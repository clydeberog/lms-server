import React, { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, ClipboardCheck, RefreshCw, Video } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { formatManilaDateTime } from '../lib/dateTime';
import { normalizeEmail, upsertAttendanceByStaff } from '../lib/lmsFirestore';
import { syncMeetAttendanceParticipants } from '../lib/workspaceApi';
import {
  AttendanceRecord,
  AttendanceStatus,
  Course,
  CourseSession,
  Enrollment,
} from '../types';

interface CourseAttendanceTabProps {
  course: Course;
  sessions: CourseSession[];
  roster: Enrollment[];
  attendance: AttendanceRecord[];
  runWithWorkspaceToken: <T>(fn: (token: string) => Promise<T>) => Promise<T | null>;
  onNotify: (message: string, tone?: 'info' | 'success' | 'warn') => void;
}

const STATUS_LABELS: Record<AttendanceStatus, string> = {
  present: 'Present',
  late: 'Late',
  excused: 'Excused',
  absent: 'Absent',
};

export const CourseAttendanceTab: React.FC<CourseAttendanceTabProps> = ({
  course,
  sessions,
  roster,
  attendance,
  runWithWorkspaceToken,
  onNotify,
}) => {
  const { user } = useAuth();
  const [selectedSessionId, setSelectedSessionId] = useState<string>('');
  const [syncingMeet, setSyncingMeet] = useState(false);
  const [updatingKey, setUpdatingKey] = useState<string | null>(null);

  useEffect(() => {
    if (sessions.length === 0) {
      setSelectedSessionId('');
      return;
    }
    if (!selectedSessionId || !sessions.some((s) => s.id === selectedSessionId)) {
      setSelectedSessionId(sessions[sessions.length - 1].id);
    }
  }, [sessions, selectedSessionId]);

  const selectedSession = useMemo(
    () => sessions.find((s) => s.id === selectedSessionId) || null,
    [sessions, selectedSessionId]
  );

  // Only enrolled students (exclude pending approval requests and co-instructors)
  const enrolledStudents = useMemo(
    () =>
      roster
        .filter((m) => m.courseRole === 'student' && (m.status === 'active' || m.status === 'invited'))
        .sort((a, b) => a.memberName.localeCompare(b.memberName)),
    [roster]
  );

  const sessionAttendance = useMemo(() => {
    if (!selectedSession) return [];
    return attendance.filter((a) => a.sessionId === selectedSession.id);
  }, [attendance, selectedSession]);

  const attendanceByStudent = useMemo(() => {
    const byUid = new Map<string, AttendanceRecord>();
    const byEmail = new Map<string, AttendanceRecord>();
    for (const rec of sessionAttendance) {
      byUid.set(rec.studentUid, rec);
      byEmail.set(normalizeEmail(rec.studentEmail), rec);
    }
    return { byUid, byEmail };
  }, [sessionAttendance]);

  // Unified rows: all enrolled students + any extra check-ins recorded for this session
  const attendanceRows = useMemo(() => {
    const rows: Array<{
      key: string;
      studentUid: string;
      studentName: string;
      studentEmail: string;
      record: AttendanceRecord | null;
    }> = [];
    const matchedRecordIds = new Set<string>();

    for (const student of enrolledStudents) {
      const rec =
        (student.memberUid ? attendanceByStudent.byUid.get(student.memberUid) : undefined) ||
        attendanceByStudent.byEmail.get(normalizeEmail(student.memberEmail)) ||
        null;
      if (rec) matchedRecordIds.add(rec.id);
      rows.push({
        key: student.id,
        studentUid: student.memberUid || rec?.studentUid || student.id,
        studentName: student.memberName,
        studentEmail: student.memberEmail,
        record: rec,
      });
    }

    for (const rec of sessionAttendance) {
      if (matchedRecordIds.has(rec.id)) continue;
      rows.push({
        key: rec.id,
        studentUid: rec.studentUid,
        studentName: rec.studentName,
        studentEmail: rec.studentEmail,
        record: rec,
      });
    }

    return rows;
  }, [enrolledStudents, attendanceByStudent, sessionAttendance]);

  const summary = useMemo(() => {
    let present = 0;
    let late = 0;
    let excused = 0;
    let absent = 0;
    for (const row of attendanceRows) {
      const status = row.record?.status || 'absent';
      if (status === 'present') present++;
      else if (status === 'late') late++;
      else if (status === 'excused') excused++;
      else absent++;
    }
    return { present, late, excused, absent };
  }, [attendanceRows]);

  const handleStatusChange = async (
    row: { studentUid: string; studentName: string; studentEmail: string; record: AttendanceRecord | null },
    nextStatus: AttendanceStatus
  ) => {
    if (!user || !selectedSession) return;
    setUpdatingKey(row.studentUid);
    try {
      await upsertAttendanceByStaff({
        course,
        session: selectedSession,
        studentUid: row.studentUid,
        studentName: row.studentName,
        studentEmail: row.studentEmail,
        status: nextStatus,
        source: 'manual',
        joinedAt: row.record?.joinedAt || new Date().toISOString(),
        markedByUid: user.uid,
      });
      onNotify(`Marked ${row.studentName} as ${STATUS_LABELS[nextStatus]}.`, 'success');
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Unable to update attendance.', 'warn');
    } finally {
      setUpdatingKey(null);
    }
  };

  const handleSyncFromGoogleMeet = async () => {
    if (!user || !selectedSession) return;
    if (!selectedSession.meetSpaceName && !selectedSession.meetCode) {
      onNotify('This session does not have a Google Meet space ID to sync participants from.', 'warn');
      return;
    }

    setSyncingMeet(true);
    try {
      const response = await runWithWorkspaceToken((token) =>
        syncMeetAttendanceParticipants(token, {
          courseId: course.id,
          meetSpaceName: selectedSession.meetSpaceName,
          meetCode: selectedSession.meetCode,
        })
      );
      if (!response) return;

      if (response.participants.length === 0) {
        onNotify(
          response.conferenceCount === 0
            ? 'No completed or active Google Meet conference records were found for this class yet. Students who click Join Meet in the LMS are checked in automatically.'
            : 'No Google Meet participants were returned for this conference yet.',
          'info'
        );
        return;
      }

      let matchedCount = 0;
      const normalizedParticipants = response.participants.map((p) => ({
        ...p,
        normName: p.displayName.trim().toLowerCase(),
      }));

      for (const student of enrolledStudents) {
        const studentNorm = student.memberName.trim().toLowerCase();
        const emailPrefix = student.memberEmail.split('@')[0].toLowerCase();
        const match = normalizedParticipants.find(
          (p) =>
            p.normName === studentNorm ||
            p.normName.includes(studentNorm) ||
            studentNorm.includes(p.normName) ||
            p.normName.includes(emailPrefix)
        );
        if (!match) continue;

        await upsertAttendanceByStaff({
          course,
          session: selectedSession,
          studentUid: student.memberUid || student.id,
          studentName: student.memberName,
          studentEmail: student.memberEmail,
          status: 'present',
          source: 'meet_api_sync',
          joinedAt: match.earliestStartTime,
          markedByUid: user.uid,
        });
        matchedCount++;
      }

      onNotify(
        matchedCount > 0
          ? `Synced Google Meet attendance: matched ${matchedCount} enrolled student(s) from ${response.participants.length} Meet participant record(s).`
          : `Found ${response.participants.length} Meet participant(s), but none matched current student roster names. Students joining through the LMS are checked in automatically.`,
        matchedCount > 0 ? 'success' : 'info'
      );
    } catch (err) {
      onNotify(
        err instanceof Error ? err.message : 'Unable to sync attendance from Google Meet.',
        'warn'
      );
    } finally {
      setSyncingMeet(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="text-xl sm:text-2xl font-serif font-semibold text-[#1C1917]">
            04. Google Meet Class Attendance
          </h2>
          <p className="text-sm text-[#57534E] mt-0.5 max-w-2xl leading-relaxed">
            Attendance is checked automatically when an enrolled student joins the Google Meet class
            session. Accessible to instructors and admins only.
          </p>
        </div>

        {selectedSession && (selectedSession.meetSpaceName || selectedSession.meetCode) && (
          <button
            type="button"
            disabled={syncingMeet}
            onClick={handleSyncFromGoogleMeet}
            className="w-full sm:w-auto inline-flex items-center justify-center gap-2 min-h-[44px] sm:min-h-0 px-4 py-2 text-sm font-medium text-white bg-[#1E3A8A] hover:bg-[#172E6E] rounded-md transition-colors whitespace-nowrap disabled:opacity-60"
          >
            <RefreshCw className={`w-4 h-4 shrink-0 ${syncingMeet ? 'animate-spin' : ''}`} />
            <span>{syncingMeet ? 'Syncing Meet…' : 'Sync from Google Meet'}</span>
          </button>
        )}
      </div>

      {sessions.length === 0 ? (
        <div className="py-12 border-t border-b border-[#E5DFD3] text-center space-y-2">
          <ClipboardCheck className="w-6 h-6 text-[#57534E] mx-auto" />
          <p className="font-serif text-xl text-[#1C1917]">No class sessions scheduled yet</p>
          <p className="text-sm text-[#57534E] max-w-md mx-auto">
            Schedule a live Google Meet class first. Attendance records will populate automatically
            as enrolled students join the session.
          </p>
        </div>
      ) : (
        <>
          {/* Session Picker & Attendance Summary */}
          <div className="bg-[#F5F1E8] border border-[#E5DFD3] rounded-lg p-4 sm:p-5 space-y-4">
            <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
              <label className="space-y-1.5 flex-1 min-w-0">
                <span className="block text-xs font-medium text-[#57534E]">
                  Class Session
                </span>
                <select
                  aria-label="Select class session for attendance"
                  value={selectedSessionId}
                  onChange={(e) => setSelectedSessionId(e.target.value)}
                  className="w-full min-h-[44px] sm:min-h-0 px-3 py-2 text-base sm:text-sm bg-[#FBF9F5] border border-[#E5DFD3] rounded-md text-[#1C1917] focus:outline-none focus:border-[#1E3A8A]"
                >
                  {sessions.map((ses) => (
                    <option key={ses.id} value={ses.id}>
                      {ses.title} — {formatManilaDateTime(ses.scheduledStart)}
                    </option>
                  ))}
                </select>
              </label>

              {selectedSession && (
                <div className="flex flex-wrap items-center gap-4 text-xs font-mono tabular-nums">
                  <span className="text-[#14532D] font-medium">
                    Present: {summary.present}
                  </span>
                  <span className="text-[#78350F] font-medium">Late: {summary.late}</span>
                  <span className="text-[#1E3A8A] font-medium">Excused: {summary.excused}</span>
                  <span className="text-[#57534E]">Not Joined: {summary.absent}</span>
                </div>
              )}
            </div>
          </div>

          {attendanceRows.length === 0 ? (
            <div className="py-10 border-t border-b border-[#E5DFD3] text-center space-y-1.5">
              <p className="font-serif text-lg text-[#1C1917]">No enrolled students yet</p>
              <p className="text-xs text-[#57534E]">
                Approve student enrollment requests or add students in the Roster &amp; Drive ACL
                tab to track attendance.
              </p>
            </div>
          ) : (
            <>
              {/* Mobile stacked attendance cards */}
              <div className="md:hidden divide-y divide-[#E5DFD3] border-t border-b border-[#E5DFD3]">
                {attendanceRows.map((row) => {
                  const status: AttendanceStatus = row.record?.status || 'absent';
                  const isPresent = status === 'present';
                  return (
                    <div key={row.key} className="py-4 space-y-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-[#1C1917] flex items-center gap-1.5">
                            {isPresent && (
                              <CheckCircle2 className="w-4 h-4 text-[#14532D] shrink-0" />
                            )}
                            <span className="truncate">{row.studentName}</span>
                          </p>
                          <p className="text-xs font-mono text-[#57534E] break-all mt-0.5">
                            {row.studentEmail}
                          </p>
                        </div>
                        <span
                          className={`text-xs font-mono font-medium shrink-0 ${
                            status === 'present'
                              ? 'text-[#14532D]'
                              : status === 'late'
                                ? 'text-[#78350F]'
                                : status === 'excused'
                                  ? 'text-[#1E3A8A]'
                                  : 'text-[#57534E]'
                          }`}
                        >
                          {STATUS_LABELS[status]}
                        </span>
                      </div>

                      {row.record ? (
                        <p className="text-xs font-mono text-[#57534E] tabular-nums">
                          {row.record.source === 'meet_join'
                            ? 'Checked via Google Meet Join'
                            : row.record.source === 'meet_api_sync'
                              ? 'Synced via Google Meet'
                              : 'Updated by Faculty'}
                          <span className="mx-1.5">·</span>
                          <span>{formatManilaDateTime(row.record.joinedAt)}</span>
                          {row.record.meetJoinCount > 1 && (
                            <>
                              <span className="mx-1.5">·</span>
                              <span>{row.record.meetJoinCount} joins</span>
                            </>
                          )}
                        </p>
                      ) : (
                        <p className="text-xs text-[#57534E]">Has not joined Google Meet yet</p>
                      )}

                      <select
                        aria-label={`Attendance status for ${row.studentName}`}
                        value={status}
                        disabled={updatingKey === row.studentUid}
                        onChange={(e) =>
                          handleStatusChange(row, e.target.value as AttendanceStatus)
                        }
                        className="w-full min-h-[44px] px-3 py-2 text-base bg-[#FBF9F5] border border-[#E5DFD3] rounded-md text-[#1C1917] focus:outline-none focus:border-[#1E3A8A] disabled:opacity-60"
                      >
                        <option value="present">Present</option>
                        <option value="late">Late</option>
                        <option value="excused">Excused</option>
                        <option value="absent">Absent</option>
                      </select>
                    </div>
                  );
                })}
              </div>

              {/* Desktop attendance table */}
              <div className="hidden md:block overflow-x-auto border-t border-b border-[#E5DFD3]">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-[#E5DFD3] text-xs text-[#57534E]">
                      <th className="py-3 pr-4 font-medium">Student</th>
                      <th className="py-3 pr-4 font-medium">Google Email</th>
                      <th className="py-3 pr-4 font-medium">Meet Check-In</th>
                      <th className="py-3 pr-4 font-medium">Status</th>
                      <th className="py-3 text-right font-medium">Update</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#E5DFD3]">
                    {attendanceRows.map((row) => {
                      const status: AttendanceStatus = row.record?.status || 'absent';
                      return (
                        <tr key={row.key}>
                          <td className="py-3 pr-4 font-medium text-[#1C1917]">
                            <span className="inline-flex items-center gap-1.5">
                              {status === 'present' && (
                                <CheckCircle2 className="w-3.5 h-3.5 text-[#14532D] shrink-0" />
                              )}
                              <span>{row.studentName}</span>
                            </span>
                          </td>
                          <td className="py-3 pr-4 font-mono text-xs text-[#57534E]">
                            {row.studentEmail}
                          </td>
                          <td className="py-3 pr-4 font-mono text-xs text-[#57534E] tabular-nums">
                            {row.record ? (
                              <span className="inline-flex items-center gap-1.5">
                                {row.record.source !== 'manual' && (
                                  <Video className="w-3.5 h-3.5 text-[#14532D] shrink-0" />
                                )}
                                <span>{formatManilaDateTime(row.record.joinedAt)}</span>
                                <span className="text-[#57534E]">
                                  (
                                  {row.record.source === 'meet_join'
                                    ? 'Meet Join'
                                    : row.record.source === 'meet_api_sync'
                                      ? 'Meet Sync'
                                      : 'Manual'}
                                  )
                                </span>
                              </span>
                            ) : (
                              <span>Not joined yet</span>
                            )}
                          </td>
                          <td className="py-3 pr-4 text-xs font-medium">
                            <span
                              className={
                                status === 'present'
                                  ? 'text-[#14532D]'
                                  : status === 'late'
                                    ? 'text-[#78350F]'
                                    : status === 'excused'
                                      ? 'text-[#1E3A8A]'
                                      : 'text-[#57534E]'
                              }
                            >
                              {STATUS_LABELS[status]}
                            </span>
                          </td>
                          <td className="py-3 text-right">
                            <select
                              aria-label={`Attendance status for ${row.studentName}`}
                              value={status}
                              disabled={updatingKey === row.studentUid}
                              onChange={(e) =>
                                handleStatusChange(row, e.target.value as AttendanceStatus)
                              }
                              className="px-2.5 py-1.5 text-xs bg-[#FBF9F5] border border-[#E5DFD3] rounded-md text-[#1C1917] focus:outline-none focus:border-[#1E3A8A] disabled:opacity-60"
                            >
                              <option value="present">Present</option>
                              <option value="late">Late</option>
                              <option value="excused">Excused</option>
                              <option value="absent">Absent</option>
                            </select>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
};
