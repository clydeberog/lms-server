import React, { useEffect, useMemo, useState } from 'react';
import { FolderPlus, Plus, ShieldCheck, UserCheck, Users, Video, X } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { BOOTSTRAP_ADMIN_EMAIL, clearWorkspaceAccessToken } from '../firebase';
import {
  createCourseRecord,
  listDirectoryUsersForAdmin,
  updateUserRoleAsAdmin,
} from '../lib/lmsFirestore';
import { ensureCourseDriveFolder, WorkspaceAuthExpiredError } from '../lib/workspaceApi';
import {
  Course,
  CourseRecording,
  CourseResource,
  CourseSession,
  DirectoryUser,
  Enrollment,
  RegistrationRequest,
  UserRole,
} from '../types';
import { ConfirmActionRequest } from './ConfirmActionModal';
import { AdminMeetDashboard, AdminSessionRecord } from './AdminMeetDashboard';
import { ApprovalsPanel } from './ApprovalsPanel';

interface AdminFacultyPanelProps {
  courses: Course[];
  sessions: AdminSessionRecord[];
  recordings: CourseRecording[];
  resources: CourseResource[];
  registrationRequests: RegistrationRequest[];
  pendingEnrollments: Enrollment[];
  onOpenCourse: (courseId: string) => void;
  onDeleteMeetInvite: (course: Course, session: CourseSession) => void;
  onRequestConfirm: (req: ConfirmActionRequest) => void;
  onCourseCreated: (courseId: string) => void;
  onNotify: (message: string, tone?: 'info' | 'success' | 'warn') => void;
}

type PhTermPeriod =
  | '1st Semester'
  | '2nd Semester'
  | 'Midyear'
  | 'Full School Year'
  | '1st Quarter'
  | '2nd Quarter'
  | '3rd Quarter'
  | '4th Quarter'
  | 'Custom';

function getDefaultPhSchoolYear(): string {
  const now = new Date();
  const year = now.getFullYear();
  const startYear = now.getMonth() >= 5 ? year : year - 1;
  return `S.Y. ${startYear}-${startYear + 1}`;
}

