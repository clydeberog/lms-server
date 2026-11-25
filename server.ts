import crypto from 'crypto';
import fs from 'fs';
import express, { Request, Response } from 'express';
import multer from 'multer';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = Number(process.env.PORT) || 3000;

app.set('trust proxy', 1);

app.use((_req, res, next) => {
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
  next();
});

app.use(express.json({ limit: '2mb' }));

// Server-side AES-256-GCM key for sealing HttpOnly Workspace session & remembered-device cookies
const COOKIE_ENCRYPTION_KEY: Buffer = process.env.SESSION_SECRET
  ? crypto.createHash('sha256').update(process.env.SESSION_SECRET).digest()
  : crypto.randomBytes(32);

const WORKSPACE_SESSION_COOKIE = 'nlfbc_ws_session';
const REMEMBERED_DEVICE_COOKIE = 'nlfbc_device_hint';
const DEVICE_COOKIE_MAX_AGE_SECONDS = 30 * 24 * 60 * 60; // 30 days

interface SealedWorkspaceSession {
  accessToken: string;
  email: string;
  expiresAt: number;
}

interface SealedDeviceHint {
  email: string;
  displayName: string;
  rememberedAt: number;
}

function parseCookies(req: Request): Record<string, string> {
  const header = req.headers.cookie;
  if (!header) return {};
  const map: Record<string, string> = {};
  for (const part of header.split(';')) {
    const eqIndex = part.indexOf('=');
    if (eqIndex <= 0) continue;
    const key = part.slice(0, eqIndex).trim();
    const rawVal = part.slice(eqIndex + 1).trim();
    if (!key) continue;
    try {
      map[key] = decodeURIComponent(rawVal);
    } catch {
      map[key] = rawVal;
    }
  }
  return map;
}

function sealCookiePayload<T>(payload: T): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', COOKIE_ENCRYPTION_KEY, iv);
  const plaintext = Buffer.from(JSON.stringify(payload), 'utf8');
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString('base64url');
}

function unsealCookiePayload<T>(raw: string | undefined): T | null {
  if (!raw || raw.length < 40) return null;
  try {
    const buf = Buffer.from(raw, 'base64url');
    if (buf.length < 29) return null;
    const iv = buf.subarray(0, 12);
    const tag = buf.subarray(12, 28);
    const ciphertext = buf.subarray(28);
    const decipher = crypto.createDecipheriv('aes-256-gcm', COOKIE_ENCRYPTION_KEY, iv);
    decipher.setAuthTag(tag);
    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return JSON.parse(decrypted.toString('utf8')) as T;
  } catch {
    return null;
  }
}

function setSecureCookie(res: Response, name: string, value: string, maxAgeSeconds: number): void {
  const safeAge = Math.max(0, Math.floor(maxAgeSeconds));
  res.append(
    'Set-Cookie',
    `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=${safeAge}; HttpOnly; Secure; SameSite=None; Partitioned`
  );
}

function clearSecureCookie(res: Response, name: string): void {
  res.append(
    'Set-Cookie',
    `${name}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=None; Partitioned`
  );
}

function verifyCookieCsrf(req: Request): boolean {
  const requestedWith = String(req.headers['x-requested-with'] || '');
  if (requestedWith !== 'XMLHttpRequest') {
    return false;
  }
  const originHeader = req.headers.origin;
  if (!originHeader) {
    return true;
  }
  try {
    const originHost = new URL(originHeader).host.toLowerCase();
    const forwardedHost = String(req.headers['x-forwarded-host'] || '')
      .split(',')[0]
      .trim()
      .toLowerCase();
    const directHost = String(req.headers.host || '').trim().toLowerCase();
    return Boolean(
      (forwardedHost && originHost === forwardedHost) ||
        (directHost && originHost === directHost)
    );
  } catch {
    return false;
  }
}

function readWorkspaceSessionCookie(req: Request): SealedWorkspaceSession | null {
  const cookies = parseCookies(req);
  const parsed = unsealCookiePayload<SealedWorkspaceSession>(cookies[WORKSPACE_SESSION_COOKIE]);
  if (!parsed || typeof parsed.accessToken !== 'string' || typeof parsed.expiresAt !== 'number') {
    return null;
  }
  if (parsed.expiresAt <= Date.now()) {
    return null;
  }
  return parsed;
}

function readDeviceHintCookie(req: Request): SealedDeviceHint | null {
  const cookies = parseCookies(req);
  const parsed = unsealCookiePayload<SealedDeviceHint>(cookies[REMEMBERED_DEVICE_COOKIE]);
  if (!parsed || typeof parsed.email !== 'string' || !parsed.email.includes('@')) {
    return null;
  }
  return parsed;
}

// Clear stale Workspace session cookie automatically if any Workspace proxy route returns 401
app.use('/api', (req, res, next) => {
  if (req.path.startsWith('/auth/workspace-session')) {
    next();
    return;
  }
  const originalStatus = res.status.bind(res);
  res.status = ((code: number) => {
    if (code === 401 && parseCookies(req)[WORKSPACE_SESSION_COOKIE]) {
      clearSecureCookie(res, WORKSPACE_SESSION_COOKIE);
    }
    return originalStatus(code);
  }) as Response['status'];
  next();
});

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
});

const ALLOWED_MIME_TYPES = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/plain',
  'text/markdown',
  'video/mp4',
  'audio/mpeg',
  'image/png',
  'image/jpeg',
]);

const BOOTSTRAP_ADMIN_EMAIL = 'clydefrancis.berog39@gmail.com';
const SAFE_FIRESTORE_ID_RE = /^[a-zA-Z0-9_-]{1,128}$/;
const SAFE_DRIVE_ID_RE = /^[a-zA-Z0-9_-]{5,256}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface FirebaseAppletConfig {
  projectId: string;
  apiKey: string;
  firestoreDatabaseId?: string;
}

const FIREBASE_APPLET_CONFIG: FirebaseAppletConfig = (() => {
  const configPath = path.resolve(__dirname, 'firebase-applet-config.json');
  const raw = fs.readFileSync(configPath, 'utf8');
  return JSON.parse(raw) as FirebaseAppletConfig;
})();

const FIRESTORE_DATABASE_ID =
  FIREBASE_APPLET_CONFIG.firestoreDatabaseId || '(default)';

interface VerifiedCaller {
  uid: string;
  email: string;
  role: 'admin' | 'instructor' | 'co-instructor' | 'student';
  isAdmin: boolean;
  isStaff: boolean;
}

const callerRoleCache = new Map<string, { caller: VerifiedCaller; expiresAt: number }>();

function extractFirebaseIdToken(req: Request): string | null {
  const raw = req.headers['x-firebase-id-token'];
  const token = Array.isArray(raw) ? raw[0] : raw;
  if (!token || typeof token !== 'string') return null;
  const trimmed = token.trim();
  return trimmed.length > 20 ? trimmed : null;
}

