import { auth, COOKIE_SESSION_SENTINEL } from '../firebase';
import {
  DiscoveredRecording,
  MeetParticipantRecord,
  ShareRosterResult,
  SyncFolderAccessResult,
} from '../types';

export class WorkspaceAuthExpiredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WorkspaceAuthExpiredError';
  }
}

export interface WorkspaceSessionStatus {
  connected: boolean;
  email: string | null;
  expiresAt: number | null;
  rememberedAccount: {
    email: string;
    displayName: string;
  } | null;
}

async function buildWorkspaceHeaders(
  token: string,
  extra?: Record<string, string>
): Promise<Record<string, string>> {
  const headers: Record<string, string> = {
    'X-Requested-With': 'XMLHttpRequest',
    ...(extra || {}),
  };
  if (token && token !== COOKIE_SESSION_SENTINEL) {
    headers.Authorization = `Bearer ${token}`;
  }
  const currentUser = auth.currentUser;
  if (currentUser) {
    try {
      const idToken = await currentUser.getIdToken();
      if (idToken) {
        headers['X-Firebase-Id-Token'] = idToken;
      }
    } catch {
      // Proceed without Firebase ID token header if unavailable
    }
  }
  return headers;
}

async function parseJsonResponse<T>(res: Response): Promise<T> {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg =
      (data as { error?: string }).error || `Workspace API request failed (HTTP ${res.status}).`;
    if (res.status === 401 || (data as { reauthRequired?: boolean }).reauthRequired) {
      throw new WorkspaceAuthExpiredError(msg);
    }
    throw new Error(msg);
  }
  return data as T;
}

export async function fetchWorkspaceSessionStatus(): Promise<WorkspaceSessionStatus> {
  const res = await fetch('/api/auth/workspace-session', {
    method: 'GET',
    credentials: 'include',
    headers: {
      'X-Requested-With': 'XMLHttpRequest',
    },
  });
  if (!res.ok) {
    return {
      connected: false,
      email: null,
      expiresAt: null,
      rememberedAccount: null,
    };
  }
  return (await res.json()) as WorkspaceSessionStatus;
}

export async function saveWorkspaceSessionCookie(
  accessToken: string,
  options: { displayName?: string; rememberDevice: boolean }
): Promise<WorkspaceSessionStatus> {
  const headers = await buildWorkspaceHeaders(accessToken, {
    'Content-Type': 'application/json',
  });
  const res = await fetch('/api/auth/workspace-session', {
    method: 'POST',
    credentials: 'include',
    headers,
    body: JSON.stringify(options),
  });
  return parseJsonResponse<WorkspaceSessionStatus>(res);
}

export async function clearWorkspaceSessionCookie(forgetDevice = false): Promise<void> {
  await fetch('/api/auth/workspace-session', {
    method: 'DELETE',
    credentials: 'include',
    headers: {
      'X-Requested-With': 'XMLHttpRequest',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ forgetDevice }),
  }).catch(() => undefined);
}

export async function ensureCourseDriveFolder(
  token: string,
  folderName: string,
  options?: { courseId?: string; staffEmails?: string[] }
): Promise<{ id: string; name: string; webViewLink: string }> {
  const headers = await buildWorkspaceHeaders(token, { 'Content-Type': 'application/json' });
  const res = await fetch('/api/drive/ensure-folder', {
    method: 'POST',
    credentials: 'include',
    headers,
    body: JSON.stringify({
      folderName,
      courseId: options?.courseId,
      staffEmails: options?.staffEmails,
    }),
  });
  return parseJsonResponse(res);
}

export async function scheduleMeetClass(
  token: string,
  payload: {
    courseId?: string;
    title: string;
    description?: string;
    scheduledStart: string;
    scheduledEnd: string;
    attendeeEmails: string[];
  }
): Promise<{
  calendarEventId: string;
  calendarHtmlLink: string;
  meetUri: string;
  meetSpaceName: string;
  meetCode: string;
}> {
  const headers = await buildWorkspaceHeaders(token, { 'Content-Type': 'application/json' });
  const res = await fetch('/api/meet/schedule', {
    method: 'POST',
    credentials: 'include',
    headers,
    body: JSON.stringify(payload),
  });
  return parseJsonResponse(res);
}

export async function discoverMeetRecordings(
  token: string,
  payload: {
    courseId?: string;
    meetSpaceName?: string;
    meetCode?: string;
    calendarEventId?: string;
    courseFolderId?: string;
    sessionTitle?: string;
    searchQuery?: string;
    driveUrlOrId?: string;
  }
): Promise<{
  recordings: DiscoveredRecording[];
  processingCount?: number;
  warning?: string | null;
}> {
  const headers = await buildWorkspaceHeaders(token, { 'Content-Type': 'application/json' });
  const res = await fetch('/api/meet/sync-recording', {
    method: 'POST',
    credentials: 'include',
    headers,
    body: JSON.stringify(payload),
  });
  return parseJsonResponse(res);
}

export async function moveDriveFileToLmsFolder(
  token: string,
  payload: {
    courseId?: string;
    fileId: string;
    courseFolderId?: string;
    courseFolderName?: string;
    subfolderName?: string;
  }
): Promise<{
  moved: boolean;
  alreadyInLms: boolean;
  shortcutCreated: boolean;
  driveFileId: string;
  folderId: string;
  folderUrl: string;
  courseFolderId: string;
  webViewLink: string;
}> {
  const headers = await buildWorkspaceHeaders(token, { 'Content-Type': 'application/json' });
  const res = await fetch('/api/drive/move-to-lms', {
    method: 'POST',
    credentials: 'include',
    headers,
    body: JSON.stringify(payload),
  });
  return parseJsonResponse(res);
}

