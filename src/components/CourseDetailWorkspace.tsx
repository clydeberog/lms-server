import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  CalendarPlus,
  Check,
  CheckCircle2,
  Clock,
  Download,
  ExternalLink,
  Eye,
  FileText,
  FolderOpen,
  Link2,
  Lock,
  Paperclip,
  PlayCircle,
  RefreshCw,
  Search,
  Trash2,
  Upload,
  UserPlus,
  Users,
  Video,
  VideoOff,
  X,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { BOOTSTRAP_ADMIN_EMAIL, clearWorkspaceAccessToken } from '../firebase';
import {
  approvePendingEnrollment,
  attachRecordingRecord,
  clearSessionMeetInvite,
  createResourceRecord,
  createSessionRecord,
  createSubmissionRecord,
  declinePendingEnrollment,
  deleteCourseRecord,
  deleteRecordingRecord,
  deleteResourceRecord,
  deleteSessionRecord,
  enrollMemberByEmail,
  gradeSubmissionRecord,
  normalizeEmail,
  recordStudentMeetJoinAttendance,
  removeEnrollment,
  subscribeCourseAttendance,
  subscribeCourseRecordings,
  subscribeCourseResources,
  subscribeCourseRoster,
  subscribeCourseSessions,
  subscribeCourseSubmissions,
  updateCourseDriveFolder,
  updateRecordingShareCount,
  updateResourceSessionLink,
  updateResourceShareCount,
} from '../lib/lmsFirestore';
import {
  closeMeetInvite,
  deleteWorkspaceItem,
  discoverMeetRecordings,
  downloadDriveFile,
  moveDriveFileToLmsFolder,
  scheduleMeetClass,
  shareDriveFilesWithRoster,
  syncCourseDriveFolderAccess,
  uploadFileToDrive,
  WorkspaceAuthExpiredError,
} from '../lib/workspaceApi';
import {
  AssignmentSubmission,
  AttendanceRecord,
  Course,
  CourseRecording,
  CourseResource,
  CourseRole,
  CourseSession,
  DiscoveredRecording,
  Enrollment,
  ShareRosterResult,
} from '../types';
import {
  buildManilaScheduleWindow,
  formatManilaDateTime,
  formatRecordingTitle,
  getManilaTodayDateString,
} from '../lib/dateTime';
import { ConfirmActionRequest } from './ConfirmActionModal';
import { CourseAttendanceTab } from './CourseAttendanceTab';

type CourseSectionTab = 'sessions' | 'resources' | 'assignments' | 'attendance' | 'roster';

interface CourseDetailWorkspaceProps {
  course: Course;
  userCourseRole: 'owner' | 'co-instructor' | 'student' | 'admin' | 'prospective';
  pendingEnrollment?: Enrollment | null;
  onRequestEnrollment?: (course: Course) => Promise<void>;
  onCancelEnrollment?: (enrollment: Enrollment) => Promise<void>;
  initialSection?: CourseSectionTab;
  onBack: () => void;
  onRequestConfirm: (req: ConfirmActionRequest) => void;
  onNotify: (message: string, tone?: 'info' | 'success' | 'warn') => void;
}

