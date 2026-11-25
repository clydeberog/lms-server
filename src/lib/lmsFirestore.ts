import {
  collection,
  deleteDoc,
  deleteField,
  doc,
  DocumentReference,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
  Unsubscribe,
} from 'firebase/firestore';
import { User } from 'firebase/auth';
import { BOOTSTRAP_ADMIN_EMAIL, db, handleFirestoreError, OperationType } from '../firebase';
import {
  ApprovalStatus,
  AssignmentSubmission,
  AttendanceRecord,
  AttendanceSource,
  AttendanceStatus,
  Course,
  CourseRecording,
  CourseResource,
  CourseRole,
  CourseSession,
  DirectoryUser,
  Enrollment,
  RegistrationRequest,
  UserProfile,
  UserRole,
} from '../types';

function makeSafeId(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 10);
  return `${prefix}_${Date.now()}_${rand}`.replace(/[^a-zA-Z0-9_-]/g, '');
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Loads the user's profile.
 * - For the bootstrap admin, auto-provisions the admin profile & admin registry doc.
 * - For brand-new non-bootstrap users, returns null so they complete the Student Registration form
 *   and enter the "Pending Approval" workflow before accessing the LMS.
 */
export async function ensureUserProfile(user: User): Promise<UserProfile | null> {
  const userRef = doc(db, 'users', user.uid);
  const privateRef = doc(db, 'users', user.uid, 'private', 'info');
  const normalizedEmail = normalizeEmail(user.email || '');
  const isBootstrap = normalizedEmail === BOOTSTRAP_ADMIN_EMAIL && user.emailVerified;

  try {
    const snap = await getDoc(userRef);
    const displayName = (user.displayName || normalizedEmail.split('@')[0] || 'Scholar').slice(
      0,
      120
    );

    if (!snap.exists()) {
      if (!isBootstrap) {
        return null;
      }

      const batch = writeBatch(db);
      batch.set(userRef, {
        uid: user.uid,
        displayName,
        role: 'admin' as UserRole,
        approvalStatus: 'approved' as ApprovalStatus,
        department: 'Academic Administration',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      batch.set(privateRef, {
        uid: user.uid,
        email: normalizedEmail,
        updatedAt: serverTimestamp(),
      });
      batch.set(doc(db, 'admins', user.uid), {
        uid: user.uid,
        grantedByUid: user.uid,
        createdAt: serverTimestamp(),
      });
      await batch.commit();
      const created = await getDoc(userRef);
      return created.data() as UserProfile;
    }

    // Ensure isolated private info document is always synchronized
    const privSnap = await getDoc(privateRef);
    if (!privSnap.exists()) {
      await setDoc(privateRef, {
        uid: user.uid,
        email: normalizedEmail,
        updatedAt: serverTimestamp(),
      });
    }

    // Ensure bootstrap admin registry entry exists
    if (isBootstrap) {
      const adminRef = doc(db, 'admins', user.uid);
      const adminSnap = await getDoc(adminRef);
      if (!adminSnap.exists()) {
        await setDoc(adminRef, {
          uid: user.uid,
          grantedByUid: user.uid,
          createdAt: serverTimestamp(),
        });
      }
    }

    return snap.data() as UserProfile;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `users/${user.uid}`);
  }
}

export function subscribeUserProfile(
  uid: string,
  onUpdate: (profile: UserProfile | null) => void
): Unsubscribe {
  return onSnapshot(
    doc(db, 'users', uid),
    (snap) => {
      if (!snap.exists()) {
        onUpdate(null);
        return;
      }
      onUpdate(snap.data() as UserProfile);
    },
    (error) => {
      handleFirestoreError(error, OperationType.GET, `users/${uid}`);
    }
  );
}

export async function updateUserAccountProfile(
  uid: string,
  params: {
    displayName: string;
    photoUrl?: string | null;
  }
): Promise<UserProfile> {
  const cleanName = params.displayName.trim().slice(0, 120);
  if (!cleanName) {
    throw new Error('Display name cannot be empty.');
  }

  const userRef = doc(db, 'users', uid);
  const updates: Record<string, unknown> = {
    displayName: cleanName,
    updatedAt: serverTimestamp(),
  };

  if (params.photoUrl !== undefined) {
    if (params.photoUrl === null || params.photoUrl.trim() === '') {
      updates.photoUrl = deleteField();
    } else {
      updates.photoUrl = params.photoUrl.trim();
    }
  }

  try {
    await updateDoc(userRef, updates);
    const snap = await getDoc(userRef);
    return snap.data() as UserProfile;
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `users/${uid}`);
  }
}

