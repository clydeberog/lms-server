import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { updateProfile, User } from 'firebase/auth';
import {
  BOOTSTRAP_ADMIN_EMAIL,
  COOKIE_SESSION_SENTINEL,
  getWorkspaceAccessToken,
  initAuthObserver,
  logoutUser,
  setWorkspaceCookieSession,
  signInWithGoogleWorkspace,
} from '../firebase';
import {
  claimPendingEnrollments,
  ensureUserProfile,
  normalizeEmail,
  submitStudentRegistration,
  subscribeUserProfile,
  updateUserAccountProfile,
} from '../lib/lmsFirestore';
import {
  clearWorkspaceSessionCookie,
  fetchWorkspaceSessionStatus,
  saveWorkspaceSessionCookie,
} from '../lib/workspaceApi';
import { ApprovalStatus, UserProfile, UserRole } from '../types';

export interface RememberedDeviceAccount {
  email: string;
  displayName: string;
}

interface AuthContextValue {
  user: User | null;
  profile: UserProfile | null;
  workspaceToken: string | null;
  loading: boolean;
  isSigningIn: boolean;
  authError: string | null;
  isBootstrapAdmin: boolean;
  isAdmin: boolean;
  isInstructor: boolean;
  effectiveRole: UserRole;
  actualRole: UserRole;
  actualIsAdmin: boolean;
  actualIsInstructor: boolean;
  // Student Registration & Approval state
  needsRegistration: boolean;
  approvalStatus: ApprovalStatus;
  isApproved: boolean;
  submitRegistration: (params: {
    displayName: string;
    department?: string;
    note?: string;
  }) => Promise<void>;
  claimedCount: number;
  rememberDevice: boolean;
  setRememberDevice: (value: boolean) => void;
  rememberedAccount: RememberedDeviceAccount | null;
  signIn: (options?: { switchAccount?: boolean }) => Promise<void>;
  connectWorkspace: () => Promise<string | null>;
  ensureWorkspaceToken: () => Promise<string | null>;
  signOut: (options?: { forgetDevice?: boolean }) => Promise<void>;
  forgetDevice: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  updateAccountProfile: (params: {
    displayName: string;
    photoUrl?: string | null;
  }) => Promise<UserProfile>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [workspaceToken, setWorkspaceToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [claimedCount, setClaimedCount] = useState(0);
  const [rememberDevice, setRememberDevice] = useState(true);
  const [rememberedAccount, setRememberedAccount] = useState<RememberedDeviceAccount | null>(null);

  // Restore server-side HttpOnly Workspace cookie & remembered device hint on startup
  const syncServerSession = useCallback(async (expectedEmail?: string | null) => {
    try {
      const status = await fetchWorkspaceSessionStatus();
      setRememberedAccount(status.rememberedAccount);

      const normalizedExpected = expectedEmail ? normalizeEmail(expectedEmail) : '';
      const normalizedCookieEmail = status.email ? normalizeEmail(status.email) : '';
      const emailMatches =
        !normalizedExpected ||
        (normalizedCookieEmail && normalizedCookieEmail === normalizedExpected);

      if (status.connected && status.expiresAt && emailMatches) {
        setWorkspaceCookieSession(status.expiresAt);
        const resolved = getWorkspaceAccessToken() || COOKIE_SESSION_SENTINEL;
        setWorkspaceToken(resolved);
        return resolved;
      }

      setWorkspaceCookieSession(null);
      return getWorkspaceAccessToken();
    } catch {
      return getWorkspaceAccessToken();
    }
  }, []);

  const hydrateUser = useCallback(
    async (firebaseUser: User, token: string | null) => {
      setUser(firebaseUser);
      if (token) {
        setWorkspaceToken(token);
      }
      try {
        const [userProfile] = await Promise.all([
          ensureUserProfile(firebaseUser),
          token ? Promise.resolve(token) : syncServerSession(firebaseUser.email),
        ]);
        setProfile(userProfile);
        setAuthError(null);
      } catch (err) {
        setAuthError(err instanceof Error ? err.message : 'Unable to load academic profile.');
      } finally {
        setLoading(false);
      }
    },
    [syncServerSession]
  );

  useEffect(() => {
    const unsubscribe = initAuthObserver((firebaseUser, token) => {
      if (firebaseUser) {
        hydrateUser(firebaseUser, token);
      } else {
        setUser(null);
        setProfile(null);
        setWorkspaceToken(null);
        void syncServerSession(null).finally(() => {
          setLoading(false);
        });
      }
    });
    return () => unsubscribe();
  }, [hydrateUser, syncServerSession]);

  // Live subscription to the signed-in user's profile so registration approval unlocks immediately
  useEffect(() => {
    if (!user?.uid) return;
    return subscribeUserProfile(user.uid, (liveProfile) => {
      setProfile(liveProfile);
    });
  }, [user?.uid]);

  const isBootstrapAdmin = Boolean(
    user?.emailVerified && normalizeEmail(user.email || '') === BOOTSTRAP_ADMIN_EMAIL
  );

  const actualRole: UserRole =
    isBootstrapAdmin || profile?.role === 'admin'
      ? 'admin'
      : profile?.role === 'instructor'
        ? 'instructor'
        : 'student';

  const actualIsAdmin = actualRole === 'admin';
  const actualIsInstructor = actualRole === 'admin' || actualRole === 'instructor';

  const needsRegistration = Boolean(user && !loading && !profile && !isBootstrapAdmin);

  const approvalStatus: ApprovalStatus = useMemo(() => {
    if (!user) return 'pending';
    if (isBootstrapAdmin || actualIsInstructor) return 'approved';
    if (!profile) return 'pending';
    // Legacy existing profiles without approvalStatus remain approved
    return profile.approvalStatus || 'approved';
  }, [user, isBootstrapAdmin, actualIsInstructor, profile]);

  const isApproved = Boolean(user && !needsRegistration && approvalStatus === 'approved');

  // Claim pre-invited course enrollments once the user's account is approved
  useEffect(() => {
    if (!user || !isApproved) return;
    let active = true;
    claimPendingEnrollments(user)
      .then((claimed) => {
        if (active && claimed > 0) {
          setClaimedCount((prev) => prev + claimed);
        }
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [user, isApproved]);

  const effectiveRole: UserRole = actualRole;
  const isAdmin = actualIsAdmin;
  const isInstructor = actualIsInstructor;

  const submitRegistration = useCallback(
    async (params: { displayName: string; department?: string; note?: string }) => {
      if (!user) throw new Error('Please sign in with Google first.');
      const created = await submitStudentRegistration(user, params);
      setProfile(created);
    },
    [user]
  );

  // Unified single-step Google + Workspace sign-in so users don't face repeated popups
  const signIn = useCallback(
    async (options?: { switchAccount?: boolean }): Promise<void> => {
      setIsSigningIn(true);
      setAuthError(null);
      try {
        const useHint = !options?.switchAccount ? rememberedAccount?.email : undefined;
        const { user: signedUser, accessToken } = await signInWithGoogleWorkspace({
          loginHint: useHint,
          forceAccountPicker: Boolean(options?.switchAccount || !useHint),
        });

        try {
          const saved = await saveWorkspaceSessionCookie(accessToken, {
            displayName: signedUser.displayName || signedUser.email?.split('@')[0] || 'Member',
            rememberDevice,
          });
          if (saved.expiresAt) {
            setWorkspaceCookieSession(saved.expiresAt);
          }
          setRememberedAccount(saved.rememberedAccount);
        } catch {
          // Non-fatal: in-memory token remains active for this tab
        }

        await hydrateUser(signedUser, accessToken);
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'Google Sign-In was canceled or failed.';
        setAuthError(message);
      } finally {
        setIsSigningIn(false);
      }
    },
    [hydrateUser, rememberDevice, rememberedAccount?.email]
  );

  const connectWorkspace = useCallback(async (): Promise<string | null> => {
    setIsSigningIn(true);
    setAuthError(null);
    try {
      const loginHint = user?.email || rememberedAccount?.email || undefined;
      const { user: signedUser, accessToken } = await signInWithGoogleWorkspace({
        loginHint,
        forceAccountPicker: !loginHint,
      });

      try {
        const saved = await saveWorkspaceSessionCookie(accessToken, {
          displayName: signedUser.displayName || profile?.displayName || undefined,
          rememberDevice,
        });
        if (saved.expiresAt) {
          setWorkspaceCookieSession(saved.expiresAt);
        }
        setRememberedAccount(saved.rememberedAccount);
      } catch {
        // Non-fatal: in-memory token remains active for this tab
      }

      await hydrateUser(signedUser, accessToken);
      return accessToken;
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : 'Google Workspace authorization was canceled or blocked.';
      setAuthError(message);
      return null;
    } finally {
      setIsSigningIn(false);
    }
  }, [hydrateUser, profile?.displayName, rememberDevice, rememberedAccount?.email, user?.email]);

  const ensureWorkspaceToken = useCallback(async (): Promise<string | null> => {
    const existing = getWorkspaceAccessToken();
    if (existing) {
      setWorkspaceToken(existing);
      return existing;
    }

    const fromCookie = await syncServerSession(user?.email);
    if (fromCookie) {
      return fromCookie;
    }

    return connectWorkspace();
  }, [connectWorkspace, syncServerSession, user?.email]);

  const signOut = useCallback(async (options?: { forgetDevice?: boolean }) => {
    await clearWorkspaceSessionCookie(Boolean(options?.forgetDevice));
    if (options?.forgetDevice) {
      setRememberedAccount(null);
    }
    await logoutUser();
    setUser(null);
    setProfile(null);
    setWorkspaceToken(null);
    setClaimedCount(0);
  }, []);

  const forgetDevice = useCallback(async () => {
    await clearWorkspaceSessionCookie(true);
    setRememberedAccount(null);
  }, []);

  const refreshProfile = useCallback(async () => {
    if (!user) return;
    const updated = await ensureUserProfile(user);
    setProfile(updated);
  }, [user]);

  const updateAccountProfile = useCallback(
    async (params: { displayName: string; photoUrl?: string | null }): Promise<UserProfile> => {
      if (!user) {
        throw new Error('Please sign in first.');
      }
      const cleanName = params.displayName.trim().slice(0, 120);
      if (!cleanName) {
        throw new Error('Display name cannot be empty.');
      }

      const updated = await updateUserAccountProfile(user.uid, {
        displayName: cleanName,
        photoUrl: params.photoUrl,
      });

      try {
        const authPhotoUpdate: { displayName: string; photoURL?: string } = {
          displayName: cleanName,
        };
        if (params.photoUrl === null) {
          authPhotoUpdate.photoURL = '';
        } else if (
          typeof params.photoUrl === 'string' &&
          params.photoUrl.startsWith('https://') &&
          params.photoUrl.length <= 1024
        ) {
          authPhotoUpdate.photoURL = params.photoUrl;
        }
        await updateProfile(user, authPhotoUpdate);
      } catch {
        // Non-fatal: Firestore UserProfile remains the source of truth
      }

      setProfile(updated);
      return updated;
    },
    [user]
  );

  return (
    <AuthContext.Provider
      value={{
        user,
        profile,
        workspaceToken,
        loading,
        isSigningIn,
        authError,
        isBootstrapAdmin,
        isAdmin,
        isInstructor,
        effectiveRole,
        actualRole,
        actualIsAdmin,
        actualIsInstructor,
        needsRegistration,
        approvalStatus,
        isApproved,
        submitRegistration,
        claimedCount,
        rememberDevice,
        setRememberDevice,
        rememberedAccount,
        signIn,
        connectWorkspace,
        ensureWorkspaceToken,
        signOut,
        forgetDevice,
        refreshProfile,
        updateAccountProfile,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