function formatDateTime(iso: string): string {
  return formatManilaDateTime(iso);
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getDefaultLocalDateString(): string {
  return getManilaTodayDateString();
}

const HOUR_OPTIONS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12'];
const MINUTE_OPTIONS = ['00', '05', '10', '15', '20', '25', '30', '35', '40', '45', '50', '55'];
const DURATION_HOUR_OPTIONS = [
  { value: 0.5, label: '30 minutes (0.5 hr)' },
  { value: 1, label: '1 hour' },
  { value: 1.5, label: '1.5 hours' },
  { value: 2, label: '2 hours' },
  { value: 2.5, label: '2.5 hours' },
  { value: 3, label: '3 hours' },
  { value: 4, label: '4 hours' },
  { value: 5, label: '5 hours' },
  { value: 6, label: '6 hours' },
];

function buildScheduleWindow(
  dateStr: string,
  hour12Str: string,
  minuteStr: string,
  meridiem: 'AM' | 'PM',
  durationHours: number
): { startDate: Date; endDate: Date; startIso: string; endIso: string } | null {
  return buildManilaScheduleWindow(dateStr, hour12Str, minuteStr, meridiem, durationHours);
}

function formatDurationLabel(hours: number): string {
  const found = DURATION_HOUR_OPTIONS.find((opt) => opt.value === hours);
  if (found) return found.label;
  return `${hours} ${hours === 1 ? 'hour' : 'hours'}`;
}

function formatUploaderLabel(res: CourseResource, fallbackInstructorName: string): string {
  const name = res.uploadedByName?.trim() || fallbackInstructorName;
  const roleLabel = res.uploadedByRole === 'admin' ? 'Admin' : 'Instructor';
  return `${name} (${roleLabel})`;
}

export const CourseDetailWorkspace: React.FC<CourseDetailWorkspaceProps> = ({
  course,
  userCourseRole,
  pendingEnrollment = null,
  onRequestEnrollment,
  onCancelEnrollment,
  initialSection = 'sessions',
  onBack,
  onRequestConfirm,
  onNotify,
}) => {
  const {
    user,
    profile,
    isAdmin,
    isBootstrapAdmin,
    actualIsAdmin,
    isPreviewing,
    ensureWorkspaceToken,
  } = useAuth();
  const isProspective = userCourseRole === 'prospective';
  const isStaff =
    userCourseRole === 'owner' ||
    userCourseRole === 'admin' ||
    userCourseRole === 'co-instructor';
  const canDeleteCourse = userCourseRole === 'owner' || userCourseRole === 'admin';
  const currentUploaderName = (
    profile?.displayName ||
    user?.displayName ||
    user?.email?.split('@')[0] ||
    course.instructorName
  ).trim();
  const currentUploaderRole: 'admin' | 'instructor' =
    isAdmin || isBootstrapAdmin || userCourseRole === 'admin' ? 'admin' : 'instructor';

  const [section, setSection] = useState<CourseSectionTab>(initialSection);

  useEffect(() => {
    setSection(initialSection);
  }, [initialSection, course.id]);

  // If role switches away from staff (e.g. footer Student preview toggle), exit staff-only tabs
  useEffect(() => {
    if (!isStaff && (section === 'attendance' || section === 'roster')) {
      setSection('sessions');
    }
  }, [isStaff, section]);

  const [sessions, setSessions] = useState<CourseSession[]>([]);
  const [recordings, setRecordings] = useState<CourseRecording[]>([]);
  const [resources, setResources] = useState<CourseResource[]>([]);
  const [submissions, setSubmissions] = useState<AssignmentSubmission[]>([]);
  const [roster, setRoster] = useState<Enrollment[]>([]);
  const [attendance, setAttendance] = useState<AttendanceRecord[]>([]);

  // Session scheduling state (accessible Date + Hour/Minute/AM-PM without seconds + Duration in Hours)
  const [showScheduleForm, setShowScheduleForm] = useState(false);
  const [sessionTitle, setSessionTitle] = useState('');
  const [sessionDesc, setSessionDesc] = useState('');
  const [startDateStr, setStartDateStr] = useState<string>(() => getDefaultLocalDateString());
  const [startHour, setStartHour] = useState<string>('9');
  const [startMinute, setStartMinute] = useState<string>('00');
  const [startMeridiem, setStartMeridiem] = useState<'AM' | 'PM'>('AM');
  const [durationHours, setDurationHours] = useState<number>(1);

  // Recording discovery, LMS folder organization & inline playback state
  const [syncingSession, setSyncingSession] = useState<CourseSession | null>(null);
  const [discovering, setDiscovering] = useState(false);
  const [discoveredList, setDiscoveredList] = useState<DiscoveredRecording[]>([]);
  const [recordingSearchQuery, setRecordingSearchQuery] = useState('');
  const [manualDriveLink, setManualDriveLink] = useState('');
  const [processingRecordingCount, setProcessingRecordingCount] = useState(0);
  const [discoveryWarning, setDiscoveryWarning] = useState<string | null>(null);
  const [lastShareAudit, setLastShareAudit] = useState<{
    label: string;
    result: ShareRosterResult;
    fileIds: string[];
  } | null>(null);
  const [activePlayerRecordingId, setActivePlayerRecordingId] = useState<string | null>(null);
  const [activePreviewResourceId, setActivePreviewResourceId] = useState<string | null>(null);
  const [activePreviewSubmissionId, setActivePreviewSubmissionId] = useState<string | null>(null);

  // Resource upload & direct download state (supports optional lesson session pre-class attachment)
  const [moduleTitle, setModuleTitle] = useState('Week 1 · Course Readings');
  const [uploadSessionId, setUploadSessionId] = useState<string>('');
  const [resourceFile, setResourceFile] = useState<File | null>(null);
  const [resourceFileInputKey, setResourceFileInputKey] = useState<number>(0);
  const [uploadingResource, setUploadingResource] = useState(false);
  const [downloadingResourceId, setDownloadingResourceId] = useState<string | null>(null);

  // Inline lesson-session pre-class file attachment state
  const [attachingSessionId, setAttachingSessionId] = useState<string | null>(null);
  const [sessionUploadFile, setSessionUploadFile] = useState<File | null>(null);
  const [sessionFileInputKey, setSessionFileInputKey] = useState<number>(0);
  const [uploadingSessionFile, setUploadingSessionFile] = useState(false);
  const [linkingResourceId, setLinkingResourceId] = useState<string | null>(null);

  // Assignment upload & grading state
  const [assignmentTitle, setAssignmentTitle] = useState('');
  const [submissionSessionId, setSubmissionSessionId] = useState('');
  const [submissionFile, setSubmissionFile] = useState<File | null>(null);
  const [submissionFileInputKey, setSubmissionFileInputKey] = useState<number>(0);
  const [uploadingSubmission, setUploadingSubmission] = useState(false);
  const [gradingId, setGradingId] = useState<string | null>(null);
  const [gradeValue, setGradeValue] = useState('');
  const [feedbackValue, setFeedbackValue] = useState('');

  // Roster enrollment & prospective request state
  const [enrollEmail, setEnrollEmail] = useState('');
  const [enrollName, setEnrollName] = useState('');
  const [enrollRole, setEnrollRole] = useState<CourseRole>('student');
  const [enrolling, setEnrolling] = useState(false);
  const [requestingEnrollment, setRequestingEnrollment] = useState(false);
  const [reviewingEnrollmentId, setReviewingEnrollmentId] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    const unsubs = [subscribeCourseSessions(course.id, setSessions)];
    if (isProspective) {
      setRecordings([]);
      setResources([]);
      setSubmissions([]);
      setRoster([]);
      setAttendance([]);
    } else {
      unsubs.push(
        subscribeCourseRecordings(course.id, setRecordings),
        subscribeCourseResources(course.id, setResources),
        subscribeCourseSubmissions(course, user.uid, isStaff, actualIsAdmin, setSubmissions)
      );
      if (isStaff) {
        unsubs.push(
          subscribeCourseRoster(course, actualIsAdmin, setRoster),
          subscribeCourseAttendance(course.id, setAttendance)
        );
      } else {
        setRoster([]);
        setAttendance([]);
      }
    }
    return () => {
      unsubs.forEach((fn) => fn());
    };
  }, [course, user, isProspective, isStaff, actualIsAdmin]);

  // Auto-dismiss Drive ACL audit banner after 10 seconds when all grants succeeded
  useEffect(() => {
    if (!lastShareAudit || lastShareAudit.result.failedCount > 0) return;
    const timer = window.setTimeout(() => {
      setLastShareAudit(null);
    }, 10000);
    return () => window.clearTimeout(timer);
  }, [lastShareAudit]);

  // Helper that executes a Workspace API callback and retries once if the cached OAuth token expired
  const runWithWorkspaceToken = useCallback(
    async <T,>(fn: (token: string) => Promise<T>): Promise<T | null> => {
      let token = await ensureWorkspaceToken();
      if (!token) {
        onNotify('Google Workspace authorization is required for this action.', 'warn');
        return null;
      }
      try {
        return await fn(token);
      } catch (err) {
        if (err instanceof WorkspaceAuthExpiredError) {
          clearWorkspaceAccessToken();
          token = await ensureWorkspaceToken();
          if (!token) {
            onNotify('Google Workspace session expired. Please re-authorize to continue.', 'warn');
            return null;
          }
          return await fn(token);
        }
        throw err;
      }
    },
    [ensureWorkspaceToken, onNotify]
  );

  // Split roster into approved/invited members vs pending student enrollment requests
  const pendingRosterRequests = useMemo(
    () => roster.filter((m) => m.status === 'pending'),
    [roster]
  );
  const activeRoster = useMemo(
    () => roster.filter((m) => m.status === 'active' || m.status === 'invited'),
    [roster]
  );

  // Complete deduplicated email list of approved enrolled members + instructors (NEVER pending requests)
  const cohortShareEmails = useMemo(() => {
    const actorEmail = normalizeEmail(user?.email || '');
    const set = new Set<string>();
    if (course.instructorEmail) {
      set.add(normalizeEmail(course.instructorEmail));
    }
    for (const member of activeRoster) {
      if (member.memberEmail) {
        set.add(normalizeEmail(member.memberEmail));
      }
    }
    if (actorEmail) {
      set.delete(actorEmail);
    }
    return Array.from(set);
  }, [course.instructorEmail, activeRoster, user?.email]);

  // Staff-only emails permitted on course Google Drive folders
  const staffFolderEmails = useMemo(() => {
    const set = new Set<string>([BOOTSTRAP_ADMIN_EMAIL]);
    if (course.instructorEmail) set.add(normalizeEmail(course.instructorEmail));
    for (const member of activeRoster) {
      if (member.courseRole === 'co-instructor' && member.memberEmail) {
        set.add(normalizeEmail(member.memberEmail));
      }
    }
    return Array.from(set);
  }, [course.instructorEmail, activeRoster]);

  // Student emails whose folder-level permissions must be revoked during Drive ACL sync
  const studentEmailsForFolderAudit = useMemo(() => {
    const staffSet = new Set(staffFolderEmails);
    return Array.from(
      new Set(
        roster
          .filter((m) => m.courseRole === 'student' && m.memberEmail)
          .map((m) => normalizeEmail(m.memberEmail))
          .filter((email) => !staffSet.has(email))
      )
    );
  }, [roster, staffFolderEmails]);

  const recordingsBySession = useMemo(() => {
    const map = new Map<string, CourseRecording[]>();
    for (const rec of recordings) {
      const existing = map.get(rec.sessionId) || [];
      existing.push(rec);
      map.set(rec.sessionId, existing);
    }
    return map;
  }, [recordings]);

  const resourcesBySession = useMemo(() => {
    const map = new Map<string, CourseResource[]>();
    for (const res of resources) {
      if (!res.sessionId) continue;
      const existing = map.get(res.sessionId) || [];
      existing.push(res);
      map.set(res.sessionId, existing);
    }
    return map;
  }, [resources]);

  const sessionById = useMemo(() => {
    const map = new Map<string, CourseSession>();
    for (const ses of sessions) {
      map.set(ses.id, ses);
    }
    return map;
  }, [sessions]);

  const schedulePreview = useMemo(
    () =>
      buildScheduleWindow(startDateStr, startHour, startMinute, startMeridiem, durationHours),
    [startDateStr, startHour, startMinute, startMeridiem, durationHours]
  );

  // 1. Schedule Live Class (Calendar v3 + Meet v2)
  const handleScheduleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !sessionTitle.trim()) {
      onNotify('Lecture title is required.', 'warn');
      return;
    }
    const windowRange = buildScheduleWindow(
      startDateStr,
      startHour,
      startMinute,
      startMeridiem,
      durationHours
    );
    if (!windowRange) {
      onNotify('Select a valid start date, start time, and duration.', 'warn');
      return;
    }

    onRequestConfirm({
      title: 'Schedule Google Meet Class',
      description:
        'Creates a Google Calendar event with an attached Google Meet room on your primary calendar.',
      details: [
        `Session: ${sessionTitle.trim()}`,
        `Window: ${formatDateTime(windowRange.startIso)} — ${formatDateTime(windowRange.endIso)}`,
        `Duration: ${formatDurationLabel(durationHours)}`,
        `Invited cohort emails: ${cohortShareEmails.length} enrolled member(s)`,
      ],
      recipientEmails: cohortShareEmails,
      confirmLabel: 'Create Meet & Calendar Event',
      onConfirm: async () => {
        const scheduled = await runWithWorkspaceToken((token) =>
          scheduleMeetClass(token, {
            courseId: course.id,
            title: `[${course.code}] ${sessionTitle.trim()}`,
            description:
              sessionDesc.trim() || `${course.title} (${course.term}) — LMS live class.`,
            scheduledStart: windowRange.startIso,
            scheduledEnd: windowRange.endIso,
            attendeeEmails: cohortShareEmails,
          })
        );
        if (!scheduled) return;

        await createSessionRecord({
          courseId: course.id,
          instructorUid: course.instructorUid,
          title: sessionTitle.trim(),
          description: sessionDesc.trim(),
          scheduledStart: windowRange.startIso,
          scheduledEnd: windowRange.endIso,
          meetUri: scheduled.meetUri,
          meetSpaceName: scheduled.meetSpaceName,
          meetCode: scheduled.meetCode,
          calendarEventId: scheduled.calendarEventId,
        });

        setSessionTitle('');
        setSessionDesc('');
        setStartDateStr(getDefaultLocalDateString());
        setStartHour('9');
        setStartMinute('00');
        setStartMeridiem('AM');
        setDurationHours(1);
        setShowScheduleForm(false);
        onNotify('Google Meet class scheduled and saved to course sessions.', 'success');
      },
    });
  };

  // 2. Discover Meet Recordings from Meet v2, Calendar attachments, Meet Recordings folder, LMS folder, or direct Drive link
  const handleDiscoverRecordings = async (
    targetSession: CourseSession,
    opts?: { searchQuery?: string; driveUrlOrId?: string }
  ) => {
    setSyncingSession(targetSession);
    setDiscovering(true);
    setDiscoveryWarning(null);
    setProcessingRecordingCount(0);
    if (!opts?.driveUrlOrId) {
      setDiscoveredList([]);
    }
    try {
      const response = await runWithWorkspaceToken((token) =>
        discoverMeetRecordings(token, {
          courseId: course.id,
          meetSpaceName: targetSession.meetSpaceName,
          meetCode: targetSession.meetCode,
          calendarEventId: targetSession.calendarEventId,
          courseFolderId: course.driveFolderId,
          sessionTitle: targetSession.title,
          searchQuery: opts?.searchQuery,
          driveUrlOrId: opts?.driveUrlOrId,
        })
      );
      if (!response) return;

      const found = response.recordings || [];
      setProcessingRecordingCount(response.processingCount || 0);
      setDiscoveryWarning(response.warning || null);

      if (opts?.driveUrlOrId && found.length > 0) {
        setDiscoveredList((prev) => {
          const existingIds = new Set(prev.map((item) => item.driveFileId));
          const merged = [...found.filter((item) => !existingIds.has(item.driveFileId)), ...prev];
          return merged;
        });
        setManualDriveLink('');
        onNotify(`Located "${found[0].title}" from Google Drive link.`, 'success');
      } else {
        setDiscoveredList(found);
        if (found.length === 0) {
          if ((response.processingCount || 0) > 0) {
            onNotify(
              'Google Meet is still processing your recording. Check back in a few minutes or paste its Drive link.',
              'info'
            );
          } else {
            onNotify(
              'No recordings matched automatically. Search by file name or paste the Google Drive link from your Meet folder below.',
              'info'
            );
          }
        }
      }
    } catch (err) {
      onNotify(
        err instanceof Error ? err.message : 'Unable to query Meet recordings.',
        'warn'
      );
    } finally {
      setDiscovering(false);
    }
  };

  // 3. Attach Recording (Automatically stored in LMS / <Course> / Recordings + Cohort Drive Reader Permissions)
  const handleAttachAndShareRecording = (
    targetSession: CourseSession,
    candidate: DiscoveredRecording
  ) => {
    const courseFolderLabel = `${course.code} — ${course.title}`;
    const shouldMove = candidate.source !== 'lms_folder';
    const storagePath = `LMS / ${courseFolderLabel} / Recordings`;
    const storageNote = shouldMove
      ? `Automatically moves this recording into "${storagePath}" in Google Drive`
      : `Stores this recording in "${storagePath}"`;

    const shareDescription =
      cohortShareEmails.length > 0
        ? `${storageNote}, attaches it to "${targetSession.title}", and automatically grants Google Drive view (reader) permission to every enrolled student and instructor on the course.`
        : `${storageNote} and attaches it to "${targetSession.title}". No other course members are enrolled yet—once you enroll students, use "Sync Cohort Drive Access" in the Roster tab to grant view permissions.`;

    const formattedTitle = formatRecordingTitle(candidate.title);
    const details = [
      `Recording: ${formattedTitle}`,
      `Session: ${targetSession.title}`,
      `Default Storage Path: ${storagePath}`,
    ];

    onRequestConfirm({
      title: 'Attach Recording & Share with Enrolled Cohort',
      description: shareDescription,
      details,
      recipientEmails: cohortShareEmails,
      confirmLabel:
        cohortShareEmails.length > 0
          ? `Attach & Share (${cohortShareEmails.length})`
          : 'Attach Recording',
      onConfirm: async () => {
        const result = await runWithWorkspaceToken(async (token) => {
          let movedSummary = '';
          let finalWebViewLink = candidate.webViewLink;
          let resolvedCourseFolderId = '';

          if (shouldMove) {
            const moveRes = await moveDriveFileToLmsFolder(token, {
              courseId: course.id,
              fileId: candidate.driveFileId,
              courseFolderId: course.driveFolderId,
              courseFolderName: courseFolderLabel,
              subfolderName: 'Recordings',
            });
            if (moveRes.webViewLink) {
              finalWebViewLink = moveRes.webViewLink;
            }
            if (moveRes.courseFolderId) {
              resolvedCourseFolderId = moveRes.courseFolderId;
            }
            if (moveRes.moved) {
              movedSummary = 'Stored in LMS / Recordings, ';
            } else if (moveRes.shortcutCreated) {
              movedSummary = 'Linked in LMS / Recordings, ';
            }
          }

          let grantedCount = 0;
          let shareAuditRes: ShareRosterResult | null = null;
          if (cohortShareEmails.length > 0) {
            shareAuditRes = await shareDriveFilesWithRoster(token, {
              courseId: course.id,
              fileIds: [candidate.driveFileId],
              emails: cohortShareEmails,
              role: 'reader',
            });
            grantedCount = shareAuditRes.grantedCount;
          }

          return {
            movedSummary,
            finalWebViewLink,
            resolvedCourseFolderId,
            grantedCount,
            shareAuditRes,
          };
        });

        if (!result) return;

        if (!course.driveFolderId && result.resolvedCourseFolderId) {
          await updateCourseDriveFolder(
            course.id,
            result.resolvedCourseFolderId,
            `https://drive.google.com/drive/folders/${result.resolvedCourseFolderId}`
          ).catch(() => undefined);
        }

        if (result.shareAuditRes) {
          setLastShareAudit({
            label: `Recording: ${formattedTitle}`,
            result: result.shareAuditRes,
            fileIds: [candidate.driveFileId],
          });
        }

        await attachRecordingRecord({
          courseId: course.id,
          sessionId: targetSession.id,
          instructorUid: course.instructorUid,
          title: formattedTitle,
          driveFileId: candidate.driveFileId,
          conferenceRecordId: candidate.conferenceRecordId,
          webViewLink: result.finalWebViewLink,
          mimeType: candidate.mimeType,
          durationLabel: candidate.durationLabel,
          sharedWithCount: result.grantedCount,
        });

        setSyncingSession(null);
        setDiscoveredList([]);
        setRecordingSearchQuery('');
        setManualDriveLink('');
        onNotify(
          cohortShareEmails.length > 0
            ? `${result.movedSummary}attached recording and shared with ${result.grantedCount} of ${cohortShareEmails.length} enrolled member(s).`
            : `${result.movedSummary}recording attached to session.`,
          'success'
        );
      },
    });
  };

  // 3c. Remove/detach an attached recording from a course session (keeps file safe in Drive)
  const handleRemoveRecording = (rec: CourseRecording, sessionRecordingCount: number) => {
    const displayRecTitle = formatRecordingTitle(rec.title);
    onRequestConfirm({
      title: 'Remove Attached Recording',
      description:
        'Removes this recording from the course session so students no longer see it in the LMS. The original video file remains safe in your Google Drive.',
      details: [
        `Recording: ${displayRecTitle}`,
        `Drive File ID: ${rec.driveFileId}`,
      ],
      confirmLabel: 'Remove Recording',
      tone: 'danger',
      onConfirm: async () => {
        await deleteRecordingRecord(
          course.id,
          rec.sessionId,
          rec.id,
          sessionRecordingCount <= 1
        );
        if (activePlayerRecordingId === rec.id) {
          setActivePlayerRecordingId(null);
        }
        onNotify(`Removed "${displayRecTitle}" from this class session.`, 'info');
      },
    });
  };

  // 3d. Stop Active Google Meet & Delete Meet Invite (Instructor / Admin ONLY — preserves session, recordings & resources)
  const handleDeleteMeetInvite = (targetSession: CourseSession) => {
    if (!isStaff) return;
    const details = [
      `Session: ${targetSession.title}`,
      `Scheduled: ${formatDateTime(targetSession.scheduledStart)}`,
      ...(targetSession.meetCode ? [`Google Meet Code: ${targetSession.meetCode}`] : []),
      'Preserved: Saved session record, synced recordings, and attached lesson resources',
    ];

    onRequestConfirm({
      title: 'Stop & Delete Google Meet Invite',
      description:
        'Stops any active Google Meet call for this class, deletes the Google Calendar invite, and removes the Join Meet link. The saved class session, attached recordings, and lesson resources will remain preserved in this course.',
      details,
      confirmLabel: 'Stop & Delete Meet Invite',
      tone: 'danger',
      onConfirm: async () => {
        if (targetSession.calendarEventId || targetSession.meetSpaceName) {
          const closed = await runWithWorkspaceToken((token) =>
            closeMeetInvite(token, {
              courseId: course.id,
              calendarEventId: targetSession.calendarEventId,
              meetSpaceName: targetSession.meetSpaceName,
            })
          );
          if (!closed) return;
        }
        await clearSessionMeetInvite(course.id, targetSession.id);
        onNotify(
          `Google Meet invite stopped and deleted for "${targetSession.title}". The session, recordings, and resources remain saved.`,
          'success'
        );
      },
    });
  };

  // 4. Delete Session (Instructor / Admin ONLY — removes entire session record)
  const handleDeleteSession = (targetSession: CourseSession) => {
    if (!isStaff) return;
    onRequestConfirm({
      title: 'Delete Entire Class Session',
      description: targetSession.calendarEventId
        ? 'Removes this entire session from the course and deletes the linked Google Calendar event from your primary calendar. To keep the session, recordings, and resources while removing only the Meet link, use "Stop & Delete Meet" instead.'
        : 'Removes this entire session from the course schedule.',
      details: [
        `Session: ${targetSession.title}`,
        `Scheduled: ${formatDateTime(targetSession.scheduledStart)}`,
      ],
      confirmLabel: 'Delete Session',
      tone: 'danger',
      onConfirm: async () => {
        if (targetSession.calendarEventId) {
          await runWithWorkspaceToken((token) =>
            closeMeetInvite(token, {
              courseId: course.id,
              calendarEventId: targetSession.calendarEventId,
              meetSpaceName: targetSession.meetSpaceName,
            })
          );
        }
        await deleteSessionRecord(course.id, targetSession.id);
        onNotify('Session removed.', 'info');
      },
    });
  };

  // 5. Upload Course Resource directly to Google Drive + Cohort Share (optionally attached to a lesson session)
  const triggerResourceDriveUpload = (params: {
    file: File;
    topicLabel: string;
    targetSession: CourseSession | null;
    source: 'resources_form' | 'session_panel';
  }) => {
    if (!user) return;
    const { file, topicLabel, targetSession, source } = params;
    const details = [
      `File: ${file.name} (${formatBytes(file.size)})`,
      `Module: ${topicLabel}`,
      `Uploaded by: ${currentUploaderName} (${currentUploaderRole === 'admin' ? 'Admin' : 'Instructor'})`,
      targetSession
        ? `Attached Lesson Session: ${targetSession.title} (Students can access ahead of class)`
        : 'Lesson Session: General Course Resource',
      `Destination: LMS / ${course.code} — ${course.title}`,
    ];

    onRequestConfirm({
      title: targetSession
        ? `Upload Lesson File for "${targetSession.title}"`
        : 'Upload Resource to Google Drive & Share',
      description: targetSession
        ? 'Uploads the selected file to your Google Drive course folder, attaches it directly to this lesson session for advance student access, and grants read-only permission to all enrolled students and instructors.'
        : 'Uploads the selected file to your Google Drive course folder and automatically grants view permission to all enrolled students and instructors.',
      details,
      recipientEmails: cohortShareEmails,
      confirmLabel: 'Upload & Share',
      onConfirm: async () => {
        if (source === 'session_panel') {
          setUploadingSessionFile(true);
        } else {
          setUploadingResource(true);
        }
        try {
          const outcome = await runWithWorkspaceToken(async (token) => {
            const uploaded = await uploadFileToDrive(token, file, {
              courseId: course.id,
              parentFolderId: course.driveFolderId,
              folderName: `${course.code} — ${course.title}`,
            });

            let grantedCount = 0;
            let shareRes: ShareRosterResult | null = null;
            if (cohortShareEmails.length > 0) {
              shareRes = await shareDriveFilesWithRoster(token, {
                courseId: course.id,
                fileIds: [uploaded.driveFileId],
                emails: cohortShareEmails,
                role: 'reader',
              });
              grantedCount = shareRes.grantedCount;
            }
            return { uploaded, grantedCount, shareRes };
          });

          if (!outcome) return;

          if (outcome.shareRes) {
            setLastShareAudit({
              label: `Resource: ${outcome.uploaded.fileName}`,
              result: outcome.shareRes,
              fileIds: [outcome.uploaded.driveFileId],
            });
          }

          await createResourceRecord({
            courseId: course.id,
            instructorUid: course.instructorUid,
            moduleTitle: topicLabel,
            fileName: outcome.uploaded.fileName,
            mimeType: outcome.uploaded.mimeType,
            sizeBytes: outcome.uploaded.sizeBytes,
            driveFileId: outcome.uploaded.driveFileId,
            webViewLink: outcome.uploaded.webViewLink,
            sharedWithCount: outcome.grantedCount,
            uploadedByUid: user.uid,
            uploadedByName: currentUploaderName,
            uploadedByRole: currentUploaderRole,
            sessionId: targetSession?.id,
            sessionTitle: targetSession?.title,
          });

          if (source === 'session_panel') {
            setSessionUploadFile(null);
            setSessionFileInputKey((k) => k + 1);
            setAttachingSessionId(null);
          } else {
            setResourceFile(null);
            setResourceFileInputKey((k) => k + 1);
            setUploadSessionId('');
          }

          onNotify(
            `Uploaded ${outcome.uploaded.fileName}${
              targetSession ? ` and attached to "${targetSession.title}"` : ''
            }${
              cohortShareEmails.length > 0
                ? ` · shared with ${outcome.grantedCount} enrolled member(s).`
                : '.'
            }`,
            'success'
          );
        } finally {
          if (source === 'session_panel') {
            setUploadingSessionFile(false);
          } else {
            setUploadingResource(false);
          }
        }
      },
    });
  };

  const handleResourceUploadSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !resourceFile || !moduleTitle.trim()) {
      onNotify('Select a file and provide a module title.', 'warn');
      return;
    }
    const targetSession = uploadSessionId ? sessionById.get(uploadSessionId) || null : null;
    triggerResourceDriveUpload({
      file: resourceFile,
      topicLabel: moduleTitle.trim(),
      targetSession,
      source: 'resources_form',
    });
  };

  const handleSessionFileUploadSubmit = (targetSession: CourseSession, e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !sessionUploadFile) {
      onNotify('Choose a file to attach to this lesson session.', 'warn');
      return;
    }
    triggerResourceDriveUpload({
      file: sessionUploadFile,
      topicLabel: `Pre-Class · ${targetSession.title}`.slice(0, 120),
      targetSession,
      source: 'session_panel',
    });
  };

  const handleLinkResourceToSession = async (resource: CourseResource, nextSessionId: string) => {
    setLinkingResourceId(resource.id);
    try {
      const targetSession = nextSessionId ? sessionById.get(nextSessionId) || null : null;
      await updateResourceSessionLink(
        course.id,
        resource.id,
        targetSession ? { id: targetSession.id, title: targetSession.title } : null
      );
      onNotify(
        targetSession
          ? `Attached "${resource.fileName}" to lesson "${targetSession.title}".`
          : `Unlinked "${resource.fileName}" from lesson session.`,
        'success'
      );
    } catch (err) {
      onNotify(
        err instanceof Error ? err.message : 'Unable to update lesson file link.',
        'warn'
      );
    } finally {
      setLinkingResourceId(null);
    }
  };

  // 5b. Direct File Download (Streams from Google Drive via OAuth Bearer proxy with course membership verification)
  const handleDownloadResource = async (res: CourseResource) => {
    if (isProspective) {
      onNotify(
        'Course downloads are protected and unlock once an instructor or admin approves your enrollment.',
        'warn'
      );
      return;
    }
    setDownloadingResourceId(res.id);
    try {
      const outcome = await runWithWorkspaceToken((token) =>
        downloadDriveFile(token, {
          courseId: course.id,
          driveFileId: res.driveFileId,
          fileName: res.fileName,
          mimeType: res.mimeType,
        })
      );
      if (outcome) {
        onNotify(`Downloaded ${outcome.fileName}.`, 'success');
      }
    } catch (err) {
      onNotify(
        err instanceof Error ? err.message : `Unable to download ${res.fileName}.`,
        'warn'
      );
    } finally {
      setDownloadingResourceId(null);
    }
  };

  // 6. Delete Resource (Drive + Firestore)
  const handleDeleteResource = (resource: CourseResource) => {
    onRequestConfirm({
      title: 'Delete Course Material',
      description:
        'Permanently deletes this file from Google Drive and removes it from the course materials list.',
      details: [`File: ${resource.fileName}`, `Drive File ID: ${resource.driveFileId}`],
      confirmLabel: 'Delete File',
      tone: 'danger',
      onConfirm: async () => {
        await runWithWorkspaceToken((token) =>
          deleteWorkspaceItem(token, 'drive_file', resource.driveFileId, course.id)
        );
        await deleteResourceRecord(course.id, resource.id);
        onNotify(`Deleted ${resource.fileName}.`, 'info');
      },
    });
  };

  // 7. Student Private Assignment Upload (Visible ONLY to the student, lesson instructor, and school admins)
  const handleSubmissionUpload = (e: React.FormEvent) => {
    e.preventDefault();
    if (isProspective) {
      onNotify('You must be approved and enrolled in this course before submitting assignments.', 'warn');
      return;
    }
    if (!user || !profile || !submissionFile || !assignmentTitle.trim()) {
      onNotify('Provide an assignment title and select a file to submit.', 'warn');
      return;
    }

    const selectedLesson = submissionSessionId ? sessionById.get(submissionSessionId) || null : null;
    const actorEmail = normalizeEmail(user.email || '');
    const reviewerRecipients = Array.from(
      new Set(
        [course.instructorEmail, BOOTSTRAP_ADMIN_EMAIL]
          .filter(Boolean)
          .map((email) => normalizeEmail(email))
          .filter((email) => email && email !== actorEmail)
      )
    );

    onRequestConfirm({
      title: 'Submit Private Assignment',
      description:
        'Uploads your assignment file and grants read-only review access strictly to your course instructor and school administration. Other students cannot view your submission.',
      details: [
        `Assignment: ${assignmentTitle.trim()}`,
        ...(selectedLesson ? [`Lesson: ${selectedLesson.title}`] : []),
        `File: ${submissionFile.name} (${formatBytes(submissionFile.size)})`,
        'Visibility: Only you, your instructor, and school admins',
      ],
      recipientEmails: reviewerRecipients,
      confirmLabel: 'Upload & Submit',
      onConfirm: async () => {
        setUploadingSubmission(true);
        try {
          const uploaded = await runWithWorkspaceToken(async (token) => {
            // Standalone student file upload (students never create/access LMS Drive folders)
            const res = await uploadFileToDrive(token, submissionFile, {
              courseId: course.id,
            });

            if (reviewerRecipients.length > 0) {
              await shareDriveFilesWithRoster(token, {
                courseId: course.id,
                fileIds: [res.driveFileId],
                emails: reviewerRecipients,
                role: 'reader',
              });
            }
            return res;
          });

          if (!uploaded) return;

          await createSubmissionRecord({
            courseId: course.id,
            instructorUid: course.instructorUid,
            sessionId: selectedLesson?.id,
            sessionTitle: selectedLesson?.title,
            assignmentTitle: assignmentTitle.trim(),
            studentUid: user.uid,
            studentName: profile.displayName,
            fileName: uploaded.fileName,
            mimeType: uploaded.mimeType,
            sizeBytes: uploaded.sizeBytes,
            driveFileId: uploaded.driveFileId,
            webViewLink: uploaded.webViewLink,
          });

          setAssignmentTitle('');
          setSubmissionSessionId('');
          setSubmissionFile(null);
          setSubmissionFileInputKey((k) => k + 1);
          onNotify(
            'Assignment submitted privately. Only your instructor and school admins can view it.',
            'success'
          );
        } finally {
          setUploadingSubmission(false);
        }
      },
    });
  };

  // 8. Instructor Grading
  const handleSaveGrade = async (submissionId: string) => {
    if (!gradeValue.trim()) {
      onNotify('Enter a grade before saving.', 'warn');
      return;
    }
    try {
      await gradeSubmissionRecord({
        courseId: course.id,
        submissionId,
        grade: gradeValue.trim(),
        feedback: feedbackValue.trim(),
      });
      setGradingId(null);
      setGradeValue('');
      setFeedbackValue('');
      onNotify('Grade and feedback recorded.', 'success');
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Unable to save grade.', 'warn');
    }
  };

  // 9. Roster Enrollment by Email
  const handleEnrollSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    const cleaned = normalizeEmail(enrollEmail);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleaned)) {
      onNotify('Enter a valid Google email address.', 'warn');
      return;
    }
    if (roster.some((r) => normalizeEmail(r.memberEmail) === cleaned)) {
      onNotify(`${cleaned} is already enrolled on this course.`, 'warn');
      return;
    }

    setEnrolling(true);
    try {
      await enrollMemberByEmail({
        course,
        memberEmail: cleaned,
        memberName: enrollName.trim() || cleaned.split('@')[0],
        courseRole: enrollRole,
        enrolledByUid: user.uid,
      });
      setEnrollEmail('');
      setEnrollName('');
      setEnrollRole('student');
      onNotify(
        `Enrolled ${cleaned}. They will see this course automatically upon signing in—use "Sync Cohort Drive Access" to share existing Drive files.`,
        'success'
      );
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Failed to enroll member.', 'warn');
    } finally {
      setEnrolling(false);
    }
  };

  // 10. Batch Sync Cohort Drive Access (Folder access STRICTLY for Admins & Instructors; Viewer-Only Files for Approved Students)
  const handleSyncAllCohortDriveAccess = () => {
    const allFileIds = Array.from(
      new Set([
        ...recordings.map((r) => r.driveFileId),
        ...resources.map((r) => r.driveFileId),
      ])
    );

    if (!course.driveFolderId && allFileIds.length === 0) {
      onNotify('No course Drive folder, recordings, or course resources exist yet to sync.', 'info');
      return;
    }

    onRequestConfirm({
      title: 'Sync Google Drive Folder & Viewer-Only File Access',
      description:
        'Enforces Google Drive folder permissions strictly for admins and instructors (revoking any student or public folder permissions) and grants read-only (viewer) permissions on individual recordings and resources to approved enrolled students.',
      details: [
        ...(course.driveFolderId
          ? [
              `Course Drive Folder: Restricted to ${staffFolderEmails.length} admin/instructor account(s) only`,
            ]
          : []),
        `Individual Drive Files (Viewer Only): ${recordings.length} recording(s) + ${resources.length} resource(s) = ${allFileIds.length} total`,
        `Approved Cohort Recipients: ${cohortShareEmails.length} member(s) (pending requests excluded)`,
      ],
      recipientEmails: cohortShareEmails,
      confirmLabel: 'Sync Drive Access',
      onConfirm: async () => {
        const outcome = await runWithWorkspaceToken(async (token) => {
          let folderSummary = '';
          if (course.driveFolderId) {
            const folderRes = await syncCourseDriveFolderAccess(token, {
              courseId: course.id,
              courseFolderId: course.driveFolderId,
              staffEmails: staffFolderEmails,
              studentEmails: studentEmailsForFolderAudit,
            });
            folderSummary = `Folder ACL verified (${folderRes.staffGrantedCount} staff synced${
              folderRes.studentRevokedCount > 0
                ? `, ${folderRes.studentRevokedCount} non-staff folder permission(s) revoked`
                : ''
            }). `;
          }

          let shareRes: ShareRosterResult | null = null;
          if (allFileIds.length > 0 && cohortShareEmails.length > 0) {
            shareRes = await shareDriveFilesWithRoster(token, {
              courseId: course.id,
              fileIds: allFileIds,
              emails: cohortShareEmails,
              role: 'reader',
            });
          }

          return { folderSummary, shareRes };
        });
        if (!outcome) return;

        if (outcome.shareRes) {
          setLastShareAudit({
            label: `Full Course Sync (${allFileIds.length} Drive files · Viewer Only)`,
            result: outcome.shareRes,
            fileIds: allFileIds,
          });

          await Promise.all([
            ...recordings.map((rec) =>
              updateRecordingShareCount(course.id, rec.id, cohortShareEmails.length)
            ),
            ...resources.map((res) =>
              updateResourceShareCount(course.id, res.id, cohortShareEmails.length)
            ),
          ]);
        }

        const fileMsg = outcome.shareRes
          ? `Files: ${outcome.shareRes.grantedCount} viewer grant(s) succeeded${
              outcome.shareRes.failedCount > 0 ? `, ${outcome.shareRes.failedCount} failed` : ''
            }.`
          : 'No individual files needed sharing.';

        onNotify(
          `${outcome.folderSummary}${fileMsg}`,
          outcome.shareRes && outcome.shareRes.failedCount > 0 ? 'warn' : 'success'
        );
      },
    });
  };

  // Retry failed permissions from lastShareAudit
  const handleRetryFailedPermissions = () => {
    if (!lastShareAudit) return;
    const failedEmails = Array.from(
      new Set(
        lastShareAudit.result.results
          .filter((r) => r.status === 'failed')
          .map((r) => r.email)
      )
    );
    if (failedEmails.length === 0) return;

    onRequestConfirm({
      title: 'Retry Failed Drive Permission Grants',
      description: 'Retries Google Drive reader permission grants for recipients that previously failed.',
      recipientEmails: failedEmails,
      confirmLabel: `Retry ${failedEmails.length} Email(s)`,
      onConfirm: async () => {
        const retryRes = await runWithWorkspaceToken((token) =>
          shareDriveFilesWithRoster(token, {
            courseId: course.id,
            fileIds: lastShareAudit.fileIds,
            emails: failedEmails,
            role: 'reader',
          })
        );
        if (!retryRes) return;
        setLastShareAudit({
          label: `Retry: ${lastShareAudit.label}`,
          result: retryRes,
          fileIds: lastShareAudit.fileIds,
        });
        onNotify(
          `Retry complete: ${retryRes.grantedCount} granted, ${retryRes.failedCount} remaining.`,
          retryRes.failedCount > 0 ? 'warn' : 'success'
        );
      },
    });
  };

  const handleApproveEnrollmentRequest = async (member: Enrollment) => {
    setReviewingEnrollmentId(member.id);
    try {
      await approvePendingEnrollment(member);
      onNotify(
        `Approved ${member.memberName} for ${course.code}. Click "Sync Cohort Drive Access" to share existing recordings and resources read-only.`,
        'success'
      );
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Unable to approve enrollment.', 'warn');
    } finally {
      setReviewingEnrollmentId(null);
    }
  };

  const handleDeclineEnrollmentRequest = async (member: Enrollment) => {
    setReviewingEnrollmentId(member.id);
    try {
      await declinePendingEnrollment(member);
      onNotify(`Declined enrollment request from ${member.memberName}.`, 'info');
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Unable to decline enrollment.', 'warn');
    } finally {
      setReviewingEnrollmentId(null);
    }
  };

  const handleProspectiveEnrollClick = async () => {
    if (!onRequestEnrollment) return;
    setRequestingEnrollment(true);
    try {
      await onRequestEnrollment(course);
    } finally {
      setRequestingEnrollment(false);
    }
  };

  const handleProspectiveCancelClick = async () => {
    if (!pendingEnrollment || !onCancelEnrollment) return;
    setRequestingEnrollment(true);
    try {
      await onCancelEnrollment(pendingEnrollment);
    } finally {
      setRequestingEnrollment(false);
    }
  };

  const handleStudentJoinMeet = (ses: CourseSession) => {
    if (user && userCourseRole === 'student' && !isPreviewing) {
      void recordStudentMeetJoinAttendance({
        course,
        session: ses,
        user,
        displayName: profile?.displayName || user.displayName || user.email?.split('@')[0] || 'Student',
      });
    }
  };

  const handleDeleteCourse = () => {
    onRequestConfirm({
      title: `Delete Course ${course.code}`,
      description:
        'Permanently removes this course, its roster enrollments, scheduled sessions, recording links, and resource records from the LMS. Files and recordings already stored in Google Drive will remain safe in your Drive.',
      details: [
        `Course: ${course.code} — ${course.title}`,
        `Term: ${course.term}`,
        `Instructor: ${course.instructorName}`,
      ],
      confirmLabel: 'Delete Course',
      tone: 'danger',
      onConfirm: async () => {
        await deleteCourseRecord(course, actualIsAdmin);
        onNotify(`Deleted course ${course.code} — ${course.title}.`, 'info');
        onBack();
      },
    });
  };

  return (
    <section className="space-y-6 sm:space-y-8">
      {/* Course Header */}
      <div className="space-y-3.5 sm:space-y-4 border-b border-[#E5DFD3] pb-5 sm:pb-6">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1.5 min-h-[44px] sm:min-h-0 -ml-2 px-2 sm:ml-0 sm:px-0 text-xs font-medium text-[#57534E] hover:text-[#1C1917] transition-colors rounded-md"
        >
          <ArrowLeft className="w-4 h-4 sm:w-3.5 sm:h-3.5" />
          <span>All Courses</span>
        </button>

        <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-end justify-between gap-4">
          <div className="space-y-1.5 min-w-0">
            <p className="text-xs font-mono text-[#57534E] leading-relaxed">
              {course.code}
              <span className="mx-1.5 sm:mx-2" aria-hidden="true">
                ·
              </span>
              {course.term}
              <span className="mx-1.5 sm:mx-2" aria-hidden="true">
                ·
              </span>
              Instructor: {course.instructorName}
            </p>
            <h1 className="text-2xl sm:text-3xl md:text-4xl font-serif font-semibold text-[#1C1917]">
              {course.title}
            </h1>
            {course.description && (
              <p className="text-sm text-[#57534E] max-w-2xl leading-relaxed">
                {course.description}
              </p>
            )}
          </div>

          {((course.driveFolderUrl && isStaff) || canDeleteCourse) && (
            <div className="flex flex-wrap items-center gap-2.5 w-full sm:w-auto">
              {course.driveFolderUrl && isStaff && (
                <a
                  href={course.driveFolderUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex-1 sm:flex-initial inline-flex items-center justify-center gap-2 min-h-[44px] sm:min-h-0 px-3.5 py-2 text-xs font-medium text-[#1C1917] bg-[#F5F1E8] hover:bg-[#EBE6DF] border border-[#E5DFD3] rounded-md transition-colors whitespace-nowrap"
                >
                  <FolderOpen className="w-4 h-4 text-[#1E3A8A] shrink-0" />
                  <span>Course Drive Folder</span>
                  <ExternalLink className="w-3 h-3 text-[#57534E] shrink-0" />
                </a>
              )}
              {canDeleteCourse && (
                <button
                  type="button"
                  onClick={handleDeleteCourse}
                  className="flex-1 sm:flex-initial inline-flex items-center justify-center gap-1.5 min-h-[44px] sm:min-h-0 px-3.5 py-2 text-xs font-medium text-[#78350F] bg-[#F5F1E8] hover:bg-[#EBE6DF] border border-[#E5DFD3] rounded-md transition-colors whitespace-nowrap"
                >
                  <Trash2 className="w-3.5 h-3.5 shrink-0" />
                  <span>Delete Course</span>
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Prospective Student Enrollment Gate Banner */}
      {isProspective && (
        <div className="bg-[#F5F1E8] border border-[#1E3A8A]/35 rounded-lg p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-1 min-w-0">
            <p className="text-xs font-mono text-[#1E3A8A] flex items-center gap-1.5">
              {pendingEnrollment ? (
                <>
                  <Clock className="w-3.5 h-3.5 shrink-0" />
                  <span>Enrollment Pending Approval</span>
                </>
              ) : (
                <>
                  <Lock className="w-3.5 h-3.5 shrink-0" />
                  <span>Course Enrollment Required</span>
                </>
              )}
            </p>
            <p className="text-sm font-medium text-[#1C1917]">
              {pendingEnrollment
                ? 'Your enrollment request is awaiting instructor or admin approval.'
                : 'You can browse the class schedule below, but live Meet links, recordings, resources, downloads, and assignments are protected for approved enrolled students.'}
            </p>
          </div>
          <div className="flex items-center gap-2.5 w-full sm:w-auto shrink-0">
            {pendingEnrollment ? (
              onCancelEnrollment && (
                <button
                  type="button"
                  disabled={requestingEnrollment}
                  onClick={handleProspectiveCancelClick}
                  className="w-full sm:w-auto min-h-[44px] sm:min-h-0 px-3.5 py-2 text-xs font-medium text-[#78350F] bg-[#FBF9F5] hover:bg-[#EBE6DF] border border-[#E5DFD3] rounded-md transition-colors whitespace-nowrap disabled:opacity-60"
                >
                  {requestingEnrollment ? 'Canceling…' : 'Cancel Request'}
                </button>
              )
            ) : (
              onRequestEnrollment && (
                <button
                  type="button"
                  disabled={requestingEnrollment}
                  onClick={handleProspectiveEnrollClick}
                  className="w-full sm:w-auto min-h-[44px] sm:min-h-0 px-4 py-2 text-xs font-medium text-white bg-[#1E3A8A] hover:bg-[#172E6E] rounded-md transition-colors whitespace-nowrap disabled:opacity-60"
                >
                  {requestingEnrollment ? 'Submitting…' : 'Request Course Enrollment'}
                </button>
              )
            )}
          </div>
        </div>
      )}

      {/* Share Audit Banner (shown after a batch Drive permission operation) */}
      {lastShareAudit && (
        <div className="bg-[#F5F1E8] border border-[#E5DFD3] rounded-lg p-4 flex flex-col sm:flex-row sm:flex-wrap sm:items-center justify-between gap-3 sm:gap-4">
          <div className="space-y-0.5 min-w-0">
            <p className="text-xs font-medium text-[#1C1917] break-words">
              Drive ACL Audit · {lastShareAudit.label}
            </p>
            <p className="text-xs text-[#57534E] tabular-nums">
              <span className="text-[#14532D] font-medium">
                {lastShareAudit.result.grantedCount} granted
              </span>
              {lastShareAudit.result.failedCount > 0 && (
                <>
                  <span className="mx-2">·</span>
                  <span className="text-[#78350F] font-medium">
                    {lastShareAudit.result.failedCount} failed
                  </span>
                </>
              )}
              <span className="mx-2">·</span>
              <span>{lastShareAudit.result.totalRequested} total permission calls</span>
            </p>
          </div>
          <div className="flex items-center gap-3">
            {lastShareAudit.result.failedCount > 0 && (
              <button
                type="button"
                onClick={handleRetryFailedPermissions}
                className="min-h-[40px] sm:min-h-0 px-3 py-1.5 text-xs font-medium text-white bg-[#78350F] hover:bg-[#5E290B] rounded-md"
              >
                Retry Failed
              </button>
            )}
            <button
              type="button"
              onClick={() => setLastShareAudit(null)}
              className="min-h-[40px] sm:min-h-0 px-2 text-xs text-[#57534E] hover:text-[#1C1917]"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {/* Course Sub-Navigation Tabs (synced with Courses -> Classes -> Resources hierarchy) */}
      <div className="flex items-center gap-1 p-1 bg-[#F5F1E8] border border-[#E5DFD3] rounded-lg overflow-x-auto no-scrollbar snap-x snap-mandatory">
        {[
          { id: 'sessions' as const, label: `Classes & Recordings (${sessions.length})` },
          {
            id: 'resources' as const,
            label: isProspective ? 'Resources (Locked)' : `Resources (${resources.length})`,
          },
          {
            id: 'assignments' as const,
            label: isProspective ? 'Assignments (Locked)' : `Assignments (${submissions.length})`,
          },
          ...(isStaff
            ? [
                { id: 'attendance' as const, label: 'Attendance' },
                {
                  id: 'roster' as const,
                  label:
                    pendingRosterRequests.length > 0
                      ? `Roster & Drive ACL (${activeRoster.length} · ${pendingRosterRequests.length} Pending)`
                      : `Roster & Drive ACL (${activeRoster.length})`,
                },
              ]
            : []),
        ].map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setSection(tab.id)}
            className={`snap-start min-h-[44px] sm:min-h-0 px-3.5 py-2.5 sm:py-2 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 tabular-nums ${
              section === tab.id
                ? 'bg-[#FBF9F5] text-[#1C1917] border border-[#E5DFD3]'
                : 'text-[#57534E] hover:text-[#1C1917]'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* SECTION 1: SESSIONS & MEET RECORDINGS */}
      {section === 'sessions' && (
        <div className="space-y-6">
          <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-center justify-between gap-4">
            <div className="min-w-0">
              <h2 className="text-xl sm:text-2xl font-serif font-semibold text-[#1C1917]">
                01. Live Google Meet Classes & Synced Recordings
              </h2>
              {!isStaff && (
                <p className="text-sm text-[#57534E] mt-0.5">
                  Join live Google Meet sessions or stream attached class recordings directly.
                </p>
              )}
            </div>
            {isStaff && (
              <button
                type="button"
                onClick={() => setShowScheduleForm((prev) => !prev)}
                className="w-full sm:w-auto inline-flex items-center justify-center gap-2 min-h-[44px] sm:min-h-0 px-4 py-2 text-sm font-medium text-white bg-[#1E3A8A] hover:bg-[#172E6E] rounded-md transition-colors whitespace-nowrap"
              >
                <CalendarPlus className="w-4 h-4 shrink-0" />
                <span>Schedule Live Class</span>
              </button>
            )}
          </div>

          {showScheduleForm && isStaff && (
            <form
              onSubmit={handleScheduleSubmit}
              className="bg-[#F5F1E8] border border-[#E5DFD3] rounded-lg p-4 sm:p-6 space-y-4"
            >
              <h3 className="text-xl font-serif font-semibold text-[#1C1917]">
                Schedule Virtual Lecture (Google Calendar + Meet)
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-12 gap-4">
                <label className="space-y-1.5 md:col-span-12">
                  <span className="block text-xs font-medium text-[#57534E]">Lecture Title</span>
                  <input
                    type="text"
                    required
                    maxLength={180}
                    value={sessionTitle}
                    onChange={(e) => setSessionTitle(e.target.value)}
                    placeholder="e.g., Lecture 01 — Historical-Grammatical Method"
                    className="w-full min-h-[44px] sm:min-h-0 px-3 py-2 text-base sm:text-sm bg-[#FBF9F5] border border-[#E5DFD3] rounded-md focus:outline-none focus:border-[#1E3A8A]"
                  />
                </label>

                <label className="space-y-1.5 md:col-span-4">
                  <span className="block text-xs font-medium text-[#57534E]">Start Date</span>
                  <input
                    type="date"
                    required
                    value={startDateStr}
                    onChange={(e) => setStartDateStr(e.target.value)}
                    className="w-full min-h-[44px] sm:min-h-0 px-3 py-2 text-base sm:text-sm bg-[#FBF9F5] border border-[#E5DFD3] rounded-md focus:outline-none focus:border-[#1E3A8A]"
                  />
                </label>

                <fieldset className="space-y-1.5 md:col-span-5">
                  <legend className="block text-xs font-medium text-[#57534E]">
                    Start Time (Hour &amp; Minute)
                  </legend>
                  <div className="grid grid-cols-3 gap-2">
                    <select
                      aria-label="Start hour"
                      value={startHour}
                      onChange={(e) => setStartHour(e.target.value)}
                      className="w-full min-h-[44px] sm:min-h-0 px-2.5 py-2 text-base sm:text-sm bg-[#FBF9F5] border border-[#E5DFD3] rounded-md focus:outline-none focus:border-[#1E3A8A] tabular-nums"
                    >
                      {HOUR_OPTIONS.map((h) => (
                        <option key={h} value={h}>
                          {h}
                        </option>
                      ))}
                    </select>
                    <select
                      aria-label="Start minute"
                      value={startMinute}
                      onChange={(e) => setStartMinute(e.target.value)}
                      className="w-full min-h-[44px] sm:min-h-0 px-2.5 py-2 text-base sm:text-sm bg-[#FBF9F5] border border-[#E5DFD3] rounded-md focus:outline-none focus:border-[#1E3A8A] tabular-nums"
                    >
                      {MINUTE_OPTIONS.map((m) => (
                        <option key={m} value={m}>
                          :{m}
                        </option>
                      ))}
                    </select>
                    <select
                      aria-label="AM or PM"
                      value={startMeridiem}
                      onChange={(e) => setStartMeridiem(e.target.value as 'AM' | 'PM')}
                      className="w-full min-h-[44px] sm:min-h-0 px-2.5 py-2 text-base sm:text-sm bg-[#FBF9F5] border border-[#E5DFD3] rounded-md focus:outline-none focus:border-[#1E3A8A]"
                    >
                      <option value="AM">AM</option>
                      <option value="PM">PM</option>
                    </select>
                  </div>
                </fieldset>

                <label className="space-y-1.5 md:col-span-3">
                  <span className="block text-xs font-medium text-[#57534E]">Duration</span>
                  <select
                    aria-label="Session duration in hours"
                    value={durationHours}
                    onChange={(e) => setDurationHours(Number(e.target.value))}
                    className="w-full min-h-[44px] sm:min-h-0 px-3 py-2 text-base sm:text-sm bg-[#FBF9F5] border border-[#E5DFD3] rounded-md focus:outline-none focus:border-[#1E3A8A]"
                  >
                    {DURATION_HOUR_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </label>

                {schedulePreview && (
                  <p
                    aria-live="polite"
                    className="md:col-span-12 text-xs font-mono text-[#57534E] tabular-nums leading-relaxed"
                  >
                    Scheduled Window:{' '}
                    <span className="text-[#1C1917] font-medium">
                      {formatDateTime(schedulePreview.startIso)} —{' '}
                      {formatDateTime(schedulePreview.endIso)}
                    </span>{' '}
                    ({formatDurationLabel(durationHours)})
                  </p>
                )}

                <label className="space-y-1.5 md:col-span-12">
                  <span className="block text-xs font-medium text-[#57534E]">
                    Agenda / Scripture Reading (Optional)
                  </span>
                  <input
                    type="text"
                    maxLength={1500}
                    value={sessionDesc}
                    onChange={(e) => setSessionDesc(e.target.value)}
                    placeholder="Reading: Nehemiah 8:1–8 · Prepare two exegetical observations."
                    className="w-full min-h-[44px] sm:min-h-0 px-3 py-2 text-base sm:text-sm bg-[#FBF9F5] border border-[#E5DFD3] rounded-md focus:outline-none focus:border-[#1E3A8A]"
                  />
                </label>
              </div>
              <div className="flex flex-col-reverse sm:flex-row sm:items-center sm:justify-end gap-2.5 sm:gap-3 pt-3 border-t border-[#E5DFD3]">
                <button
                  type="button"
                  onClick={() => setShowScheduleForm(false)}
                  className="w-full sm:w-auto min-h-[44px] sm:min-h-0 px-4 py-2 text-sm font-medium text-[#57534E] hover:text-[#1C1917] border border-[#E5DFD3] sm:border-transparent rounded-md text-center"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="w-full sm:w-auto min-h-[44px] sm:min-h-0 px-4 py-2 text-sm font-medium text-white bg-[#1E3A8A] hover:bg-[#172E6E] rounded-md text-center"
                >
                  Continue to Confirm
                </button>
              </div>
            </form>
          )}

          {/* Recording Discovery & Move-to-LMS Panel */}
          {syncingSession && isStaff && (
            <div className="bg-[#F5F1E8] border border-[#1E3A8A]/40 rounded-lg p-4 sm:p-6 space-y-5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs font-mono text-[#1E3A8A]">
                    Google Meet Folder · LMS Drive Folder · Calendar Attachments
                  </p>
                  <h3 className="text-lg sm:text-xl font-serif font-semibold text-[#1C1917] mt-0.5 break-words">
                    Attach Recording for &ldquo;{syncingSession.title}&rdquo;
                  </h3>
                  <p className="text-xs text-[#57534E] mt-1 leading-relaxed">
                    Selecting a recording moves it into{' '}
                    <span className="font-mono text-[#1C1917] break-words">
                      LMS / {course.code} — {course.title} / Recordings
                    </span>{' '}
                    and grants Google Drive view access to{' '}
                    <span className="font-mono font-medium text-[#1C1917]">
                      {cohortShareEmails.length}
                    </span>{' '}
                    enrolled member(s).
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setSyncingSession(null);
                    setDiscoveredList([]);
                    setDiscoveryWarning(null);
                    setProcessingRecordingCount(0);
                  }}
                  className="min-h-[40px] sm:min-h-0 px-2 text-xs font-medium text-[#57534E] hover:text-[#1C1917] shrink-0"
                >
                  Close
                </button>
              </div>

              {/* Default LMS storage path notice */}
              <p className="text-xs font-mono text-[#57534E] break-words">
                Default Storage:{' '}
                <span className="text-[#1C1917] font-medium">
                  LMS / {course.code} — {course.title} / Recordings
                </span>
              </p>

              {/* Search Drive videos or paste direct Drive link */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    handleDiscoverRecordings(syncingSession, {
                      searchQuery: recordingSearchQuery.trim() || undefined,
                    });
                  }}
                  className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2"
                >
                  <div className="relative flex-1">
                    <Search className="w-4 h-4 sm:w-3.5 sm:h-3.5 text-[#57534E] absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      value={recordingSearchQuery}
                      onChange={(e) => setRecordingSearchQuery(e.target.value)}
                      placeholder="Search Drive videos by title or Meet code…"
                      className="w-full min-h-[44px] sm:min-h-0 pl-9 sm:pl-8 pr-3 py-2 text-base sm:text-xs bg-[#FBF9F5] border border-[#E5DFD3] rounded-md focus:outline-none focus:border-[#1E3A8A]"
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={discovering}
                    className="min-h-[44px] sm:min-h-0 px-3.5 sm:px-3 py-2 text-sm sm:text-xs font-medium text-[#1C1917] bg-[#FBF9F5] hover:bg-[#EBE6DF] border border-[#E5DFD3] rounded-md whitespace-nowrap disabled:opacity-60"
                  >
                    {discovering ? 'Searching…' : 'Search / Refresh'}
                  </button>
                </form>

                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (!manualDriveLink.trim()) return;
                    handleDiscoverRecordings(syncingSession, {
                      driveUrlOrId: manualDriveLink.trim(),
                    });
                  }}
                  className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2"
                >
                  <div className="relative flex-1">
                    <Link2 className="w-4 h-4 sm:w-3.5 sm:h-3.5 text-[#57534E] absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      value={manualDriveLink}
                      onChange={(e) => setManualDriveLink(e.target.value)}
                      placeholder="Paste Google Drive recording URL or File ID…"
                      className="w-full min-h-[44px] sm:min-h-0 pl-9 sm:pl-8 pr-3 py-2 text-base sm:text-xs bg-[#FBF9F5] border border-[#E5DFD3] rounded-md focus:outline-none focus:border-[#1E3A8A]"
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={discovering || !manualDriveLink.trim()}
                    className="min-h-[44px] sm:min-h-0 px-3.5 sm:px-3 py-2 text-sm sm:text-xs font-medium text-white bg-[#1E3A8A] hover:bg-[#172E6E] rounded-md whitespace-nowrap disabled:opacity-50"
                  >
                    Find Link
                  </button>
                </form>
              </div>

              {processingRecordingCount > 0 && (
                <div className="bg-[#FBF9F5] border border-[#E5DFD3] rounded-md px-4 py-2.5 text-xs text-[#78350F]">
                  Google Meet reports {processingRecordingCount} recording
                  {processingRecordingCount === 1 ? '' : 's'} still processing. Click{' '}
                  <strong>Search / Refresh</strong> again in a few minutes once Drive finishes
                  encoding.
                </div>
              )}

              {discoveryWarning && (
                <div className="bg-[#FBF9F5] border border-[#E5DFD3] rounded-md px-4 py-2.5 text-xs text-[#78350F]">
                  {discoveryWarning}
                </div>
              )}

              {discovering ? (
                <p className="text-sm text-[#57534E] py-4">
                  Scanning Google Meet folders, LMS course folder, Calendar attachments, and Drive
                  videos…
                </p>
              ) : discoveredList.length === 0 ? (
                <p className="text-sm text-[#57534E] py-4">
                  No video recordings found automatically yet. If your recording is inside a Google
                  Meet folder in Drive, paste its Google Drive share link above to move it into the
                  LMS folder and attach it immediately.
                </p>
              ) : (
                <div className="divide-y divide-[#E5DFD3] border-t border-[#E5DFD3]">
                  {discoveredList.map((rec) => {
                    const sourceLabel =
                      rec.source === 'meet_api'
                        ? 'Meet API Match'
                        : rec.source === 'calendar_attachment'
                          ? 'Calendar Attachment'
                          : rec.source === 'lms_folder'
                            ? 'LMS Course Folder'
                            : rec.source === 'meet_folder'
                              ? 'Google Meet Folder'
                              : rec.source === 'direct_link'
                                ? 'Direct Drive Link'
                                : 'Drive Video';
                    return (
                      <div
                        key={rec.driveFileId}
                        className="py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-4"
                      >
                        <div className="space-y-0.5 min-w-0">
                          <p className="text-sm font-medium text-[#1C1917] break-words sm:truncate">
                            {formatRecordingTitle(rec.title)}
                          </p>
                          <p className="text-xs text-[#57534E] font-mono tabular-nums">
                            <span
                              className={
                                rec.source === 'lms_folder'
                                  ? 'text-[#14532D] font-medium'
                                  : 'text-[#1E3A8A]'
                              }
                            >
                              {sourceLabel}
                            </span>
                            <span className="mx-2">·</span>
                            {rec.durationLabel}
                            {rec.createdTime && (
                              <>
                                <span className="mx-2">·</span>
                                <span>{formatDateTime(rec.createdTime)}</span>
                              </>
                            )}
                          </p>
                        </div>
                        <div className="grid grid-cols-2 sm:flex sm:items-center gap-2 sm:gap-2.5 w-full sm:w-auto shrink-0">
                          <a
                            href={rec.webViewLink}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center justify-center gap-1 min-h-[44px] sm:min-h-0 px-3 sm:px-0 py-2 sm:py-0 text-xs font-medium text-[#57534E] hover:text-[#1C1917] border border-[#E5DFD3] sm:border-transparent rounded-md sm:rounded-none"
                          >
                            <span>Preview</span>
                            <ExternalLink className="w-3 h-3" />
                          </a>
                          <button
                            type="button"
                            onClick={() => handleAttachAndShareRecording(syncingSession, rec)}
                            className="inline-flex items-center justify-center gap-1.5 min-h-[44px] sm:min-h-0 px-3.5 py-2 text-xs font-medium text-white bg-[#1E3A8A] hover:bg-[#172E6E] rounded-md whitespace-nowrap"
                          >
                            <span>Attach &amp; Share</span>
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* Sessions List */}
          {sessions.length === 0 ? (
            <div className="py-12 border-t border-b border-[#E5DFD3] text-center space-y-2">
              <p className="font-serif text-xl text-[#1C1917]">No live classes scheduled yet</p>
              <p className="text-sm text-[#57534E] max-w-md mx-auto">
                {isStaff
                  ? 'Tap "Schedule Live Class" above to provision a Google Calendar event and Google Meet link for this cohort.'
                  : 'Scheduled Google Meet sessions and class recordings will appear here once posted by your instructor.'}
              </p>
            </div>
          ) : (
            <div className="divide-y divide-[#E5DFD3] border-t border-b border-[#E5DFD3]">
              {sessions.map((item) => {
                const attached = recordingsBySession.get(item.id) || [];
                const sessionFiles = resourcesBySession.get(item.id) || [];
                const isAttachingFiles = attachingSessionId === item.id;
                const unlinkedResources = resources.filter((r) => r.sessionId !== item.id);
                return (
                  <div key={item.id} className="py-5 sm:py-6 space-y-4">
                    <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
                      <div className="space-y-1 min-w-0">
                        <p className="text-xs font-mono text-[#57534E] tabular-nums leading-relaxed">
                          {formatDateTime(item.scheduledStart)} — {formatDateTime(item.scheduledEnd)}
                          {!isProspective && (
                            <>
                              {item.meetUri && item.meetCode ? (
                                <>
                                  <span className="mx-1.5 sm:mx-2">·</span>
                                  <span>Meet: {item.meetCode}</span>
                                </>
                              ) : !item.meetUri || item.meetInviteDeleted ? (
                                <>
                                  <span className="mx-1.5 sm:mx-2">·</span>
                                  <span className="text-[#78350F] font-medium">
                                    Meet Invite Closed
                                  </span>
                                </>
                              ) : null}
                              <span className="mx-1.5 sm:mx-2">·</span>
                              <span
                                className={
                                  attached.length > 0
                                    ? 'text-[#14532D] font-medium'
                                    : 'text-[#57534E]'
                                }
                              >
                                {attached.length > 0
                                  ? `${attached.length} Recording${attached.length === 1 ? '' : 's'} Synced`
                                  : 'Awaiting Recording'}
                              </span>
                              {sessionFiles.length > 0 && (
                                <>
                                  <span className="mx-1.5 sm:mx-2">·</span>
                                  <span className="text-[#1E3A8A] font-medium">
                                    {sessionFiles.length} Lesson File
                                    {sessionFiles.length === 1 ? '' : 's'}
                                  </span>
                                </>
                              )}
                            </>
                          )}
                        </p>
                        <h3 className="text-xl font-serif font-semibold text-[#1C1917]">
                          {item.title}
                        </h3>
                        {item.description && (
                          <p className="text-sm text-[#57534E] max-w-2xl leading-relaxed">
                            {item.description}
                          </p>
                        )}
                      </div>

                      <div className="flex flex-wrap items-center gap-2 sm:gap-2.5 w-full lg:w-auto shrink-0">
                        {!isProspective && item.meetUri && (
                          <a
                            href={item.meetUri}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={() => handleStudentJoinMeet(item)}
                            className="w-full sm:w-auto inline-flex items-center justify-center gap-2 min-h-[44px] sm:min-h-0 px-3.5 py-2 text-sm sm:text-xs font-medium text-white bg-[#1E3A8A] hover:bg-[#172E6E] rounded-md whitespace-nowrap"
                          >
                            <Video className="w-4 h-4 sm:w-3.5 sm:h-3.5 shrink-0" />
                            <span>Join Google Meet</span>
                          </a>
                        )}
                        {isStaff && (
                          <>
                            {(item.meetUri || item.calendarEventId) && (
                              <button
                                type="button"
                                onClick={() => handleDeleteMeetInvite(item)}
                                title="Stop active Google Meet and delete invite (keeps saved session, recordings, and resources)"
                                className="flex-1 sm:flex-initial inline-flex items-center justify-center gap-1.5 min-h-[44px] sm:min-h-0 px-3 py-2 text-xs font-medium text-[#78350F] bg-[#F5F1E8] hover:bg-[#EBE6DF] border border-[#E5DFD3] rounded-md whitespace-nowrap"
                              >
                                <VideoOff className="w-3.5 h-3.5 shrink-0" />
                                <span>Stop &amp; Delete Meet</span>
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => {
                                setAttachingSessionId(isAttachingFiles ? null : item.id);
                                setSessionUploadFile(null);
                              }}
                              className="flex-1 sm:flex-initial inline-flex items-center justify-center gap-1.5 min-h-[44px] sm:min-h-0 px-3 py-2 text-xs font-medium text-[#1C1917] bg-[#F5F1E8] hover:bg-[#EBE6DF] border border-[#E5DFD3] rounded-md whitespace-nowrap"
                            >
                              <Paperclip className="w-3.5 h-3.5 text-[#1E3A8A] shrink-0" />
                              <span>{isAttachingFiles ? 'Close Files' : 'Add Lesson File'}</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDiscoverRecordings(item)}
                              className="flex-1 sm:flex-initial inline-flex items-center justify-center gap-1.5 min-h-[44px] sm:min-h-0 px-3 py-2 text-xs font-medium text-[#1C1917] bg-[#F5F1E8] hover:bg-[#EBE6DF] border border-[#E5DFD3] rounded-md whitespace-nowrap"
                            >
                              <RefreshCw className="w-3.5 h-3.5 text-[#1E3A8A] shrink-0" />
                              <span>Sync Recording</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteSession(item)}
                              aria-label={`Delete entire session ${item.title}`}
                              title="Delete entire session"
                              className="min-w-[44px] min-h-[44px] sm:min-w-0 sm:min-h-0 p-2 inline-flex items-center justify-center text-[#57534E] hover:text-[#78350F] border border-[#E5DFD3] sm:border-transparent rounded-md"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </>
                        )}
                      </div>
                    </div>

                    {isProspective && (
                      <div className="pl-3 sm:pl-4 md:pl-6 border-l border-[#E5DFD3]">
                        <p className="text-xs text-[#57534E] inline-flex items-center gap-1.5">
                          <Lock className="w-3.5 h-3.5 text-[#78350F] shrink-0" />
                          <span>
                            Enroll and await instructor or admin approval to join Google Meet,
                            access lesson materials, and watch recordings.
                          </span>
                        </p>
                      </div>
                    )}

                    {/* Inline Add Lesson File Panel (Staff Only) */}
                    {isStaff && isAttachingFiles && (
                      <div className="bg-[#F5F1E8] border border-[#E5DFD3] rounded-lg p-4 space-y-4">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="text-xs font-mono text-[#1E3A8A]">
                              Pre-Class Lesson Materials
                            </p>
                            <p className="text-sm font-medium text-[#1C1917]">
                              Attach files to &ldquo;{item.title}&rdquo; so students can review them
                              ahead of class
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={() => setAttachingSessionId(null)}
                            className="min-h-[40px] sm:min-h-0 px-2 text-xs font-medium text-[#57534E] hover:text-[#1C1917] shrink-0"
                          >
                            Close
                          </button>
                        </div>

                        <form
                          onSubmit={(e) => handleSessionFileUploadSubmit(item, e)}
                          className="flex flex-col sm:flex-row sm:flex-wrap sm:items-end justify-between gap-3"
                        >
                          <label className="space-y-1.5 flex-1 min-w-0">
                            <span className="block text-xs font-medium text-[#57534E]">
                              Upload New File to Google Drive (PDF, DOCX, PPTX, TXT, MP4 · Max 50MB)
                            </span>
                            <input
                              key={sessionFileInputKey}
                              type="file"
                              required
                              onChange={(e) => setSessionUploadFile(e.target.files?.[0] || null)}
                              className="w-full text-xs text-[#57534E] file:mr-3 file:py-2 file:px-3 file:min-h-[40px] file:rounded-md file:border file:border-[#E5DFD3] file:bg-[#FBF9F5] file:text-[#1C1917] file:font-medium hover:file:bg-[#EBE6DF]"
                            />
                          </label>
                          <button
                            type="submit"
                            disabled={uploadingSessionFile || !sessionUploadFile}
                            className="w-full sm:w-auto inline-flex items-center justify-center gap-1.5 min-h-[44px] sm:min-h-0 px-3.5 py-2 text-sm sm:text-xs font-medium text-white bg-[#1E3A8A] hover:bg-[#172E6E] rounded-md disabled:opacity-60 whitespace-nowrap"
                          >
                            <Upload className="w-3.5 h-3.5 shrink-0" />
                            <span>
                              {uploadingSessionFile ? 'Uploading…' : 'Upload & Attach to Lesson'}
                            </span>
                          </button>
                        </form>

                        {unlinkedResources.length > 0 && (
                          <div className="pt-3 border-t border-[#E5DFD3] space-y-2">
                            <p className="text-xs font-medium text-[#57534E]">
                              Or attach an existing course material:
                            </p>
                            <div className="flex flex-wrap items-center gap-2">
                              {unlinkedResources.map((res) => (
                                <button
                                  key={res.id}
                                  type="button"
                                  disabled={linkingResourceId === res.id}
                                  onClick={() => handleLinkResourceToSession(res, item.id)}
                                  className="inline-flex items-center gap-1.5 min-h-[40px] sm:min-h-0 px-3 py-1.5 text-xs font-medium text-[#1C1917] bg-[#FBF9F5] hover:bg-[#EBE6DF] border border-[#E5DFD3] rounded-md disabled:opacity-60 max-w-full"
                                >
                                  <Paperclip className="w-3 h-3 text-[#1E3A8A] shrink-0" />
                                  <span className="max-w-[220px] truncate">{res.fileName}</span>
                                </button>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Attached Pre-Class Lesson Files (Visible to Enrolled Students & Staff) */}
                    {!isProspective && sessionFiles.length > 0 && (
                      <div className="pl-3 sm:pl-4 md:pl-6 border-l border-[#1E3A8A]/35 space-y-3">
                        <p className="text-xs font-mono text-[#1E3A8A]">Lesson Materials</p>
                        {sessionFiles.map((res) => {
                          const isPreviewOpen = activePreviewResourceId === res.id;
                          return (
                            <div key={res.id} className="space-y-2.5">
                              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2.5 sm:gap-3">
                                <div className="space-y-0.5 min-w-0">
                                  <p className="text-sm font-medium text-[#1C1917] flex items-start sm:items-center gap-2">
                                    <FileText className="w-4 h-4 text-[#1E3A8A] shrink-0 mt-0.5 sm:mt-0" />
                                    <span className="break-words sm:truncate">{res.fileName}</span>
                                  </p>
                                  <p className="text-xs text-[#57534E]">
                                    <span>
                                      Uploaded by {formatUploaderLabel(res, course.instructorName)}
                                    </span>
                                    <span className="mx-2">·</span>
                                    <span className="font-mono tabular-nums">
                                      {formatBytes(res.sizeBytes)}
                                    </span>
                                  </p>
                                </div>
                                <div className="grid grid-cols-2 sm:flex sm:flex-wrap sm:items-center gap-2 w-full sm:w-auto shrink-0">
                                  <button
                                    type="button"
                                    disabled={downloadingResourceId === res.id}
                                    onClick={() => handleDownloadResource(res)}
                                    className="inline-flex items-center justify-center gap-1.5 min-h-[44px] sm:min-h-0 px-3 py-2 sm:py-1.5 text-xs font-medium text-white bg-[#1E3A8A] hover:bg-[#172E6E] rounded-md whitespace-nowrap disabled:opacity-60"
                                  >
                                    <Download className="w-3.5 h-3.5 shrink-0" />
                                    <span>
                                      {downloadingResourceId === res.id
                                        ? 'Downloading…'
                                        : 'Download'}
                                    </span>
                                  </button>
                                  {isStaff ? (
                                    <a
                                      href={res.webViewLink}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="inline-flex items-center justify-center gap-1.5 min-h-[44px] sm:min-h-0 px-3 py-2 sm:py-1.5 text-xs font-medium text-[#1C1917] bg-[#F5F1E8] hover:bg-[#EBE6DF] border border-[#E5DFD3] rounded-md whitespace-nowrap"
                                    >
                                      <span>Open in Drive</span>
                                      <ExternalLink className="w-3 h-3 shrink-0" />
                                    </a>
                                  ) : (
                                    <button
                                      type="button"
                                      onClick={() =>
                                        setActivePreviewResourceId(isPreviewOpen ? null : res.id)
                                      }
                                      className="inline-flex items-center justify-center gap-1.5 min-h-[44px] sm:min-h-0 px-3 py-2 sm:py-1.5 text-xs font-medium text-[#1E3A8A] bg-[#F5F1E8] hover:bg-[#EBE6DF] border border-[#E5DFD3] rounded-md whitespace-nowrap"
                                    >
                                      <Eye className="w-3.5 h-3.5 shrink-0" />
                                      <span>{isPreviewOpen ? 'Hide Preview' : 'View'}</span>
                                    </button>
                                  )}
                                  {isStaff && (
                                    <button
                                      type="button"
                                      disabled={linkingResourceId === res.id}
                                      onClick={() => handleLinkResourceToSession(res, '')}
                                      className="col-span-2 sm:col-span-1 min-h-[40px] sm:min-h-0 text-xs font-medium text-[#78350F] hover:underline disabled:opacity-60 text-center sm:text-left"
                                    >
                                      Unlink from lesson
                                    </button>
                                  )}
                                </div>
                              </div>
                              {!isStaff && isPreviewOpen && (
                                <div className="space-y-1.5">
                                  <div className="aspect-[16/10] w-full max-w-3xl bg-[#F5F1E8] rounded-md overflow-hidden border border-[#E5DFD3]">
                                    <iframe
                                      title={res.fileName}
                                      src={`https://drive.google.com/file/d/${encodeURIComponent(
                                        res.driveFileId
                                      )}/preview`}
                                      className="w-full h-full border-0"
                                      allow="fullscreen"
                                    />
                                  </div>
                                  <p className="text-[11px] text-[#57534E]">
                                    Preview not loading?{' '}
                                    <a
                                      href={`https://drive.google.com/file/d/${encodeURIComponent(
                                        res.driveFileId
                                      )}/preview`}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="text-[#1E3A8A] hover:underline"
                                    >
                                      Open read-only viewer
                                    </a>
                                  </p>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {/* Attached Meet Recordings (Formatted identically to Lesson Materials) */}
                    {!isProspective && attached.length > 0 && (
                      <div className="pl-3 sm:pl-4 md:pl-6 border-l border-[#1E3A8A]/35 space-y-3">
                        <p className="text-xs font-mono text-[#1E3A8A]">Meet Recording</p>
                        {attached.map((rec) => {
                          const isPlaying = activePlayerRecordingId === rec.id;
                          const displayTitle = formatRecordingTitle(rec.title);
                          return (
                            <div key={rec.id} className="space-y-3">
                              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                                <div className="space-y-0.5 min-w-0">
                                  <p className="text-sm font-medium text-[#1C1917] flex items-start sm:items-center gap-2">
                                    <Video className="w-4 h-4 text-[#1E3A8A] shrink-0 mt-0.5 sm:mt-0" />
                                    <span className="break-words sm:truncate">{displayTitle}</span>
                                  </p>
                                  <p className="text-xs text-[#57534E] font-mono tabular-nums">
                                    {rec.durationLabel || 'Recorded lecture'}
                                    <span className="mx-2">·</span>
                                    <span className="text-[#14532D]">
                                      Shared with {rec.sharedWithCount} cohort member(s)
                                    </span>
                                  </p>
                                  {isStaff && (
                                    <p className="text-xs text-[#57534E] font-mono break-words">
                                      Drive Path:{' '}
                                      <span className="text-[#1C1917]">
                                        LMS / {course.code} — {course.title} / Recordings
                                      </span>
                                    </p>
                                  )}
                                </div>
                                <div className="grid grid-cols-2 sm:flex sm:flex-wrap sm:items-center gap-2 sm:gap-2.5 w-full sm:w-auto shrink-0">
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setActivePlayerRecordingId(isPlaying ? null : rec.id)
                                    }
                                    className={`${
                                      isStaff ? '' : 'col-span-2 sm:col-span-1 '
                                    }inline-flex items-center justify-center gap-1.5 min-h-[44px] sm:min-h-0 px-3 py-2 sm:py-1.5 text-xs font-medium text-[#1E3A8A] bg-[#F5F1E8] hover:bg-[#EBE6DF] border border-[#E5DFD3] rounded-md whitespace-nowrap`}
                                  >
                                    <PlayCircle className="w-4 h-4 sm:w-3.5 sm:h-3.5 shrink-0" />
                                    <span>{isPlaying ? 'Hide Player' : 'Watch Recording'}</span>
                                  </button>
                                  {isStaff && (
                                    <>
                                      <a
                                        href={rec.webViewLink}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="inline-flex items-center justify-center gap-1.5 min-h-[44px] sm:min-h-0 px-3 sm:px-0 py-2 sm:py-0 text-xs font-medium text-[#57534E] hover:text-[#1C1917] border border-[#E5DFD3] sm:border-transparent rounded-md sm:rounded-none whitespace-nowrap"
                                      >
                                        <span>Open in Drive</span>
                                        <ExternalLink className="w-3 h-3 shrink-0" />
                                      </a>
                                      <button
                                        type="button"
                                        onClick={() => handleRemoveRecording(rec, attached.length)}
                                        aria-label={`Remove recording ${displayTitle}`}
                                        className="col-span-2 sm:col-span-1 inline-flex items-center justify-center gap-1.5 min-h-[44px] sm:min-h-0 px-3 py-2 sm:py-1.5 text-xs font-medium text-[#78350F] bg-[#F5F1E8] hover:bg-[#EBE6DF] border border-[#E5DFD3] rounded-md whitespace-nowrap"
                                      >
                                        <Trash2 className="w-3.5 h-3.5 shrink-0" />
                                        <span>Remove</span>
                                      </button>
                                    </>
                                  )}
                                </div>
                              </div>
                              {isPlaying && (
                                <div className="space-y-1.5">
                                  <div className="aspect-video w-full max-w-3xl bg-[#1C1917] rounded-md overflow-hidden border border-[#E5DFD3]">
                                    <iframe
                                      title={displayTitle}
                                      src={`https://drive.google.com/file/d/${encodeURIComponent(
                                        rec.driveFileId
                                      )}/preview`}
                                      className="w-full h-full border-0"
                                      allow="autoplay; fullscreen"
                                    />
                                  </div>
                                  {!isStaff && (
                                    <p className="text-[11px] text-[#57534E]">
                                      Video not loading?{' '}
                                      <a
                                        href={`https://drive.google.com/file/d/${encodeURIComponent(
                                          rec.driveFileId
                                        )}/preview`}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="text-[#1E3A8A] hover:underline"
                                      >
                                        Open read-only player
                                      </a>
                                    </p>
                                  )}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* SECTION 2: RESOURCES (LIVE GOOGLE DRIVE UPLOADS) */}
      {section === 'resources' && (
        <div className="space-y-6">
          <div>
            <h2 className="text-xl sm:text-2xl font-serif font-semibold text-[#1C1917]">
              02. Course Materials &amp; Commentaries
            </h2>
            {isStaff && (
              <p className="text-sm text-[#57534E] mt-0.5">
                Files are uploaded directly to Google Drive via OAuth and shared viewer-only with
                approved enrolled students.
              </p>
            )}
          </div>

          {isProspective ? (
            <div className="py-12 px-4 border-t border-b border-[#E5DFD3] text-center space-y-3">
              <Lock className="w-6 h-6 text-[#78350F] mx-auto" />
              <p className="font-serif text-xl text-[#1C1917]">
                Course resources are protected for enrolled students
              </p>
              <p className="text-sm text-[#57534E] max-w-md mx-auto">
                {pendingEnrollment
                  ? 'Your enrollment request is pending approval from the instructor or admin. Once approved, course materials and downloads will unlock here.'
                  : 'Request enrollment in this course to access downloadable syllabi, lesson files, and commentaries.'}
              </p>
              {!pendingEnrollment && onRequestEnrollment && (
                <button
                  type="button"
                  disabled={requestingEnrollment}
                  onClick={handleProspectiveEnrollClick}
                  className="inline-flex items-center justify-center min-h-[44px] sm:min-h-0 px-4 py-2 text-xs font-medium text-white bg-[#1E3A8A] hover:bg-[#172E6E] rounded-md disabled:opacity-60"
                >
                  {requestingEnrollment ? 'Submitting…' : 'Request Course Enrollment'}
                </button>
              )}
            </div>
          ) : (
            <>
              {isStaff && (
                <form
                  onSubmit={handleResourceUploadSubmit}
                  className="bg-[#F5F1E8] border border-[#E5DFD3] rounded-lg p-4 sm:p-6 space-y-4"
                >
                  <h3 className="text-lg font-serif font-semibold text-[#1C1917]">
                    Upload Material to Google Drive
                  </h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <label className="space-y-1.5">
                      <span className="block text-xs font-medium text-[#57534E]">
                        Module / Topic
                      </span>
                      <input
                        type="text"
                        required
                        maxLength={120}
                        value={moduleTitle}
                        onChange={(e) => setModuleTitle(e.target.value)}
                        placeholder="Week 1 · Syllabus & Hermeneutics"
                        className="w-full min-h-[44px] sm:min-h-0 px-3 py-2 text-base sm:text-sm bg-[#FBF9F5] border border-[#E5DFD3] rounded-md focus:outline-none focus:border-[#1E3A8A]"
                      />
                    </label>
                    <label className="space-y-1.5">
                      <span className="block text-xs font-medium text-[#57534E]">
                        File (PDF, DOCX, PPTX, TXT, MP4 · Max 50MB)
                      </span>
                      <input
                        key={resourceFileInputKey}
                        type="file"
                        required
                        onChange={(e) => setResourceFile(e.target.files?.[0] || null)}
                        className="w-full text-xs text-[#57534E] file:mr-3 file:py-2 file:px-3 file:min-h-[44px] sm:file:min-h-0 file:rounded-md file:border file:border-[#E5DFD3] file:bg-[#FBF9F5] file:text-[#1C1917] file:font-medium hover:file:bg-[#EBE6DF]"
                      />
                    </label>
                    <label className="space-y-1.5 md:col-span-2">
                      <span className="block text-xs font-medium text-[#57534E]">
                        Attach to Lesson Session (Optional — lets students access files ahead of
                        class)
                      </span>
                      <select
                        aria-label="Attach material to lesson session"
                        value={uploadSessionId}
                        onChange={(e) => setUploadSessionId(e.target.value)}
                        className="w-full min-h-[44px] sm:min-h-0 px-3 py-2 text-base sm:text-sm bg-[#FBF9F5] border border-[#E5DFD3] rounded-md focus:outline-none focus:border-[#1E3A8A]"
                      >
                        <option value="">
                          General Course Resource (Not tied to a specific lesson)
                        </option>
                        {sessions.map((ses) => (
                          <option key={ses.id} value={ses.id}>
                            {ses.title} — {formatDateTime(ses.scheduledStart)}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                  <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-center justify-between gap-3 sm:gap-4 pt-3 border-t border-[#E5DFD3]">
                    <p className="text-xs text-[#57534E] tabular-nums leading-relaxed">
                      Uploading as <strong className="text-[#1C1917]">{currentUploaderName}</strong>{' '}
                      ({currentUploaderRole === 'admin' ? 'Admin' : 'Instructor'}) · Will share
                      viewer-only with {cohortShareEmails.length} enrolled member(s).
                    </p>
                    <button
                      type="submit"
                      disabled={uploadingResource || !resourceFile}
                      className="w-full sm:w-auto inline-flex items-center justify-center gap-2 min-h-[44px] sm:min-h-0 px-4 py-2 text-sm font-medium text-white bg-[#1E3A8A] hover:bg-[#172E6E] rounded-md disabled:opacity-60"
                    >
                      <Upload className="w-4 h-4 shrink-0" />
                      <span>{uploadingResource ? 'Uploading…' : 'Upload to Drive'}</span>
                    </button>
                  </div>
                </form>
              )}

              {resources.length === 0 ? (
                <div className="py-12 border-t border-b border-[#E5DFD3] text-center space-y-1.5">
                  <p className="font-serif text-xl text-[#1C1917]">
                    No course resources uploaded yet
                  </p>
                  <p className="text-sm text-[#57534E]">
                    Syllabi, commentaries, and lecture slides shared for this course will appear
                    here.
                  </p>
                </div>
              ) : (
                <div className="divide-y divide-[#E5DFD3] border-t border-b border-[#E5DFD3]">
                  {resources.map((res) => {
                    const linkedSession = res.sessionId ? sessionById.get(res.sessionId) : null;
                    const linkedSessionLabel = linkedSession?.title || res.sessionTitle;
                    const isPreviewOpen = activePreviewResourceId === res.id;
                    return (
                      <div key={res.id} className="py-4 sm:py-5 space-y-3">
                        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3.5 sm:gap-4">
                          <div className="space-y-1 min-w-0">
                            <p className="text-xs text-[#57534E] leading-relaxed">
                              {res.moduleTitle}
                              {linkedSessionLabel && (
                                <>
                                  <span className="mx-1.5 sm:mx-2">·</span>
                                  <span className="text-[#1E3A8A] font-medium">
                                    Lesson: {linkedSessionLabel}
                                  </span>
                                </>
                              )}
                              <span className="mx-1.5 sm:mx-2">·</span>
                              <span className="font-mono tabular-nums">
                                {formatBytes(res.sizeBytes)}
                              </span>
                              <span className="mx-1.5 sm:mx-2">·</span>
                              <span className="text-[#14532D]">
                                Shared with {res.sharedWithCount} member(s)
                              </span>
                            </p>
                            <p className="text-sm font-medium text-[#1C1917] flex items-start sm:items-center gap-2">
                              <FileText className="w-4 h-4 text-[#1E3A8A] shrink-0 mt-0.5 sm:mt-0" />
                              <span className="break-words sm:truncate">{res.fileName}</span>
                            </p>
                            <p className="text-xs text-[#57534E]">
                              Uploaded by{' '}
                              <span className="text-[#1C1917] font-medium">
                                {formatUploaderLabel(res, course.instructorName)}
                              </span>
                            </p>
                            {isStaff && (
                              <p className="text-xs text-[#57534E] font-mono break-words">
                                Drive Path:{' '}
                                <span className="text-[#1C1917]">
                                  LMS / {course.code} — {course.title}
                                </span>
                              </p>
                            )}
                          </div>

                          <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-center gap-2 sm:gap-2.5 w-full lg:w-auto shrink-0">
                            {isStaff && sessions.length > 0 && (
                              <select
                                aria-label={`Assign ${res.fileName} to lesson session`}
                                disabled={linkingResourceId === res.id}
                                value={linkedSession ? linkedSession.id : ''}
                                onChange={(e) => handleLinkResourceToSession(res, e.target.value)}
                                className="w-full sm:w-auto sm:max-w-[200px] min-h-[44px] sm:min-h-0 px-3 sm:px-2.5 py-2 sm:py-1.5 text-base sm:text-xs bg-[#F5F1E8] border border-[#E5DFD3] rounded-md text-[#1C1917] focus:outline-none focus:border-[#1E3A8A]"
                              >
                                <option value="">General Resource</option>
                                {sessions.map((ses) => (
                                  <option key={ses.id} value={ses.id}>
                                    Lesson: {ses.title}
                                  </option>
                                ))}
                              </select>
                            )}
                            <div className="flex items-center gap-2 w-full sm:w-auto">
                              <button
                                type="button"
                                disabled={downloadingResourceId === res.id}
                                onClick={() => handleDownloadResource(res)}
                                className="flex-1 sm:flex-initial inline-flex items-center justify-center gap-1.5 min-h-[44px] sm:min-h-0 px-3 py-2 sm:py-1.5 text-xs font-medium text-white bg-[#1E3A8A] hover:bg-[#172E6E] rounded-md whitespace-nowrap disabled:opacity-60"
                              >
                                <Download className="w-3.5 h-3.5 shrink-0" />
                                <span>
                                  {downloadingResourceId === res.id ? 'Downloading…' : 'Download'}
                                </span>
                              </button>
                              {isStaff ? (
                                <a
                                  href={res.webViewLink}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="flex-1 sm:flex-initial inline-flex items-center justify-center gap-1.5 min-h-[44px] sm:min-h-0 px-3 py-2 sm:py-1.5 text-xs font-medium text-[#1C1917] bg-[#F5F1E8] hover:bg-[#EBE6DF] border border-[#E5DFD3] rounded-md whitespace-nowrap"
                                >
                                  <span>Open in Drive</span>
                                  <ExternalLink className="w-3 h-3 shrink-0" />
                                </a>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() =>
                                    setActivePreviewResourceId(isPreviewOpen ? null : res.id)
                                  }
                                  className="flex-1 sm:flex-initial inline-flex items-center justify-center gap-1.5 min-h-[44px] sm:min-h-0 px-3 py-2 sm:py-1.5 text-xs font-medium text-[#1E3A8A] bg-[#F5F1E8] hover:bg-[#EBE6DF] border border-[#E5DFD3] rounded-md whitespace-nowrap"
                                >
                                  <Eye className="w-3.5 h-3.5 shrink-0" />
                                  <span>{isPreviewOpen ? 'Hide Preview' : 'View'}</span>
                                </button>
                              )}
                              {isStaff && (
                                <button
                                  type="button"
                                  onClick={() => handleDeleteResource(res)}
                                  aria-label={`Delete ${res.fileName}`}
                                  className="min-w-[44px] min-h-[44px] sm:min-w-0 sm:min-h-0 p-2 sm:p-1.5 inline-flex items-center justify-center text-[#57534E] hover:text-[#78350F] border border-[#E5DFD3] sm:border-transparent rounded-md shrink-0"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              )}
                            </div>
                          </div>
                        </div>

                        {!isStaff && isPreviewOpen && (
                          <div className="space-y-1.5">
                            <div className="aspect-[16/10] w-full max-w-3xl bg-[#F5F1E8] rounded-md overflow-hidden border border-[#E5DFD3]">
                              <iframe
                                title={res.fileName}
                                src={`https://drive.google.com/file/d/${encodeURIComponent(
                                  res.driveFileId
                                )}/preview`}
                                className="w-full h-full border-0"
                                allow="fullscreen"
                              />
                            </div>
                            <p className="text-[11px] text-[#57534E]">
                              Preview not loading?{' '}
                              <a
                                href={`https://drive.google.com/file/d/${encodeURIComponent(
                                  res.driveFileId
                                )}/preview`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-[#1E3A8A] hover:underline"
                              >
                                Open read-only viewer
                              </a>
                            </p>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* SECTION 3: STUDENT ASSIGNMENTS & GRADING */}
      {section === 'assignments' && (
        <div className="space-y-6">
          <div>
            <h2 className="text-xl sm:text-2xl font-serif font-semibold text-[#1C1917]">
              03. Assignment Submissions &amp; Evaluation
            </h2>
            {isStaff && (
              <p className="text-sm text-[#57534E] mt-0.5">
                Review private student submissions hosted on Google Drive and record final grades and written exegesis feedback.
              </p>
            )}
          </div>

          {isProspective ? (
            <div className="py-12 px-4 border-t border-b border-[#E5DFD3] text-center space-y-3">
              <Lock className="w-6 h-6 text-[#78350F] mx-auto" />
              <p className="font-serif text-xl text-[#1C1917]">
                Assignment uploads require approved enrollment
              </p>
              <p className="text-sm text-[#57534E] max-w-md mx-auto">
                {pendingEnrollment
                  ? 'Once your instructor or admin approves your enrollment request, you can submit private assignments here.'
                  : 'Request enrollment in this course to upload assignments and receive instructor feedback.'}
              </p>
              {!pendingEnrollment && onRequestEnrollment && (
                <button
                  type="button"
                  disabled={requestingEnrollment}
                  onClick={handleProspectiveEnrollClick}
                  className="inline-flex items-center justify-center min-h-[44px] sm:min-h-0 px-4 py-2 text-xs font-medium text-white bg-[#1E3A8A] hover:bg-[#172E6E] rounded-md disabled:opacity-60"
                >
                  {requestingEnrollment ? 'Submitting…' : 'Request Course Enrollment'}
                </button>
              )}
            </div>
          ) : (
            <>
              {!isStaff && (
                <form
                  onSubmit={handleSubmissionUpload}
                  className="bg-[#F5F1E8] border border-[#E5DFD3] rounded-lg p-4 sm:p-6 space-y-4"
                >
                  <h3 className="text-lg font-serif font-semibold text-[#1C1917]">
                    Submit Assignment
                  </h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <label className="space-y-1.5">
                      <span className="block text-xs font-medium text-[#57534E]">
                        Assignment Title
                      </span>
                      <input
                        type="text"
                        required
                        maxLength={180}
                        value={assignmentTitle}
                        onChange={(e) => setAssignmentTitle(e.target.value)}
                        placeholder="e.g., Exegesis Paper — Romans 8:1–17"
                        className="w-full min-h-[44px] sm:min-h-0 px-3 py-2 text-base sm:text-sm bg-[#FBF9F5] border border-[#E5DFD3] rounded-md focus:outline-none focus:border-[#1E3A8A]"
                      />
                    </label>
                    <label className="space-y-1.5">
                      <span className="block text-xs font-medium text-[#57534E]">
                        Deliverable File (PDF, DOCX, TXT)
                      </span>
                      <input
                        key={submissionFileInputKey}
                        type="file"
                        required
                        onChange={(e) => setSubmissionFile(e.target.files?.[0] || null)}
                        className="w-full text-xs text-[#57534E] file:mr-3 file:py-2 file:px-3 file:min-h-[44px] sm:file:min-h-0 file:rounded-md file:border file:border-[#E5DFD3] file:bg-[#FBF9F5] file:text-[#1C1917] file:font-medium hover:file:bg-[#EBE6DF]"
                      />
                    </label>
                    {sessions.length > 0 && (
                      <label className="space-y-1.5 md:col-span-2">
                        <span className="block text-xs font-medium text-[#57534E]">
                          Lesson Session (Optional)
                        </span>
                        <select
                          aria-label="Select lesson session for assignment"
                          value={submissionSessionId}
                          onChange={(e) => setSubmissionSessionId(e.target.value)}
                          className="w-full min-h-[44px] sm:min-h-0 px-3 py-2 text-base sm:text-sm bg-[#FBF9F5] border border-[#E5DFD3] rounded-md focus:outline-none focus:border-[#1E3A8A]"
                        >
                          <option value="">General Course Assignment</option>
                          {sessions.map((ses) => (
                            <option key={ses.id} value={ses.id}>
                              {ses.title} — {formatDateTime(ses.scheduledStart)}
                            </option>
                          ))}
                        </select>
                      </label>
                    )}
                  </div>
                  <div className="flex justify-end pt-3 border-t border-[#E5DFD3]">
                    <button
                      type="submit"
                      disabled={uploadingSubmission || !submissionFile}
                      className="w-full sm:w-auto inline-flex items-center justify-center gap-2 min-h-[44px] sm:min-h-0 px-4 py-2 text-sm font-medium text-white bg-[#1E3A8A] hover:bg-[#172E6E] rounded-md disabled:opacity-60 shrink-0"
                    >
                      <Upload className="w-4 h-4 shrink-0" />
                      <span>{uploadingSubmission ? 'Uploading…' : 'Upload & Submit'}</span>
                    </button>
                  </div>
                </form>
              )}

              {submissions.length === 0 ? (
                <div className="py-12 border-t border-b border-[#E5DFD3] text-center space-y-1.5">
                  <p className="font-serif text-xl text-[#1C1917]">No submissions recorded yet</p>
                  <p className="text-sm text-[#57534E]">
                    {isStaff
                      ? 'Student deliverables will appear here once submitted.'
                      : 'Your uploaded essays and instructor grades will appear here.'}
                  </p>
                </div>
              ) : (
                <div className="divide-y divide-[#E5DFD3] border-t border-b border-[#E5DFD3]">
                  {submissions.map((sub) => {
                    const isSubPreviewOpen = activePreviewSubmissionId === sub.id;
                    return (
                      <div key={sub.id} className="py-5 space-y-3">
                        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3.5 sm:gap-4">
                          <div className="space-y-1 min-w-0">
                            <p className="text-xs text-[#57534E] leading-relaxed">
                              <span>{sub.studentName}</span>
                              {sub.sessionTitle && (
                                <>
                                  <span className="mx-1.5 sm:mx-2">·</span>
                                  <span className="text-[#1E3A8A] font-medium">
                                    Lesson: {sub.sessionTitle}
                                  </span>
                                </>
                              )}
                              <span className="mx-1.5 sm:mx-2">·</span>
                              <span className="font-mono break-all">{sub.fileName}</span>
                              <span className="mx-1.5 sm:mx-2">·</span>
                              <span
                                className={
                                  sub.status === 'graded'
                                    ? 'text-[#14532D] font-medium'
                                    : 'text-[#78350F] font-medium'
                                }
                              >
                                {sub.status === 'graded' ? `Graded: ${sub.grade}` : 'Submitted'}
                              </span>
                            </p>
                            <h3 className="text-lg font-serif font-semibold text-[#1C1917]">
                              {sub.assignmentTitle}
                            </h3>
                            {sub.feedback && (
                              <p className="text-sm text-[#57534E] max-w-2xl leading-relaxed">
                                Feedback: {sub.feedback}
                              </p>
                            )}
                          </div>

                          <div
                            className={`grid gap-2 sm:flex sm:items-center sm:gap-2.5 w-full sm:w-auto shrink-0 ${
                              isStaff ? 'grid-cols-2' : 'grid-cols-1'
                            }`}
                          >
                            {isStaff ? (
                              <a
                                href={sub.webViewLink}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center justify-center gap-1.5 min-h-[44px] sm:min-h-0 px-3 py-2 sm:py-1.5 text-xs font-medium text-[#1C1917] bg-[#F5F1E8] hover:bg-[#EBE6DF] border border-[#E5DFD3] rounded-md whitespace-nowrap"
                              >
                                <span>Review in Drive</span>
                                <ExternalLink className="w-3 h-3 shrink-0" />
                              </a>
                            ) : (
                              <button
                                type="button"
                                onClick={() =>
                                  setActivePreviewSubmissionId(isSubPreviewOpen ? null : sub.id)
                                }
                                className="inline-flex items-center justify-center gap-1.5 min-h-[44px] sm:min-h-0 px-3 py-2 sm:py-1.5 text-xs font-medium text-[#1E3A8A] bg-[#F5F1E8] hover:bg-[#EBE6DF] border border-[#E5DFD3] rounded-md whitespace-nowrap"
                              >
                                <Eye className="w-3.5 h-3.5 shrink-0" />
                                <span>{isSubPreviewOpen ? 'Hide Preview' : 'View Submission'}</span>
                              </button>
                            )}
                            {isStaff && (
                              <button
                                type="button"
                                onClick={() => {
                                  setGradingId(gradingId === sub.id ? null : sub.id);
                                  setGradeValue(sub.grade || '');
                                  setFeedbackValue(sub.feedback || '');
                                }}
                                className="inline-flex items-center justify-center min-h-[44px] sm:min-h-0 px-3 py-2 sm:py-1.5 text-xs font-medium text-white bg-[#1E3A8A] hover:bg-[#172E6E] rounded-md whitespace-nowrap"
                              >
                                {sub.status === 'graded' ? 'Update Grade' : 'Grade'}
                              </button>
                            )}
                          </div>
                        </div>

                        {!isStaff && isSubPreviewOpen && (
                          <div className="space-y-1.5">
                            <div className="aspect-[16/10] w-full max-w-3xl bg-[#F5F1E8] rounded-md overflow-hidden border border-[#E5DFD3]">
                              <iframe
                                title={sub.fileName}
                                src={`https://drive.google.com/file/d/${encodeURIComponent(
                                  sub.driveFileId
                                )}/preview`}
                                className="w-full h-full border-0"
                                allow="fullscreen"
                              />
                            </div>
                            <p className="text-[11px] text-[#57534E]">
                              Preview not loading?{' '}
                              <a
                                href={`https://drive.google.com/file/d/${encodeURIComponent(
                                  sub.driveFileId
                                )}/preview`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-[#1E3A8A] hover:underline"
                              >
                                Open read-only viewer
                              </a>
                            </p>
                          </div>
                        )}

                        {gradingId === sub.id && isStaff && (
                          <div className="bg-[#F5F1E8] border border-[#E5DFD3] rounded-md p-4 space-y-3">
                            <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                              <label className="space-y-1">
                                <span className="block text-xs font-medium text-[#57534E]">
                                  Grade
                                </span>
                                <input
                                  type="text"
                                  maxLength={32}
                                  value={gradeValue}
                                  onChange={(e) => setGradeValue(e.target.value)}
                                  placeholder="e.g., A / 95%"
                                  className="w-full min-h-[44px] sm:min-h-0 px-3 py-2 sm:py-1.5 text-base sm:text-sm bg-[#FBF9F5] border border-[#E5DFD3] rounded-md"
                                />
                              </label>
                              <label className="space-y-1 md:col-span-3">
                                <span className="block text-xs font-medium text-[#57534E]">
                                  Instructor Feedback
                                </span>
                                <input
                                  type="text"
                                  maxLength={2000}
                                  value={feedbackValue}
                                  onChange={(e) => setFeedbackValue(e.target.value)}
                                  placeholder="Clear exegetical structure; strong engagement with primary text."
                                  className="w-full min-h-[44px] sm:min-h-0 px-3 py-2 sm:py-1.5 text-base sm:text-sm bg-[#FBF9F5] border border-[#E5DFD3] rounded-md"
                                />
                              </label>
                            </div>
                            <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
                              <button
                                type="button"
                                onClick={() => setGradingId(null)}
                                className="w-full sm:w-auto min-h-[44px] sm:min-h-0 px-3 py-2 sm:py-1.5 text-xs text-[#57534E] border border-[#E5DFD3] sm:border-transparent rounded-md text-center"
                              >
                                Cancel
                              </button>
                              <button
                                type="button"
                                onClick={() => handleSaveGrade(sub.id)}
                                className="w-full sm:w-auto min-h-[44px] sm:min-h-0 px-3.5 py-2 sm:py-1.5 text-xs font-medium text-white bg-[#14532D] hover:bg-[#0F3F22] rounded-md text-center"
                              >
                                Save Grade
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* SECTION 4: GOOGLE MEET ATTENDANCE (INSTRUCTOR / ADMIN ONLY) */}
      {section === 'attendance' && isStaff && (
        <CourseAttendanceTab
          course={course}
          sessions={sessions}
          roster={roster}
          attendance={attendance}
          runWithWorkspaceToken={runWithWorkspaceToken}
          onNotify={onNotify}
        />
      )}

      {/* SECTION 5: ROSTER & COHORT DRIVE ACL SYNC (INSTRUCTOR / ADMIN ONLY) */}
      {section === 'roster' && isStaff && (
        <div className="space-y-6">
          <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-start justify-between gap-4">
            <div className="min-w-0">
              <h2 className="text-xl sm:text-2xl font-serif font-semibold text-[#1C1917]">
                05. Enrolled Cohort Roster &amp; Drive Access Sync
              </h2>
              <p className="text-sm text-[#57534E] mt-0.5 max-w-2xl leading-relaxed">
                Approve student enrollment requests or enroll members by email. Drive folders are
                restricted to admins and instructors; approved students receive viewer-only access
                on individual recordings and materials.
              </p>
            </div>

            <button
              type="button"
              onClick={handleSyncAllCohortDriveAccess}
              className="w-full sm:w-auto inline-flex items-center justify-center gap-2 min-h-[44px] sm:min-h-0 px-4 py-2 text-sm font-medium text-white bg-[#1E3A8A] hover:bg-[#172E6E] rounded-md transition-colors whitespace-nowrap"
            >
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>Sync Cohort Drive Access</span>
            </button>
          </div>

          {/* Pending Student Course Enrollment Requests */}
          {pendingRosterRequests.length > 0 && (
            <div className="bg-[#F5F1E8] border border-[#1E3A8A]/35 rounded-lg p-4 sm:p-5 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-base sm:text-lg font-serif font-semibold text-[#1C1917] flex items-center gap-2">
                  <Clock className="w-4 h-4 text-[#1E3A8A] shrink-0" />
                  <span>
                    Pending Enrollment Requests ({pendingRosterRequests.length})
                  </span>
                </h3>
              </div>
              <div className="divide-y divide-[#E5DFD3] border-t border-[#E5DFD3]">
                {pendingRosterRequests.map((req) => (
                  <div
                    key={req.id}
                    className="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-[#1C1917]">{req.memberName}</p>
                      <p className="text-xs font-mono text-[#57534E] break-all">
                        {req.memberEmail}
                      </p>
                    </div>
                    <div className="grid grid-cols-2 sm:flex sm:items-center gap-2 w-full sm:w-auto shrink-0">
                      <button
                        type="button"
                        disabled={reviewingEnrollmentId === req.id}
                        onClick={() => handleApproveEnrollmentRequest(req)}
                        className="inline-flex items-center justify-center gap-1.5 min-h-[44px] sm:min-h-0 px-3 py-2 sm:py-1.5 text-xs font-medium text-white bg-[#14532D] hover:bg-[#0F3F22] rounded-md whitespace-nowrap disabled:opacity-60"
                      >
                        <Check className="w-3.5 h-3.5 shrink-0" />
                        <span>Approve</span>
                      </button>
                      <button
                        type="button"
                        disabled={reviewingEnrollmentId === req.id}
                        onClick={() => handleDeclineEnrollmentRequest(req)}
                        className="inline-flex items-center justify-center gap-1.5 min-h-[44px] sm:min-h-0 px-3 py-2 sm:py-1.5 text-xs font-medium text-[#78350F] bg-[#FBF9F5] hover:bg-[#EBE6DF] border border-[#E5DFD3] rounded-md whitespace-nowrap disabled:opacity-60"
                      >
                        <X className="w-3.5 h-3.5 shrink-0" />
                        <span>Decline</span>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <form
            onSubmit={handleEnrollSubmit}
            className="bg-[#F5F1E8] border border-[#E5DFD3] rounded-lg p-4 sm:p-6 space-y-4"
          >
            <h3 className="text-lg font-serif font-semibold text-[#1C1917] flex items-center gap-2">
              <UserPlus className="w-4 h-4 text-[#1E3A8A] shrink-0" />
              <span>Enroll Student or Co-Instructor by Google Email</span>
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-12 gap-4">
              <label className="space-y-1.5 md:col-span-5">
                <span className="block text-xs font-medium text-[#57534E]">Google Email</span>
                <input
                  type="email"
                  required
                  maxLength={254}
                  value={enrollEmail}
                  onChange={(e) => setEnrollEmail(e.target.value)}
                  placeholder="student@gmail.com"
                  className="w-full min-h-[44px] sm:min-h-0 px-3 py-2 text-base sm:text-sm bg-[#FBF9F5] border border-[#E5DFD3] rounded-md focus:outline-none focus:border-[#1E3A8A]"
                />
              </label>
              <label className="space-y-1.5 md:col-span-4">
                <span className="block text-xs font-medium text-[#57534E]">Full Name</span>
                <input
                  type="text"
                  maxLength={120}
                  value={enrollName}
                  onChange={(e) => setEnrollName(e.target.value)}
                  placeholder="e.g., Hannah Reyes"
                  className="w-full min-h-[44px] sm:min-h-0 px-3 py-2 text-base sm:text-sm bg-[#FBF9F5] border border-[#E5DFD3] rounded-md focus:outline-none focus:border-[#1E3A8A]"
                />
              </label>
              <label className="space-y-1.5 md:col-span-3">
                <span className="block text-xs font-medium text-[#57534E]">Course Role</span>
                <select
                  value={enrollRole}
                  onChange={(e) => setEnrollRole(e.target.value as CourseRole)}
                  className="w-full min-h-[44px] sm:min-h-0 px-3 py-2 text-base sm:text-sm bg-[#FBF9F5] border border-[#E5DFD3] rounded-md focus:outline-none focus:border-[#1E3A8A]"
                >
                  <option value="student">Student</option>
                  <option value="co-instructor">Co-Instructor</option>
                </select>
              </label>
            </div>
            <div className="flex justify-end pt-3 border-t border-[#E5DFD3]">
              <button
                type="submit"
                disabled={enrolling}
                className="w-full sm:w-auto min-h-[44px] sm:min-h-0 px-4 py-2 text-sm font-medium text-white bg-[#1E3A8A] hover:bg-[#172E6E] rounded-md disabled:opacity-60 text-center"
              >
                {enrolling ? 'Enrolling…' : 'Add to Course Roster'}
              </button>
            </div>
          </form>

          {/* Roster List (Mobile Cards + Desktop Table) */}
          <div className="space-y-3">
            <div className="flex items-start sm:items-center gap-2 text-xs text-[#57534E] leading-relaxed">
              <Users className="w-4 h-4 text-[#1E3A8A] shrink-0 mt-0.5 sm:mt-0" />
              <span className="break-words">
                Primary Instructor: <strong className="text-[#1C1917]">{course.instructorName}</strong>{' '}
                (<span className="font-mono break-all">{course.instructorEmail}</span>) · Approved
                members: <span className="font-mono tabular-nums">{activeRoster.length}</span>
              </span>
            </div>

            {activeRoster.length === 0 ? (
              <div className="py-10 border-t border-b border-[#E5DFD3] text-center">
                <p className="font-serif text-lg text-[#1C1917]">No students enrolled yet</p>
                <p className="text-xs text-[#57534E] mt-1">
                  Approve pending requests above or add student/co-instructor emails directly.
                </p>
              </div>
            ) : (
              <>
                {/* Mobile stacked roster cards */}
                <div className="md:hidden divide-y divide-[#E5DFD3] border-t border-b border-[#E5DFD3]">
                  {activeRoster.map((member) => (
                    <div key={member.id} className="py-4 space-y-2.5">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-[#1C1917]">{member.memberName}</p>
                          <p className="font-mono text-xs text-[#57534E] break-all mt-0.5">
                            {member.memberEmail}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() =>
                            onRequestConfirm({
                              title: 'Remove Course Enrollment',
                              description:
                                'Immediately revokes this member’s access to the course, sessions, recordings, and resources in Firestore.',
                              details: [
                                `Member: ${member.memberName} (${member.memberEmail})`,
                                `Course: ${course.code} — ${course.title}`,
                              ],
                              confirmLabel: 'Remove Member',
                              tone: 'danger',
                              onConfirm: async () => {
                                await removeEnrollment(member);
                                onNotify(`Removed ${member.memberEmail} from roster.`, 'info');
                              },
                            })
                          }
                          className="min-h-[40px] px-3 py-1.5 text-xs font-medium text-[#78350F] bg-[#F5F1E8] hover:bg-[#EBE6DF] border border-[#E5DFD3] rounded-md shrink-0"
                        >
                          Remove
                        </button>
                      </div>
                      <p className="text-xs text-[#57534E] leading-relaxed">
                        <span className="capitalize text-[#1C1917] font-medium">
                          {member.courseRole}
                        </span>
                        <span className="mx-2">·</span>
                        <span>
                          {member.courseRole === 'co-instructor'
                            ? 'Drive Folder & Files'
                            : 'Viewer Only (Files)'}
                        </span>
                        <span className="mx-2">·</span>
                        <span
                          className={
                            member.status === 'active'
                              ? 'text-[#14532D] font-medium'
                              : 'text-[#78350F] font-medium'
                          }
                        >
                          {member.status === 'active'
                            ? 'Active (Signed In)'
                            : 'Invited (Awaiting First Sign-In)'}
                        </span>
                      </p>
                    </div>
                  ))}
                </div>

                {/* Desktop roster table */}
                <div className="hidden md:block overflow-x-auto border-t border-b border-[#E5DFD3]">
                  <table className="w-full text-left text-sm">
                    <thead>
                      <tr className="border-b border-[#E5DFD3] text-xs text-[#57534E]">
                        <th className="py-3 pr-4 font-medium">Member</th>
                        <th className="py-3 pr-4 font-medium">Google Email</th>
                        <th className="py-3 pr-4 font-medium">Role</th>
                        <th className="py-3 pr-4 font-medium">Drive Access</th>
                        <th className="py-3 pr-4 font-medium">Enrollment Status</th>
                        <th className="py-3 text-right font-medium">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#E5DFD3]">
                      {activeRoster.map((member) => (
                        <tr key={member.id}>
                          <td className="py-3 pr-4 font-medium text-[#1C1917]">
                            {member.memberName}
                          </td>
                          <td className="py-3 pr-4 font-mono text-xs text-[#57534E]">
                            {member.memberEmail}
                          </td>
                          <td className="py-3 pr-4 text-xs capitalize text-[#1C1917]">
                            {member.courseRole}
                          </td>
                          <td className="py-3 pr-4 text-xs text-[#57534E]">
                            {member.courseRole === 'co-instructor'
                              ? 'Drive Folder & Files'
                              : 'Viewer Only (Files)'}
                          </td>
                          <td className="py-3 pr-4 text-xs">
                            <span
                              className={
                                member.status === 'active'
                                  ? 'text-[#14532D] font-medium'
                                  : 'text-[#78350F] font-medium'
                              }
                            >
                              {member.status === 'active'
                                ? 'Active (Signed In)'
                                : 'Invited (Awaiting First Sign-In)'}
                            </span>
                          </td>
                          <td className="py-3 text-right">
                            <button
                              type="button"
                              onClick={() =>
                                onRequestConfirm({
                                  title: 'Remove Course Enrollment',
                                  description:
                                    'Immediately revokes this member’s access to the course, sessions, recordings, and resources in Firestore.',
                                  details: [
                                    `Member: ${member.memberName} (${member.memberEmail})`,
                                    `Course: ${course.code} — ${course.title}`,
                                  ],
                                  confirmLabel: 'Remove Member',
                                  tone: 'danger',
                                  onConfirm: async () => {
                                    await removeEnrollment(member);
                                    onNotify(`Removed ${member.memberEmail} from roster.`, 'info');
                                  },
                                })
                              }
                              className="text-xs font-medium text-[#78350F] hover:underline"
                            >
                              Remove
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </section>
  );
};