async function fetchFirestoreDoc(
  idToken: string,
  docPath: string
): Promise<{ fields?: Record<string, { stringValue?: string }> } | null> {
  const url = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(
    FIREBASE_APPLET_CONFIG.projectId
  )}/databases/${encodeURIComponent(FIRESTORE_DATABASE_ID)}/documents/${docPath}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${idToken}` },
  });
  if (!res.ok) return null;
  return (await res.json()) as { fields?: Record<string, { stringValue?: string }> };
}

async function verifyFirebaseCaller(
  req: Request,
  courseId?: string
): Promise<VerifiedCaller | null> {
  const idToken = extractFirebaseIdToken(req);
  if (!idToken) return null;

  const cleanCourseId =
    typeof courseId === 'string' && SAFE_FIRESTORE_ID_RE.test(courseId.trim())
      ? courseId.trim()
      : '';

  const cacheKey = crypto
    .createHash('sha256')
    .update(`${idToken}:${cleanCourseId}`)
    .digest('hex');

  const cached = callerRoleCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.caller;
  }

  try {
    const lookupRes = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(
        FIREBASE_APPLET_CONFIG.apiKey
      )}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken }),
      }
    );

    if (!lookupRes.ok) {
      return null;
    }

    const lookupData = (await lookupRes.json()) as {
      users?: Array<{
        localId?: string;
        email?: string;
        emailVerified?: boolean;
      }>;
    };

    const user = lookupData.users?.[0];
    if (!user?.localId || !user.email) {
      return null;
    }

    const uid = user.localId;
    const email = user.email.trim().toLowerCase();
    const emailVerified = Boolean(user.emailVerified);

    let caller: VerifiedCaller = {
      uid,
      email,
      role: 'student',
      isAdmin: false,
      isStaff: false,
    };

    if (emailVerified) {
      if (email === BOOTSTRAP_ADMIN_EMAIL) {
        caller = { uid, email, role: 'admin', isAdmin: true, isStaff: true };
      } else {
        const adminDoc = await fetchFirestoreDoc(idToken, `admins/${encodeURIComponent(uid)}`);
        if (adminDoc) {
          caller = { uid, email, role: 'admin', isAdmin: true, isStaff: true };
        } else {
          const userDoc = await fetchFirestoreDoc(idToken, `users/${encodeURIComponent(uid)}`);
          const userRole = userDoc?.fields?.role?.stringValue;
          if (userRole === 'admin') {
            caller = { uid, email, role: 'admin', isAdmin: true, isStaff: true };
          } else if (userRole === 'instructor') {
            caller = { uid, email, role: 'instructor', isAdmin: false, isStaff: true };
          } else if (cleanCourseId) {
            const [memberDoc, courseDoc] = await Promise.all([
              fetchFirestoreDoc(
                idToken,
                `courses/${encodeURIComponent(cleanCourseId)}/members/${encodeURIComponent(uid)}`
              ),
              fetchFirestoreDoc(idToken, `courses/${encodeURIComponent(cleanCourseId)}`),
            ]);
            if (courseDoc?.fields?.instructorUid?.stringValue === uid) {
              caller = { uid, email, role: 'instructor', isAdmin: false, isStaff: true };
            } else if (memberDoc?.fields?.courseRole?.stringValue === 'co-instructor') {
              caller = { uid, email, role: 'co-instructor', isAdmin: false, isStaff: true };
            }
          }
        }
      }
    }

    // Keep cache small and short-lived (60s) so role updates take effect promptly
    if (callerRoleCache.size > 500) {
      callerRoleCache.clear();
    }
    callerRoleCache.set(cacheKey, { caller, expiresAt: Date.now() + 60_000 });
    return caller;
  } catch {
    return null;
  }
}

async function requireStaffCaller(
  req: Request,
  res: Response,
  courseId?: string
): Promise<VerifiedCaller | null> {
  const caller = await verifyFirebaseCaller(req, courseId);
  if (!caller) {
    res.status(401).json({
      error: 'Authentication required. Please sign in to continue.',
    });
    return null;
  }
  if (!caller.isStaff) {
    res.status(403).json({
      error:
        'Only admins and instructors have access to Google Drive folders and faculty controls. Students have viewer-only file access.',
    });
    return null;
  }
  return caller;
}

function extractBearerToken(req: Request): string | null {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7).trim();
    if (token.length > 10 && token !== '__http_only_cookie__') {
      return token;
    }
  }

  // Seamless fallback to encrypted HttpOnly Workspace session cookie (CSRF-checked on mutations)
  const isMutating = !['GET', 'HEAD', 'OPTIONS'].includes(req.method.toUpperCase());
  if (isMutating && !verifyCookieCsrf(req)) {
    return null;
  }
  const session = readWorkspaceSessionCookie(req);
  return session?.accessToken || null;
}

// Workspace Session Cookie & Remembered Device Endpoints
app.get('/api/auth/workspace-session', (req: Request, res: Response) => {
  const cookies = parseCookies(req);
  const rawSession = cookies[WORKSPACE_SESSION_COOKIE];
  const session = readWorkspaceSessionCookie(req);
  if (rawSession && !session) {
    clearSecureCookie(res, WORKSPACE_SESSION_COOKIE);
  }
  const deviceHint = readDeviceHintCookie(req);

  res.setHeader('Cache-Control', 'private, no-store');
  res.json({
    connected: Boolean(session),
    email: session?.email || null,
    expiresAt: session?.expiresAt || null,
    rememberedAccount: deviceHint
      ? {
          email: deviceHint.email,
          displayName: deviceHint.displayName,
        }
      : null,
  });
});

app.post('/api/auth/workspace-session', async (req: Request, res: Response) => {
  if (!verifyCookieCsrf(req)) {
    res.status(403).json({ error: 'Invalid request origin for session creation.' });
    return;
  }

  const authHeader = req.headers.authorization;
  const rawToken =
    authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  if (!rawToken || rawToken.length < 15 || rawToken === '__http_only_cookie__') {
    res.status(401).json({ error: 'Missing Google Workspace OAuth access token.' });
    return;
  }

  const { displayName, rememberDevice } = (req.body || {}) as {
    displayName?: string;
    rememberDevice?: boolean;
  };

  try {
    // Verify the Google OAuth access token directly with Google using POST form body (never in URL query)
    const tokenInfoRes = await fetch('https://oauth2.googleapis.com/tokeninfo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ access_token: rawToken }).toString(),
    });

    if (!tokenInfoRes.ok) {
      res.status(401).json({
        error: 'Google Workspace token could not be verified.',
        reauthRequired: true,
      });
      return;
    }

    const tokenInfo = (await tokenInfoRes.json()) as {
      email?: string;
      email_verified?: string | boolean;
      expires_in?: string | number;
    };

    let verifiedEmail = String(tokenInfo.email || '').trim().toLowerCase();
    if (!verifiedEmail) {
      const userInfoRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
        headers: { Authorization: `Bearer ${rawToken}` },
      });
      if (userInfoRes.ok) {
        const userInfo = (await userInfoRes.json()) as { email?: string };
        verifiedEmail = String(userInfo.email || '').trim().toLowerCase();
      }
    }
    if (!verifiedEmail) {
      res.status(401).json({ error: 'Verified Google account email missing on token.' });
      return;
    }

    const rawExpiresIn = Number(tokenInfo.expires_in);
    const safeExpiresIn =
      Number.isFinite(rawExpiresIn) && rawExpiresIn > 120
        ? Math.min(3540, Math.floor(rawExpiresIn - 60))
        : 3300;
    const expiresAt = Date.now() + safeExpiresIn * 1000;

    const sealedSession = sealCookiePayload<SealedWorkspaceSession>({
      accessToken: rawToken,
      email: verifiedEmail,
      expiresAt,
    });
    setSecureCookie(res, WORKSPACE_SESSION_COOKIE, sealedSession, safeExpiresIn);

    const shouldRemember = rememberDevice !== false;
    let rememberedAccount: { email: string; displayName: string } | null = null;
    if (shouldRemember) {
      const safeName = (
        typeof displayName === 'string' && displayName.trim()
          ? displayName.trim()
          : verifiedEmail.split('@')[0]
      ).slice(0, 120);
      const sealedHint = sealCookiePayload<SealedDeviceHint>({
        email: verifiedEmail,
        displayName: safeName,
        rememberedAt: Date.now(),
      });
      setSecureCookie(res, REMEMBERED_DEVICE_COOKIE, sealedHint, DEVICE_COOKIE_MAX_AGE_SECONDS);
      rememberedAccount = { email: verifiedEmail, displayName: safeName };
    } else {
      clearSecureCookie(res, REMEMBERED_DEVICE_COOKIE);
    }

    res.setHeader('Cache-Control', 'private, no-store');
    res.json({
      connected: true,
      email: verifiedEmail,
      expiresAt,
      rememberedAccount,
    });
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Unable to save Workspace session cookie.',
    });
  }
});

app.delete('/api/auth/workspace-session', (req: Request, res: Response) => {
  if (!verifyCookieCsrf(req)) {
    res.status(403).json({ error: 'Invalid request origin.' });
    return;
  }

  const { forgetDevice } = (req.body || {}) as { forgetDevice?: boolean };
  clearSecureCookie(res, WORKSPACE_SESSION_COOKIE);
  if (forgetDevice) {
    clearSecureCookie(res, REMEMBERED_DEVICE_COOKIE);
  }
  res.setHeader('Cache-Control', 'private, no-store');
  res.json({ cleared: true, deviceForgotten: Boolean(forgetDevice) });
});

function escapeDriveQueryValue(val: string): string {
  return val.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithBackoff(
  url: string,
  options: RequestInit,
  maxRetries = 3
): Promise<globalThis.Response> {
  let attempt = 0;
  while (true) {
    const res = await fetch(url, options);
    if (res.status !== 429 && res.status !== 503 && res.status !== 500) {
      if (res.status === 403) {
        const clone = res.clone();
        try {
          const errJson = await clone.json();
          const reason = errJson?.error?.errors?.[0]?.reason || '';
          const isRateLimit =
            reason === 'userRateLimitExceeded' ||
            reason === 'rateLimitExceeded' ||
            reason === 'sharingRateLimitExceeded';
          if (isRateLimit && attempt < maxRetries) {
            attempt++;
            await sleep(Math.pow(2, attempt) * 400 + Math.random() * 250);
            continue;
          }
        } catch {
          return res;
        }
      }
      return res;
    }
    if (attempt >= maxRetries) {
      return res;
    }
    attempt++;
    await sleep(Math.pow(2, attempt) * 400 + Math.random() * 250);
  }
}

async function ensureDriveFolder(
  token: string,
  folderName: string,
  parentId?: string
): Promise<{ id: string; name: string; webViewLink: string }> {
  const escaped = escapeDriveQueryValue(folderName);
  const parentClause = parentId ? ` and '${escapeDriveQueryValue(parentId)}' in parents` : '';
  const q = `mimeType='application/vnd.google-apps.folder' and name='${escaped}' and trashed=false${parentClause}`;

  const searchUrl = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(
    q
  )}&fields=files(id,name,webViewLink)&pageSize=1`;

  const searchRes = await fetchWithBackoff(searchUrl, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (searchRes.ok) {
    const data = (await searchRes.json()) as {
      files?: Array<{ id: string; name: string; webViewLink?: string }>;
    };
    if (data.files && data.files.length > 0) {
      const folder = data.files[0];
      return {
        id: folder.id,
        name: folder.name,
        webViewLink: folder.webViewLink || `https://drive.google.com/drive/folders/${folder.id}`,
      };
    }
  }

  const metadata: Record<string, unknown> = {
    name: folderName,
    mimeType: 'application/vnd.google-apps.folder',
  };
  if (parentId) {
    metadata.parents = [parentId];
  }

  const createRes = await fetchWithBackoff(
    'https://www.googleapis.com/drive/v3/files?fields=id,name,webViewLink',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(metadata),
    }
  );

  if (!createRes.ok) {
    const errText = await createRes.text();
    throw new Error(`Failed to create Drive folder (${createRes.status}): ${errText}`);
  }

  const created = (await createRes.json()) as { id: string; name: string; webViewLink?: string };
  return {
    id: created.id,
    name: created.name,
    webViewLink: created.webViewLink || `https://drive.google.com/drive/folders/${created.id}`,
  };
}