export async function submitStudentRegistration(
  user: User,
  params: {
    displayName: string;
    department?: string;
    note?: string;
  }
): Promise<UserProfile> {
  const normalizedEmail = normalizeEmail(user.email || '');
  const cleanName = params.displayName.trim().slice(0, 120);
  const cleanDepartment = (params.department || '').trim().slice(0, 100);
  const cleanNote = (params.note || '').trim().slice(0, 500);

  const userRef = doc(db, 'users', user.uid);
  const privateRef = doc(db, 'users', user.uid, 'private', 'info');
  const reqRef = doc(db, 'registrationRequests', user.uid);

  const userPayload: Record<string, unknown> = {
    uid: user.uid,
    displayName: cleanName,
    role: 'student' as UserRole,
    approvalStatus: 'pending' as ApprovalStatus,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
  if (cleanDepartment) userPayload.department = cleanDepartment;
  if (cleanNote) userPayload.registrationNote = cleanNote;

  const reqPayload: Record<string, unknown> = {
    uid: user.uid,
    displayName: cleanName,
    email: normalizedEmail,
    status: 'pending' as ApprovalStatus,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
  if (cleanDepartment) reqPayload.department = cleanDepartment;
  if (cleanNote) reqPayload.note = cleanNote;

  try {
    const batch = writeBatch(db);
    batch.set(userRef, userPayload);
    batch.set(privateRef, {
      uid: user.uid,
      email: normalizedEmail,
      updatedAt: serverTimestamp(),
    });
    batch.set(reqRef, reqPayload);
    await batch.commit();

    const created = await getDoc(userRef);
    return created.data() as UserProfile;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `registrationRequests/${user.uid}`);
  }
}

export function subscribeRegistrationRequests(
  onUpdate: (items: RegistrationRequest[]) => void
): Unsubscribe {
  return onSnapshot(
    collection(db, 'registrationRequests'),
    (snap) => {
      const items = snap.docs
        .map((d) => ({ id: d.id, ...(d.data() as Omit<RegistrationRequest, 'id'>) }))
        .sort((a, b) => {
          if (a.status === 'pending' && b.status !== 'pending') return -1;
          if (a.status !== 'pending' && b.status === 'pending') return 1;
          const aTime = a.createdAt?.toMillis?.() || 0;
          const bTime = b.createdAt?.toMillis?.() || 0;
          return bTime - aTime;
        });
      onUpdate(items);
    },
    (error) => {
      handleFirestoreError(error, OperationType.LIST, 'registrationRequests');
    }
  );
}

export async function reviewRegistrationRequest(params: {
  requestId: string;
  status: 'approved' | 'rejected';
  reviewerUid: string;
  reviewerName: string;
}): Promise<void> {
  const cleanReviewerName = params.reviewerName.trim().slice(0, 120) || 'Faculty Reviewer';
  try {
    const batch = writeBatch(db);
    batch.update(doc(db, 'registrationRequests', params.requestId), {
      status: params.status,
      reviewedByUid: params.reviewerUid,
      reviewedByName: cleanReviewerName,
      updatedAt: serverTimestamp(),
    });
    batch.update(doc(db, 'users', params.requestId), {
      approvalStatus: params.status,
      approvedByUid: params.reviewerUid,
      approvedByName: cleanReviewerName,
      updatedAt: serverTimestamp(),
    });
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `registrationRequests/${params.requestId}`);
  }
}

/**
 * Claims ONLY pre-invited or already-approved active enrollments for the user.
 * Pending student enrollment requests are NEVER auto-claimed until approved by an instructor or admin.
 */
export async function claimPendingEnrollments(user: User): Promise<number> {
  const email = normalizeEmail(user.email || '');
  if (!email || !user.emailVerified) return 0;

  try {
    const q = query(collection(db, 'enrollments'), where('memberEmail', '==', email));
    const snap = await getDocs(q);
    let claimed = 0;

    for (const enrollDoc of snap.docs) {
      const data = enrollDoc.data() as Omit<Enrollment, 'id'>;
      if (data.status !== 'invited' && data.status !== 'active') continue;

      const memberRef = doc(db, 'courses', data.courseId, 'members', user.uid);
      const memberSnap = await getDoc(memberRef).catch(() => null);
      const needsEnrollmentUpdate = data.status === 'invited';
      const needsMemberDoc = !memberSnap || !memberSnap.exists();

      if (needsEnrollmentUpdate || needsMemberDoc) {
        const batch = writeBatch(db);
        if (needsEnrollmentUpdate) {
          batch.update(doc(db, 'enrollments', enrollDoc.id), {
            memberUid: user.uid,
            memberName: (user.displayName || data.memberName || email.split('@')[0]).slice(0, 120),
            status: 'active',
            updatedAt: serverTimestamp(),
          });
        }
        if (needsMemberDoc) {
          batch.set(memberRef, {
            courseId: data.courseId,
            memberUid: user.uid,
            instructorUid: data.instructorUid,
            enrollmentId: enrollDoc.id,
            courseRole: data.courseRole,
            displayName: (user.displayName || data.memberName || email.split('@')[0]).slice(0, 120),
            joinedAt: serverTimestamp(),
          });
        }
        await batch.commit();
        claimed++;
      }
    }
    return claimed;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, 'enrollments');
  }
}