export const AdminFacultyPanel: React.FC<AdminFacultyPanelProps> = ({
  courses,
  sessions,
  recordings,
  resources,
  registrationRequests,
  pendingEnrollments,
  onOpenCourse,
  onDeleteMeetInvite,
  onRequestConfirm,
  onCourseCreated,
  onNotify,
}) => {
  const { user, profile, isAdmin, isInstructor, ensureWorkspaceToken } = useAuth();

  const [showCreateCourse, setShowCreateCourse] = useState(false);
  const [showFacultyConsole, setShowFacultyConsole] = useState(false);
  const [showMeetDashboard, setShowMeetDashboard] = useState(false);
  const [showApprovals, setShowApprovals] = useState(false);

  const activeMeetCount = useMemo(
    () => sessions.filter((s) => Boolean(s.meetUri || s.calendarEventId)).length,
    [sessions]
  );

  const pendingApprovalsCount = useMemo(() => {
    const pendingReg = registrationRequests.filter((r) => r.status === 'pending').length;
    return pendingReg + pendingEnrollments.length;
  }, [registrationRequests, pendingEnrollments]);

  const [code, setCode] = useState('');
  const [title, setTitle] = useState('');
  const [phPeriod, setPhPeriod] = useState<PhTermPeriod>('1st Semester');
  const [schoolYear, setSchoolYear] = useState<string>(() => getDefaultPhSchoolYear());
  const [description, setDescription] = useState('');
  const [provisionDriveFolder, setProvisionDriveFolder] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const [directoryUsers, setDirectoryUsers] = useState<DirectoryUser[]>([]);
  const [loadingDirectory, setLoadingDirectory] = useState(false);
  const [updatingUid, setUpdatingUid] = useState<string | null>(null);

  useEffect(() => {
    if (!showFacultyConsole || !isAdmin) return;
    let active = true;
    setLoadingDirectory(true);
    listDirectoryUsersForAdmin()
      .then((list) => {
        if (active) setDirectoryUsers(list);
      })
      .catch((err) => {
        onNotify(err instanceof Error ? err.message : 'Unable to load directory.', 'warn');
      })
      .finally(() => {
        if (active) setLoadingDirectory(false);
      });
    return () => {
      active = false;
    };
  }, [showFacultyConsole, isAdmin, onNotify]);

  // Close Admin-only panels if user toggles to Instructor preview
  useEffect(() => {
    if (!isAdmin) {
      setShowMeetDashboard(false);
      setShowFacultyConsole(false);
    }
  }, [isAdmin]);

  if (!isInstructor || !user || !profile) return null;

  const formattedSchoolYearTerm =
    phPeriod === 'Full School Year' || phPeriod === 'Custom'
      ? schoolYear.trim()
      : `${phPeriod}, ${schoolYear.trim()}`;

  const handleCreateCourseSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!code.trim() || !title.trim() || !schoolYear.trim()) {
      onNotify('Course code, title, and school year are required.', 'warn');
      return;
    }
    const finalTerm = formattedSchoolYearTerm.slice(0, 48);
    if (finalTerm.length < 2) {
      onNotify('Enter a valid Philippine school year (e.g., S.Y. 2026-2027).', 'warn');
      return;
    }

    const executeCreation = async () => {
      setSubmitting(true);
      try {
        let driveFolderId: string | undefined;
        let driveFolderUrl: string | undefined;

        if (provisionDriveFolder) {
          let token = await ensureWorkspaceToken();
          if (!token) {
            onNotify('Google Workspace authorization is required to create a Drive folder.', 'warn');
            return;
          }
          const folderTitle = `${code.trim().toUpperCase()} — ${title.trim()}`;
          const folderOptions = { staffEmails: [BOOTSTRAP_ADMIN_EMAIL] };
          let folder: { id: string; name: string; webViewLink: string };
          try {
            folder = await ensureCourseDriveFolder(token, folderTitle, folderOptions);
          } catch (err) {
            if (err instanceof WorkspaceAuthExpiredError) {
              clearWorkspaceAccessToken();
              token = await ensureWorkspaceToken();
              if (!token) {
                onNotify('Google Workspace session expired. Please re-authorize.', 'warn');
                return;
              }
              folder = await ensureCourseDriveFolder(token, folderTitle, folderOptions);
            } else {
              throw err;
            }
          }
          driveFolderId = folder.id;
          driveFolderUrl = folder.webViewLink;
        }

        const courseId = await createCourseRecord({
          code: code.trim().toUpperCase(),
          title: title.trim(),
          term: finalTerm,
          description: description.trim(),
          instructorUid: user.uid,
          instructorName: profile.displayName,
          instructorEmail: user.email || '',
          driveFolderId,
          driveFolderUrl,
        });

        setCode('');
        setTitle('');
        setDescription('');
        setShowCreateCourse(false);
        onNotify(`Course ${code.trim().toUpperCase()} created. Enroll students to begin.`, 'success');
        onCourseCreated(courseId);
      } catch (err) {
        onNotify(err instanceof Error ? err.message : 'Failed to create course.', 'warn');
      } finally {
        setSubmitting(false);
      }
    };

    if (provisionDriveFolder) {
      onRequestConfirm({
        title: 'Create Course & Google Drive Folder',
        description:
          'This will create a new course in Firestore and provision a dedicated folder inside your Google Drive under "LMS" (accessible to admins and instructors only).',
        details: [
          `Course: ${code.trim().toUpperCase()} — ${title.trim()}`,
          `School Year (PH): ${finalTerm}`,
          `Google Drive Folder: LMS / ${code.trim().toUpperCase()} — ${title.trim()}`,
          'Folder Access: Admins & Instructors only (students receive viewer-only file access)',
        ],
        confirmLabel: 'Create Course & Folder',
        onConfirm: executeCreation,
      });
    } else {
      void executeCreation();
    }
  };

  const handleRoleChange = async (target: DirectoryUser, newRole: UserRole) => {
    if (!user || target.role === newRole) return;
    setUpdatingUid(target.uid);
    try {
      await updateUserRoleAsAdmin(user.uid, target.uid, newRole);
      setDirectoryUsers((prev) =>
        prev.map((item) =>
          item.uid === target.uid
            ? {
                ...item,
                role: newRole,
                approvalStatus:
                  newRole === 'admin' || newRole === 'instructor'
                    ? 'approved'
                    : item.approvalStatus,
              }
            : item
        )
      );
      onNotify(`Updated ${target.displayName} to ${newRole}.`, 'success');
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Unable to update user role.', 'warn');
    } finally {
      setUpdatingUid(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-center sm:justify-between gap-4 pb-5 border-b border-[#E5DFD3]">
        <div className="min-w-0">
          <p className="text-xs text-[#57534E] font-medium break-words">
            {isAdmin ? 'Academic Administration & Faculty' : 'Faculty Workspace'}
            <span className="mx-2" aria-hidden="true">
              ·
            </span>
            <span className="break-all">{user.email}</span>
          </p>
          <h2 className="text-xl sm:text-2xl font-serif font-semibold text-[#1C1917] mt-1">
            Course Governance &amp; Roster Controls
          </h2>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 sm:gap-3 w-full sm:w-auto">
          <button
            type="button"
            onClick={() => {
              setShowApprovals((prev) => !prev);
              setShowMeetDashboard(false);
              setShowFacultyConsole(false);
              setShowCreateCourse(false);
            }}
            aria-expanded={showApprovals}
            className={`flex-1 sm:flex-initial inline-flex items-center justify-center gap-2 min-h-[44px] sm:min-h-0 px-3.5 sm:px-4 py-2 text-sm font-medium rounded-md transition-colors whitespace-nowrap border ${
              showApprovals
                ? 'text-[#1E3A8A] bg-[#EBE6DF] border-[#1E3A8A]/40'
                : 'text-[#1C1917] bg-[#F5F1E8] hover:bg-[#EBE6DF] border-[#E5DFD3]'
            }`}
          >
            <UserCheck className="w-4 h-4 text-[#1E3A8A] shrink-0" />
            <span>
              Approvals
              {pendingApprovalsCount > 0 && (
                <span className="ml-1.5 font-mono text-xs text-[#78350F] font-semibold tabular-nums">
                  ({pendingApprovalsCount})
                </span>
              )}
            </span>
          </button>

          {isAdmin && (
            <>
              <button
                type="button"
                onClick={() => {
                  setShowMeetDashboard((prev) => !prev);
                  setShowApprovals(false);
                  setShowFacultyConsole(false);
                  setShowCreateCourse(false);
                }}
                aria-expanded={showMeetDashboard}
                className={`flex-1 sm:flex-initial inline-flex items-center justify-center gap-2 min-h-[44px] sm:min-h-0 px-3.5 sm:px-4 py-2 text-sm font-medium rounded-md transition-colors whitespace-nowrap border ${
                  showMeetDashboard
                    ? 'text-[#1E3A8A] bg-[#EBE6DF] border-[#1E3A8A]/40'
                    : 'text-[#1C1917] bg-[#F5F1E8] hover:bg-[#EBE6DF] border-[#E5DFD3]'
                }`}
              >
                <Video className="w-4 h-4 text-[#1E3A8A] shrink-0" />
                <span>
                  Meet Dashboard
                  {sessions.length > 0 && (
                    <span className="ml-1.5 font-mono text-xs text-[#57534E] tabular-nums">
                      ({activeMeetCount}/{sessions.length})
                    </span>
                  )}
                </span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowFacultyConsole((prev) => !prev);
                  setShowApprovals(false);
                  setShowMeetDashboard(false);
                  setShowCreateCourse(false);
                }}
                aria-expanded={showFacultyConsole}
                className={`flex-1 sm:flex-initial inline-flex items-center justify-center gap-2 min-h-[44px] sm:min-h-0 px-3.5 sm:px-4 py-2 text-sm font-medium rounded-md transition-colors whitespace-nowrap border ${
                  showFacultyConsole
                    ? 'text-[#1E3A8A] bg-[#EBE6DF] border-[#1E3A8A]/40'
                    : 'text-[#1C1917] bg-[#F5F1E8] hover:bg-[#EBE6DF] border-[#E5DFD3]'
                }`}
              >
                <Users className="w-4 h-4 text-[#57534E] shrink-0" />
                <span>Faculty Roles</span>
              </button>
            </>
          )}
          <button
            type="button"
            onClick={() => {
              setShowCreateCourse((prev) => !prev);
              setShowApprovals(false);
              setShowFacultyConsole(false);
              setShowMeetDashboard(false);
            }}
            aria-expanded={showCreateCourse}
            className="w-full sm:w-auto inline-flex items-center justify-center gap-2 min-h-[44px] sm:min-h-0 px-3.5 sm:px-4 py-2 text-sm font-medium text-white bg-[#1E3A8A] hover:bg-[#172E6E] rounded-md transition-colors whitespace-nowrap"
          >
            <Plus className="w-4 h-4 shrink-0" />
            <span>New Course</span>
          </button>
        </div>
      </div>

      {/* Approvals Panel (Admins & Instructors) */}
      {showApprovals && (
        <ApprovalsPanel
          registrationRequests={registrationRequests}
          pendingEnrollments={pendingEnrollments}
          onClose={() => setShowApprovals(false)}
          onNotify={onNotify}
        />
      )}

      {/* Admin Google Meet Dashboard */}
      {showMeetDashboard && isAdmin && (
        <AdminMeetDashboard
          courses={courses}
          sessions={sessions}
          recordings={recordings}
          resources={resources}
          onOpenCourse={onOpenCourse}
          onDeleteMeetInvite={onDeleteMeetInvite}
          onClose={() => setShowMeetDashboard(false)}
        />
      )}

      {/* Create Course Form */}
      {showCreateCourse && (
        <form
          onSubmit={handleCreateCourseSubmit}
          className="bg-[#F5F1E8] border border-[#E5DFD3] rounded-lg p-4 sm:p-6 space-y-5"
        >
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-xl font-serif font-semibold text-[#1C1917]">
              Create Academic Course
            </h3>
            <button
              type="button"
              onClick={() => setShowCreateCourse(false)}
              className="text-[#57534E] hover:text-[#1C1917] min-w-[44px] min-h-[44px] -mr-2 flex items-center justify-center rounded-md"
              aria-label="Close course form"
            >
              <X className="w-5 h-5 sm:w-4 sm:h-4" />
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <label className="space-y-1.5">
              <span className="block text-xs font-medium text-[#57534E]">Course Code</span>
              <input
                type="text"
                required
                maxLength={24}
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="e.g., BIBL-201"
                className="w-full min-h-[44px] sm:min-h-0 px-3 py-2 text-base sm:text-sm bg-[#FBF9F5] border border-[#E5DFD3] rounded-md focus:outline-none focus:border-[#1E3A8A]"
              />
            </label>
            <label className="space-y-1.5 md:col-span-2">
              <span className="block text-xs font-medium text-[#57534E]">Course Title</span>
              <input
                type="text"
                required
                maxLength={160}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g., Biblical Hermeneutics & Exegesis"
                className="w-full min-h-[44px] sm:min-h-0 px-3 py-2 text-base sm:text-sm bg-[#FBF9F5] border border-[#E5DFD3] rounded-md focus:outline-none focus:border-[#1E3A8A]"
              />
            </label>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <label className="space-y-1.5">
              <span className="block text-xs font-medium text-[#57534E]">
                Semester / Quarter
              </span>
              <select
                value={phPeriod}
                onChange={(e) => setPhPeriod(e.target.value as PhTermPeriod)}
                className="w-full min-h-[44px] sm:min-h-0 px-3 py-2 text-base sm:text-sm bg-[#FBF9F5] border border-[#E5DFD3] rounded-md text-[#1C1917] focus:outline-none focus:border-[#1E3A8A]"
              >
                <option value="1st Semester">1st Semester</option>
                <option value="2nd Semester">2nd Semester</option>
                <option value="Midyear">Midyear / Summer</option>
                <option value="Full School Year">Full School Year</option>
                <option value="1st Quarter">1st Quarter</option>
                <option value="2nd Quarter">2nd Quarter</option>
                <option value="3rd Quarter">3rd Quarter</option>
                <option value="4th Quarter">4th Quarter</option>
                <option value="Custom">Custom</option>
              </select>
            </label>
            <label className="space-y-1.5">
              <span className="block text-xs font-medium text-[#57534E]">School Year</span>
              <input
                type="text"
                required
                maxLength={phPeriod === 'Custom' || phPeriod === 'Full School Year' ? 48 : 30}
                value={schoolYear}
                onChange={(e) => setSchoolYear(e.target.value)}
                placeholder="e.g., S.Y. 2026-2027"
                className="w-full min-h-[44px] sm:min-h-0 px-3 py-2 text-base sm:text-sm bg-[#FBF9F5] border border-[#E5DFD3] rounded-md focus:outline-none focus:border-[#1E3A8A]"
              />
            </label>
            <label className="space-y-1.5">
              <span className="block text-xs font-medium text-[#57534E]">
                Syllabus Overview (Optional)
              </span>
              <input
                type="text"
                maxLength={2000}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Course objectives and overview"
                className="w-full min-h-[44px] sm:min-h-0 px-3 py-2 text-base sm:text-sm bg-[#FBF9F5] border border-[#E5DFD3] rounded-md focus:outline-none focus:border-[#1E3A8A]"
              />
            </label>
          </div>
          <p className="text-xs text-[#57534E] font-mono">
            Saved term preview:{' '}
            <span className="text-[#1C1917] font-medium">
              {formattedSchoolYearTerm || 'Enter a school year'}
            </span>
          </p>

          <label className="flex items-start gap-3 py-1 text-sm text-[#1C1917] cursor-pointer">
            <input
              type="checkbox"
              checked={provisionDriveFolder}
              onChange={(e) => setProvisionDriveFolder(e.target.checked)}
              className="mt-1 w-4 h-4 accent-[#1E3A8A] shrink-0"
            />
            <span>
              <span className="font-medium inline-flex items-center gap-1.5">
                <FolderPlus className="w-4 h-4 text-[#1E3A8A] shrink-0" />
                Provision course folder in Google Drive
              </span>
              <span className="block text-xs text-[#57534E] mt-0.5">
                Organizes uploaded course materials and recordings under LMS in Drive for admins and
                instructors only. Students receive viewer-only file access.
              </span>
            </span>
          </label>

          <div className="flex flex-col-reverse sm:flex-row sm:items-center sm:justify-end gap-2.5 sm:gap-3 pt-3 border-t border-[#E5DFD3]">
            <button
              type="button"
              onClick={() => setShowCreateCourse(false)}
              className="w-full sm:w-auto min-h-[44px] sm:min-h-0 px-4 py-2 text-sm font-medium text-[#57534E] hover:text-[#1C1917] border border-[#E5DFD3] sm:border-transparent rounded-md text-center"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="w-full sm:w-auto min-h-[44px] sm:min-h-0 px-4 py-2 text-sm font-medium text-white bg-[#1E3A8A] hover:bg-[#172E6E] rounded-md transition-colors disabled:opacity-60 text-center"
            >
              {submitting ? 'Creating…' : 'Create Course'}
            </button>
          </div>
        </form>
      )}

      {/* Admin Faculty Directory */}
      {showFacultyConsole && isAdmin && (
        <div className="bg-[#F5F1E8] border border-[#E5DFD3] rounded-lg p-4 sm:p-6 space-y-4">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2.5 min-w-0">
              <ShieldCheck className="w-5 h-5 text-[#1E3A8A] shrink-0" />
              <h3 className="text-lg sm:text-xl font-serif font-semibold text-[#1C1917]">
                Registered Users &amp; Role Assignments
              </h3>
            </div>
            <button
              type="button"
              onClick={() => setShowFacultyConsole(false)}
              className="text-[#57534E] hover:text-[#1C1917] min-w-[44px] min-h-[44px] -mr-2 flex items-center justify-center rounded-md shrink-0"
              aria-label="Close directory"
            >
              <X className="w-5 h-5 sm:w-4 sm:h-4" />
            </button>
          </div>

          <p className="text-sm text-[#57534E] max-w-2xl leading-relaxed">
            New accounts register as students pending approval. Promote verified faculty members to
            instructor so they can create courses, schedule Google Meet sessions, review approvals,
            and manage student rosters.
          </p>

          {loadingDirectory ? (
            <p className="text-sm text-[#57534E] py-4">Loading registered accounts…</p>
          ) : directoryUsers.length === 0 ? (
            <p className="text-sm text-[#57534E] py-4">No registered users found yet.</p>
          ) : (
            <>
              {/* Mobile stacked card directory */}
              <div className="md:hidden divide-y divide-[#E5DFD3] border-t border-[#E5DFD3]">
                {directoryUsers.map((entry) => {
                  const isSelf = entry.uid === user.uid;
                  const status = entry.approvalStatus || 'approved';
                  return (
                    <div key={entry.uid} className="py-3.5 space-y-2.5">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-[#1C1917]">
                          {entry.displayName}
                          {isSelf && <span className="ml-2 text-xs text-[#57534E]">(You)</span>}
                        </p>
                        <p className="font-mono text-xs text-[#57534E] break-all mt-0.5">
                          {entry.email || 'Private'}
                          <span className="mx-1.5">·</span>
                          <span
                            className={
                              status === 'approved'
                                ? 'text-[#14532D]'
                                : status === 'pending'
                                  ? 'text-[#78350F]'
                                  : 'text-[#78350F]'
                            }
                          >
                            {status}
                          </span>
                        </p>
                      </div>
                      <label className="block space-y-1">
                        <span className="text-[11px] font-medium text-[#57534E]">Role</span>
                        <select
                          aria-label={`Role for ${entry.displayName}`}
                          value={entry.role}
                          disabled={updatingUid === entry.uid || isSelf}
                          onChange={(e) => handleRoleChange(entry, e.target.value as UserRole)}
                          className="w-full min-h-[44px] px-3 py-2 text-base bg-[#FBF9F5] border border-[#E5DFD3] rounded-md text-[#1C1917] focus:outline-none focus:border-[#1E3A8A] disabled:opacity-60"
                        >
                          <option value="student">Student</option>
                          <option value="instructor">Instructor</option>
                          <option value="admin">Admin</option>
                        </select>
                      </label>
                    </div>
                  );
                })}
              </div>

              {/* Desktop table directory */}
              <div className="hidden md:block overflow-x-auto border-t border-[#E5DFD3]">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-[#E5DFD3] text-xs text-[#57534E]">
                      <th className="py-3 pr-4 font-medium">Name</th>
                      <th className="py-3 pr-4 font-medium">Verified Email</th>
                      <th className="py-3 pr-4 font-medium">Access Status</th>
                      <th className="py-3 pr-4 font-medium">Role</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#E5DFD3]">
                    {directoryUsers.map((entry) => {
                      const isSelf = entry.uid === user.uid;
                      const status = entry.approvalStatus || 'approved';
                      return (
                        <tr key={entry.uid}>
                          <td className="py-3 pr-4 font-medium text-[#1C1917]">
                            {entry.displayName}
                            {isSelf && (
                              <span className="ml-2 text-xs text-[#57534E]">(You)</span>
                            )}
                          </td>
                          <td className="py-3 pr-4 font-mono text-xs text-[#57534E]">
                            {entry.email || 'Private'}
                          </td>
                          <td className="py-3 pr-4 text-xs capitalize">
                            <span
                              className={
                                status === 'approved'
                                  ? 'text-[#14532D] font-medium'
                                  : 'text-[#78350F] font-medium'
                              }
                            >
                              {status}
                            </span>
                          </td>
                          <td className="py-3 pr-4">
                            <select
                              aria-label={`Role for ${entry.displayName}`}
                              value={entry.role}
                              disabled={updatingUid === entry.uid || isSelf}
                              onChange={(e) => handleRoleChange(entry, e.target.value as UserRole)}
                              className="px-2.5 py-1.5 text-xs bg-[#FBF9F5] border border-[#E5DFD3] rounded-md text-[#1C1917] focus:outline-none focus:border-[#1E3A8A] disabled:opacity-60"
                            >
                              <option value="student">Student</option>
                              <option value="instructor">Instructor</option>
                              <option value="admin">Admin</option>
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
        </div>
      )}
    </div>
  );
};