// Health check
app.get('/api/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok' });
});

// Ensure Drive folder for course (Admins & Instructors ONLY)
app.post('/api/drive/ensure-folder', async (req: Request, res: Response) => {
  const { folderName, parentId, courseId, staffEmails } = req.body as {
    folderName?: string;
    parentId?: string;
    courseId?: string;
    staffEmails?: string[];
  };

  const caller = await requireStaffCaller(req, res, courseId);
  if (!caller) return;

  const token = extractBearerToken(req);
  if (!token) {
    res.status(401).json({ error: 'Missing Google Workspace OAuth Bearer token.' });
    return;
  }

  if (!folderName || typeof folderName !== 'string' || folderName.trim().length < 2) {
    res.status(400).json({ error: 'A valid folderName is required.' });
    return;
  }

  const safeParentId =
    typeof parentId === 'string' && SAFE_DRIVE_ID_RE.test(parentId.trim())
      ? parentId.trim()
      : undefined;

  const cleanStaffEmails = Array.isArray(staffEmails)
    ? Array.from(
        new Set(
          staffEmails
            .map((e) => (typeof e === 'string' ? e.trim().toLowerCase() : ''))
            .filter((e) => EMAIL_RE.test(e) && e !== caller.email)
        )
      ).slice(0, 25)
    : [];

  try {
    const rootFolder = await ensureDriveFolder(token, 'LMS');
    const targetFolder = await ensureDriveFolder(
      token,
      folderName.trim().slice(0, 120),
      safeParentId || rootFolder.id
    );

    // Grant Drive folder access strictly to specified admins & instructors
    for (const staffEmail of cleanStaffEmails) {
      await fetchWithBackoff(
        `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(
          targetFolder.id
        )}/permissions?sendNotificationEmail=false&supportsAllDrives=true`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            type: 'user',
            role: 'writer',
            emailAddress: staffEmail,
          }),
        }
      ).catch(() => undefined);
    }

    res.json(targetFolder);
  } catch (err) {
    res.status(502).json({
      error: err instanceof Error ? err.message : 'Unable to ensure Google Drive folder.',
    });
  }
});

// Schedule a live class with Google Calendar + Google Meet conferenceData (Admins & Instructors ONLY)
app.post('/api/meet/schedule', async (req: Request, res: Response) => {
  const { title, description, scheduledStart, scheduledEnd, attendeeEmails, courseId } =
    req.body as {
      title?: string;
      description?: string;
      scheduledStart?: string;
      scheduledEnd?: string;
      attendeeEmails?: string[];
      courseId?: string;
    };

  const caller = await requireStaffCaller(req, res, courseId);
  if (!caller) return;

  const token = extractBearerToken(req);
  if (!token) {
    res.status(401).json({ error: 'Missing Google Workspace OAuth Bearer token.' });
    return;
  }

  if (!title || !scheduledStart || !scheduledEnd) {
    res.status(400).json({ error: 'title, scheduledStart, and scheduledEnd are required.' });
    return;
  }

  const cleanAttendees = Array.isArray(attendeeEmails)
    ? Array.from(
        new Set(
          attendeeEmails
            .map((e) => (typeof e === 'string' ? e.trim().toLowerCase() : ''))
            .filter((e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e))
        )
      ).map((email) => ({ email }))
    : [];

  try {
    const requestId = `bslms-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const eventPayload = {
      summary: title.trim().slice(0, 180),
      description: (description || '').trim().slice(0, 1500),
      start: { dateTime: new Date(scheduledStart).toISOString(), timeZone: 'Asia/Manila' },
      end: { dateTime: new Date(scheduledEnd).toISOString(), timeZone: 'Asia/Manila' },
      attendees: cleanAttendees,
      conferenceData: {
        createRequest: {
          requestId,
          conferenceSolutionKey: { type: 'hangoutsMeet' },
        },
      },
    };

    const calRes = await fetchWithBackoff(
      'https://www.googleapis.com/calendar/v3/calendars/primary/events?conferenceDataVersion=1&sendUpdates=none',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(eventPayload),
      }
    );

    if (!calRes.ok) {
      const errBody = await calRes.text();
      res.status(calRes.status).json({
        error: `Google Calendar API error (${calRes.status}): ${errBody}`,
      });
      return;
    }

    const calEvent = (await calRes.json()) as {
      id: string;
      htmlLink?: string;
      hangoutLink?: string;
      conferenceData?: {
        conferenceId?: string;
        entryPoints?: Array<{ entryPointType?: string; uri?: string }>;
      };
    };

    let meetUri =
      calEvent.hangoutLink ||
      calEvent.conferenceData?.entryPoints?.find((ep) => ep.entryPointType === 'video')?.uri ||
      '';
    let meetCode = calEvent.conferenceData?.conferenceId || '';
    let meetSpaceName = '';

    // Resolve canonical Meet v2 Space resource name if we have a meeting code
    if (meetCode) {
      const spaceRes = await fetchWithBackoff(
        `https://meet.googleapis.com/v2/spaces/${encodeURIComponent(meetCode)}`,
        {
          headers: { Authorization: `Bearer ${token}` },
        }
      );
      if (spaceRes.ok) {
        const spaceData = (await spaceRes.json()) as {
          name?: string;
          meetingUri?: string;
          meetingCode?: string;
        };
        meetSpaceName = spaceData.name || '';
        meetUri = meetUri || spaceData.meetingUri || '';
        meetCode = spaceData.meetingCode || meetCode;
      }
    }

    // Fallback: directly provision a Meet v2 Space if Calendar did not return a Meet link
    if (!meetUri) {
      const createSpaceRes = await fetchWithBackoff('https://meet.googleapis.com/v2/spaces', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({}),
      });
      if (createSpaceRes.ok) {
        const spaceData = (await createSpaceRes.json()) as {
          name?: string;
          meetingUri?: string;
          meetingCode?: string;
        };
        meetSpaceName = spaceData.name || '';
        meetUri = spaceData.meetingUri || '';
        meetCode = spaceData.meetingCode || '';
      }
    }

    if (!meetUri) {
      res.status(502).json({
        error: 'Calendar event was created, but Google Meet link generation was unavailable for this account.',
      });
      return;
    }

    res.json({
      calendarEventId: calEvent.id,
      calendarHtmlLink: calEvent.htmlLink || '',
      meetUri,
      meetSpaceName,
      meetCode,
    });
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Failed to schedule Google Meet class.',
    });
  }
});

function extractDriveFileId(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const dMatch = trimmed.match(/\/d\/([a-zA-Z0-9_-]{10,})/);
  if (dMatch) return dMatch[1];
  const idMatch = trimmed.match(/[?&]id=([a-zA-Z0-9_-]{10,})/);
  if (idMatch) return idMatch[1];
  if (/^[a-zA-Z0-9_-]{15,}$/.test(trimmed)) return trimmed;
  return null;
}