export async function listDirectoryUsersForAdmin(): Promise<DirectoryUser[]> {
  try {
    const snap = await getDocs(collection(db, 'users'));
    const results: DirectoryUser[] = [];
    for (const userDoc of snap.docs) {
      const profile = userDoc.data() as UserProfile;
      let email = '';
      try {
        const privSnap = await getDoc(doc(db, 'users', profile.uid, 'private', 'info'));
        if (privSnap.exists()) {
          email = (privSnap.data() as { email?: string }).email || '';
        }
      } catch {
        // Skip private lookup if unavailable
      }
      results.push({ ...profile, email });
    }
    return results.sort((a, b) => a.displayName.localeCompare(b.displayName));
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, 'users');
  }
}

export async function updateUserRoleAsAdmin(
  adminUid: string,
  targetUid: string,
  newRole: UserRole
): Promise<void> {
  try {
    const batch = writeBatch(db);
    const updatePayload: Record<string, unknown> = {
      role: newRole,
      updatedAt: serverTimestamp(),
    };
    if (newRole === 'instructor' || newRole === 'admin') {
      updatePayload.approvalStatus = 'approved';
    }
    batch.update(doc(db, 'users', targetUid), updatePayload);
    const adminRef = doc(db, 'admins', targetUid);
    if (newRole === 'admin') {
      batch.set(adminRef, {
        uid: targetUid,
        grantedByUid: adminUid,
        createdAt: serverTimestamp(),
      });
    } else if (targetUid !== adminUid) {
      const existingAdmin = await getDoc(adminRef);
      if (existingAdmin.exists()) {
        batch.delete(adminRef);
      }
    }
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `users/${targetUid}`);
  }
}

export async function createCourseRecord(params: {
  code: string;
  title: string;
  term: string;
  description?: string;
  instructorUid: string;
  instructorName: string;
  instructorEmail: string;
  driveFolderId?: string;
  driveFolderUrl?: string;
}): Promise<string> {
  const courseId = makeSafeId('crs');
  const payload: Record<string, unknown> = {
    code: params.code.trim().slice(0, 24),
    title: params.title.trim().slice(0, 160),
    term: params.term.trim().slice(0, 48),
    description: (params.description || '').trim().slice(0, 2000),
    instructorUid: params.instructorUid,
    instructorName: params.instructorName.trim().slice(0, 120),
    instructorEmail: normalizeEmail(params.instructorEmail),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  if (params.driveFolderId) {
    payload.driveFolderId = params.driveFolderId.slice(0, 256);
  }
  if (params.driveFolderUrl) {
    payload.driveFolderUrl = params.driveFolderUrl.slice(0, 512);
  }

  try {
    await setDoc(doc(db, 'courses', courseId), payload);
    return courseId;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `courses/${courseId}`);
  }
}

