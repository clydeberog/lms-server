import { Timestamp } from 'firebase/firestore';

export type UserRole = 'student' | 'instructor' | 'admin';
export type ApprovalStatus = 'pending' | 'approved' | 'rejected';
export type CourseRole = 'student' | 'co-instructor';
export type EnrollmentStatus = 'pending' | 'invited' | 'active' | 'revoked';
export type RecordingStatus = 'pending' | 'synced' | 'not_recorded';
export type SubmissionStatus = 'submitted' | 'graded';
export type AttendanceStatus = 'present' | 'late' | 'excused' | 'absent';
export type AttendanceSource = 'meet_join' | 'meet_api_sync' | 'manual';

export interface UserProfile {
  uid: string;
  displayName: string;
  photoUrl?: string;
  role: UserRole;
  approvalStatus?: ApprovalStatus;
  department?: string;
  registrationNote?: string;
  approvedByUid?: string;
  approvedByName?: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface RegistrationRequest {
  id: string;
  uid: string;
  displayName: string;
  email: string;
  department?: string;
  note?: string;
  status: ApprovalStatus;
  reviewedByUid?: string;
  reviewedByName?: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface UserPrivateInfo {
  uid: string;
  email: string;
  phone?: string;
  updatedAt: Timestamp;
}

export interface DirectoryUser extends UserProfile {
  email?: string;
}

export interface Course {
  id: string;
  code: string;
  title: string;
  term: string;
  description?: string;
  instructorUid: string;
  instructorName: string;
  instructorEmail: string;
  driveFolderId?: string;
  driveFolderUrl?: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface Enrollment {
  id: string;
  courseId: string;
  courseCode: string;
  courseTitle: string;
  courseTerm: string;
  instructorUid: string;
  instructorName: string;
  memberEmail: string;
  memberUid?: string;
  memberName: string;
  courseRole: CourseRole;
  status: EnrollmentStatus;
  enrolledByUid: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface CourseSession {
  id: string;
  courseId: string;
  instructorUid: string;
  title: string;
  description?: string;
  scheduledStart: string;
  scheduledEnd: string;
  meetUri?: string;
  meetSpaceName?: string;
  meetCode?: string;
  calendarEventId?: string;
  meetInviteDeleted?: boolean;
  recordingStatus: RecordingStatus;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface CourseRecording {
  id: string;
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
  lastAclSyncAt: Timestamp;
  createdAt: Timestamp;
}

export interface CourseResource {
  id: string;
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
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface AssignmentSubmission {
  id: string;
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
  status: SubmissionStatus;
  grade?: string;
  feedback?: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface AttendanceRecord {
  id: string;
  courseId: string;
  sessionId: string;
  sessionTitle: string;
  instructorUid: string;
  studentUid: string;
  studentName: string;
  studentEmail: string;
  status: AttendanceStatus;
  source: AttendanceSource;
  joinedAt: string;
  meetJoinCount: number;
  markedByUid?: string;
  notes?: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface DiscoveredRecording {
  driveFileId: string;
  title: string;
  webViewLink: string;
  mimeType: string;
  durationLabel: string;
  conferenceRecordId: string;
  createdTime: string;
  source:
    | 'meet_api'
    | 'calendar_attachment'
    | 'meet_folder'
    | 'lms_folder'
    | 'drive_search'
    | 'direct_link';
}

export interface ShareRosterResult {
  totalRequested: number;
  grantedCount: number;
  failedCount: number;
  results: Array<{
    fileId: string;
    email: string;
    status: 'granted' | 'failed';
    error?: string;
  }>;
}

export interface SyncFolderAccessResult {
  staffGrantedCount: number;
  staffFailedCount: number;
  studentRevokedCount: number;
  auditedFolders: number;
}

export interface MeetParticipantRecord {
  displayName: string;
  earliestStartTime: string;
  latestEndTime: string;
  userResourceName: string;
}

export type ActiveNavTab = 'courses' | 'classes' | 'resources';