// Multi-signal Meet Recording discovery (Admins & Instructors ONLY)
app.post('/api/meet/sync-recording', async (req: Request, res: Response) => {
  const {
    meetSpaceName,
    meetCode,
    calendarEventId,
    courseFolderId,
    sessionTitle,
    searchQuery,
    driveUrlOrId,
    courseId,
  } = req.body as {
    meetSpaceName?: string;
    meetCode?: string;
    calendarEventId?: string;
    courseFolderId?: string;
    sessionTitle?: string;
    searchQuery?: string;
    driveUrlOrId?: string;
    courseId?: string;
  };

  const caller = await requireStaffCaller(req, res, courseId);
  if (!caller) return;

  const token = extractBearerToken(req);
  if (!token) {
    res.status(401).json({ error: 'Missing Google Workspace OAuth Bearer token.', reauthRequired: true });
    return;
  }

  interface DiscoveredRecording {
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

  const discovered: DiscoveredRecording[] = [];
  const seenFileIds = new Set<string>();
  let processingCount = 0;
  let sawUnauthorized = false;
  let driveErrorMessage: string | null = null;

  const formatDuration = (msString?: string): string => {
    const ms = Number(msString);
    if (!Number.isFinite(ms) || ms <= 0) return 'Recorded session';
    const totalSec = Math.round(ms / 1000);
    const hrs = Math.floor(totalSec / 3600);
    const mins = Math.floor((totalSec % 3600) / 60);
    const secs = totalSec % 60;
    if (hrs > 0) return `${hrs}h ${mins}m`;
    return `${mins}m ${secs}s`;
  };

  const addDriveFile = (
    file: {
      id: string;
      name?: string;
      webViewLink?: string;
      mimeType?: string;
      createdTime?: string;
      videoMediaMetadata?: { durationMillis?: string };
    },
    source: DiscoveredRecording['source'],
    conferenceRecordId = ''
  ) => {
    if (!file.id || seenFileIds.has(file.id)) return;
    seenFileIds.add(file.id);
    discovered.push({
      driveFileId: file.id,
      title: file.name || (sessionTitle ? `${sessionTitle} — Recording` : 'Google Meet Recording'),
      webViewLink: file.webViewLink || `https://drive.google.com/file/d/${file.id}/view`,
      mimeType: file.mimeType || 'video/mp4',
      durationLabel: formatDuration(file.videoMediaMetadata?.durationMillis),
      conferenceRecordId,
      createdTime: file.createdTime || new Date().toISOString(),
      source,
    });
  };

  try {
    // Signal 0: Direct Drive URL or File ID lookup
    if (driveUrlOrId && driveUrlOrId.trim()) {
      const parsedId = extractDriveFileId(driveUrlOrId);
      if (!parsedId) {
        res.status(400).json({ error: 'Could not extract a valid Google Drive file ID from that link.' });
        return;
      }
      const metaRes = await fetchWithBackoff(
        `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(
          parsedId
        )}?supportsAllDrives=true&fields=id,name,webViewLink,mimeType,createdTime,videoMediaMetadata`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (metaRes.status === 401) {
        res.status(401).json({ error: 'Google Workspace token expired. Please re-authorize.', reauthRequired: true });
        return;
      }
      if (!metaRes.ok) {
        const errText = await metaRes.text();
        res.status(metaRes.status).json({ error: `Unable to read Drive file (${metaRes.status}): ${errText.slice(0, 200)}` });
        return;
      }
      const meta = (await metaRes.json()) as {
        id: string;
        name?: string;
        webViewLink?: string;
        mimeType?: string;
        createdTime?: string;
        videoMediaMetadata?: { durationMillis?: string };
      };
      addDriveFile(meta, 'direct_link');
      res.json({ recordings: discovered, processingCount: 0 });
      return;
    }

    // Signal 1: Meet REST API v2 conferenceRecords (filtered by space + unfiltered recent fallback)
    let resolvedSpaceName = meetSpaceName || '';
    if (!resolvedSpaceName && meetCode) {
      const lookupRes = await fetchWithBackoff(
        `https://meet.googleapis.com/v2/spaces/${encodeURIComponent(meetCode)}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (lookupRes.status === 401) {
        sawUnauthorized = true;
      } else if (lookupRes.ok) {
        const spaceData = (await lookupRes.json()) as { name?: string };
        resolvedSpaceName = spaceData.name || '';
      }
    }

    const conferenceEndpoints: string[] = [];
    if (resolvedSpaceName) {
      const filter = `space.name="${resolvedSpaceName}"`;
      conferenceEndpoints.push(
        `https://meet.googleapis.com/v2/conferenceRecords?filter=${encodeURIComponent(filter)}&pageSize=10`
      );
    }
    conferenceEndpoints.push('https://meet.googleapis.com/v2/conferenceRecords?pageSize=15');

    const checkedRecords = new Set<string>();
    for (const confUrl of conferenceEndpoints) {
      const confRes = await fetchWithBackoff(confUrl, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (confRes.status === 401) {
        sawUnauthorized = true;
        continue;
      }
      if (!confRes.ok) continue;

      const confData = (await confRes.json()) as {
        conferenceRecords?: Array<{ name: string; startTime?: string; endTime?: string }>;
      };

      for (const rec of (confData.conferenceRecords || []).slice(0, 10)) {
        if (checkedRecords.has(rec.name)) continue;
        checkedRecords.add(rec.name);

        const recListRes = await fetchWithBackoff(
          `https://meet.googleapis.com/v2/${rec.name}/recordings`,
          { headers: { Authorization: `Bearer ${token}` } }
        );
        if (!recListRes.ok) continue;

        const recListData = (await recListRes.json()) as {
          recordings?: Array<{
            name: string;
            state?: string;
            driveDestination?: { file?: string; exportUri?: string };
          }>;
        };

        for (const item of recListData.recordings || []) {
          const fileId = item.driveDestination?.file;
          if (!fileId) {
            if (item.state === 'STARTED' || item.state === 'ENDED') {
              processingCount++;
            }
            continue;
          }
          if (seenFileIds.has(fileId)) continue;

          const metaRes = await fetchWithBackoff(
            `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(
              fileId
            )}?supportsAllDrives=true&fields=id,name,webViewLink,mimeType,createdTime,videoMediaMetadata`,
            { headers: { Authorization: `Bearer ${token}` } }
          );
          if (metaRes.ok) {
            const meta = (await metaRes.json()) as {
              id: string;
              name?: string;
              webViewLink?: string;
              mimeType?: string;
              createdTime?: string;
              videoMediaMetadata?: { durationMillis?: string };
            };
            addDriveFile(meta, 'meet_api', rec.name);
          } else {
            addDriveFile(
              {
                id: fileId,
                name: sessionTitle ? `${sessionTitle} — Recording` : 'Google Meet Recording',
                webViewLink:
                  item.driveDestination?.exportUri || `https://drive.google.com/file/d/${fileId}/view`,
                createdTime: rec.startTime,
              },
              'meet_api',
              rec.name
            );
          }
        }
      }
    }

    // Signal 1b: Google Calendar event attachments (Meet automatically attaches recordings here)
    if (calendarEventId && calendarEventId.trim()) {
      const calRes = await fetchWithBackoff(
        `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(
          calendarEventId.trim()
        )}?fields=id,summary,attachments`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (calRes.status === 401) {
        sawUnauthorized = true;
      } else if (calRes.ok) {
        const calData = (await calRes.json()) as {
          attachments?: Array<{
            fileId?: string;
            fileUrl?: string;
            title?: string;
            mimeType?: string;
          }>;
        };
        for (const att of calData.attachments || []) {
          const attFileId = att.fileId || (att.fileUrl ? extractDriveFileId(att.fileUrl) : null);
          if (!attFileId || seenFileIds.has(attFileId)) continue;
          const isVideo =
            !att.mimeType ||
            att.mimeType.startsWith('video/') ||
            att.mimeType === 'application/octet-stream';
          if (!isVideo) continue;

          const metaRes = await fetchWithBackoff(
            `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(
              attFileId
            )}?supportsAllDrives=true&fields=id,name,webViewLink,mimeType,createdTime,videoMediaMetadata`,
            { headers: { Authorization: `Bearer ${token}` } }
          );
          if (metaRes.ok) {
            const meta = (await metaRes.json()) as {
              id: string;
              name?: string;
              webViewLink?: string;
              mimeType?: string;
              createdTime?: string;
              videoMediaMetadata?: { durationMillis?: string };
            };
            addDriveFile(meta, 'calendar_attachment');
          } else {
            addDriveFile(
              {
                id: attFileId,
                name: att.title || (sessionTitle ? `${sessionTitle} — Recording` : 'Google Meet Recording'),
                webViewLink: att.fileUrl || `https://drive.google.com/file/d/${attFileId}/view`,
                mimeType: att.mimeType || 'video/mp4',
              },
              'calendar_attachment'
            );
          }
        }
      }
    }

    // Signal 2: Direct inspection of Google Meet folder(s) AND LMS course/recordings folders in Drive
    const listVideosInFolder = async (
      folderId: string,
      source: 'meet_folder' | 'lms_folder',
      depth = 0
    ) => {
      const insideQ = `'${escapeDriveQueryValue(folderId)}' in parents and trashed=false`;
      const insideRes = await fetchWithBackoff(
        `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(
          insideQ
        )}&orderBy=createdTime desc&pageSize=25&supportsAllDrives=true&includeItemsFromAllDrives=true&fields=files(id,name,webViewLink,mimeType,createdTime,videoMediaMetadata)`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (insideRes.status === 401) {
        sawUnauthorized = true;
        return;
      }
      if (!insideRes.ok) return;

      const insideData = (await insideRes.json()) as {
        files?: Array<{
          id: string;
          name?: string;
          webViewLink?: string;
          mimeType?: string;
          createdTime?: string;
          videoMediaMetadata?: { durationMillis?: string };
        }>;
      };
      for (const file of insideData.files || []) {
        if (file.mimeType === 'application/vnd.google-apps.folder') {
          if (depth < 1) {
            await listVideosInFolder(file.id, source, depth + 1);
          }
          continue;
        }
        if (
          file.mimeType &&
          (file.mimeType.startsWith('video/') ||
            file.mimeType === 'application/octet-stream' ||
            (file.name && /\.(mp4|webm|mov|mkv)$/i.test(file.name)))
        ) {
          addDriveFile(file, source);
        }
      }
    };

    // Check LMS course folder (and its Recordings subfolder) first if available
    if (courseFolderId && courseFolderId.trim()) {
      await listVideosInFolder(courseFolderId.trim(), 'lms_folder', 0);
    }

    // Check any folder matching "Meet" (e.g. "Meet Recordings", "Google Meet", "Google Meet Recordings")
    const folderQ = `mimeType='application/vnd.google-apps.folder' and (name contains 'Meet' or name='Recordings') and trashed=false`;
    const folderRes = await fetchWithBackoff(
      `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(
        folderQ
      )}&supportsAllDrives=true&includeItemsFromAllDrives=true&fields=files(id,name)&pageSize=10`,
      { headers: { Authorization: `Bearer ${token}` } }
    );

    if (folderRes.status === 401) {
      sawUnauthorized = true;
    } else if (!folderRes.ok) {
      driveErrorMessage = `Google Drive folder lookup returned HTTP ${folderRes.status}.`;
    } else {
      const folderData = (await folderRes.json()) as { files?: Array<{ id: string; name?: string }> };
      for (const folder of folderData.files || []) {
        await listVideosInFolder(folder.id, 'meet_folder', 0);
      }
    }

    // Signal 3: Scoped & Recent Drive v3 video search across My Drive + Shared Drives
    const driveQueries: string[] = [];
    if (searchQuery && searchQuery.trim().length >= 2) {
      driveQueries.push(
        `mimeType contains 'video/' and trashed=false and name contains '${escapeDriveQueryValue(
          searchQuery.trim()
        )}'`
      );
    } else {
      const searchClauses: string[] = [];
      if (meetCode) {
        searchClauses.push(`name contains '${escapeDriveQueryValue(meetCode)}'`);
      }
      if (sessionTitle && sessionTitle.trim().length >= 3) {
        const keyword = sessionTitle.trim().split(/\s+/).slice(0, 3).join(' ');
        searchClauses.push(`name contains '${escapeDriveQueryValue(keyword)}'`);
      }
      if (searchClauses.length > 0) {
        driveQueries.push(
          `mimeType contains 'video/' and trashed=false and (${searchClauses.join(' or ')})`
        );
      }
      driveQueries.push(`mimeType contains 'video/' and trashed=false`);
    }

    for (const q of driveQueries) {
      const url = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(
        q
      )}&orderBy=createdTime desc&pageSize=20&supportsAllDrives=true&includeItemsFromAllDrives=true&fields=files(id,name,webViewLink,mimeType,createdTime,videoMediaMetadata)`;
      const driveRes = await fetchWithBackoff(url, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (driveRes.status === 401) {
        sawUnauthorized = true;
        break;
      }
      if (!driveRes.ok) {
        driveErrorMessage = driveErrorMessage || `Google Drive search returned HTTP ${driveRes.status}.`;
        continue;
      }
      const driveData = (await driveRes.json()) as {
        files?: Array<{
          id: string;
          name?: string;
          webViewLink?: string;
          mimeType?: string;
          createdTime?: string;
          videoMediaMetadata?: { durationMillis?: string };
        }>;
      };
      for (const file of driveData.files || []) {
        addDriveFile(file, 'drive_search');
      }
    }

    if (discovered.length === 0 && sawUnauthorized) {
      res.status(401).json({
        error: 'Your Google Workspace token expired. Please re-authorize Google access.',
        reauthRequired: true,
      });
      return;
    }

    res.json({
      recordings: discovered,
      processingCount,
      warning: discovered.length === 0 ? driveErrorMessage : null,
    });
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Failed to discover Google Meet recordings.',
    });
  }
});

// Move a Google Drive recording or file from Google Meet's folder into the LMS Course Folder (Admins & Instructors ONLY)
app.post('/api/drive/move-to-lms', async (req: Request, res: Response) => {
  const { fileId, courseFolderId, courseFolderName, subfolderName, courseId } = req.body as {
    fileId?: string;
    courseFolderId?: string;
    courseFolderName?: string;
    subfolderName?: string;
    courseId?: string;
  };

  const caller = await requireStaffCaller(req, res, courseId);
  if (!caller) return;

  const token = extractBearerToken(req);
  if (!token) {
    res.status(401).json({ error: 'Missing Google Workspace OAuth Bearer token.', reauthRequired: true });
    return;
  }

  if (!fileId || !SAFE_DRIVE_ID_RE.test(fileId.trim())) {
    res.status(400).json({ error: 'A valid Google Drive fileId is required.' });
    return;
  }

  try {
    // Resolve destination folder: LMS / <Course Folder> / Recordings (or directly inside LMS)
    let baseCourseFolderId = courseFolderId?.trim() || '';
    let baseCourseFolderUrl = '';

    if (!baseCourseFolderId) {
      const rootFolder = await ensureDriveFolder(token, 'LMS');
      if (courseFolderName && courseFolderName.trim()) {
        const courseFolder = await ensureDriveFolder(
          token,
          courseFolderName.trim().slice(0, 120),
          rootFolder.id
        );
        baseCourseFolderId = courseFolder.id;
        baseCourseFolderUrl = courseFolder.webViewLink;
      } else {
        baseCourseFolderId = rootFolder.id;
        baseCourseFolderUrl = rootFolder.webViewLink;
      }
    }

    let destinationFolderId = baseCourseFolderId;
    let destinationFolderUrl =
      baseCourseFolderUrl || `https://drive.google.com/drive/folders/${baseCourseFolderId}`;

    const targetSub = subfolderName?.trim();
    if (targetSub) {
      const subFolder = await ensureDriveFolder(token, targetSub.slice(0, 80), baseCourseFolderId);
      destinationFolderId = subFolder.id;
      destinationFolderUrl = subFolder.webViewLink;
    }

    // Fetch current parents of the file
    const metaRes = await fetchWithBackoff(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(
        fileId.trim()
      )}?supportsAllDrives=true&fields=id,name,parents,webViewLink`,
      { headers: { Authorization: `Bearer ${token}` } }
    );

    if (metaRes.status === 401) {
      res.status(401).json({ error: 'Google Workspace token expired. Please re-authorize.', reauthRequired: true });
      return;
    }

    if (!metaRes.ok) {
      const errText = await metaRes.text();
      res.status(metaRes.status).json({
        error: `Unable to read Drive file before moving (${metaRes.status}): ${errText.slice(0, 200)}`,
      });
      return;
    }

    const fileMeta = (await metaRes.json()) as {
      id: string;
      name?: string;
      parents?: string[];
      webViewLink?: string;
    };

    const currentParents = fileMeta.parents || [];
    if (currentParents.includes(destinationFolderId)) {
      res.json({
        moved: false,
        alreadyInLms: true,
        shortcutCreated: false,
        driveFileId: fileMeta.id,
        folderId: destinationFolderId,
        folderUrl: destinationFolderUrl,
        courseFolderId: baseCourseFolderId,
        webViewLink: fileMeta.webViewLink || `https://drive.google.com/file/d/${fileMeta.id}/view`,
      });
      return;
    }

    const removeParentsParam =
      currentParents.length > 0 ? `&removeParents=${encodeURIComponent(currentParents.join(','))}` : '';

    const moveRes = await fetchWithBackoff(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(
        fileMeta.id
      )}?addParents=${encodeURIComponent(destinationFolderId)}${removeParentsParam}&supportsAllDrives=true&fields=id,name,parents,webViewLink`,
      {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({}),
      }
    );

    if (moveRes.status === 401) {
      res.status(401).json({ error: 'Google Workspace token expired. Please re-authorize.', reauthRequired: true });
      return;
    }

    if (moveRes.ok) {
      const movedMeta = (await moveRes.json()) as {
        id: string;
        webViewLink?: string;
      };
      res.json({
        moved: true,
        alreadyInLms: false,
        shortcutCreated: false,
        driveFileId: movedMeta.id,
        folderId: destinationFolderId,
        folderUrl: destinationFolderUrl,
        courseFolderId: baseCourseFolderId,
        webViewLink: movedMeta.webViewLink || fileMeta.webViewLink || `https://drive.google.com/file/d/${fileMeta.id}/view`,
      });
      return;
    }

    // Fallback: if the user doesn't own the original recording and can't move it out of another owner's Meet folder,
    // create a Drive Shortcut inside the LMS course Recordings folder so it's still organized inside LMS.
    const shortcutRes = await fetchWithBackoff(
      'https://www.googleapis.com/drive/v3/files?supportsAllDrives=true&fields=id,name,webViewLink',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: fileMeta.name || 'Google Meet Recording',
          mimeType: 'application/vnd.google-apps.shortcut',
          parents: [destinationFolderId],
          shortcutDetails: {
            targetId: fileMeta.id,
          },
        }),
      }
    );

    if (shortcutRes.ok) {
      res.json({
        moved: false,
        alreadyInLms: false,
        shortcutCreated: true,
        driveFileId: fileMeta.id,
        folderId: destinationFolderId,
        folderUrl: destinationFolderUrl,
        courseFolderId: baseCourseFolderId,
        webViewLink: fileMeta.webViewLink || `https://drive.google.com/file/d/${fileMeta.id}/view`,
      });
      return;
    }

    const moveErrText = await moveRes.text();
    res.status(moveRes.status).json({
      error: `Failed to move recording into LMS folder (${moveRes.status}): ${moveErrText.slice(0, 200)}`,
    });
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Failed to move recording to LMS folder.',
    });
  }
});