export async function deleteCourseRecord(course: Course, isAdmin: boolean): Promise<void> {
  const courseId = course.id;
  try {
    const refsToDelete: DocumentReference<unknown>[] = [];

    const collectRefs = async (q: ReturnType<typeof query>) => {
      try {
        const snap = await getDocs(q);
        for (const d of snap.docs) {
          refsToDelete.push(d.ref);
        }
      } catch {
        // Ignore subcollection query errors for empty/inaccessible collections
      }
    };

    const enrollQuery = isAdmin
      ? query(collection(db, 'enrollments'), where('courseId', '==', courseId))
      : query(
          collection(db, 'enrollments'),
          where('courseId', '==', courseId),
          where('instructorUid', '==', course.instructorUid)
        );
    const membersQuery = isAdmin
      ? query(collection(db, 'courses', courseId, 'members'))
      : query(
          collection(db, 'courses', courseId, 'members'),
          where('instructorUid', '==', course.instructorUid)
        );
    const recordingsQuery = query(
      collection(db, 'courses', courseId, 'recordings'),
      where('courseId', '==', courseId)
    );
    const sessionsQuery = query(
      collection(db, 'courses', courseId, 'sessions'),
      where('courseId', '==', courseId)
    );
    const resourcesQuery = query(
      collection(db, 'courses', courseId, 'resources'),
      where('courseId', '==', courseId)
    );
    const submissionsQuery = query(
      collection(db, 'courses', courseId, 'submissions'),
      where('courseId', '==', courseId)
    );
    const attendanceQuery = query(
      collection(db, 'courses', courseId, 'attendance'),
      where('courseId', '==', courseId)
    );

    await Promise.all([
      collectRefs(recordingsQuery),
      collectRefs(sessionsQuery),
      collectRefs(resourcesQuery),
      collectRefs(submissionsQuery),
      collectRefs(attendanceQuery),
      collectRefs(enrollQuery),
      collectRefs(membersQuery),
    ]);

    const CHUNK_SIZE = 400;
    for (let i = 0; i < refsToDelete.length; i += CHUNK_SIZE) {
      const batch = writeBatch(db);
      for (const ref of refsToDelete.slice(i, i + CHUNK_SIZE)) {
        batch.delete(ref);
      }
      await batch.commit();
    }

    await deleteDoc(doc(db, 'courses', courseId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `courses/${courseId}`);
  }
}

export async function updateCourseDriveFolder(
  courseId: string,
  driveFolderId: string,
  driveFolderUrl: string
): Promise<void> {
  try {
    await updateDoc(doc(db, 'courses', courseId), {
      driveFolderId: driveFolderId.slice(0, 256),
      driveFolderUrl: driveFolderUrl.slice(0, 512),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `courses/${courseId}`);
  }
}

export async function enrollMemberByEmail(params: {
  course: Course;
  memberEmail: string;
  memberName: string;
  courseRole: CourseRole;
  enrolledByUid: string;
}): Promise<string> {
  const email = normalizeEmail(params.memberEmail);
  const enrollmentId = makeSafeId('enr');

  try {
    await setDoc(doc(db, 'enrollments', enrollmentId), {
      courseId: params.course.id,
      courseCode: params.course.code.slice(0, 24),
      courseTitle: params.course.title.slice(0, 160),
      courseTerm: params.course.term.slice(0, 48),
      instructorUid: params.course.instructorUid,
      instructorName: params.course.instructorName.slice(0, 120),
      memberEmail: email.slice(0, 254),
      memberName: (params.memberName.trim() || email.split('@')[0]).slice(0, 120),
      courseRole: params.courseRole,
      status: 'invited',
      enrolledByUid: params.enrolledByUid,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    return enrollmentId;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `enrollments/${enrollmentId}`);
  }
}

/**
 * Approved student requests enrollment in a course (creates a 'pending' enrollment awaiting staff approval).
 */
export async function requestCourseEnrollment(params: {
  course: Course;
  user: User;
  displayName: string;
}): Promise<string> {
  const email = normalizeEmail(params.user.email || '');
  const enrollmentId = makeSafeId('enr');

  try {
    await setDoc(doc(db, 'enrollments', enrollmentId), {
      courseId: params.course.id,
      courseCode: params.course.code.slice(0, 24),
      courseTitle: params.course.title.slice(0, 160),
      courseTerm: params.course.term.slice(0, 48),
      instructorUid: params.course.instructorUid,
      instructorName: params.course.instructorName.slice(0, 120),
      memberEmail: email.slice(0, 254),
      memberUid: params.user.uid,
      memberName: (params.displayName.trim() || email.split('@')[0]).slice(0, 120),
      courseRole: 'student' as CourseRole,
      status: 'pending',
      enrolledByUid: params.user.uid,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    return enrollmentId;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `enrollments/${enrollmentId}`);
  }
}

export async function cancelPendingEnrollmentRequest(enrollmentId: string): Promise<void> {
  try {
    await deleteDoc(doc(db, 'enrollments', enrollmentId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `enrollments/${enrollmentId}`);
  }
}

/**
 * Instructor or Admin approves a pending student enrollment request and atomically unlocks
 * course membership in courses/{courseId}/members/{memberUid}.
 */
export async function approvePendingEnrollment(enrollment: Enrollment): Promise<void> {
  try {
    const batch = writeBatch(db);
    batch.update(doc(db, 'enrollments', enrollment.id), {
      status: enrollment.memberUid ? 'active' : 'invited',
      updatedAt: serverTimestamp(),
    });
    if (enrollment.memberUid) {
      batch.set(doc(db, 'courses', enrollment.courseId, 'members', enrollment.memberUid), {
        courseId: enrollment.courseId,
        memberUid: enrollment.memberUid,
        instructorUid: enrollment.instructorUid,
        enrollmentId: enrollment.id,
        courseRole: enrollment.courseRole,
        displayName: enrollment.memberName.slice(0, 120),
        joinedAt: serverTimestamp(),
      });
    }
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `enrollments/${enrollment.id}`);
  }
}

export async function declinePendingEnrollment(enrollment: Enrollment): Promise<void> {
  try {
    await deleteDoc(doc(db, 'enrollments', enrollment.id));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `enrollments/${enrollment.id}`);
  }
}

export async function removeEnrollment(enrollment: Enrollment): Promise<void> {
  try {
    const batch = writeBatch(db);
    batch.delete(doc(db, 'enrollments', enrollment.id));
    if (enrollment.memberUid) {
      batch.delete(doc(db, 'courses', enrollment.courseId, 'members', enrollment.memberUid));
    }
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `enrollments/${enrollment.id}`);
  }
}

export function subscribeUserEnrollments(
  email: string,
  onUpdate: (items: Enrollment[]) => void
): Unsubscribe {
  const q = query(collection(db, 'enrollments'), where('memberEmail', '==', normalizeEmail(email)));
  return onSnapshot(
    q,
    (snap) => {
      const items = snap.docs
        .map((d) => ({ id: d.id, ...(d.data() as Omit<Enrollment, 'id'>) }))
        .filter((e) => e.status !== 'revoked');
      onUpdate(items);
    },
    (error) => {
      handleFirestoreError(error, OperationType.LIST, 'enrollments');
    }
  );
}

export function subscribePendingEnrollmentsForStaff(
  uid: string,
  isAdmin: boolean,
  onUpdate: (items: Enrollment[]) => void
): Unsubscribe {
  const q = isAdmin
    ? query(collection(db, 'enrollments'), where('status', '==', 'pending'))
    : query(collection(db, 'enrollments'), where('instructorUid', '==', uid));

  return onSnapshot(
    q,
    (snap) => {
      const items = snap.docs
        .map((d) => ({ id: d.id, ...(d.data() as Omit<Enrollment, 'id'>) }))
        .filter((e) => e.status === 'pending')
        .sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));
      onUpdate(items);
    },
    (error) => {
      handleFirestoreError(error, OperationType.LIST, 'enrollments');
    }
  );
}

