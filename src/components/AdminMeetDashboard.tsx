import React, { useMemo, useState } from 'react';
import {
  ArrowRight,
  Clock,
  ExternalLink,
  Search,
  Video,
  VideoOff,
  X,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { formatManilaDateTime } from '../lib/dateTime';
import { Course, CourseRecording, CourseResource, CourseSession } from '../types';

export interface AdminSessionRecord extends CourseSession {
  courseCode: string;
  courseTitle: string;
  instructorName: string;
}

type TimestampSortMode = 'created_desc' | 'created_asc' | 'scheduled_desc' | 'scheduled_asc';
type MeetStatusFilter = 'all' | 'active' | 'closed';

interface AdminMeetDashboardProps {
  courses: Course[];
  sessions: AdminSessionRecord[];
  recordings: CourseRecording[];
  resources: CourseResource[];
  onOpenCourse: (courseId: string) => void;
  onDeleteMeetInvite: (course: Course, session: CourseSession) => void;
  onClose: () => void;
}

function getCreatedMillis(session: CourseSession): number {
  if (session.createdAt && typeof session.createdAt.toMillis === 'function') {
    return session.createdAt.toMillis();
  }
  const fallback = Date.parse(session.scheduledStart);
  return Number.isNaN(fallback) ? 0 : fallback;
}

function getScheduledMillis(session: CourseSession): number {
  const parsed = Date.parse(session.scheduledStart);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function formatDateTime(input: Date | string): string {
  return formatManilaDateTime(input);
}

function formatCreatedTimestamp(session: CourseSession): string {
  if (session.createdAt && typeof session.createdAt.toDate === 'function') {
    return formatManilaDateTime(session.createdAt.toDate());
  }
  return formatManilaDateTime(session.scheduledStart);
}

export const AdminMeetDashboard: React.FC<AdminMeetDashboardProps> = ({
  courses,
  sessions,
  recordings,
  resources,
  onOpenCourse,
  onDeleteMeetInvite,
  onClose,
}) => {
  const { isAdmin } = useAuth();

  const [sortMode, setSortMode] = useState<TimestampSortMode>('created_desc');
  const [statusFilter, setStatusFilter] = useState<MeetStatusFilter>('all');
  const [courseFilter, setCourseFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');

  const courseById = useMemo(() => {
    const map = new Map<string, Course>();
    for (const c of courses) map.set(c.id, c);
    return map;
  }, [courses]);

  const recordingCountBySessionId = useMemo(() => {
    const map = new Map<string, number>();
    for (const rec of recordings) {
      map.set(rec.sessionId, (map.get(rec.sessionId) || 0) + 1);
    }
    return map;
  }, [recordings]);

  const resourceCountBySessionId = useMemo(() => {
    const map = new Map<string, number>();
    for (const res of resources) {
      if (!res.sessionId) continue;
      map.set(res.sessionId, (map.get(res.sessionId) || 0) + 1);
    }
    return map;
  }, [resources]);

  const stats = useMemo(() => {
    let activeCount = 0;
    let closedCount = 0;
    let preservedRecordings = 0;
    let preservedResources = 0;

    for (const ses of sessions) {
      if (ses.meetUri || ses.calendarEventId) {
        activeCount++;
      } else {
        closedCount++;
      }
      preservedRecordings += recordingCountBySessionId.get(ses.id) || 0;
      preservedResources += resourceCountBySessionId.get(ses.id) || 0;
    }

    return {
      total: sessions.length,
      activeCount,
      closedCount,
      preservedRecordings,
      preservedResources,
    };
  }, [sessions, recordingCountBySessionId, resourceCountBySessionId]);

  const filteredSessions = useMemo(() => {
    const needle = searchQuery.trim().toLowerCase();

    const matched = sessions.filter((ses) => {
      const isMeetActive = Boolean(ses.meetUri || ses.calendarEventId);
      if (statusFilter === 'active' && !isMeetActive) return false;
      if (statusFilter === 'closed' && isMeetActive) return false;
      if (courseFilter !== 'all' && ses.courseId !== courseFilter) return false;
      if (needle) {
        const haystack = [
          ses.title,
          ses.courseCode,
          ses.courseTitle,
          ses.instructorName,
          ses.meetCode || '',
        ]
          .join(' ')
          .toLowerCase();
        if (!haystack.includes(needle)) return false;
      }
      return true;
    });

    return [...matched].sort((a, b) => {
      switch (sortMode) {
        case 'created_asc':
          return getCreatedMillis(a) - getCreatedMillis(b);
        case 'scheduled_desc':
          return getScheduledMillis(b) - getScheduledMillis(a);
        case 'scheduled_asc':
          return getScheduledMillis(a) - getScheduledMillis(b);
        case 'created_desc':
        default:
          return getCreatedMillis(b) - getCreatedMillis(a);
      }
    });
  }, [sessions, statusFilter, courseFilter, searchQuery, sortMode]);

  if (!isAdmin) return null;

  return (
    <div className="bg-[#F5F1E8] border border-[#E5DFD3] rounded-lg p-4 sm:p-6 space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1 min-w-0">
          <p className="text-xs font-mono text-[#1E3A8A]">
            Admin Oversight · All Google Meet Sessions by Timestamp
          </p>
          <h3 className="text-xl sm:text-2xl font-serif font-semibold text-[#1C1917]">
            Google Meet Dashboard
          </h3>
          <p className="text-sm text-[#57534E] max-w-2xl leading-relaxed">
            Review every Google Meet session created across all courses ordered by timestamp.
            Deleting a Google Meet stops any active call and removes its Calendar invite while
            preserving the saved class session, synced recordings, and lesson resources.
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="text-[#57534E] hover:text-[#1C1917] min-w-[44px] min-h-[44px] -mr-2 -mt-1 flex items-center justify-center rounded-md shrink-0"
          aria-label="Close Google Meet dashboard"
        >
          <X className="w-5 h-5 sm:w-4 sm:h-4" />
        </button>
      </div>

      {/* Summary Metrics Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 border-t border-b border-[#E5DFD3] py-3.5">
        <div>
          <p className="text-[11px] font-mono text-[#57534E]">Total Created</p>
          <p className="text-xl font-serif font-semibold text-[#1C1917] tabular-nums mt-0.5">
            {stats.total}
          </p>
        </div>
        <div>
          <p className="text-[11px] font-mono text-[#1E3A8A]">Active Meet Links</p>
          <p className="text-xl font-serif font-semibold text-[#1E3A8A] tabular-nums mt-0.5">
            {stats.activeCount}
          </p>
        </div>
        <div>
          <p className="text-[11px] font-mono text-[#78350F]">Meet Closed</p>
          <p className="text-xl font-serif font-semibold text-[#78350F] tabular-nums mt-0.5">
            {stats.closedCount}
          </p>
        </div>
        <div>
          <p className="text-[11px] font-mono text-[#14532D]">Preserved Assets</p>
          <p className="text-xs font-mono text-[#14532D] font-medium tabular-nums mt-1.5">
            {stats.preservedRecordings} Rec{stats.preservedRecordings === 1 ? '' : 's'}
            <span className="mx-1.5">·</span>
            {stats.preservedResources} File{stats.preservedResources === 1 ? '' : 's'}
          </p>
        </div>
      </div>

      {/* Filter & Timestamp Sort Controls */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-12 gap-2.5 sm:gap-3">
        <div className="relative lg:col-span-4">
          <Search className="w-4 h-4 text-[#57534E] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search lecture, course, instructor, or code…"
            aria-label="Search Google Meet sessions"
            className="w-full min-h-[44px] sm:min-h-0 pl-9 pr-3 py-2 text-base sm:text-xs bg-[#FBF9F5] border border-[#E5DFD3] rounded-md text-[#1C1917] focus:outline-none focus:border-[#1E3A8A]"
          />
        </div>

        <select
          aria-label="Sort sessions by timestamp"
          value={sortMode}
          onChange={(e) => setSortMode(e.target.value as TimestampSortMode)}
          className="lg:col-span-3 w-full min-h-[44px] sm:min-h-0 px-3 py-2 text-base sm:text-xs bg-[#FBF9F5] border border-[#E5DFD3] rounded-md text-[#1C1917] focus:outline-none focus:border-[#1E3A8A]"
        >
          <option value="created_desc">Created Timestamp: Newest First</option>
          <option value="created_asc">Created Timestamp: Oldest First</option>
          <option value="scheduled_desc">Scheduled Start: Latest First</option>
          <option value="scheduled_asc">Scheduled Start: Earliest First</option>
        </select>

        <select
          aria-label="Filter by Google Meet status"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as MeetStatusFilter)}
          className="lg:col-span-2 w-full min-h-[44px] sm:min-h-0 px-3 py-2 text-base sm:text-xs bg-[#FBF9F5] border border-[#E5DFD3] rounded-md text-[#1C1917] focus:outline-none focus:border-[#1E3A8A]"
        >
          <option value="all">All Statuses</option>
          <option value="active">Active Meet Only</option>
          <option value="closed">Meet Closed</option>
        </select>

        <select
          aria-label="Filter by course"
          value={courseFilter}
          onChange={(e) => setCourseFilter(e.target.value)}
          className="lg:col-span-3 w-full min-h-[44px] sm:min-h-0 px-3 py-2 text-base sm:text-xs bg-[#FBF9F5] border border-[#E5DFD3] rounded-md text-[#1C1917] focus:outline-none focus:border-[#1E3A8A]"
        >
          <option value="all">All Courses ({courses.length})</option>
          {courses.map((c) => (
            <option key={c.id} value={c.id}>
              {c.code} — {c.title}
            </option>
          ))}
        </select>
      </div>

      {filteredSessions.length === 0 ? (
        <div className="py-10 text-center space-y-1.5 border-t border-[#E5DFD3]">
          <Clock className="w-5 h-5 text-[#57534E] mx-auto" />
          <p className="font-serif text-lg text-[#1C1917]">No matching Google Meet sessions</p>
          <p className="text-xs text-[#57534E]">
            {sessions.length === 0
              ? 'No virtual class sessions have been created across the school yet.'
              : 'Try adjusting your status, course, or search filter.'}
          </p>
        </div>
      ) : (
        <>
          {/* Mobile Stacked Cards */}
          <div className="md:hidden divide-y divide-[#E5DFD3] border-t border-[#E5DFD3]">
            {filteredSessions.map((ses) => {
              const parentCourse = courseById.get(ses.courseId);
              const isMeetActive = Boolean(ses.meetUri || ses.calendarEventId);
              const recCount = recordingCountBySessionId.get(ses.id) || 0;
              const fileCount = resourceCountBySessionId.get(ses.id) || 0;

              return (
                <div key={ses.id} className="py-4 space-y-3">
                  <div className="space-y-1 min-w-0">
                    <p className="text-[11px] font-mono text-[#57534E] tabular-nums">
                      Created: <span className="text-[#1C1917]">{formatCreatedTimestamp(ses)}</span>
                    </p>
                    <p className="text-xs font-mono text-[#57534E] tabular-nums leading-relaxed">
                      <span className="text-[#1E3A8A] font-medium">{ses.courseCode}</span>
                      <span className="mx-1.5">·</span>
                      <span>{ses.instructorName}</span>
                      <span className="mx-1.5">·</span>
                      <span
                        className={
                          isMeetActive ? 'text-[#14532D] font-medium' : 'text-[#78350F] font-medium'
                        }
                      >
                        {isMeetActive ? 'Meet Active' : 'Meet Closed'}
                      </span>
                    </p>
                    <h4 className="text-base font-serif font-semibold text-[#1C1917] break-words">
                      {ses.title}
                    </h4>
                    <p className="text-xs font-mono text-[#57534E] tabular-nums">
                      Scheduled: {formatDateTime(ses.scheduledStart)} —{' '}
                      {formatDateTime(ses.scheduledEnd)}
                    </p>
                    <p className="text-xs font-mono text-[#57534E] tabular-nums">
                      {ses.meetCode && isMeetActive && (
                        <>
                          <span>Code: {ses.meetCode}</span>
                          <span className="mx-1.5">·</span>
                        </>
                      )}
                      <span className="text-[#14532D]">
                        {recCount} Recording{recCount === 1 ? '' : 's'}
                      </span>
                      <span className="mx-1.5">·</span>
                      <span className="text-[#1E3A8A]">
                        {fileCount} Resource{fileCount === 1 ? '' : 's'}
                      </span>
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    {ses.meetUri && (
                      <a
                        href={ses.meetUri}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex-1 inline-flex items-center justify-center gap-1.5 min-h-[44px] px-3 py-2 text-xs font-medium text-white bg-[#1E3A8A] hover:bg-[#172E6E] rounded-md whitespace-nowrap"
                      >
                        <Video className="w-3.5 h-3.5 shrink-0" />
                        <span>Join Meet</span>
                      </a>
                    )}
                    {isMeetActive && parentCourse && (
                      <button
                        type="button"
                        onClick={() => onDeleteMeetInvite(parentCourse, ses)}
                        className="flex-1 inline-flex items-center justify-center gap-1.5 min-h-[44px] px-3 py-2 text-xs font-medium text-[#78350F] bg-[#FBF9F5] hover:bg-[#EBE6DF] border border-[#E5DFD3] rounded-md whitespace-nowrap"
                      >
                        <VideoOff className="w-3.5 h-3.5 shrink-0" />
                        <span>Delete Meet</span>
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => onOpenCourse(ses.courseId)}
                      className="w-full inline-flex items-center justify-center gap-1.5 min-h-[44px] px-3 py-2 text-xs font-medium text-[#1C1917] bg-[#FBF9F5] hover:bg-[#EBE6DF] border border-[#E5DFD3] rounded-md whitespace-nowrap"
                    >
                      <span>Open Course</span>
                      <ArrowRight className="w-3.5 h-3.5 shrink-0" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Desktop Table */}
          <div className="hidden md:block overflow-x-auto border-t border-[#E5DFD3]">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-[#E5DFD3] text-xs text-[#57534E]">
                  <th className="py-3 pr-4 font-medium whitespace-nowrap">Created Timestamp</th>
                  <th className="py-3 pr-4 font-medium">Class &amp; Course</th>
                  <th className="py-3 pr-4 font-medium whitespace-nowrap">Scheduled Window</th>
                  <th className="py-3 pr-4 font-medium whitespace-nowrap">Meet Status</th>
                  <th className="py-3 pr-4 font-medium whitespace-nowrap">Saved Assets</th>
                  <th className="py-3 font-medium text-right whitespace-nowrap">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E5DFD3]">
                {filteredSessions.map((ses) => {
                  const parentCourse = courseById.get(ses.courseId);
                  const isMeetActive = Boolean(ses.meetUri || ses.calendarEventId);
                  const recCount = recordingCountBySessionId.get(ses.id) || 0;
                  const fileCount = resourceCountBySessionId.get(ses.id) || 0;

                  return (
                    <tr key={ses.id} className="align-top">
                      <td className="py-3.5 pr-4 font-mono text-xs text-[#1C1917] tabular-nums whitespace-nowrap">
                        {formatCreatedTimestamp(ses)}
                      </td>
                      <td className="py-3.5 pr-4 max-w-xs">
                        <p className="font-medium text-[#1C1917] leading-snug">{ses.title}</p>
                        <p className="text-xs text-[#57534E] mt-0.5">
                          <span className="font-mono text-[#1E3A8A] font-medium">
                            {ses.courseCode}
                          </span>
                          <span className="mx-1.5">·</span>
                          <span>{ses.instructorName}</span>
                        </p>
                      </td>
                      <td className="py-3.5 pr-4 font-mono text-xs text-[#57534E] tabular-nums whitespace-nowrap">
                        <div>{formatDateTime(ses.scheduledStart)}</div>
                        <div className="text-[11px] text-[#57534E]/80">
                          to {formatDateTime(ses.scheduledEnd)}
                        </div>
                      </td>
                      <td className="py-3.5 pr-4 font-mono text-xs whitespace-nowrap">
                        {isMeetActive ? (
                          <div>
                            <span className="text-[#14532D] font-medium">Active</span>
                            {ses.meetCode && (
                              <div className="text-[11px] text-[#57534E] mt-0.5">
                                {ses.meetCode}
                              </div>
                            )}
                          </div>
                        ) : (
                          <span className="text-[#78350F] font-medium">Meet Closed</span>
                        )}
                      </td>
                      <td className="py-3.5 pr-4 font-mono text-xs tabular-nums whitespace-nowrap">
                        <div className={recCount > 0 ? 'text-[#14532D]' : 'text-[#57534E]'}>
                          {recCount} Recording{recCount === 1 ? '' : 's'}
                        </div>
                        <div className={fileCount > 0 ? 'text-[#1E3A8A]' : 'text-[#57534E]'}>
                          {fileCount} Resource{fileCount === 1 ? '' : 's'}
                        </div>
                      </td>
                      <td className="py-3.5 text-right whitespace-nowrap">
                        <div className="inline-flex items-center justify-end gap-2">
                          {ses.meetUri && (
                            <a
                              href={ses.meetUri}
                              target="_blank"
                              rel="noopener noreferrer"
                              title="Open Google Meet link"
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-[#1E3A8A] bg-[#FBF9F5] hover:bg-[#EBE6DF] border border-[#E5DFD3] rounded-md"
                            >
                              <span>Join</span>
                              <ExternalLink className="w-3 h-3" />
                            </a>
                          )}
                          {isMeetActive && parentCourse ? (
                            <button
                              type="button"
                              onClick={() => onDeleteMeetInvite(parentCourse, ses)}
                              title="Stop active Google Meet and delete invite without deleting recordings or resources"
                              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-[#78350F] bg-[#FBF9F5] hover:bg-[#EBE6DF] border border-[#E5DFD3] rounded-md"
                            >
                              <VideoOff className="w-3.5 h-3.5 shrink-0" />
                              <span>Delete Meet</span>
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => onOpenCourse(ses.courseId)}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-[#1C1917] bg-[#FBF9F5] hover:bg-[#EBE6DF] border border-[#E5DFD3] rounded-md"
                            >
                              <span>View Course</span>
                              <ArrowRight className="w-3 h-3" />
                            </button>
                          )}
                        </div>
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
  );
};