// Live Google Drive Multipart File Upload (Course Resources for Staff; Standalone Assignment Upload for Students)
app.post('/api/drive/upload', upload.single('file'), async (req: Request, res: Response) => {
  const { folderName, parentFolderId, courseId } = req.body as {
    folderName?: string;
    parentFolderId?: string;
    courseId?: string;
  };

  const caller = await verifyFirebaseCaller(req, courseId);
  if (!caller) {
    res.status(401).json({ error: 'Authentication required to upload files.' });
    return;
  }

  const token = extractBearerToken(req);
  if (!token) {
    res.status(401).json({ error: 'Missing Google Workspace OAuth Bearer token.' });
    return;
  }

  const file = req.file;
  if (!file) {
    res.status(400).json({ error: 'No file attached in upload request.' });
    return;
  }

  if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
    res.status(400).json({
      error: `Unsupported file type (${file.mimetype}). Allowed: PDF, DOCX, PPTX, XLSX, TXT, MP4, MP3, PNG, JPG.`,
    });
    return;
  }

  try {
    // Only admins and instructors may create or upload into LMS Google Drive folders.
    // Students upload standalone assignment files to their own Drive root without LMS folder access.
    let targetFolderId = '';
    if (caller.isStaff) {
      if (parentFolderId && SAFE_DRIVE_ID_RE.test(parentFolderId.trim())) {
        targetFolderId = parentFolderId.trim();
      } else if (folderName?.trim()) {
        const rootFolder = await ensureDriveFolder(token, 'LMS');
        const subFolder = await ensureDriveFolder(
          token,
          folderName.trim().slice(0, 120),
          rootFolder.id
        );
        targetFolderId = subFolder.id;
      }
    }

    const boundary = `bslms_boundary_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const metadata: Record<string, unknown> = {
      name: file.originalname.slice(0, 255),
      mimeType: file.mimetype,
    };
    if (targetFolderId) {
      metadata.parents = [targetFolderId];
    }

    const metaPart = Buffer.from(
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(
        metadata
      )}\r\n--${boundary}\r\nContent-Type: ${file.mimetype}\r\n\r\n`,
      'utf8'
    );
    const endPart = Buffer.from(`\r\n--${boundary}--`, 'utf8');
    const multipartBody = Buffer.concat([metaPart, file.buffer, endPart]);

    const uploadRes = await fetchWithBackoff(
      'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,mimeType,size,webViewLink,webContentLink',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': `multipart/related; boundary=${boundary}`,
          'Content-Length': String(multipartBody.length),
        },
        body: multipartBody,
      }
    );

    if (!uploadRes.ok) {
      const errBody = await uploadRes.text();
      res.status(uploadRes.status).json({
        error: `Google Drive upload failed (${uploadRes.status}): ${errBody}`,
      });
      return;
    }

    const uploaded = (await uploadRes.json()) as {
      id: string;
      name: string;
      mimeType: string;
      size?: string;
      webViewLink?: string;
      webContentLink?: string;
    };

    res.json({
      driveFileId: uploaded.id,
      fileName: uploaded.name,
      mimeType: uploaded.mimeType,
      sizeBytes: Number(uploaded.size) || file.size,
      webViewLink: uploaded.webViewLink || `https://drive.google.com/file/d/${uploaded.id}/view`,
      webContentLink: uploaded.webContentLink || '',
      folderId: targetFolderId,
    });
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Failed to upload file to Google Drive.',
    });
  }
});

