import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowRight,
  BookOpen,
  Calendar,
  Clock,
  Download,
  ExternalLink,
  Eye,
  FileText,
  Lock,
  PlayCircle,
  Trash2,
  UserPlus,
  Video,
  VideoOff,
} from 'lucide-react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ThemeProvider } from './context/ThemeContext';
import { clearWorkspaceAccessToken } from './firebase';
import { TopBar } from './components/TopBar';
import { GoogleSignInButton } from './components/GoogleSignInButton';
import { AdminFacultyPanel } from './components/AdminFacultyPanel';
import { CourseDetailWorkspace } from './components/CourseDetailWorkspace';
import { ConfirmActionModal, ConfirmActionRequest } from './components/ConfirmActionModal';
import { LegalPageType, LegalPageView } from './components/LegalPages';
import { StudentRegistrationGate } from './components/StudentRegistrationGate';
import { ErrorBoundary } from './components/ErrorBoundary';
import {
  cancelPendingEnrollmentRequest,
  clearSessionMeetInvite,
  deleteCourseRecord,
  fetchCourseById,
  recordStudentMeetJoinAttendance,
  requestCourseEnrollment,
  subscribeAllCoursesForCatalog,
  subscribeCourseRecordings,
  subscribeCourseResources,
  subscribeCourseSessions,
  subscribeInstructorCourses,
  subscribePendingEnrollmentsForStaff,
  subscribeRegistrationRequests,
  subscribeUserEnrollments,
} from './lib/lmsFirestore';
import {
  closeMeetInvite,
  downloadDriveFile,
  WorkspaceAuthExpiredError,
} from './lib/workspaceApi';
import { formatManilaDateTime, formatRecordingTitle } from './lib/dateTime';
import {
  ActiveNavTab,
  Course,
  CourseRecording,
  CourseResource,
  CourseSession,
  Enrollment,
  RegistrationRequest,
} from './types';

const LOGO_IMAGE_SRC = '/assets/aistudio/4a52c352-b439-44b9-9ab2-e11bf7c67dfe_57428442.jpg';

function formatSessionDateTime(iso: string): string {
  return formatManilaDateTime(iso);
}

function formatResourceUploader(res: CourseResource, fallbackInstructorName: string): string {
  const name = res.uploadedByName?.trim() || fallbackInstructorName;
  const roleLabel = res.uploadedByRole === 'admin' ? 'Admin' : 'Instructor';
  return `${name} (${roleLabel})`;
}

type AppRoutePage = 'home' | LegalPageType;

function resolvePageFromPathname(pathname: string): AppRoutePage {
  const clean = pathname.toLowerCase().replace(/\/+$/, '') || '/';
  if (clean === '/privacy' || clean === '/privacy-policy') return 'privacy';
  if (clean === '/terms' || clean === '/terms-of-service') return 'terms';
  return 'home';
}

