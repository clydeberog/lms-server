import { initializeApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signOut,
  User,
} from 'firebase/auth';
import { doc, getDocFromServer, getFirestore } from 'firebase/firestore';
import firebaseConfig from '../firebase-applet-config.json';

export const BOOTSTRAP_ADMIN_EMAIL = 'clydefrancis.berog39@gmail.com';

export const WORKSPACE_SCOPES = [
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/meetings.space.created',
  'https://www.googleapis.com/auth/meetings.space.readonly',
  'https://www.googleapis.com/auth/drive',
] as const;

const app = initializeApp(firebaseConfig);
const databaseId =
  (firebaseConfig as { firestoreDatabaseId?: string }).firestoreDatabaseId ||
  'ai-studio-7b12a4a0-509b-4def-bfed-82d2d4d49bd1';

export const db = getFirestore(app, databaseId);
export const auth = getAuth(app);

export const COOKIE_SESSION_SENTINEL = '__http_only_cookie__';

function buildWorkspaceGoogleProvider(options?: {
  loginHint?: string;
  forceAccountPicker?: boolean;
}): GoogleAuthProvider {
  const provider = new GoogleAuthProvider();
  for (const scope of WORKSPACE_SCOPES) {
    provider.addScope(scope);
  }
  const hint = options?.loginHint?.trim() || auth.currentUser?.email || '';
  const params: Record<string, string> = {
    include_granted_scopes: 'true',
  };
  if (hint && !options?.forceAccountPicker) {
    params.login_hint = hint;
  } else {
    params.prompt = 'select_account';
  }
  provider.setCustomParameters(params);
  return provider;
}

// Strict in-memory OAuth access token cache + HttpOnly server cookie status (never stored in localStorage/sessionStorage)
let cachedWorkspaceToken: string | null = null;
let cachedWorkspaceTokenExpiresAt = 0;
let cookieSessionExpiresAt = 0;
let isSigningIn = false;

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error:', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

// Mandatory startup Firestore connectivity check
async function testConnection() {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration: Firestore client is offline.');
    }
  }
}
testConnection();

export function initAuthObserver(
  onUserChange: (user: User | null, workspaceToken: string | null) => void
) {
  return onAuthStateChanged(auth, (user) => {
    if (!user) {
      cachedWorkspaceToken = null;
      cachedWorkspaceTokenExpiresAt = 0;
      cookieSessionExpiresAt = 0;
      onUserChange(null, null);
    } else if (!isSigningIn) {
      onUserChange(user, getWorkspaceAccessToken());
    }
  });
}

export async function signInWithGoogleWorkspace(options?: {
  loginHint?: string;
  forceAccountPicker?: boolean;
}): Promise<{
  user: User;
  accessToken: string;
}> {
  isSigningIn = true;
  try {
    const provider = buildWorkspaceGoogleProvider(options);
    const result = await signInWithPopup(auth, provider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    if (!credential?.accessToken) {
      throw new Error('Google Workspace access token was not granted. Please retry authorization.');
    }
    cachedWorkspaceToken = credential.accessToken;
    cachedWorkspaceTokenExpiresAt = Date.now() + 50 * 60 * 1000;
    return { user: result.user, accessToken: cachedWorkspaceToken };
  } finally {
    isSigningIn = false;
  }
}

export function setWorkspaceCookieSession(expiresAt: number | null): void {
  cookieSessionExpiresAt = expiresAt && expiresAt > Date.now() ? expiresAt : 0;
}

export function getWorkspaceAccessToken(): string | null {
  const now = Date.now();
  if (cachedWorkspaceToken && cachedWorkspaceTokenExpiresAt > now + 15_000) {
    return cachedWorkspaceToken;
  }
  if (cookieSessionExpiresAt > now + 15_000) {
    return COOKIE_SESSION_SENTINEL;
  }
  return null;
}

export function clearWorkspaceAccessToken(): void {
  cachedWorkspaceToken = null;
  cachedWorkspaceTokenExpiresAt = 0;
  cookieSessionExpiresAt = 0;
}

export async function logoutUser(): Promise<void> {
  clearWorkspaceAccessToken();
  await signOut(auth);
}