// Direct Google Drive File Download Proxy (Streams binary content or exports Google Workspace Docs/Sheets/Slides)
app.get('/api/drive/download/:fileId', async (req: Request, res: Response) => {
  const rawCourseId = typeof req.query.courseId === 'string' ? req.query.courseId.trim() : '';
  const cleanCourseId = SAFE_FIRESTORE_ID_RE.test(rawCourseId) ? rawCourseId : '';

  const caller = await verifyFirebaseCaller(req, cleanCourseId || undefined);
  if (!caller) {
    res.status(401).json({ error: 'Authentication required to download files.' });
    return;
  }

  // Students can only download resources belonging to courses where they have approved active membership
  if (!caller.isStaff) {
    const idToken = extractFirebaseIdToken(req);
    if (!cleanCourseId || !idToken) {
      res.status(403).json({
        error: 'Course downloads are protected and available only to approved enrolled students.',
      });
      return;
    }
    const memberDoc = await fetchFirestoreDoc(
      idToken,
      `courses/${encodeURIComponent(cleanCourseId)}/members/${encodeURIComponent(caller.uid)}`
    );
    if (!memberDoc) {
      res.status(403).json({
        error:
          'You must be approved and enrolled in this course by an instructor or admin before downloading course materials.',
      });
      return;
    }
  }

  const token = extractBearerToken(req);
  if (!token) {
    res.status(401).json({
      error: 'Missing Google Workspace OAuth Bearer token.',
      reauthRequired: true,
    });
    return;
  }

  const fileId = String(req.params.fileId || '').trim();
  if (!SAFE_DRIVE_ID_RE.test(fileId)) {
    res.status(400).json({ error: 'Invalid Google Drive file ID.' });
    return;
  }

  const requestedName =
    typeof req.query.fileName === 'string' && req.query.fileName.trim()
      ? req.query.fileName.trim().slice(0, 255)
      : 'course-resource';
  const requestedMime =
    typeof req.query.mimeType === 'string' ? req.query.mimeType.trim() : '';

  if (requestedMime === 'application/vnd.google-apps.folder') {
    res.status(403).json({
      error: 'Only admins and instructors have access to Google Drive folders.',
    });
    return;
  }

  const sanitizeFilename = (name: string) =>
    name.replace(/[\r\n"\\/]/g, '_').trim() || 'course-resource';

  const GOOGLE_EXPORT_MAP: Record<string, { mime: string; ext: string }> = {
    'application/vnd.google-apps.document': { mime: 'application/pdf', ext: '.pdf' },
    'application/vnd.google-apps.spreadsheet': {
      mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      ext: '.xlsx',
    },
    'application/vnd.google-apps.presentation': {
      mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      ext: '.pptx',
    },
    'application/vnd.google-apps.drawing': { mime: 'image/png', ext: '.png' },
  };

  try {
    let downloadName = sanitizeFilename(requestedName);
    let downloadMime = requestedMime || 'application/octet-stream';
    let driveRes: globalThis.Response;

    const mappedExport = GOOGLE_EXPORT_MAP[requestedMime];
    if (mappedExport) {
      downloadMime = mappedExport.mime;
      if (!downloadName.toLowerCase().endsWith(mappedExport.ext)) {
        downloadName = `${downloadName}${mappedExport.ext}`;
      }
      driveRes = await fetchWithBackoff(
        `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(
          fileId
        )}/export?mimeType=${encodeURIComponent(mappedExport.mime)}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
    } else {
      driveRes = await fetchWithBackoff(
        `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(
          fileId
        )}?alt=media&supportsAllDrives=true`,
        { headers: { Authorization: `Bearer ${token}` } }
      );

      // Fallback if file is actually a native Google Workspace Doc/Sheet/Slide without hint
      if (driveRes.status === 403) {
        const cloneText = await driveRes.clone().text().catch(() => '');
        if (cloneText.includes('fileNotDownloadable')) {
          downloadMime = 'application/pdf';
          if (!downloadName.toLowerCase().endsWith('.pdf')) {
            downloadName = `${downloadName}.pdf`;
          }
          driveRes = await fetchWithBackoff(
            `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(
              fileId
            )}/export?mimeType=application/pdf`,
            { headers: { Authorization: `Bearer ${token}` } }
          );
        }
      }
    }

    if (driveRes.status === 401) {
      res.status(401).json({
        error: 'Google Workspace session expired. Please re-authorize to download.',
        reauthRequired: true,
      });
      return;
    }

    if (!driveRes.ok) {
      const errText = await driveRes.text().catch(() => '');
      const statusMsg =
        driveRes.status === 403 || driveRes.status === 404
          ? 'Unable to download this file from Google Drive. Confirm that your Google account has view access to this course resource.'
          : `Google Drive download failed (HTTP ${driveRes.status}): ${errText.slice(0, 180)}`;
      res.status(driveRes.status).json({ error: statusMsg });
      return;
    }

    const upstreamType = driveRes.headers.get('content-type');
    const finalContentType =
      upstreamType && !upstreamType.includes('application/json') ? upstreamType : downloadMime;
    const buffer = Buffer.from(await driveRes.arrayBuffer());

    res.setHeader('Content-Type', finalContentType);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${downloadName.replace(/"/g, '')}"; filename*=UTF-8''${encodeURIComponent(
        downloadName
      )}`
    );
    res.setHeader('Content-Length', String(buffer.length));
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(buffer);
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Failed to download file from Google Drive.',
    });
  }
});