export async function uploadFileToDrive(
  token: string,
  file: File,
  options: { courseId?: string; folderName?: string; parentFolderId?: string }
): Promise<{
  driveFileId: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  webViewLink: string;
  webContentLink: string;
  folderId: string;
}> {
  const formData = new FormData();
  formData.append('file', file);
  if (options.courseId) formData.append('courseId', options.courseId);
  if (options.folderName) formData.append('folderName', options.folderName);
  if (options.parentFolderId) formData.append('parentFolderId', options.parentFolderId);

  const headers = await buildWorkspaceHeaders(token);
  const res = await fetch('/api/drive/upload', {
    method: 'POST',
    credentials: 'include',
    headers,
    body: formData,
  });
  return parseJsonResponse(res);
}

export async function shareDriveFilesWithRoster(
  token: string,
  payload: {
    courseId?: string;
    fileIds: string[];
    emails: string[];
    role?: 'reader';
  }
): Promise<ShareRosterResult> {
  const headers = await buildWorkspaceHeaders(token, { 'Content-Type': 'application/json' });
  const res = await fetch('/api/drive/share-roster', {
    method: 'POST',
    credentials: 'include',
    headers,
    body: JSON.stringify({
      courseId: payload.courseId,
      fileIds: payload.fileIds,
      emails: payload.emails,
      role: 'reader',
    }),
  });
  return parseJsonResponse(res);
}

export async function syncCourseDriveFolderAccess(
  token: string,
  payload: {
    courseId: string;
    courseFolderId: string;
    staffEmails: string[];
    studentEmails: string[];
  }
): Promise<SyncFolderAccessResult> {
  const headers = await buildWorkspaceHeaders(token, { 'Content-Type': 'application/json' });
  const res = await fetch('/api/drive/sync-folder-access', {
    method: 'POST',
    credentials: 'include',
    headers,
    body: JSON.stringify(payload),
  });
  return parseJsonResponse(res);
}

export async function syncMeetAttendanceParticipants(
  token: string,
  payload: {
    courseId: string;
    meetSpaceName?: string;
    meetCode?: string;
  }
): Promise<{
  participants: MeetParticipantRecord[];
  conferenceCount: number;
}> {
  const headers = await buildWorkspaceHeaders(token, { 'Content-Type': 'application/json' });
  const res = await fetch('/api/meet/sync-attendance', {
    method: 'POST',
    credentials: 'include',
    headers,
    body: JSON.stringify(payload),
  });
  return parseJsonResponse(res);
}

export async function downloadDriveFile(
  token: string,
  params: {
    courseId?: string;
    driveFileId: string;
    fileName: string;
    mimeType?: string;
  }
): Promise<{ fileName: string }> {
  const qs = new URLSearchParams();
  if (params.courseId) qs.set('courseId', params.courseId);
  if (params.fileName) qs.set('fileName', params.fileName);
  if (params.mimeType) qs.set('mimeType', params.mimeType);

  const headers = await buildWorkspaceHeaders(token);
  const res = await fetch(
    `/api/drive/download/${encodeURIComponent(params.driveFileId)}?${qs.toString()}`,
    {
      method: 'GET',
      credentials: 'include',
      headers,
    }
  );

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    const msg =
      (data as { error?: string }).error || `File download failed (HTTP ${res.status}).`;
    if (res.status === 401 || (data as { reauthRequired?: boolean }).reauthRequired) {
      throw new WorkspaceAuthExpiredError(msg);
    }
    throw new Error(msg);
  }

  let resolvedName = params.fileName || 'course-resource';
  const disposition = res.headers.get('content-disposition') || '';
  const utf8Match = disposition.match(/filename\*=UTF-8''([^;]+)/i);
  const plainMatch = disposition.match(/filename="([^"]+)"/i);
  if (utf8Match?.[1]) {
    try {
      resolvedName = decodeURIComponent(utf8Match[1]);
    } catch {
      resolvedName = utf8Match[1];
    }
  } else if (plainMatch?.[1]) {
    resolvedName = plainMatch[1];
  }

  const blob = await res.blob();
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = objectUrl;
  anchor.download = resolvedName;
  anchor.rel = 'noopener noreferrer';
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  window.setTimeout(() => {
    URL.revokeObjectURL(objectUrl);
  }, 15000);

  return { fileName: resolvedName };
}

export async function closeMeetInvite(
  token: string,
  payload: {
    courseId?: string;
    calendarEventId?: string;
    meetSpaceName?: string;
  }
): Promise<{ conferenceEnded: boolean; calendarDeleted: boolean }> {
  const headers = await buildWorkspaceHeaders(token, { 'Content-Type': 'application/json' });
  const res = await fetch('/api/meet/close-invite', {
    method: 'POST',
    credentials: 'include',
    headers,
    body: JSON.stringify(payload),
  });
  return parseJsonResponse(res);
}

export async function deleteWorkspaceItem(
  token: string,
  type: 'calendar_event' | 'drive_file',
  id: string,
  courseId?: string
): Promise<{ deleted: boolean }> {
  const headers = await buildWorkspaceHeaders(token, { 'Content-Type': 'application/json' });
  const res = await fetch('/api/workspace/item', {
    method: 'DELETE',
    credentials: 'include',
    headers,
    body: JSON.stringify({ type, id, courseId }),
  });
  return parseJsonResponse(res);
}