export function subscribeInstructorCourses(
  uid: string,
  isAdmin: boolean,
  onUpdate: (courses: Course[]) => void
): Unsubscribe {
  const q = isAdmin
    ? query(collection(db, 'courses'))
    : query(collection(db, 'courses'), where('instructorUid', '==', uid));
  return onSnapshot(
    q,
    (snap) => {
      const items = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Course, 'id'>) }));
      onUpdate(items);
    },
    (error) => {
      handleFirestoreError(error, OperationType.LIST, 'courses');
    }
  );
}

/**
 * Allows approved students to browse all school courses so they can view class schedules
 * and request enrollment (resources/recordings/downloads remain locked until approved).
 */
export function subscribeAllCoursesForCatalog(onUpdate: (courses: Course[]) => void): Unsubscribe {
  return onSnapshot(
    collection(db, 'courses'),
    (snap) => {
      const items = snap.docs
        .map((d) => ({ id: d.id, ...(d.data() as Omit<Course, 'id'>) }))
        .sort((a, b) => a.code.localeCompare(b.code));
      onUpdate(items);
    },
    (error) => {
      handleFirestoreError(error, OperationType.LIST, 'courses');
    }
  );
}

export async function fetchCourseById(courseId: string): Promise<Course | null> {
  try {
    const snap = await getDoc(doc(db, 'courses', courseId));
    if (!snap.exists()) return null;
    return { id: snap.id, ...(snap.data() as Omit<Course, 'id'>) };
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, `courses/${courseId}`);
  }
}

export function subscribeCourseRoster(
  course: Course,
  isAdmin: boolean,
  onUpdate: (enrollments: Enrollment[]) => void
): Unsubscribe {
  const q = isAdmin
    ? query(collection(db, 'enrollments'), where('courseId', '==', course.id))
    : query(collection(db, 'enrollments'), where('instructorUid', '==', course.instructorUid));
  return onSnapshot(
    q,
    (snap) => {
      const items = snap.docs
        .map((d) => ({ id: d.id, ...(d.data() as Omit<Enrollment, 'id'>) }))
        .filter((e) => e.courseId === course.id && e.status !== 'revoked');
      onUpdate(items);
    },
    (error) => {
      handleFirestoreError(error, OperationType.LIST, 'enrollments');
    }
  );
}

export function subscribeCourseSessions(
  courseId: string,
  onUpdate: (items: CourseSession[]) => void
): Unsubscribe {
  const q = query(
    collection(db, 'courses', courseId, 'sessions'),
    where('courseId', '==', courseId)
  );
  return onSnapshot(
    q,
    (snap) => {
      const items = snap.docs
        .map((d) => ({ id: d.id, ...(d.data() as Omit<CourseSession, 'id'>) }))
        .sort((a, b) => a.scheduledStart.localeCompare(b.scheduledStart));
      onUpdate(items);
    },
    (error) => {
      handleFirestoreError(error, OperationType.LIST, `courses/${courseId}/sessions`);
    }
  );
}

export function subscribeCourseRecordings(
  courseId: string,
  onUpdate: (items: CourseRecording[]) => void
): Unsubscribe {
  const q = query(
    collection(db, 'courses', courseId, 'recordings'),
    where('courseId', '==', courseId)
  );
  return onSnapshot(
    q,
    (snap) => {
      const items = snap.docs.map((d) => ({
        id: d.id,
        ...(d.data() as Omit<CourseRecording, 'id'>),
      }));
      onUpdate(items);
    },
    (error) => {
      handleFirestoreError(error, OperationType.LIST, `courses/${courseId}/recordings`);
    }
  );
}

export function subscribeCourseResources(
  courseId: string,
  onUpdate: (items: CourseResource[]) => void
): Unsubscribe {
  const q = query(
    collection(db, 'courses', courseId, 'resources'),
    where('courseId', '==', courseId)
  );
  return onSnapshot(
    q,
    (snap) => {
      const items = snap.docs.map((d) => ({
        id: d.id,
        ...(d.data() as Omit<CourseResource, 'id'>),
      }));
      onUpdate(items);
    },
    (error) => {
      handleFirestoreError(error, OperationType.LIST, `courses/${courseId}/resources`);
    }
  );
}