// Automated Cohort Drive Viewer-Only File Permissions (Strictly blocks Drive folders; always grants 'reader' only)
app.post('/api/drive/share-roster', async (req: Request, res: Response) => {
  const { fileIds, emails, courseId } = req.body as {
    fileIds?: string[];
    emails?: string[];
    courseId?: string;
  };

  const caller = await verifyFirebaseCaller(req, courseId);
  if (!caller) {
    res.status(401).json({ error: 'Authentication required to share Drive files.' });
    return;
  }

  const token = extractBearerToken(req);
  if (!token) {
    res.status(401).json({ error: 'Missing Google Workspace OAuth Bearer token.' });
    return;
  }

  const validFileIds = Array.isArray(fileIds)
    ? Array.from(
        new Set(fileIds.map((id) => String(id).trim()).filter((id) => SAFE_DRIVE_ID_RE.test(id)))
      )
    : [];
  const validEmails = Array.isArray(emails)
    ? Array.from(
        new Set(
          emails
            .map((e) => (typeof e === 'string' ? e.trim().toLowerCase() : ''))
            .filter((e) => EMAIL_RE.test(e))
        )
      )
    : [];

  if (validFileIds.length === 0 || validEmails.length === 0) {
    res.status(400).json({ error: 'At least one valid fileId and one recipient email are required.' });
    return;
  }

  // Students may only share a single assignment submission file read-only with their instructor
  if (!caller.isStaff && (validFileIds.length > 1 || validEmails.length > 5)) {
    res.status(403).json({
      error: 'Students may only share an individual assignment submission with their instructor.',
    });
    return;
  }

  // Strictly enforce Viewer ('reader') only — students never receive commenter, writer, or folder permissions
  const permissionRole = 'reader';
  const results: Array<{
    fileId: string;
    email: string;
    status: 'granted' | 'failed';
    error?: string;
  }> = [];

  // Verify no Google Drive folder IDs are shared through this file-sharing route
  const blockedFolderIds = new Set<string>();
  for (const fileId of validFileIds) {
    const metaRes = await fetchWithBackoff(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(
        fileId
      )}?supportsAllDrives=true&fields=id,mimeType`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (metaRes.status === 401) {
      res.status(401).json({
        error: 'Google Workspace session expired. Please re-authorize.',
        reauthRequired: true,
      });
      return;
    }
    if (metaRes.ok) {
      const meta = (await metaRes.json()) as { mimeType?: string };
      if (meta.mimeType === 'application/vnd.google-apps.folder') {
        blockedFolderIds.add(fileId);
      }
    }
  }

  const tasks: Array<{ fileId: string; email: string }> = [];
  for (const fileId of validFileIds) {
    if (blockedFolderIds.has(fileId)) {
      for (const email of validEmails) {
        results.push({
          fileId,
          email,
          status: 'failed',
          error: 'Google Drive folders are restricted to admins and instructors only.',
        });
      }
      continue;
    }
    for (const email of validEmails) {
      tasks.push({ fileId, email });
    }
  }

  // Throttled worker pool (concurrency = 3) to respect Drive API per-second ACL write quotas
  const CONCURRENCY = 3;
  let index = 0;

  async function worker() {
    while (index < tasks.length) {
      const current = tasks[index++];
      try {
        const permRes = await fetchWithBackoff(
          `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(
            current.fileId
          )}/permissions?sendNotificationEmail=false&supportsAllDrives=true`,
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              type: 'user',
              role: permissionRole,
              emailAddress: current.email,
            }),
          }
        );

        if (permRes.ok) {
          results.push({ fileId: current.fileId, email: current.email, status: 'granted' });
        } else {
          const errText = await permRes.text();
          results.push({
            fileId: current.fileId,
            email: current.email,
            status: 'failed',
            error: `HTTP ${permRes.status}: ${errText.slice(0, 180)}`,
          });
        }
      } catch (err) {
        results.push({
          fileId: current.fileId,
          email: current.email,
          status: 'failed',
          error: err instanceof Error ? err.message : 'Network error',
        });
      }
    }
  }

  if (tasks.length > 0) {
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, tasks.length) }, () => worker()));
  }

  const grantedCount = results.filter((r) => r.status === 'granted').length;
  const failed = results.filter((r) => r.status === 'failed');

  res.json({
    totalRequested: validFileIds.length * validEmails.length,
    grantedCount,
    failedCount: failed.length,
    results,
  });
});

// Sync Course Google Drive Folder Permissions (Admins & Instructors ONLY; revokes any student/public folder permissions)
app.post('/api/drive/sync-folder-access', async (req: Request, res: Response) => {
  const { courseFolderId, staffEmails, studentEmails, courseId } = req.body as {
    courseFolderId?: string;
    staffEmails?: string[];
    studentEmails?: string[];
    courseId?: string;
  };

  const caller = await requireStaffCaller(req, res, courseId);
  if (!caller) return;

  const token = extractBearerToken(req);
  if (!token) {
    res.status(401).json({
      error: 'Missing Google Workspace OAuth Bearer token.',
      reauthRequired: true,
    });
    return;
  }

  const cleanFolderId = String(courseFolderId || '').trim();
  if (!SAFE_DRIVE_ID_RE.test(cleanFolderId)) {
    res.status(400).json({ error: 'A valid courseFolderId is required.' });
    return;
  }

  const cleanStaffEmails = Array.from(
    new Set(
      (Array.isArray(staffEmails) ? staffEmails : [])
        .map((e) => (typeof e === 'string' ? e.trim().toLowerCase() : ''))
        .filter((e) => EMAIL_RE.test(e) && e !== caller.email)
    )
  );
  const staffSet = new Set<string>([caller.email, ...cleanStaffEmails]);

  const studentSet = new Set<string>(
    (Array.isArray(studentEmails) ? studentEmails : [])
      .map((e) => (typeof e === 'string' ? e.trim().toLowerCase() : ''))
      .filter((e) => EMAIL_RE.test(e) && !staffSet.has(e))
  );

  try {
    // Verify target is actually a Google Drive folder
    const metaRes = await fetchWithBackoff(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(
        cleanFolderId
      )}?supportsAllDrives=true&fields=id,mimeType`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (metaRes.status === 401) {
      res.status(401).json({
        error: 'Google Workspace session expired. Please re-authorize.',
        reauthRequired: true,
      });
      return;
    }
    if (!metaRes.ok) {
      res.status(metaRes.status).json({
        error: `Unable to read course Google Drive folder (HTTP ${metaRes.status}).`,
      });
      return;
    }
    const meta = (await metaRes.json()) as { mimeType?: string };
    if (meta.mimeType !== 'application/vnd.google-apps.folder') {
      res.status(400).json({ error: 'The provided courseFolderId is not a Google Drive folder.' });
      return;
    }

    // Include course folder + any direct Recordings subfolder inside it
    const targetFolderIds = [cleanFolderId];
    const subQ = `mimeType='application/vnd.google-apps.folder' and '${escapeDriveQueryValue(
      cleanFolderId
    )}' in parents and trashed=false`;
    const subRes = await fetchWithBackoff(
      `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(
        subQ
      )}&supportsAllDrives=true&includeItemsFromAllDrives=true&fields=files(id,name)&pageSize=20`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (subRes.ok) {
      const subData = (await subRes.json()) as { files?: Array<{ id: string }> };
      for (const child of subData.files || []) {
        if (child.id && SAFE_DRIVE_ID_RE.test(child.id)) {
          targetFolderIds.push(child.id);
        }
      }
    }

    let staffGrantedCount = 0;
    let staffFailedCount = 0;
    let studentRevokedCount = 0;

    // 1. Grant folder writer access ONLY to admins & instructors on the root course folder
    for (const staffEmail of cleanStaffEmails) {
      const grantRes = await fetchWithBackoff(
        `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(
          cleanFolderId
        )}/permissions?sendNotificationEmail=false&supportsAllDrives=true`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            type: 'user',
            role: 'writer',
            emailAddress: staffEmail,
          }),
        }
      );
      if (grantRes.ok) {
        staffGrantedCount++;
      } else {
        staffFailedCount++;
      }
    }

    // 2. Audit & revoke any student or public ('anyone') permissions on the course folder & subfolders
    for (const folderId of targetFolderIds) {
      const listRes = await fetchWithBackoff(
        `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(
          folderId
        )}/permissions?supportsAllDrives=true&fields=permissions(id,type,role,emailAddress)`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (!listRes.ok) continue;
      const listData = (await listRes.json()) as {
        permissions?: Array<{
          id?: string;
          type?: string;
          role?: string;
          emailAddress?: string;
        }>;
      };
      for (const perm of listData.permissions || []) {
        if (!perm.id || perm.role === 'owner') continue;
        const permEmail = (perm.emailAddress || '').trim().toLowerCase();
        const isPublicLink = perm.type === 'anyone';
        const isStudentPerm = perm.type === 'user' && permEmail && studentSet.has(permEmail);
        if (isPublicLink || isStudentPerm) {
          const delRes = await fetchWithBackoff(
            `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(
              folderId
            )}/permissions/${encodeURIComponent(perm.id)}?supportsAllDrives=true`,
            {
              method: 'DELETE',
              headers: { Authorization: `Bearer ${token}` },
            }
          );
          if (delRes.ok || delRes.status === 404) {
            studentRevokedCount++;
          }
        }
      }
    }

    res.json({
      staffGrantedCount,
      staffFailedCount,
      studentRevokedCount,
      auditedFolders: targetFolderIds.length,
    });
  } catch (err) {
    res.status(500).json({
      error:
        err instanceof Error
          ? err.message
          : 'Failed to sync Google Drive folder permissions.',
    });
  }
});