function LMSWorkspace() {
  const {
    user,
    profile,
    loading,
    isSigningIn,
    authError,
    isBootstrapAdmin,
    actualRole,
    actualIsAdmin,
    actualIsInstructor,
    effectiveRole,
    isAdmin,
    isInstructor,
    isApproved,
    claimedCount,
    rememberDevice,
    setRememberDevice,
    rememberedAccount,
    signIn,
    forgetDevice,
    ensureWorkspaceToken,
  } = useAuth();

  const [activePage, setActivePage] = useState<AppRoutePage>(() =>
    typeof window !== 'undefined' ? resolvePageFromPathname(window.location.pathname) : 'home'
  );
  const [activeTab, setActiveTab] = useState<ActiveNavTab>('courses');
  const [taughtCourses, setTaughtCourses] = useState<Course[]>([]);
  const [catalogCourses, setCatalogCourses] = useState<Course[]>([]);
  const [userEnrollments, setUserEnrollments] = useState<Enrollment[]>([]);
  const [enrolledCourses, setEnrolledCourses] = useState<Course[]>([]);
  const [registrationRequests, setRegistrationRequests] = useState<RegistrationRequest[]>([]);
  const [pendingStaffEnrollments, setPendingStaffEnrollments] = useState<Enrollment[]>([]);
  const [selectedCourseId, setSelectedCourseId] = useState<string | null>(null);
  const [courseInitialSection, setCourseInitialSection] = useState<'sessions' | 'resources'>(
    'sessions'
  );

  // Cross-course aggregated sessions, recordings, and resources for Classes, Resources & Admin Meet Dashboard
  const [allSessions, setAllSessions] = useState<
    Array<CourseSession & { courseCode: string; courseTitle: string; instructorName: string }>
  >([]);
  const [allRecordings, setAllRecordings] = useState<CourseRecording[]>([]);
  const [activeClassPlayerId, setActiveClassPlayerId] = useState<string | null>(null);
  const [activeClassPreviewId, setActiveClassPreviewId] = useState<string | null>(null);
  const [activeResourcePreviewId, setActiveResourcePreviewId] = useState<string | null>(null);
  const [allResources, setAllResources] = useState<
    Array<CourseResource & { courseCode: string; courseTitle: string }>
  >([]);

  // Confirmation modal, non-blocking progress status, and auto-dismissing notice state
  const [confirmRequest, setConfirmRequest] = useState<ConfirmActionRequest | null>(null);
  const [workingLabel, setWorkingLabel] = useState<string | null>(null);
  const [downloadingResourceId, setDownloadingResourceId] = useState<string | null>(null);
  const [enrollingCourseId, setEnrollingCourseId] = useState<string | null>(null);
  const [notice, setNotice] = useState<{
    message: string;
    tone: 'info' | 'success' | 'warn';
  } | null>(null);

  const [logoImgFailed, setLogoImgFailed] = useState(false);

  const notify = useCallback((message: string, tone: 'info' | 'success' | 'warn' = 'info') => {
    setNotice({ message, tone });
  }, []);

  const navigateToPath = useCallback((path: '/' | '/privacy' | '/terms') => {
    const nextPage = resolvePageFromPathname(path);
    setActivePage(nextPage);
    if (typeof window !== 'undefined') {
      if (window.location.pathname !== path) {
        window.history.pushState({}, '', path);
      }
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }, []);

  useEffect(() => {
    const handlePopState = () => {
      setActivePage(resolvePageFromPathname(window.location.pathname));
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  useEffect(() => {
    if (activePage === 'privacy') {
      document.title = 'Privacy Policy · NLFBC - School of Ministry';
    } else if (activePage === 'terms') {
      document.title = 'Terms of Service · NLFBC - School of Ministry';
    } else {
      document.title = 'NLFBC - School of Ministry';
    }
  }, [activePage]);

  // Auto-dismiss transient info/success notices so banners don't stay open waiting for manual dismissal
  useEffect(() => {
    if (!notice || notice.tone === 'warn') return;
    const timer = window.setTimeout(() => {
      setNotice(null);
    }, 6500);
    return () => window.clearTimeout(timer);
  }, [notice]);

  // Subscribe to all courses catalog for approved users so students can browse and request enrollment
  useEffect(() => {
    if (!user || !isApproved) {
      setCatalogCourses([]);
      return;
    }
    return subscribeAllCoursesForCatalog(setCatalogCourses);
  }, [user, isApproved]);

  // Subscribe to courses taught by instructor / all courses for admin (based on actual Firestore role)
  useEffect(() => {
    if (!user || !isApproved || !actualIsInstructor) {
      setTaughtCourses([]);
      return;
    }
    return subscribeInstructorCourses(user.uid, actualIsAdmin, setTaughtCourses);
  }, [user, isApproved, actualIsInstructor, actualIsAdmin]);

  // Subscribe to pending registrations and pending course enrollment requests for staff
  useEffect(() => {
    if (!user || !isApproved || !actualIsInstructor) {
      setRegistrationRequests([]);
      setPendingStaffEnrollments([]);
      return;
    }
    const unsubReg = subscribeRegistrationRequests(setRegistrationRequests);
    const unsubEnr = subscribePendingEnrollmentsForStaff(
      user.uid,
      actualIsAdmin,
      setPendingStaffEnrollments
    );
    return () => {
      unsubReg();
      unsubEnr();
    };
  }, [user, isApproved, actualIsInstructor, actualIsAdmin]);

  // Subscribe to user's own email enrollments (includes active, invited, and pending)
  useEffect(() => {
    if (!user?.email || !isApproved) {
      setUserEnrollments([]);
      return;
    }
    return subscribeUserEnrollments(user.email, setUserEnrollments);
  }, [user?.email, isApproved, claimedCount]);

  const activeUserEnrollments = useMemo(
    () => userEnrollments.filter((e) => e.status === 'active' || e.status === 'invited'),
    [userEnrollments]
  );

  const pendingEnrollmentByCourseId = useMemo(() => {
    const map = new Map<string, Enrollment>();
    for (const enr of userEnrollments) {
      if (enr.status === 'pending') {
        map.set(enr.courseId, enr);
      }
    }
    return map;
  }, [userEnrollments]);

  const activeEnrolledCourseIds = useMemo(
    () => new Set(activeUserEnrollments.map((e) => e.courseId)),
    [activeUserEnrollments]
  );

  // Hydrate Course documents for each active enrollment
  useEffect(() => {
    if (!user || !isApproved || activeUserEnrollments.length === 0) {
      setEnrolledCourses([]);
      return;
    }
    let active = true;
    Promise.all(
      activeUserEnrollments.map(async (enr) => {
        try {
          return await fetchCourseById(enr.courseId);
        } catch {
          return null;
        }
      })
    ).then((docs) => {
      if (!active) return;
      setEnrolledCourses(docs.filter((d): d is Course => d !== null));
    });
    return () => {
      active = false;
    };
  }, [user, isApproved, activeUserEnrollments]);

  // Unified deduplicated list of courses where user is staff or actively enrolled
  const myCourses = useMemo(() => {
    const map = new Map<string, Course>();
    for (const c of taughtCourses) map.set(c.id, c);
    for (const c of enrolledCourses) {
      if (!map.has(c.id)) map.set(c.id, c);
    }
    return Array.from(map.values()).sort((a, b) => a.code.localeCompare(b.code));
  }, [taughtCourses, enrolledCourses]);

  // All browsable courses (taught + enrolled + school catalog)
  const browsableCourses = useMemo(() => {
    const map = new Map<string, Course>();
    for (const c of myCourses) map.set(c.id, c);
    for (const c of catalogCourses) {
      if (!map.has(c.id)) map.set(c.id, c);
    }
    return Array.from(map.values()).sort((a, b) => a.code.localeCompare(b.code));
  }, [myCourses, catalogCourses]);

  // Courses in catalog where the user is not yet actively enrolled/teaching
  const availableCourses = useMemo(() => {
    const myIds = new Set(myCourses.map((c) => c.id));
    return catalogCourses
      .filter((c) => !myIds.has(c.id))
      .sort((a, b) => a.code.localeCompare(b.code));
  }, [catalogCourses, myCourses]);

  // Whether the real signed-in Firebase account has Firestore read access to protected subcollections
  const hasRealCourseAccess = useCallback(
    (course: Course): boolean => {
      if (!user || !isApproved) return false;
      if (actualIsAdmin || course.instructorUid === user.uid) return true;
      return activeEnrolledCourseIds.has(course.id);
    },
    [user, isApproved, actualIsAdmin, activeEnrolledCourseIds]
  );

  // Subscribe to sessions for browsable courses, and recordings/resources ONLY for courses the user has access to
  useEffect(() => {
    if (!user || !isApproved || browsableCourses.length === 0) {
      setAllSessions([]);
      setAllRecordings([]);
      setAllResources([]);
      return;
    }

    const sessionMap = new Map<
      string,
      Array<CourseSession & { courseCode: string; courseTitle: string; instructorName: string }>
    >();
    const recordingMap = new Map<string, CourseRecording[]>();
    const resourceMap = new Map<
      string,
      Array<CourseResource & { courseCode: string; courseTitle: string }>
    >();

    const unsubs: Array<() => void> = [];

    for (const course of browsableCourses) {
      unsubs.push(
        subscribeCourseSessions(course.id, (items) => {
          sessionMap.set(
            course.id,
            items.map((s) => ({
              ...s,
              courseCode: course.code,
              courseTitle: course.title,
              instructorName: course.instructorName,
            }))
          );
          const merged = Array.from(sessionMap.values())
            .flat()
            .sort((a, b) => a.scheduledStart.localeCompare(b.scheduledStart));
          setAllSessions(merged);
        })
      );

      if (hasRealCourseAccess(course)) {
        unsubs.push(
          subscribeCourseRecordings(course.id, (items) => {
            recordingMap.set(course.id, items);
            setAllRecordings(Array.from(recordingMap.values()).flat());
          })
        );
        unsubs.push(
          subscribeCourseResources(course.id, (items) => {
            resourceMap.set(
              course.id,
              items.map((r) => ({ ...r, courseCode: course.code, courseTitle: course.title }))
            );
            setAllResources(Array.from(resourceMap.values()).flat());
          })
        );
      }
    }

    const activeCourseIds = new Set(browsableCourses.map((c) => c.id));
    setAllSessions((prev) => prev.filter((s) => activeCourseIds.has(s.courseId)));
    setAllRecordings((prev) => prev.filter((r) => activeCourseIds.has(r.courseId)));
    setAllResources((prev) => prev.filter((r) => activeCourseIds.has(r.courseId)));

    return () => {
      unsubs.forEach((u) => u());
    };
  }, [user, isApproved, browsableCourses, hasRealCourseAccess]);

  const recordingsBySessionId = useMemo(() => {
    const map = new Map<string, CourseRecording[]>();
    for (const rec of allRecordings) {
      const list = map.get(rec.sessionId) || [];
      list.push(rec);
      map.set(rec.sessionId, list);
    }
    return map;
  }, [allRecordings]);

  const sessionCountByCourseId = useMemo(() => {
    const map = new Map<string, number>();
    for (const ses of allSessions) {
      map.set(ses.courseId, (map.get(ses.courseId) || 0) + 1);
    }
    return map;
  }, [allSessions]);

  const resourceCountByCourseId = useMemo(() => {
    const map = new Map<string, number>();
    for (const res of allResources) {
      map.set(res.courseId, (map.get(res.courseId) || 0) + 1);
    }
    return map;
  }, [allResources]);

  const selectedCourse = useMemo(
    () => browsableCourses.find((c) => c.id === selectedCourseId) || null,
    [browsableCourses, selectedCourseId]
  );

  // Active course synchronized across Courses -> Classes -> Resources hierarchy
  const hierarchyCourse = selectedCourse || myCourses[0] || browsableCourses[0] || null;

  const activeCourseSessions = useMemo(() => {
    if (!hierarchyCourse) return [];
    return allSessions.filter((s) => s.courseId === hierarchyCourse.id);
  }, [allSessions, hierarchyCourse]);

  const activeCourseResources = useMemo(() => {
    if (!hierarchyCourse) return [];
    return allResources.filter((r) => r.courseId === hierarchyCourse.id);
  }, [allResources, hierarchyCourse]);

  const activeCourseResourcesBySessionId = useMemo(() => {
    const map = new Map<string, Array<CourseResource & { courseCode: string; courseTitle: string }>>();
    for (const res of activeCourseResources) {
      if (!res.sessionId) continue;
      const list = map.get(res.sessionId) || [];
      list.push(res);
      map.set(res.sessionId, list);
    }
    return map;
  }, [activeCourseResources]);

  const activeCourseSessionById = useMemo(() => {
    const map = new Map<string, CourseSession>();
    for (const ses of activeCourseSessions) {
      map.set(ses.id, ses);
    }
    return map;
  }, [activeCourseSessions]);

  const getUserCourseRole = useCallback(
    (course: Course): 'owner' | 'co-instructor' | 'student' | 'admin' | 'prospective' => {
      if (effectiveRole === 'student') {
        return activeEnrolledCourseIds.has(course.id) ? 'student' : 'prospective';
      }
      if (effectiveRole === 'instructor') {
        if (user && course.instructorUid === user.uid) return 'owner';
        const match = activeUserEnrollments.find((e) => e.courseId === course.id);
        if (match?.courseRole === 'co-instructor') return 'co-instructor';
        return 'prospective';
      }
      if (user && course.instructorUid === user.uid) return 'owner';
      if (isAdmin) return 'admin';
      return 'prospective';
    },
    [effectiveRole, activeEnrolledCourseIds, user, activeUserEnrollments, isAdmin]
  );

  // Close the confirmation modal immediately before awaiting Workspace OAuth / API calls
  // so no modal ever stays stuck open waiting for the user to close it.
  const handleConfirmExecute = async () => {
    if (!confirmRequest) return;
    const req = confirmRequest;
    setConfirmRequest(null);
    setWorkingLabel(req.title);
    try {
      await req.onConfirm();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Workspace operation failed.', 'warn');
    } finally {
      setWorkingLabel(null);
    }
  };

  const handleRequestCourseEnrollment = async (course: Course) => {
    if (!user) return;
    setEnrollingCourseId(course.id);
    try {
      await requestCourseEnrollment({
        course,
        user,
        displayName:
          profile?.displayName || user.displayName || user.email?.split('@')[0] || 'Student',
      });
      notify(
        `Enrollment request submitted for ${course.code}. Your instructor or admin must approve it before resources unlock.`,
        'success'
      );
    } catch (err) {
      notify(
        err instanceof Error ? err.message : 'Unable to submit course enrollment request.',
        'warn'
      );
    } finally {
      setEnrollingCourseId(null);
    }
  };

  const handleCancelEnrollmentRequest = async (enrollment: Enrollment) => {
    setEnrollingCourseId(enrollment.courseId);
    try {
      await cancelPendingEnrollmentRequest(enrollment.id);
      notify('Enrollment request canceled.', 'info');
    } catch (err) {
      notify(
        err instanceof Error ? err.message : 'Unable to cancel enrollment request.',
        'warn'
      );
    } finally {
      setEnrollingCourseId(null);
    }
  };

  const handleStudentJoinMeetFromClasses = (course: Course, ses: CourseSession) => {
    if (user && getUserCourseRole(course) === 'student') {
      void recordStudentMeetJoinAttendance({
        course,
        session: ses,
        user,
        displayName:
          profile?.displayName || user.displayName || user.email?.split('@')[0] || 'Student',
      });
    }
  };

  const handleDownloadResource = async (res: CourseResource) => {
    setDownloadingResourceId(res.id);
    try {
      let token = await ensureWorkspaceToken();
      if (!token) {
        notify('Google Drive authorization is required to download files directly.', 'warn');
        return;
      }
      try {
        const result = await downloadDriveFile(token, {
          driveFileId: res.driveFileId,
          fileName: res.fileName,
          mimeType: res.mimeType,
          courseId: res.courseId,
        });
        notify(`Downloaded ${result.fileName}.`, 'success');
      } catch (err) {
        if (err instanceof WorkspaceAuthExpiredError) {
          clearWorkspaceAccessToken();
          token = await ensureWorkspaceToken();
          if (!token) {
            notify('Google Workspace session expired. Please re-authorize to download.', 'warn');
            return;
          }
          const result = await downloadDriveFile(token, {
            driveFileId: res.driveFileId,
            fileName: res.fileName,
            mimeType: res.mimeType,
            courseId: res.courseId,
          });
          notify(`Downloaded ${result.fileName}.`, 'success');
        } else {
          throw err;
        }
      }
    } catch (err) {
      notify(
        err instanceof Error ? err.message : `Unable to download ${res.fileName}.`,
        'warn'
      );
    } finally {
      setDownloadingResourceId(null);
    }
  };

  const openCourse = (courseId: string, section: 'sessions' | 'resources' = 'sessions') => {
    setSelectedCourseId(courseId);
    setCourseInitialSection(section);
    setActiveTab('courses');
  };

  const handleSelectNavTab = (tab: ActiveNavTab) => {
    if (activePage !== 'home') {
      navigateToPath('/');
    }
    setActiveTab(tab);
    if (tab === 'courses') {
      // Clicking Courses while already viewing Courses returns to the catalog list;
      // switching from Classes/Resources keeps the synced course context intact.
      if (activeTab === 'courses' && activePage === 'home') {
        setSelectedCourseId(null);
      }
    } else if (!selectedCourseId && (myCourses[0] || browsableCourses[0])) {
      setSelectedCourseId((myCourses[0] || browsableCourses[0]).id);
    }
  };

  const handleDeleteMeetInviteFromClasses = (course: Course, ses: CourseSession) => {
    const role = getUserCourseRole(course);
    if (role === 'student' || role === 'prospective') return;
    setConfirmRequest({
      title: 'Stop & Delete Google Meet Invite',
      description:
        'Stops any active Google Meet call for this class, deletes the Google Calendar invite, and removes the Join Meet link. The saved class session, attached recordings, and lesson resources will remain preserved in this course.',
      details: [
        `Session: ${ses.title}`,
        `Course: ${course.code} — ${course.title}`,
        `Scheduled: ${formatSessionDateTime(ses.scheduledStart)}`,
        ...(ses.meetCode ? [`Google Meet Code: ${ses.meetCode}`] : []),
        'Preserved: Saved session record, synced recordings, and attached lesson resources',
      ],
      confirmLabel: 'Stop & Delete Meet Invite',
      tone: 'danger',
      onConfirm: async () => {
        if (ses.calendarEventId || ses.meetSpaceName) {
          let token = await ensureWorkspaceToken();
          if (!token) {
            notify('Google Workspace authorization is required to close this Google Meet invite.', 'warn');
            return;
          }
          try {
            await closeMeetInvite(token, {
              calendarEventId: ses.calendarEventId,
              meetSpaceName: ses.meetSpaceName,
            });
          } catch (err) {
            if (err instanceof WorkspaceAuthExpiredError) {
              clearWorkspaceAccessToken();
              token = await ensureWorkspaceToken();
              if (!token) {
                notify('Google Workspace session expired. Please re-authorize to continue.', 'warn');
                return;
              }
              await closeMeetInvite(token, {
                calendarEventId: ses.calendarEventId,
                meetSpaceName: ses.meetSpaceName,
              });
            } else {
              throw err;
            }
          }
        }
        await clearSessionMeetInvite(course.id, ses.id);
        notify(
          `Google Meet invite stopped and deleted for "${ses.title}". The session, recordings, and resources remain saved.`,
          'success'
        );
      },
    });
  };

  const handleDeleteCourse = (course: Course) => {
    setConfirmRequest({
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
        await deleteCourseRecord(course, actualIsAdmin || isBootstrapAdmin);
        setSelectedCourseId((prev) => (prev === course.id ? null : prev));
        notify(`Deleted course ${course.code} — ${course.title}.`, 'info');
      },
    });
  };

  const hierarchyRole = hierarchyCourse ? getUserCourseRole(hierarchyCourse) : 'prospective';
  const hierarchyPendingEnrollment = hierarchyCourse
    ? pendingEnrollmentByCourseId.get(hierarchyCourse.id) || null
    : null;
  const isStaffForHierarchyCourse =
    hierarchyRole === 'owner' || hierarchyRole === 'admin' || hierarchyRole === 'co-instructor';

  return (
    <div className="min-h-screen flex flex-col bg-[#FBF9F5] text-[#1C1917]">
      <TopBar activeTab={activeTab} onSelectTab={handleSelectNavTab} />

      <main
        className={`flex-1 max-w-[1200px] w-full mx-auto px-4 sm:px-6 py-6 sm:py-10 md:py-14 space-y-6 sm:space-y-8 ${
          user && isApproved ? 'pb-24 md:pb-14' : ''
        }`}
      >
        {/* Non-blocking Workspace action status banner */}
        {workingLabel && (
          <div
            role="status"
            className="bg-[#F5F1E8] border border-[#1E3A8A]/35 rounded-lg px-4 sm:px-5 py-3 flex items-center justify-between gap-3"
          >
            <p className="text-sm text-[#1E3A8A]">
              Working on: <span className="font-medium">{workingLabel}</span>…
            </p>
          </div>
        )}

        {/* Global transient notice banner */}
        {(notice || authError) && (
          <div
            role="status"
            className="bg-[#F5F1E8] border border-[#E5DFD3] rounded-lg px-4 sm:px-5 py-3.5 flex items-center justify-between gap-3"
          >
            <p
              className={`text-sm leading-relaxed ${
                authError || notice?.tone === 'warn'
                  ? 'text-[#78350F]'
                  : notice?.tone === 'success'
                    ? 'text-[#14532D]'
                    : 'text-[#1C1917]'
              }`}
            >
              {authError || notice?.message}
            </p>
            {notice && (
              <button
                type="button"
                onClick={() => setNotice(null)}
                className="min-h-[40px] sm:min-h-0 px-2 text-xs font-medium text-[#57534E] hover:text-[#1C1917] shrink-0"
              >
                Dismiss
              </button>
            )}
          </div>
        )}

        {/* MAIN CONTENT: Dedicated Legal Pages or Courses, Classes, Resources */}
        {activePage === 'privacy' || activePage === 'terms' ? (
          <LegalPageView
            page={activePage}
            onNavigateHome={() => navigateToPath('/')}
            onNavigateLegal={(target) => navigateToPath(target === 'privacy' ? '/privacy' : '/terms')}
          />
        ) : loading ? (
          <div className="py-20 sm:py-24 text-center space-y-2">
            <p className="font-serif text-2xl text-[#1C1917]">Loading NLFBC - School of Ministry…</p>
            <p className="text-sm text-[#57534E]">
              Verifying authentication and course memberships.
            </p>
          </div>
        ) : !user ? (
          /* UNAUTHENTICATED EDITORIAL HERO PORTAL */
          <section className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-12 items-stretch">
            <div className="lg:col-span-6 flex flex-col justify-center space-y-5 sm:space-y-6">
              <h1 className="text-3xl sm:text-4xl md:text-5xl font-serif font-semibold leading-[1.12] text-[#1C1917]">
                Courses, live classes, and shared recordings in one study space.
              </h1>
              <p className="text-sm sm:text-base text-[#57534E] leading-relaxed max-w-xl">
                Sign in with your Google account to access your enrolled courses, join live Google
                Meet classes, watch synced recordings, and download course resources. New students
                can register with Google and await instructor or admin approval.
              </p>

              <div className="space-y-3 pt-1 sm:pt-2">
                {rememberedAccount ? (
                  <div className="space-y-2.5">
                    <p className="text-xs font-mono text-[#57534E]">
                      Remembered on this device:{' '}
                      <span className="text-[#1C1917] font-medium break-all">
                        {rememberedAccount.email}
                      </span>
                    </p>
                    <div className="flex flex-wrap items-center gap-3">
                      <GoogleSignInButton
                        onClick={() => signIn()}
                        disabled={isSigningIn}
                        label={`Continue as ${rememberedAccount.displayName}`}
                        mobileLabel={`Continue as ${rememberedAccount.displayName}`}
                        className="w-full sm:w-auto"
                      />
                      <button
                        type="button"
                        disabled={isSigningIn}
                        onClick={() => signIn({ switchAccount: true })}
                        className="min-h-[44px] sm:min-h-0 px-3 py-2 text-xs font-medium text-[#1C1917] bg-[#F5F1E8] hover:bg-[#EBE6DF] border border-[#E5DFD3] rounded-md transition-colors disabled:opacity-60"
                      >
                        Use another account
                      </button>
                      <button
                        type="button"
                        disabled={isSigningIn}
                        onClick={() => forgetDevice()}
                        className="min-h-[44px] sm:min-h-0 px-2 py-2 text-xs font-medium text-[#57534E] hover:text-[#78350F] transition-colors disabled:opacity-60"
                      >
                        Forget device
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-wrap items-center gap-3">
                    <GoogleSignInButton
                      onClick={() => signIn()}
                      disabled={isSigningIn}
                      className="w-full sm:w-auto"
                    />
                    <button
                      type="button"
                      disabled={isSigningIn}
                      onClick={() => signIn({ switchAccount: true })}
                      className="w-full sm:w-auto inline-flex items-center justify-center gap-2 min-h-[44px] px-4 py-2 text-sm font-medium text-[#1E3A8A] bg-[#F5F1E8] hover:bg-[#EBE6DF] border border-[#E5DFD3] rounded-md transition-colors disabled:opacity-60"
                    >
                      <UserPlus className="w-4 h-4 shrink-0" />
                      <span>Register as a Student</span>
                    </button>
                  </div>
                )}

                <label className="inline-flex items-center gap-2.5 text-xs text-[#57534E] cursor-pointer select-none pt-0.5">
                  <input
                    type="checkbox"
                    checked={rememberDevice}
                    onChange={(e) => setRememberDevice(e.target.checked)}
                    className="w-4 h-4 accent-[#1E3A8A] rounded shrink-0"
                  />
                  <span>Remember this device for faster sign-in</span>
                </label>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 sm:gap-6 pt-5 sm:pt-6 border-t border-[#E5DFD3]">
                <div>
                  <p className="text-xs font-mono text-[#1E3A8A]">01. Registration</p>
                  <p className="text-xs text-[#57534E] mt-1 leading-relaxed">
                    New students register with Google and gain portal access once approved.
                  </p>
                </div>
                <div>
                  <p className="text-xs font-mono text-[#1E3A8A]">02. Classes</p>
                  <p className="text-xs text-[#57534E] mt-1 leading-relaxed">
                    Join Google Meet sessions and stream shared class recordings.
                  </p>
                </div>
                <div>
                  <p className="text-xs font-mono text-[#1E3A8A]">03. Resources</p>
                  <p className="text-xs text-[#57534E] mt-1 leading-relaxed">
                    Lesson files and private assignments are protected for enrolled students.
                  </p>
                </div>
              </div>
            </div>

            <div className="lg:col-span-6 flex items-center justify-center">
              {!logoImgFailed ? (
                <figure className="w-full flex flex-col items-center">
                  <div className="w-full max-w-[280px] sm:max-w-[380px] lg:max-w-[440px] bg-white border border-[#E5DFD3] rounded-xl p-5 sm:p-8 flex items-center justify-center">
                    <img
                      src={LOGO_IMAGE_SRC}
                      alt="New Life Fundamental Baptist Church — School of Ministry Official Seal"
                      onError={() => setLogoImgFailed(true)}
                      className="w-full max-w-[220px] sm:max-w-[320px] lg:max-w-[360px] aspect-square object-contain"
                    />
                  </div>
                  <figcaption className="text-xs font-serif italic text-[#57534E] mt-3 text-center">
                    New Life Fundamental Baptist Church · School of Ministry
                  </figcaption>
                </figure>
              ) : (
                <div className="w-full h-full min-h-[260px] sm:min-h-[320px] bg-[#F5F1E8] border border-[#E5DFD3] rounded-lg flex flex-col items-center justify-center p-8 sm:p-10 text-center space-y-3">
                  <BookOpen className="w-8 h-8 text-[#1E3A8A]" />
                  <p className="font-serif text-xl text-[#1C1917]">NLFBC - School of Ministry</p>
                </div>
              )}
            </div>
          </section>
        ) : !isApproved ? (
          /* STUDENT REGISTRATION & PENDING APPROVAL GATE */
          <StudentRegistrationGate onNotify={notify} />
        ) : activeTab === 'courses' ? (
          /* SIGNED-IN COURSES WORKSPACE */
          selectedCourse ? (
            <CourseDetailWorkspace
              course={selectedCourse}
              userCourseRole={getUserCourseRole(selectedCourse)}
              pendingEnrollment={pendingEnrollmentByCourseId.get(selectedCourse.id) || null}
              onRequestEnrollment={handleRequestCourseEnrollment}
              onCancelEnrollment={handleCancelEnrollmentRequest}
              initialSection={courseInitialSection}
              onBack={() => setSelectedCourseId(null)}
              onRequestConfirm={setConfirmRequest}
              onNotify={notify}
            />
          ) : (
            <div className="space-y-8 sm:space-y-10">
              {isInstructor && (
                <AdminFacultyPanel
                  courses={myCourses}
                  sessions={allSessions}
                  recordings={allRecordings}
                  resources={allResources}
                  registrationRequests={registrationRequests}
                  pendingEnrollments={pendingStaffEnrollments}
                  onOpenCourse={(id) => openCourse(id, 'sessions')}
                  onDeleteMeetInvite={handleDeleteMeetInviteFromClasses}
                  onRequestConfirm={setConfirmRequest}
                  onCourseCreated={(id) => openCourse(id, 'sessions')}
                  onNotify={notify}
                />
              )}

              {myCourses.length === 0 && availableCourses.length === 0 ? (
                /* EMPTY-START ENROLLMENT-GATED ZERO STATE */
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-10 items-center py-4 sm:py-6">
                  <div className="lg:col-span-7 space-y-4">
                    <p className="text-xs font-mono text-[#57534E] break-words">
                      Signed in as {profile?.displayName || user.displayName} ·{' '}
                      <span className="capitalize">{effectiveRole}</span> ·{' '}
                      <span className="break-all">{user.email}</span>
                    </p>
                    <h1 className="text-3xl md:text-4xl font-serif font-semibold text-[#1C1917]">
                      {isInstructor
                        ? 'Your academic catalog is empty.'
                        : 'No courses are open for enrollment yet.'}
                    </h1>
                    <p className="text-sm sm:text-base text-[#57534E] leading-relaxed max-w-xl">
                      {isInstructor
                        ? 'Create your first course above to provision its Google Drive folder, approve students, schedule live Google Meet sessions, and publish shared recordings.'
                        : 'Once courses are created by an instructor or admin, they will appear here so you can browse classes and request enrollment.'}
                    </p>
                  </div>

                  <div className="lg:col-span-5 flex justify-center">
                    {!logoImgFailed ? (
                      <figure className="w-full max-w-[240px] sm:max-w-[320px] flex flex-col items-center">
                        <div className="w-full bg-white border border-[#E5DFD3] rounded-xl p-5 sm:p-6 flex items-center justify-center">
                          <img
                            src={LOGO_IMAGE_SRC}
                            alt="New Life Fundamental Baptist Church — School of Ministry Official Seal"
                            onError={() => setLogoImgFailed(true)}
                            className="w-full max-w-[190px] sm:max-w-[240px] aspect-square object-contain"
                          />
                        </div>
                        <figcaption className="text-xs font-serif italic text-[#57534E] mt-2 text-center">
                          Awaiting course catalog
                        </figcaption>
                      </figure>
                    ) : (
                      <div className="aspect-[4/3] w-full bg-[#F5F1E8] border border-[#E5DFD3] rounded-lg flex items-center justify-center">
                        <BookOpen className="w-8 h-8 text-[#57534E]" />
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="space-y-10">
                  {myCourses.length > 0 && (
                    <div className="space-y-5 sm:space-y-6">
                      <div className="space-y-1">
                        <p className="text-xs text-[#57534E] font-mono tabular-nums">
                          {myCourses.length} Active Course{myCourses.length === 1 ? '' : 's'}
                          <span className="mx-2">·</span>
                          <span className="capitalize">{effectiveRole}</span>
                        </p>
                        <h1 className="text-2xl sm:text-3xl font-serif font-semibold text-[#1C1917]">
                          Your Courses
                        </h1>
                      </div>

                      <div className="divide-y divide-[#E5DFD3] border-t border-b border-[#E5DFD3]">
                        {myCourses.map((course) => {
                          const roleLabel = getUserCourseRole(course);
                          const canDeleteCourse = roleLabel === 'owner' || roleLabel === 'admin';
                          const classCount = sessionCountByCourseId.get(course.id) || 0;
                          const resCount = resourceCountByCourseId.get(course.id) || 0;
                          return (
                            <div
                              key={course.id}
                              className="py-5 sm:py-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 sm:gap-6"
                            >
                              <div className="space-y-1.5 max-w-2xl min-w-0">
                                <p className="text-xs font-mono text-[#57534E] tabular-nums leading-relaxed">
                                  <span className="text-[#1E3A8A] font-medium">{course.code}</span>
                                  <span className="mx-1.5 sm:mx-2">·</span>
                                  <span>{course.term}</span>
                                  <span className="mx-1.5 sm:mx-2">·</span>
                                  <span>Instructor: {course.instructorName}</span>
                                  <span className="mx-1.5 sm:mx-2">·</span>
                                  <span className="capitalize">
                                    {roleLabel === 'owner' ? 'Teaching' : roleLabel}
                                  </span>
                                </p>
                                <h2 className="text-xl sm:text-2xl font-serif font-semibold text-[#1C1917]">
                                  {course.title}
                                </h2>
                                {course.description && (
                                  <p className="text-sm text-[#57534E] leading-relaxed">
                                    {course.description}
                                  </p>
                                )}
                                <p className="text-xs font-mono text-[#57534E] tabular-nums pt-0.5">
                                  {classCount} Class{classCount === 1 ? '' : 'es'}
                                  <span className="mx-2">·</span>
                                  {resCount} Resource{resCount === 1 ? '' : 's'}
                                </p>
                              </div>

                              <div className="flex items-center gap-2.5 w-full sm:w-auto shrink-0">
                                {canDeleteCourse && (
                                  <button
                                    type="button"
                                    onClick={() => handleDeleteCourse(course)}
                                    aria-label={`Delete course ${course.code}`}
                                    title="Delete Course"
                                    className="inline-flex items-center justify-center gap-1.5 min-h-[44px] sm:min-h-0 px-3.5 sm:px-3 py-2 text-xs font-medium text-[#78350F] bg-[#F5F1E8] hover:bg-[#EBE6DF] border border-[#E5DFD3] rounded-md transition-colors whitespace-nowrap"
                                  >
                                    <Trash2 className="w-4 h-4 sm:w-3.5 sm:h-3.5" />
                                    <span>Delete</span>
                                  </button>
                                )}
                                <button
                                  type="button"
                                  onClick={() => openCourse(course.id, 'sessions')}
                                  className="flex-1 sm:flex-initial inline-flex items-center justify-center gap-2 min-h-[44px] sm:min-h-0 px-4 py-2 text-sm font-medium text-white bg-[#1E3A8A] hover:bg-[#172E6E] rounded-md transition-colors whitespace-nowrap"
                                >
                                  <span>Open Course</span>
                                  <ArrowRight className="w-4 h-4" />
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Available Courses Catalog (Students can view classes & request enrollment) */}
                  {availableCourses.length > 0 && (
                    <div className="space-y-5 sm:space-y-6">
                      <div className="space-y-1">
                        <p className="text-xs text-[#57534E] font-mono tabular-nums">
                          {availableCourses.length} Available Course
                          {availableCourses.length === 1 ? '' : 's'}
                          <span className="mx-2">·</span>
                          <span>Instructor / Admin Approval Required</span>
                        </p>
                        <h2 className="text-2xl sm:text-3xl font-serif font-semibold text-[#1C1917]">
                          Available Courses
                        </h2>
                        <p className="text-sm text-[#57534E] max-w-2xl">
                          Browse course schedules below and request enrollment. Live Google Meet
                          links, recordings, downloads, and lesson resources unlock once your
                          instructor or admin approves your enrollment.
                        </p>
                      </div>

                      <div className="divide-y divide-[#E5DFD3] border-t border-b border-[#E5DFD3]">
                        {availableCourses.map((course) => {
                          const pendingEnr = pendingEnrollmentByCourseId.get(course.id) || null;
                          const classCount = sessionCountByCourseId.get(course.id) || 0;
                          return (
                            <div
                              key={course.id}
                              className="py-5 sm:py-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 sm:gap-6"
                            >
                              <div className="space-y-1.5 max-w-2xl min-w-0">
                                <p className="text-xs font-mono text-[#57534E] tabular-nums leading-relaxed">
                                  <span className="text-[#1E3A8A] font-medium">{course.code}</span>
                                  <span className="mx-1.5 sm:mx-2">·</span>
                                  <span>{course.term}</span>
                                  <span className="mx-1.5 sm:mx-2">·</span>
                                  <span>Instructor: {course.instructorName}</span>
                                  <span className="mx-1.5 sm:mx-2">·</span>
                                  <span
                                    className={
                                      pendingEnr
                                        ? 'text-[#78350F] font-medium'
                                        : 'text-[#57534E]'
                                    }
                                  >
                                    {pendingEnr ? 'Pending Approval' : 'Not Enrolled'}
                                  </span>
                                </p>
                                <h3 className="text-xl sm:text-2xl font-serif font-semibold text-[#1C1917]">
                                  {course.title}
                                </h3>
                                {course.description && (
                                  <p className="text-sm text-[#57534E] leading-relaxed">
                                    {course.description}
                                  </p>
                                )}
                                <p className="text-xs font-mono text-[#57534E] tabular-nums pt-0.5 flex items-center gap-1.5">
                                  <span>
                                    {classCount} Scheduled Class{classCount === 1 ? '' : 'es'}
                                  </span>
                                  <span>·</span>
                                  <Lock className="w-3 h-3 text-[#78350F] shrink-0" />
                                  <span>Materials locked until approved</span>
                                </p>
                              </div>

                              <div className="flex flex-wrap items-center gap-2.5 w-full sm:w-auto shrink-0">
                                <button
                                  type="button"
                                  onClick={() => openCourse(course.id, 'sessions')}
                                  className="flex-1 sm:flex-initial inline-flex items-center justify-center gap-1.5 min-h-[44px] sm:min-h-0 px-3.5 py-2 text-xs font-medium text-[#1C1917] bg-[#F5F1E8] hover:bg-[#EBE6DF] border border-[#E5DFD3] rounded-md whitespace-nowrap"
                                >
                                  <span>View Classes</span>
                                </button>
                                {pendingEnr ? (
                                  <button
                                    type="button"
                                    disabled={enrollingCourseId === course.id}
                                    onClick={() => handleCancelEnrollmentRequest(pendingEnr)}
                                    className="flex-1 sm:flex-initial inline-flex items-center justify-center gap-1.5 min-h-[44px] sm:min-h-0 px-3.5 py-2 text-xs font-medium text-[#78350F] bg-[#F5F1E8] hover:bg-[#EBE6DF] border border-[#E5DFD3] rounded-md whitespace-nowrap disabled:opacity-60"
                                  >
                                    <Clock className="w-3.5 h-3.5 shrink-0" />
                                    <span>
                                      {enrollingCourseId === course.id
                                        ? 'Canceling…'
                                        : 'Pending (Cancel)'}
                                    </span>
                                  </button>
                                ) : (
                                  <button
                                    type="button"
                                    disabled={enrollingCourseId === course.id}
                                    onClick={() => handleRequestCourseEnrollment(course)}
                                    className="flex-1 sm:flex-initial inline-flex items-center justify-center gap-2 min-h-[44px] sm:min-h-0 px-4 py-2 text-sm sm:text-xs font-medium text-white bg-[#1E3A8A] hover:bg-[#172E6E] rounded-md transition-colors whitespace-nowrap disabled:opacity-60"
                                  >
                                    <span>
                                      {enrollingCourseId === course.id
                                        ? 'Requesting…'
                                        : 'Request Enrollment'}
                                    </span>
                                  </button>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        ) : activeTab === 'classes' ? (
          /* COURSE-SCOPED CLASSES TAB (SYNCED WITH COURSES -> CLASSES -> RESOURCES HIERARCHY) */
          <section className="space-y-6">
            <div className="border-b border-[#E5DFD3] pb-5 flex flex-col md:flex-row md:items-end justify-between gap-4">
              <div className="space-y-1 min-w-0">
                <p className="text-xs font-mono text-[#57534E]">
                  Courses
                  {hierarchyCourse && (
                    <>
                      <span className="mx-1.5">/</span>
                      <span className="text-[#1E3A8A] font-medium">{hierarchyCourse.code}</span>
                    </>
                  )}
                  <span className="mx-1.5">/</span>
                  <span>Classes</span>
                </p>
                <h1 className="text-2xl sm:text-3xl font-serif font-semibold text-[#1C1917]">
                  {hierarchyCourse ? `${hierarchyCourse.code} — Classes` : 'Classes'}
                </h1>
                {hierarchyCourse && (
                  <p className="text-xs text-[#57534E]">
                    {hierarchyCourse.title} · {hierarchyCourse.term}
                  </p>
                )}
              </div>

              {browsableCourses.length > 0 && hierarchyCourse && (
                <div className="flex flex-col sm:flex-row sm:items-center gap-2.5 sm:gap-3 w-full md:w-auto">
                  <label className="flex flex-col sm:flex-row sm:items-center gap-1.5 sm:gap-2 text-xs text-[#57534E] w-full sm:w-auto">
                    <span className="font-medium">Course</span>
                    <select
                      aria-label="Select course for classes"
                      value={hierarchyCourse.id}
                      onChange={(e) => setSelectedCourseId(e.target.value)}
                      className="w-full sm:w-auto min-h-[44px] sm:min-h-0 px-3 py-2 text-base sm:text-xs font-medium bg-[#F5F1E8] border border-[#E5DFD3] rounded-md text-[#1C1917] focus:outline-none focus:border-[#1E3A8A]"
                    >
                      {browsableCourses.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.code} — {c.title}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button
                    type="button"
                    onClick={() => openCourse(hierarchyCourse.id, 'sessions')}
                    className="w-full sm:w-auto min-h-[44px] sm:min-h-0 px-3.5 py-2 text-sm sm:text-xs font-medium text-white bg-[#1E3A8A] hover:bg-[#172E6E] rounded-md whitespace-nowrap text-center"
                  >
                    {isStaffForHierarchyCourse ? 'Manage in Course' : 'Open Course'}
                  </button>
                </div>
              )}
            </div>

            {hierarchyCourse && hierarchyRole === 'prospective' && (
              <div className="bg-[#F5F1E8] border border-[#1E3A8A]/35 rounded-lg p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="space-y-0.5 min-w-0">
                  <p className="text-xs font-mono text-[#1E3A8A] flex items-center gap-1.5">
                    {hierarchyPendingEnrollment ? (
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
                  <p className="text-xs sm:text-sm text-[#1C1917]">
                    {hierarchyPendingEnrollment
                      ? 'Your enrollment request is awaiting instructor or admin approval.'
                      : 'Request enrollment to unlock Google Meet links, lesson materials, and class recordings.'}
                  </p>
                </div>
                {hierarchyPendingEnrollment ? (
                  <button
                    type="button"
                    disabled={enrollingCourseId === hierarchyCourse.id}
                    onClick={() => handleCancelEnrollmentRequest(hierarchyPendingEnrollment)}
                    className="w-full sm:w-auto min-h-[44px] sm:min-h-0 px-3.5 py-2 text-xs font-medium text-[#78350F] bg-[#FBF9F5] hover:bg-[#EBE6DF] border border-[#E5DFD3] rounded-md whitespace-nowrap disabled:opacity-60"
                  >
                    Cancel Request
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={enrollingCourseId === hierarchyCourse.id}
                    onClick={() => handleRequestCourseEnrollment(hierarchyCourse)}
                    className="w-full sm:w-auto min-h-[44px] sm:min-h-0 px-4 py-2 text-xs font-medium text-white bg-[#1E3A8A] hover:bg-[#172E6E] rounded-md whitespace-nowrap disabled:opacity-60"
                  >
                    Request Enrollment
                  </button>
                )}
              </div>
            )}

            {!hierarchyCourse ? (
              <div className="py-14 sm:py-16 text-center space-y-2 border-b border-[#E5DFD3]">
                <Calendar className="w-6 h-6 text-[#57534E] mx-auto" />
                <p className="font-serif text-xl text-[#1C1917]">No courses registered yet</p>
                <p className="text-sm text-[#57534E] max-w-md mx-auto">
                  Classes are registered under a specific course. Create or enroll in a course first
                  to view its live Google Meet classes and recordings.
                </p>
              </div>
            ) : activeCourseSessions.length === 0 ? (
              <div className="py-14 sm:py-16 text-center space-y-3 border-b border-[#E5DFD3]">
                <Calendar className="w-6 h-6 text-[#57534E] mx-auto" />
                <p className="font-serif text-xl text-[#1C1917]">
                  No classes registered for {hierarchyCourse.code}
                </p>
                <p className="text-sm text-[#57534E] max-w-md mx-auto">
                  Only classes registered to {hierarchyCourse.code} — {hierarchyCourse.title} appear
                  here.
                </p>
                <button
                  type="button"
                  onClick={() => openCourse(hierarchyCourse.id, 'sessions')}
                  className="inline-flex items-center justify-center gap-2 min-h-[44px] sm:min-h-0 px-4 py-2 text-sm sm:text-xs font-medium text-white bg-[#1E3A8A] hover:bg-[#172E6E] rounded-md"
                >
                  <span>Open {hierarchyCourse.code} Classes</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>
            ) : (
              <div className="divide-y divide-[#E5DFD3] border-b border-[#E5DFD3]">
                {activeCourseSessions.map((ses) => {
                  const isProspectiveCourse = hierarchyRole === 'prospective';
                  const attached = isProspectiveCourse
                    ? []
                    : (recordingsBySessionId.get(ses.id) || []).filter(
                        (rec) => rec.courseId === hierarchyCourse.id
                      );
                  const lessonFiles = isProspectiveCourse
                    ? []
                    : activeCourseResourcesBySessionId.get(ses.id) || [];
                  const hasRecording = attached.length > 0 || ses.recordingStatus === 'synced';
                  return (
                    <div key={ses.id} className="py-5 space-y-4">
                      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                        <div className="space-y-1 min-w-0">
                          <p className="text-xs font-mono text-[#57534E] tabular-nums leading-relaxed">
                            <span className="text-[#1E3A8A] font-medium">{ses.courseCode}</span>
                            <span className="mx-1.5 sm:mx-2">·</span>
                            <span>
                              {formatSessionDateTime(ses.scheduledStart)} —{' '}
                              {formatSessionDateTime(ses.scheduledEnd)}
                            </span>
                            {!isProspectiveCourse && (
                              <>
                                <span className="mx-1.5 sm:mx-2">·</span>
                                <span
                                  className={
                                    hasRecording
                                      ? 'text-[#14532D] font-medium'
                                      : 'text-[#57534E]'
                                  }
                                >
                                  {attached.length > 0
                                    ? `${attached.length} Recording${attached.length === 1 ? '' : 's'} Synced`
                                    : hasRecording
                                      ? 'Recording Synced'
                                      : 'Recording Pending'}
                                </span>
                                {(!ses.meetUri || ses.meetInviteDeleted) && (
                                  <>
                                    <span className="mx-1.5 sm:mx-2">·</span>
                                    <span className="text-[#78350F] font-medium">
                                      Meet Invite Closed
                                    </span>
                                  </>
                                )}
                                {lessonFiles.length > 0 && (
                                  <>
                                    <span className="mx-1.5 sm:mx-2">·</span>
                                    <span className="text-[#1E3A8A] font-medium">
                                      {lessonFiles.length} Lesson File
                                      {lessonFiles.length === 1 ? '' : 's'}
                                    </span>
                                  </>
                                )}
                              </>
                            )}
                          </p>
                          <h2 className="text-xl font-serif font-semibold text-[#1C1917]">
                            {ses.title}
                          </h2>
                          <p className="text-xs text-[#57534E]">{ses.courseTitle}</p>
                        </div>

                        <div className="flex flex-wrap items-center gap-2 sm:gap-2.5 w-full sm:w-auto shrink-0">
                          <button
                            type="button"
                            onClick={() => openCourse(ses.courseId, 'sessions')}
                            className="flex-1 sm:flex-initial inline-flex items-center justify-center min-h-[44px] sm:min-h-0 px-3.5 py-2 text-xs font-medium text-[#1C1917] bg-[#F5F1E8] hover:bg-[#EBE6DF] border border-[#E5DFD3] rounded-md whitespace-nowrap"
                          >
                            {isStaffForHierarchyCourse && attached.length === 0
                              ? 'Sync in Course'
                              : 'Open in Course'}
                          </button>
                          {isStaffForHierarchyCourse && (ses.meetUri || ses.calendarEventId) && (
                            <button
                              type="button"
                              onClick={() =>
                                handleDeleteMeetInviteFromClasses(hierarchyCourse, ses)
                              }
                              title="Stop active Google Meet and delete invite (keeps saved session, recordings, and resources)"
                              className="flex-1 sm:flex-initial inline-flex items-center justify-center gap-1.5 min-h-[44px] sm:min-h-0 px-3 py-2 text-xs font-medium text-[#78350F] bg-[#F5F1E8] hover:bg-[#EBE6DF] border border-[#E5DFD3] rounded-md whitespace-nowrap"
                            >
                              <VideoOff className="w-3.5 h-3.5 shrink-0" />
                              <span>Stop &amp; Delete Meet</span>
                            </button>
                          )}
                          {!isProspectiveCourse && ses.meetUri && (
                            <a
                              href={ses.meetUri}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={() =>
                                handleStudentJoinMeetFromClasses(hierarchyCourse, ses)
                              }
                              className="w-full sm:w-auto inline-flex items-center justify-center gap-1.5 min-h-[44px] sm:min-h-0 px-3.5 py-2 text-xs font-medium text-white bg-[#1E3A8A] hover:bg-[#172E6E] rounded-md whitespace-nowrap"
                            >
                              <Video className="w-4 h-4 sm:w-3.5 sm:h-3.5 shrink-0" />
                              <span>Join Meet</span>
                            </a>
                          )}
                        </div>
                      </div>

                      {isProspectiveCourse && (
                        <div className="pl-3 sm:pl-4 md:pl-6 border-l border-[#E5DFD3]">
                          <p className="text-xs text-[#57534E] inline-flex items-center gap-1.5">
                            <Lock className="w-3.5 h-3.5 text-[#78350F] shrink-0" />
                            <span>
                              Enroll and await approval to access live Meet links, lesson
                              materials, and recordings.
                            </span>
                          </p>
                        </div>
                      )}

                      {lessonFiles.length > 0 && (
                        <div className="pl-3 sm:pl-4 md:pl-6 border-l border-[#1E3A8A]/35 space-y-3">
                          <p className="text-xs font-mono text-[#1E3A8A]">Lesson Materials</p>
                          {lessonFiles.map((file) => {
                            const isPreviewOpen = activeClassPreviewId === file.id;
                            return (
                              <div key={file.id} className="space-y-2.5">
                                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2.5 sm:gap-3">
                                  <div className="space-y-0.5 min-w-0">
                                    <p className="text-sm font-medium text-[#1C1917] flex items-start sm:items-center gap-2">
                                      <FileText className="w-4 h-4 text-[#1E3A8A] shrink-0 mt-0.5 sm:mt-0" />
                                      <span className="break-words sm:truncate">
                                        {file.fileName}
                                      </span>
                                    </p>
                                    <p className="text-xs text-[#57534E]">
                                      Uploaded by{' '}
                                      <span className="text-[#1C1917] font-medium">
                                        {formatResourceUploader(
                                          file,
                                          hierarchyCourse.instructorName
                                        )}
                                      </span>
                                    </p>
                                  </div>
                                  <div className="grid grid-cols-2 sm:flex sm:items-center gap-2 w-full sm:w-auto shrink-0">
                                    <button
                                      type="button"
                                      disabled={downloadingResourceId === file.id}
                                      onClick={() => handleDownloadResource(file)}
                                      className="inline-flex items-center justify-center gap-1.5 min-h-[44px] sm:min-h-0 px-3 py-2 sm:py-1.5 text-xs font-medium text-white bg-[#1E3A8A] hover:bg-[#172E6E] rounded-md whitespace-nowrap disabled:opacity-60"
                                    >
                                      <Download className="w-3.5 h-3.5 shrink-0" />
                                      <span>
                                        {downloadingResourceId === file.id
                                          ? 'Downloading…'
                                          : 'Download'}
                                      </span>
                                    </button>
                                    {isStaffForHierarchyCourse ? (
                                      <a
                                        href={file.webViewLink}
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
                                          setActiveClassPreviewId(isPreviewOpen ? null : file.id)
                                        }
                                        className="inline-flex items-center justify-center gap-1.5 min-h-[44px] sm:min-h-0 px-3 py-2 sm:py-1.5 text-xs font-medium text-[#1E3A8A] bg-[#F5F1E8] hover:bg-[#EBE6DF] border border-[#E5DFD3] rounded-md whitespace-nowrap"
                                      >
                                        <Eye className="w-3.5 h-3.5 shrink-0" />
                                        <span>{isPreviewOpen ? 'Hide Preview' : 'View'}</span>
                                      </button>
                                    )}
                                  </div>
                                </div>
                                {!isStaffForHierarchyCourse && isPreviewOpen && (
                                  <div className="space-y-1.5">
                                    <div className="aspect-[16/10] w-full max-w-3xl bg-[#F5F1E8] rounded-md overflow-hidden border border-[#E5DFD3]">
                                      <iframe
                                        title={file.fileName}
                                        src={`https://drive.google.com/file/d/${encodeURIComponent(
                                          file.driveFileId
                                        )}/preview`}
                                        className="w-full h-full border-0"
                                        allow="fullscreen"
                                      />
                                    </div>
                                    <p className="text-[11px] text-[#57534E]">
                                      Preview not loading?{' '}
                                      <a
                                        href={`https://drive.google.com/file/d/${encodeURIComponent(
                                          file.driveFileId
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

                      {attached.length > 0 && (
                        <div className="pl-3 sm:pl-4 md:pl-6 border-l border-[#1E3A8A]/35 space-y-3">
                          <p className="text-xs font-mono text-[#1E3A8A]">Meet Recording</p>
                          {attached.map((rec) => {
                            const isPlaying = activeClassPlayerId === rec.id;
                            const displayTitle = formatRecordingTitle(rec.title);
                            return (
                              <div key={rec.id} className="space-y-3">
                                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                                  <div className="space-y-0.5 min-w-0">
                                    <p className="text-sm font-medium text-[#1C1917] flex items-start sm:items-center gap-2">
                                      <Video className="w-4 h-4 text-[#1E3A8A] shrink-0 mt-0.5 sm:mt-0" />
                                      <span className="break-words sm:truncate">
                                        {displayTitle}
                                      </span>
                                    </p>
                                    <p className="text-xs text-[#57534E] font-mono tabular-nums">
                                      {rec.durationLabel || 'Recorded lecture'}
                                      <span className="mx-2">·</span>
                                      <span className="text-[#14532D]">
                                        Shared with {rec.sharedWithCount} cohort member(s)
                                      </span>
                                    </p>
                                    {isStaffForHierarchyCourse && (
                                      <p className="text-xs text-[#57534E] font-mono break-words">
                                        Drive Path:{' '}
                                        <span className="text-[#1C1917]">
                                          LMS / {ses.courseCode} — {ses.courseTitle} / Recordings
                                        </span>
                                      </p>
                                    )}
                                  </div>
                                  <div className="grid grid-cols-2 sm:flex sm:items-center gap-2 sm:gap-2.5 w-full sm:w-auto shrink-0">
                                    <button
                                      type="button"
                                      onClick={() =>
                                        setActiveClassPlayerId(isPlaying ? null : rec.id)
                                      }
                                      className={`${
                                        isStaffForHierarchyCourse ? '' : 'col-span-2 sm:col-span-1 '
                                      }inline-flex items-center justify-center gap-1.5 min-h-[44px] sm:min-h-0 px-3 py-2 sm:py-1.5 text-xs font-medium text-[#1E3A8A] bg-[#F5F1E8] hover:bg-[#EBE6DF] border border-[#E5DFD3] rounded-md whitespace-nowrap`}
                                    >
                                      <PlayCircle className="w-4 h-4 sm:w-3.5 sm:h-3.5 shrink-0" />
                                      <span>{isPlaying ? 'Hide Player' : 'Watch Recording'}</span>
                                    </button>
                                    {isStaffForHierarchyCourse && (
                                      <a
                                        href={rec.webViewLink}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="inline-flex items-center justify-center gap-1.5 min-h-[44px] sm:min-h-0 px-3 sm:px-0 py-2 sm:py-0 text-xs font-medium text-[#57534E] hover:text-[#1C1917] border border-[#E5DFD3] sm:border-transparent rounded-md sm:rounded-none"
                                      >
                                        <span>Open in Drive</span>
                                        <ExternalLink className="w-3 h-3 shrink-0" />
                                      </a>
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
                                    {!isStaffForHierarchyCourse && (
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
          </section>
        ) : (
          /* COURSE-SCOPED RESOURCES TAB (SYNCED WITH COURSES -> CLASSES -> RESOURCES HIERARCHY) */
          <section className="space-y-6">
            <div className="border-b border-[#E5DFD3] pb-5 flex flex-col md:flex-row md:items-end justify-between gap-4">
              <div className="space-y-1 min-w-0">
                <p className="text-xs font-mono text-[#57534E]">
                  Courses
                  {hierarchyCourse && (
                    <>
                      <span className="mx-1.5">/</span>
                      <span className="text-[#1E3A8A] font-medium">{hierarchyCourse.code}</span>
                    </>
                  )}
                  <span className="mx-1.5">/</span>
                  <span>Resources</span>
                </p>
                <h1 className="text-2xl sm:text-3xl font-serif font-semibold text-[#1C1917]">
                  {hierarchyCourse ? `${hierarchyCourse.code} — Resources` : 'Resources'}
                </h1>
                {hierarchyCourse && (
                  <p className="text-xs text-[#57534E]">
                    {hierarchyCourse.title} · {hierarchyCourse.term}
                  </p>
                )}
              </div>

              {browsableCourses.length > 0 && hierarchyCourse && (
                <div className="flex flex-col sm:flex-row sm:items-center gap-2.5 sm:gap-3 w-full md:w-auto">
                  <label className="flex flex-col sm:flex-row sm:items-center gap-1.5 sm:gap-2 text-xs text-[#57534E] w-full sm:w-auto">
                    <span className="font-medium">Course</span>
                    <select
                      aria-label="Select course for resources"
                      value={hierarchyCourse.id}
                      onChange={(e) => setSelectedCourseId(e.target.value)}
                      className="w-full sm:w-auto min-h-[44px] sm:min-h-0 px-3 py-2 text-base sm:text-xs font-medium bg-[#F5F1E8] border border-[#E5DFD3] rounded-md text-[#1C1917] focus:outline-none focus:border-[#1E3A8A]"
                    >
                      {browsableCourses.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.code} — {c.title}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button
                    type="button"
                    onClick={() => openCourse(hierarchyCourse.id, 'resources')}
                    className="w-full sm:w-auto min-h-[44px] sm:min-h-0 px-3.5 py-2 text-sm sm:text-xs font-medium text-white bg-[#1E3A8A] hover:bg-[#172E6E] rounded-md whitespace-nowrap text-center"
                  >
                    {isStaffForHierarchyCourse ? 'Manage in Course' : 'Open Course'}
                  </button>
                </div>
              )}
            </div>

            {!hierarchyCourse ? (
              <div className="py-14 sm:py-16 text-center space-y-2 border-b border-[#E5DFD3]">
                <FileText className="w-6 h-6 text-[#57534E] mx-auto" />
                <p className="font-serif text-xl text-[#1C1917]">No courses registered yet</p>
                <p className="text-sm text-[#57534E] max-w-md mx-auto">
                  Resources belong to a specific course. Create or enroll in a course first to
                  access its shared study materials.
                </p>
              </div>
            ) : hierarchyRole === 'prospective' ? (
              <div className="py-14 sm:py-16 text-center space-y-3 border-b border-[#E5DFD3]">
                <Lock className="w-6 h-6 text-[#78350F] mx-auto" />
                <p className="font-serif text-xl text-[#1C1917]">
                  Resources for {hierarchyCourse.code} are protected
                </p>
                <p className="text-sm text-[#57534E] max-w-md mx-auto">
                  {hierarchyPendingEnrollment
                    ? 'Your enrollment request is pending instructor or admin approval. Resources and downloads will unlock once approved.'
                    : 'Request enrollment in this course to view and download its shared readings and lesson files.'}
                </p>
                {hierarchyPendingEnrollment ? (
                  <button
                    type="button"
                    disabled={enrollingCourseId === hierarchyCourse.id}
                    onClick={() => handleCancelEnrollmentRequest(hierarchyPendingEnrollment)}
                    className="inline-flex items-center justify-center min-h-[44px] sm:min-h-0 px-4 py-2 text-xs font-medium text-[#78350F] bg-[#F5F1E8] hover:bg-[#EBE6DF] border border-[#E5DFD3] rounded-md disabled:opacity-60"
                  >
                    Cancel Pending Request
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={enrollingCourseId === hierarchyCourse.id}
                    onClick={() => handleRequestCourseEnrollment(hierarchyCourse)}
                    className="inline-flex items-center justify-center min-h-[44px] sm:min-h-0 px-4 py-2 text-xs font-medium text-white bg-[#1E3A8A] hover:bg-[#172E6E] rounded-md disabled:opacity-60"
                  >
                    Request Course Enrollment
                  </button>
                )}
              </div>
            ) : activeCourseResources.length === 0 ? (
              <div className="py-14 sm:py-16 text-center space-y-3 border-b border-[#E5DFD3]">
                <FileText className="w-6 h-6 text-[#57534E] mx-auto" />
                <p className="font-serif text-xl text-[#1C1917]">
                  No resources uploaded for {hierarchyCourse.code}
                </p>
                <p className="text-sm text-[#57534E] max-w-md mx-auto">
                  Only study materials uploaded to {hierarchyCourse.code} — {hierarchyCourse.title}{' '}
                  appear here.
                </p>
                <button
                  type="button"
                  onClick={() => openCourse(hierarchyCourse.id, 'resources')}
                  className="inline-flex items-center justify-center gap-2 min-h-[44px] sm:min-h-0 px-4 py-2 text-sm sm:text-xs font-medium text-white bg-[#1E3A8A] hover:bg-[#172E6E] rounded-md"
                >
                  <span>Open {hierarchyCourse.code} Resources</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>
            ) : (
              <div className="divide-y divide-[#E5DFD3] border-b border-[#E5DFD3]">
                {activeCourseResources.map((res) => {
                  const linkedSession = res.sessionId
                    ? activeCourseSessionById.get(res.sessionId)
                    : null;
                  const linkedSessionLabel = linkedSession?.title || res.sessionTitle;
                  const isPreviewOpen = activeResourcePreviewId === res.id;
                  return (
                    <div key={res.id} className="py-4 sm:py-5 space-y-3">
                      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3.5 sm:gap-4">
                        <div className="space-y-1 min-w-0">
                          <p className="text-xs font-mono text-[#57534E] leading-relaxed">
                            <span className="text-[#1E3A8A] font-medium">{res.courseCode}</span>
                            <span className="mx-1.5 sm:mx-2">·</span>
                            <span>{res.moduleTitle}</span>
                            <span className="mx-1.5 sm:mx-2">·</span>
                            <span>{res.courseTitle}</span>
                            {linkedSessionLabel && (
                              <>
                                <span className="mx-1.5 sm:mx-2">·</span>
                                <span className="text-[#1E3A8A] font-medium">
                                  Lesson: {linkedSessionLabel}
                                </span>
                              </>
                            )}
                          </p>
                          <p className="text-sm font-medium text-[#1C1917] flex items-start sm:items-center gap-2">
                            <FileText className="w-4 h-4 text-[#1E3A8A] shrink-0 mt-0.5 sm:mt-0" />
                            <span className="break-words sm:truncate">{res.fileName}</span>
                          </p>
                          <p className="text-xs text-[#57534E]">
                            Uploaded by{' '}
                            <span className="text-[#1C1917] font-medium">
                              {formatResourceUploader(res, hierarchyCourse.instructorName)}
                            </span>
                          </p>
                          {isStaffForHierarchyCourse && (
                            <p className="text-xs text-[#57534E] font-mono break-words">
                              Drive Path:{' '}
                              <span className="text-[#1C1917]">
                                LMS / {res.courseCode} — {res.courseTitle}
                              </span>
                            </p>
                          )}
                        </div>
                        <div className="grid grid-cols-2 sm:flex sm:items-center gap-2 sm:gap-2.5 w-full sm:w-auto shrink-0">
                          <button
                            type="button"
                            onClick={() => openCourse(res.courseId, 'resources')}
                            className="hidden sm:inline-flex items-center text-xs font-medium text-[#57534E] hover:text-[#1C1917]"
                          >
                            Course
                          </button>
                          <button
                            type="button"
                            disabled={downloadingResourceId === res.id}
                            onClick={() => handleDownloadResource(res)}
                            className="inline-flex items-center justify-center gap-1.5 min-h-[44px] sm:min-h-0 px-3 py-2 sm:py-1.5 text-xs font-medium text-white bg-[#1E3A8A] hover:bg-[#172E6E] rounded-md whitespace-nowrap disabled:opacity-60"
                          >
                            <Download className="w-3.5 h-3.5 shrink-0" />
                            <span>
                              {downloadingResourceId === res.id ? 'Downloading…' : 'Download'}
                            </span>
                          </button>
                          {isStaffForHierarchyCourse ? (
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
                                setActiveResourcePreviewId(isPreviewOpen ? null : res.id)
                              }
                              className="inline-flex items-center justify-center gap-1.5 min-h-[44px] sm:min-h-0 px-3 py-2 sm:py-1.5 text-xs font-medium text-[#1E3A8A] bg-[#F5F1E8] hover:bg-[#EBE6DF] border border-[#E5DFD3] rounded-md whitespace-nowrap"
                            >
                              <Eye className="w-3.5 h-3.5 shrink-0" />
                              <span>{isPreviewOpen ? 'Hide Preview' : 'View'}</span>
                            </button>
                          )}
                        </div>
                      </div>

                      {!isStaffForHierarchyCourse && isPreviewOpen && (
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
          </section>
        )}
      </main>

      <footer
        className={`border-t border-[#E5DFD3] bg-[#FBF9F5] ${
          user && isApproved ? 'pb-20 md:pb-0' : ''
        }`}
      >
        <div className="max-w-[1200px] mx-auto px-4 sm:px-6 py-5 sm:py-6 flex flex-col sm:flex-row sm:flex-wrap sm:items-center justify-between gap-4 text-xs text-[#57534E]">
          <span className="inline-flex items-center gap-2">
            <img
              src={LOGO_IMAGE_SRC}
              alt=""
              aria-hidden="true"
              className="w-6 h-6 rounded-full object-contain bg-white border border-[#E5DFD3]"
            />
            <span>NLFBC - School of Ministry</span>
          </span>

          <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
            {(!user || isApproved) && (
              <div className={`${user ? 'hidden md:flex' : 'flex'} items-center gap-5`}>
                <button
                  type="button"
                  onClick={() => handleSelectNavTab('courses')}
                  className="hover:text-[#1C1917] transition-colors"
                >
                  Courses
                </button>
                <button
                  type="button"
                  onClick={() => handleSelectNavTab('classes')}
                  className="hover:text-[#1C1917] transition-colors"
                >
                  Classes
                </button>
                <button
                  type="button"
                  onClick={() => handleSelectNavTab('resources')}
                  className="hover:text-[#1C1917] transition-colors"
                >
                  Resources
                </button>
              </div>
            )}
            <div className="flex items-center gap-5">
              <a
                href="/privacy"
                onClick={(e) => {
                  e.preventDefault();
                  navigateToPath('/privacy');
                }}
                aria-current={activePage === 'privacy' ? 'page' : undefined}
                className={`transition-colors ${
                  activePage === 'privacy'
                    ? 'text-[#1E3A8A] font-medium'
                    : 'hover:text-[#1C1917]'
                }`}
              >
                Privacy Policy
              </a>
              <a
                href="/terms"
                onClick={(e) => {
                  e.preventDefault();
                  navigateToPath('/terms');
                }}
                aria-current={activePage === 'terms' ? 'page' : undefined}
                className={`transition-colors ${
                  activePage === 'terms'
                    ? 'text-[#1E3A8A] font-medium'
                    : 'hover:text-[#1C1917]'
                }`}
              >
                Terms of Service
              </a>
            </div>
          </div>
        </div>
      </footer>

      <ConfirmActionModal
        request={confirmRequest}
        onConfirmExecute={handleConfirmExecute}
        onCancel={() => setConfirmRequest(null)}
      />
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider>
        <AuthProvider>
          <LMSWorkspace />
        </AuthProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}