export function subscribeCourseSubmissions(
  course: Course,
  viewerUid: string,
  isStaff: boolean,
  isAdmin: boolean,
  onUpdate: (items: AssignmentSubmission[]) => void
): Unsubscribe {
  const colRef = collection(db, 'courses', course.id, 'submissions');
  const q =
    isAdmin || isStaff
      ? query(colRef, where('courseId', '==', course.id))
      : query(colRef, where('courseId', '==', course.id), where('studentUid', '==', viewerUid));

  return onSnapshot(
    q,
    (snap) => {
      const items = snap.docs.map((d) => ({
        id: d.id,
        ...(d.data() as Omit<AssignmentSubmission, 'id'>),
      }));
      onUpdate(items);
    },
    (error) => {
      handleFirestoreError(error, OperationType.LIST, `courses/${course.id}/submissions`);
    }
  );
}

export async function createSessionRecord(params: {
  courseId: string;
  instructorUid: string;
  title: string;
  description?: string;
  scheduledStart: string;
  scheduledEnd: string;
  meetUri: string;
  meetSpaceName?: string;
  meetCode?: string;
  calendarEventId?: string;
}): Promise<string> {
  const sessionId = makeSafeId('ses');
  const payload: Record<string, unknown> = {
    courseId: params.courseId,
    instructorUid: params.instructorUid,
    title: params.title.trim().slice(0, 180),
    description: (params.description || '').trim().slice(0, 1500),
    scheduledStart: params.scheduledStart.slice(0, 64),
    scheduledEnd: params.scheduledEnd.slice(0, 64),
    meetUri: params.meetUri.slice(0, 512),
    recordingStatus: 'pending',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
  if (params.meetSpaceName) payload.meetSpaceName = params.meetSpaceName.slice(0, 256);
  if (params.meetCode) payload.meetCode = params.meetCode.slice(0, 64);
  if (params.calendarEventId) payload.calendarEventId = params.calendarEventId.slice(0, 256);

  try {
    await setDoc(doc(db, 'courses', params.courseId, 'sessions', sessionId), payload);
    return sessionId;
  } catch (error) {
    handleFirestoreError(
      error,
      OperationType.CREATE,
      `courses/${params.courseId}/sessions/${sessionId}`
    );
  }
}

export async function clearSessionMeetInvite(
  courseId: string,
  sessionId: string
): Promise<void> {
  try {
    await updateDoc(doc(db, 'courses', courseId, 'sessions', sessionId), {
      meetUri: deleteField(),
      meetCode: deleteField(),
      calendarEventId: deleteField(),
      meetInviteDeleted: true,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(
      error,
      OperationType.UPDATE,
      `courses/${courseId}/sessions/${sessionId}`
    );
  }
}

export async function deleteSessionRecord(courseId: string, sessionId: string): Promise<void> {
  try {
    await deleteDoc(doc(db, 'courses', courseId, 'sessions', sessionId));
  } catch (error) {
    handleFirestoreError(
      error,
      OperationType.DELETE,
      `courses/${courseId}/sessions/${sessionId}`
    );
  }
}

export async function attachRecordingRecord(params: {
  courseId: string;
  sessionId: string;
  instructorUid: string;
  title: string;
  driveFileId: string;
  conferenceRecordId?: string;
  webViewLink: string;
  mimeType?: string;
  durationLabel?: string;
  sharedWithCount: number;
}): Promise<string> {
  const recordingId = makeSafeId('rec');
  const payload: Record<string, unknown> = {
    courseId: params.courseId,
    sessionId: params.sessionId,
    instructorUid: params.instructorUid,
    title: params.title.trim().slice(0, 200),
    driveFileId: params.driveFileId.slice(0, 256),
    webViewLink: params.webViewLink.slice(0, 1024),
    sharedWithCount: params.sharedWithCount,
    lastAclSyncAt: serverTimestamp(),
    createdAt: serverTimestamp(),
  };
  if (params.conferenceRecordId) {
    payload.conferenceRecordId = params.conferenceRecordId.slice(0, 256);
  }
  if (params.mimeType) payload.mimeType = params.mimeType.slice(0, 128);
  if (params.durationLabel) payload.durationLabel = params.durationLabel.slice(0, 64);

  try {
    const batch = writeBatch(db);
    batch.set(doc(db, 'courses', params.courseId, 'recordings', recordingId), payload);
    batch.update(doc(db, 'courses', params.courseId, 'sessions', params.sessionId), {
      recordingStatus: 'synced',
      updatedAt: serverTimestamp(),
    });
    await batch.commit();
    return recordingId;
  } catch (error) {
    handleFirestoreError(
      error,
      OperationType.CREATE,
      `courses/${params.courseId}/recordings/${recordingId}`
    );
  }
}

export async function deleteRecordingRecord(
  courseId: string,
  sessionId: string,
  recordingId: string,
  resetSessionPending: boolean
): Promise<void> {
  try {
    const batch = writeBatch(db);
    batch.delete(doc(db, 'courses', courseId, 'recordings', recordingId));
    if (resetSessionPending) {
      batch.update(doc(db, 'courses', courseId, 'sessions', sessionId), {
        recordingStatus: 'pending',
        updatedAt: serverTimestamp(),
      });
    }
    await batch.commit();
  } catch (error) {
    handleFirestoreError(
      error,
      OperationType.DELETE,
      `courses/${courseId}/recordings/${recordingId}`
    );
  }
}

export async function updateRecordingShareCount(
  courseId: string,
  recordingId: string,
  sharedWithCount: number
): Promise<void> {
  try {
    await updateDoc(doc(db, 'courses', courseId, 'recordings', recordingId), {
      sharedWithCount,
      lastAclSyncAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(
      error,
      OperationType.UPDATE,
      `courses/${courseId}/recordings/${recordingId}`
    );
  }
}

export async function createResourceRecord(params: {
  courseId: string;
  instructorUid: string;
  moduleTitle: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  driveFileId: string;
  webViewLink: string;
  sharedWithCount: number;
  uploadedByUid: string;
  uploadedByName?: string;
  uploadedByRole?: 'instructor' | 'admin';
  sessionId?: string;
  sessionTitle?: string;
}): Promise<string> {
  const resourceId = makeSafeId('res');
  const payload: Record<string, unknown> = {
    courseId: params.courseId,
    instructorUid: params.instructorUid,
    moduleTitle: params.moduleTitle.trim().slice(0, 120),
    fileName: params.fileName.trim().slice(0, 255),
    mimeType: params.mimeType.slice(0, 128),
    sizeBytes: params.sizeBytes,
    driveFileId: params.driveFileId.slice(0, 256),
    webViewLink: params.webViewLink.slice(0, 1024),
    sharedWithCount: params.sharedWithCount,
    uploadedByUid: params.uploadedByUid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  if (params.uploadedByName?.trim()) {
    payload.uploadedByName = params.uploadedByName.trim().slice(0, 120);
  }
  if (params.uploadedByRole === 'admin' || params.uploadedByRole === 'instructor') {
    payload.uploadedByRole = params.uploadedByRole;
  }
  if (params.sessionId?.trim()) {
    payload.sessionId = params.sessionId.trim().slice(0, 128);
    if (params.sessionTitle?.trim()) {
      payload.sessionTitle = params.sessionTitle.trim().slice(0, 180);
    }
  }

  try {
    await setDoc(doc(db, 'courses', params.courseId, 'resources', resourceId), payload);
    return resourceId;
  } catch (error) {
    handleFirestoreError(
      error,
      OperationType.CREATE,
      `courses/${params.courseId}/resources/${resourceId}`
    );
  }
}

export async function updateResourceSessionLink(
  courseId: string,
  resourceId: string,
  session: { id: string; title: string } | null
): Promise<void> {
  try {
    await updateDoc(doc(db, 'courses', courseId, 'resources', resourceId), {
      sessionId: session ? session.id.slice(0, 128) : deleteField(),
      sessionTitle: session ? session.title.trim().slice(0, 180) : deleteField(),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(
      error,
      OperationType.UPDATE,
      `courses/${courseId}/resources/${resourceId}`
    );
  }
}

export async function updateResourceShareCount(
  courseId: string,
  resourceId: string,
  sharedWithCount: number
): Promise<void> {
  try {
    await updateDoc(doc(db, 'courses', courseId, 'resources', resourceId), {
      sharedWithCount,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(
      error,
      OperationType.UPDATE,
      `courses/${courseId}/resources/${resourceId}`
    );
  }
}

export async function deleteResourceRecord(courseId: string, resourceId: string): Promise<void> {
  try {
    await deleteDoc(doc(db, 'courses', courseId, 'resources', resourceId));
  } catch (error) {
    handleFirestoreError(
      error,
      OperationType.DELETE,
      `courses/${courseId}/resources/${resourceId}`
    );
  }
}

export async function createSubmissionRecord(params: {
  courseId: string;
  instructorUid: string;
  sessionId?: string;
  sessionTitle?: string;
  assignmentTitle: string;
  studentUid: string;
  studentName: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  driveFileId: string;
  webViewLink: string;
}): Promise<string> {
  const submissionId = makeSafeId('sub');
  const payload: Record<string, unknown> = {
    courseId: params.courseId,
    instructorUid: params.instructorUid,
    assignmentTitle: params.assignmentTitle.trim().slice(0, 180),
    studentUid: params.studentUid,
    studentName: params.studentName.trim().slice(0, 120),
    fileName: params.fileName.trim().slice(0, 255),
    mimeType: params.mimeType.slice(0, 128),
    sizeBytes: params.sizeBytes,
    driveFileId: params.driveFileId.slice(0, 256),
    webViewLink: params.webViewLink.slice(0, 1024),
    status: 'submitted',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  if (params.sessionId?.trim()) {
    payload.sessionId = params.sessionId.trim().slice(0, 128);
    if (params.sessionTitle?.trim()) {
      payload.sessionTitle = params.sessionTitle.trim().slice(0, 180);
    }
  }

  try {
    await setDoc(doc(db, 'courses', params.courseId, 'submissions', submissionId), payload);
    return submissionId;
  } catch (error) {
    handleFirestoreError(
      error,
      OperationType.CREATE,
      `courses/${params.courseId}/submissions/${submissionId}`
    );
  }
}

export async function gradeSubmissionRecord(params: {
  courseId: string;
  submissionId: string;
  grade: string;
  feedback: string;
}): Promise<void> {
  try {
    await updateDoc(doc(db, 'courses', params.courseId, 'submissions', params.submissionId), {
      status: 'graded',
      grade: params.grade.trim().slice(0, 32),
      feedback: params.feedback.trim().slice(0, 2000),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(
      error,
      OperationType.UPDATE,
      `courses/${params.courseId}/submissions/${params.submissionId}`
    );
  }
}

// =========================================================================
// Google Meet Class Attendance (Auto-Checked on Meet Join · Staff Accessible)
// =========================================================================

export async function recordStudentMeetJoinAttendance(params: {
  course: Course;
  session: CourseSession;
  user: User;
  displayName: string;
}): Promise<void> {
  const attendanceId = `${params.session.id}_${params.user.uid}`.replace(/[^a-zA-Z0-9_-]/g, '');
  const ref = doc(db, 'courses', params.course.id, 'attendance', attendanceId);
  const nowIso = new Date().toISOString();

  try {
    const existing = await getDoc(ref);
    if (existing.exists()) {
      const data = existing.data() as AttendanceRecord;
      await updateDoc(ref, {
        joinedAt: nowIso,
        meetJoinCount: Math.min((data.meetJoinCount || 1) + 1, 500),
        updatedAt: serverTimestamp(),
      });
    } else {
      await setDoc(ref, {
        courseId: params.course.id,
        sessionId: params.session.id,
        sessionTitle: params.session.title.trim().slice(0, 180),
        instructorUid: params.course.instructorUid,
        studentUid: params.user.uid,
        studentName: (params.displayName || params.user.email?.split('@')[0] || 'Student').slice(
          0,
          120
        ),
        studentEmail: normalizeEmail(params.user.email || ''),
        status: 'present' as AttendanceStatus,
        source: 'meet_join' as AttendanceSource,
        joinedAt: nowIso,
        meetJoinCount: 1,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
  } catch {
    // Non-blocking: never prevent a student from opening Google Meet if attendance write fails
  }
}

export function subscribeCourseAttendance(
  courseId: string,
  onUpdate: (items: AttendanceRecord[]) => void
): Unsubscribe {
  const q = query(
    collection(db, 'courses', courseId, 'attendance'),
    where('courseId', '==', courseId)
  );
  return onSnapshot(
    q,
    (snap) => {
      const items = snap.docs.map((d) => ({
        id: d.id,
        ...(d.data() as Omit<AttendanceRecord, 'id'>),
      }));
      onUpdate(items);
    },
    (error) => {
      handleFirestoreError(error, OperationType.LIST, `courses/${courseId}/attendance`);
    }
  );
}

export async function upsertAttendanceByStaff(params: {
  course: Course;
  session: CourseSession;
  studentUid: string;
  studentName: string;
  studentEmail: string;
  status: AttendanceStatus;
  source: AttendanceSource;
  joinedAt?: string;
  markedByUid: string;
  notes?: string;
}): Promise<void> {
  const safeStudentKey = params.studentUid.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64);
  const attendanceId = `${params.session.id}_${safeStudentKey}`.slice(0, 128);
  const ref = doc(db, 'courses', params.course.id, 'attendance', attendanceId);
  const joinedAt = (params.joinedAt || new Date().toISOString()).slice(0, 64);

  try {
    const existing = await getDoc(ref);
    if (existing.exists()) {
      const prev = existing.data() as AttendanceRecord;
      const updatePayload: Record<string, unknown> = {
        status: params.status,
        source: params.source,
        joinedAt,
        meetJoinCount:
          params.source === 'meet_api_sync'
            ? Math.max(prev.meetJoinCount || 0, 1)
            : prev.meetJoinCount || 0,
        markedByUid: params.markedByUid,
        updatedAt: serverTimestamp(),
      };
      if (params.notes !== undefined) {
        updatePayload.notes = params.notes.trim().slice(0, 500);
      }
      await updateDoc(ref, updatePayload);
    } else {
      const createPayload: Record<string, unknown> = {
        courseId: params.course.id,
        sessionId: params.session.id,
        sessionTitle: params.session.title.trim().slice(0, 180),
        instructorUid: params.course.instructorUid,
        studentUid: safeStudentKey,
        studentName: params.studentName.trim().slice(0, 120) || 'Student',
        studentEmail: normalizeEmail(params.studentEmail),
        status: params.status,
        source: params.source,
        joinedAt,
        meetJoinCount: params.source === 'meet_api_sync' ? 1 : 0,
        markedByUid: params.markedByUid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };
      if (params.notes?.trim()) {
        createPayload.notes = params.notes.trim().slice(0, 500);
      }
      await setDoc(ref, createPayload);
    }
  } catch (error) {
    handleFirestoreError(
      error,
      OperationType.WRITE,
      `courses/${params.course.id}/attendance/${attendanceId}`
    );
  }
}