// Stop Active Google Meet Conference (if running) and Delete Linked Google Calendar Invite (Admins & Instructors ONLY)
app.post('/api/meet/close-invite', async (req: Request, res: Response) => {
  const { calendarEventId, meetSpaceName, courseId } = req.body as {
    calendarEventId?: string;
    meetSpaceName?: string;
    courseId?: string;
  };

  const caller = await requireStaffCaller(req, res, courseId);
  if (!caller) return;

  const token = extractBearerToken(req);
  if (!token) {
    res.status(401).json({
      error: 'Missing Google Workspace OAuth Bearer token.',
      reauthRequired: true,
    });
    return;
  }

  const cleanedEventId = calendarEventId?.trim() || '';
  const cleanedSpaceName = meetSpaceName?.trim() || '';

  if (!cleanedEventId && !cleanedSpaceName) {
    res.json({ conferenceEnded: false, calendarDeleted: false });
    return;
  }

  let conferenceEnded = false;
  let calendarDeleted = false;

  try {
    // 1. End any currently active Google Meet conference on this space (best-effort; ignores inactive space errors)
    if (cleanedSpaceName && /^spaces\/[a-zA-Z0-9_-]{3,200}$/.test(cleanedSpaceName)) {
      const endRes = await fetchWithBackoff(
        `https://meet.googleapis.com/v2/${cleanedSpaceName}:endActiveConference`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({}),
        }
      );

      if (endRes.status === 401) {
        res.status(401).json({
          error: 'Your Google Workspace session expired. Please re-authorize to stop this Google Meet.',
          reauthRequired: true,
        });
        return;
      }

      if (endRes.ok) {
        conferenceEnded = true;
      }
    }

    // 2. Delete the linked Google Calendar event & notify invited attendees
    if (cleanedEventId) {
      const delRes = await fetchWithBackoff(
        `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(
          cleanedEventId
        )}?sendUpdates=all`,
        {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${token}` },
        }
      );

      if (delRes.status === 401) {
        res.status(401).json({
          error: 'Your Google Workspace session expired. Please re-authorize to delete the Calendar invite.',
          reauthRequired: true,
        });
        return;
      }

      if (!delRes.ok && delRes.status !== 404 && delRes.status !== 410) {
        const errText = await delRes.text();
        res.status(delRes.status).json({
          error: `Unable to delete Google Calendar invite: ${errText.slice(0, 220)}`,
        });
        return;
      }

      calendarDeleted = true;
    }

    res.json({ conferenceEnded, calendarDeleted });
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Failed to close Google Meet invite.',
    });
  }
});

// Sync Google Meet Conference Participants for Class Attendance (Admins & Instructors ONLY)
app.post('/api/meet/sync-attendance', async (req: Request, res: Response) => {
  const { courseId, meetSpaceName, meetCode } = req.body as {
    courseId?: string;
    meetSpaceName?: string;
    meetCode?: string;
  };

  const caller = await requireStaffCaller(req, res, courseId);
  if (!caller) return;

  const token = extractBearerToken(req);
  if (!token) {
    res.status(401).json({
      error: 'Missing Google Workspace OAuth Bearer token.',
      reauthRequired: true,
    });
    return;
  }

  try {
    let resolvedSpaceName = typeof meetSpaceName === 'string' ? meetSpaceName.trim() : '';
    const cleanedCode = typeof meetCode === 'string' ? meetCode.trim() : '';

    if (!resolvedSpaceName && cleanedCode) {
      const lookupRes = await fetchWithBackoff(
        `https://meet.googleapis.com/v2/spaces/${encodeURIComponent(cleanedCode)}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (lookupRes.status === 401) {
        res.status(401).json({
          error: 'Google Workspace session expired. Please re-authorize.',
          reauthRequired: true,
        });
        return;
      }
      if (lookupRes.ok) {
        const spaceData = (await lookupRes.json()) as { name?: string };
        resolvedSpaceName = spaceData.name || '';
      }
    }

    if (!resolvedSpaceName || !/^spaces\/[a-zA-Z0-9_-]{3,200}$/.test(resolvedSpaceName)) {
      res.json({ participants: [], conferenceCount: 0 });
      return;
    }

    const filter = `space.name="${resolvedSpaceName}"`;
    const confRes = await fetchWithBackoff(
      `https://meet.googleapis.com/v2/conferenceRecords?filter=${encodeURIComponent(
        filter
      )}&pageSize=10`,
      { headers: { Authorization: `Bearer ${token}` } }
    );

    if (confRes.status === 401) {
      res.status(401).json({
        error: 'Google Workspace session expired. Please re-authorize.',
        reauthRequired: true,
      });
      return;
    }

    if (!confRes.ok) {
      res.json({ participants: [], conferenceCount: 0 });
      return;
    }

    const confData = (await confRes.json()) as {
      conferenceRecords?: Array<{ name: string; startTime?: string; endTime?: string }>;
    };
    const records = confData.conferenceRecords || [];
    const participants: Array<{
      displayName: string;
      earliestStartTime: string;
      latestEndTime: string;
      userResourceName: string;
    }> = [];

    for (const rec of records.slice(0, 5)) {
      const partRes = await fetchWithBackoff(
        `https://meet.googleapis.com/v2/${rec.name}/participants?pageSize=100`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (!partRes.ok) continue;

      const partData = (await partRes.json()) as {
        participants?: Array<{
          earliestStartTime?: string;
          latestEndTime?: string;
          signedinUser?: { user?: string; displayName?: string };
          anonymousUser?: { displayName?: string };
          phoneUser?: { displayName?: string };
        }>;
      };

      for (const p of partData.participants || []) {
        const displayName = (
          p.signedinUser?.displayName ||
          p.anonymousUser?.displayName ||
          p.phoneUser?.displayName ||
          ''
        ).trim();
        if (!displayName) continue;
        participants.push({
          displayName,
          earliestStartTime: p.earliestStartTime || rec.startTime || new Date().toISOString(),
          latestEndTime: p.latestEndTime || rec.endTime || '',
          userResourceName: p.signedinUser?.user || '',
        });
      }
    }

    res.json({
      participants,
      conferenceCount: records.length,
    });
  } catch (err) {
    res.status(500).json({
      error:
        err instanceof Error
          ? err.message
          : 'Failed to synchronize participants from Google Meet.',
    });
  }
});

// Confirmed Workspace Deletion (Calendar Event or Drive File — Admins & Instructors ONLY)
app.delete('/api/workspace/item', async (req: Request, res: Response) => {
  const { type, id, courseId } = req.body as {
    type?: 'calendar_event' | 'drive_file';
    id?: string;
    courseId?: string;
  };

  const caller = await requireStaffCaller(req, res, courseId);
  if (!caller) return;

  const token = extractBearerToken(req);
  if (!token) {
    res.status(401).json({
      error: 'Missing Google Workspace OAuth Bearer token.',
      reauthRequired: true,
    });
    return;
  }

  if (!type || !id) {
    res.status(400).json({ error: 'type and id are required.' });
    return;
  }

  try {
    const endpoint =
      type === 'calendar_event'
        ? `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(id)}?sendUpdates=all`
        : `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}`;

    const delRes = await fetchWithBackoff(endpoint, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });

    if (delRes.status === 401) {
      res.status(401).json({
        error: 'Your Google Workspace session expired. Please re-authorize.',
        reauthRequired: true,
      });
      return;
    }

    if (!delRes.ok && delRes.status !== 404 && delRes.status !== 410) {
      const errText = await delRes.text();
      res.status(delRes.status).json({ error: `Workspace delete failed: ${errText}` });
      return;
    }

    res.json({ deleted: true, type, id });
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Failed to delete Workspace item.',
    });
  }
});

async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`LMS server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
