'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  AUTH_BACKEND,
  GOOGLE_SIGN_IN_AVAILABLE,
  REQUIRES_EMAIL_CONFIRMATION,
  USING_MOCK_AUTH,
  getAuthRepository,
} from '../lib/auth/auth-repository';
import type {
  AccountUser,
  AuthBackend,
  AuthRepository,
  AuthResult,
  SignInInput,
  SignUpInput,
  UpdateEmailInput,
  UpdatePasswordInput,
} from '../lib/auth/types';

export type AuthStatus = 'loading' | 'signed-in' | 'anonymous';

export type AuthContextValue = {
  user: AccountUser | null;
  status: AuthStatus;
  backend: AuthBackend;
  usingMockAuth: boolean;
  requiresEmailConfirmation: boolean;
  /** False while the backend cannot do OAuth, which is the mock's whole story. */
  googleSignInAvailable: boolean;
  /** Sends the browser to Google; the session lands through the subscription. */
  signInWithGoogle: () => Promise<AuthResult>;
  signUp: (input: SignUpInput) => Promise<AuthResult>;
  signIn: (input: SignInInput) => Promise<AuthResult>;
  signOut: () => Promise<void>;
  updateDisplayName: (displayName: string) => Promise<AuthResult>;
  /** Edit the account itself: the address and the password it signs in with. */
  updateEmail: (input: UpdateEmailInput) => Promise<AuthResult>;
  updatePassword: (input: UpdatePasswordInput) => Promise<AuthResult>;
  deleteAccount: () => Promise<AuthResult>;
  /**
   * Banning an account, for the house account.
   *
   * A ban stops that account writing anywhere and hides what it already wrote - for
   * everybody but the admin (supabase/schema.sql, section 12). Both calls are
   * ordinary writes as far as this context is concerned: the database refuses them
   * for anybody but the admin, so the controls being hidden is a courtesy, not the
   * rule. They throw with the database's own complaint, which is what the board
   * shows.
   */
  banAccount: (userId: string, reason: string) => Promise<void>;
  unbanAccount: (userId: string) => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

/**
 * Account state for the whole site.
 *
 * Mounted in `app/layout.tsx` above the forum provider, so a signed-in visitor
 * files posts and comments under their account (the forum's author fields take
 * `user.id`, which is `auth.users.id` once the Supabase backend is on) and the
 * account page can manage the session.
 */
export default function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AccountUser | null>(null);
  const [status, setStatus] = useState<AuthStatus>('loading');
  const repositoryRef = useRef<AuthRepository | null>(null);

  useEffect(() => {
    const repository = getAuthRepository();
    repositoryRef.current = repository;
    let cancelled = false;

    const apply = (account: AccountUser | null) => {
      if (cancelled) return;
      setUser(account);
      setStatus(account === null ? 'anonymous' : 'signed-in');
    };

    void repository
      .getCurrentUser()
      .then(apply)
      .catch(() => apply(null));

    const unsubscribe = repository.subscribe(apply);

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  const applyResult = useCallback((result: AuthResult): AuthResult => {
    if (result.ok) {
      setUser(result.user);
      setStatus(result.user === null ? 'anonymous' : 'signed-in');
    }

    return result;
  }, []);

  const signUp = useCallback(
    async (input: SignUpInput) => applyResult(await (repositoryRef.current ?? getAuthRepository()).signUp(input)),
    [applyResult],
  );

  const signIn = useCallback(
    async (input: SignInInput) => applyResult(await (repositoryRef.current ?? getAuthRepository()).signIn(input)),
    [applyResult],
  );

  const signOut = useCallback(async () => {
    await (repositoryRef.current ?? getAuthRepository()).signOut();
    setUser(null);
    setStatus('anonymous');
  }, []);

  /**
   * Google sign-in.
   *
   * The result is applied like any other, but on Supabase there is no user in it:
   * the visitor has been sent to Google, and the session arrives through the
   * subscription above when they come back to /account. The mock backend has no
   * OAuth and returns the message the button shows.
   */
  const signInWithGoogle = useCallback(async (): Promise<AuthResult> => {
    const repository = repositoryRef.current ?? getAuthRepository();

    if (repository.signInWithGoogle === undefined) {
      return { ok: false, error: 'THIS BACKEND CANNOT SIGN IN WITH GOOGLE.' };
    }

    return applyResult(await repository.signInWithGoogle());
  }, [applyResult]);

  const updateDisplayName = useCallback(
    async (displayName: string) =>
      applyResult(await (repositoryRef.current ?? getAuthRepository()).updateDisplayName(displayName)),
    [applyResult],
  );

  const updateEmail = useCallback(
    async (input: UpdateEmailInput) =>
      applyResult(await (repositoryRef.current ?? getAuthRepository()).updateEmail(input)),
    [applyResult],
  );

  const updatePassword = useCallback(
    async (input: UpdatePasswordInput) =>
      applyResult(await (repositoryRef.current ?? getAuthRepository()).updatePassword(input)),
    [applyResult],
  );

  const deleteAccount = useCallback(async (): Promise<AuthResult> => {
    const repository = repositoryRef.current ?? getAuthRepository();

    if (repository.deleteAccount === undefined) {
      return { ok: false, error: 'DELETE ACCOUNTS FROM THE SUPABASE DASHBOARD WHILE ON THAT BACKEND.' };
    }

    const result = await repository.deleteAccount();
    if (result.ok) {
      setUser(null);
      setStatus('anonymous');
    }

    return result;
  }, []);

  const banAccount = useCallback(async (userId: string, reason: string) => {
    const repository = repositoryRef.current ?? getAuthRepository();

    if (repository.banAccount === undefined) throw new Error('THIS BACKEND CANNOT BAN AN ACCOUNT.');

    await repository.banAccount(userId, reason);
  }, []);

  const unbanAccount = useCallback(async (userId: string) => {
    const repository = repositoryRef.current ?? getAuthRepository();

    if (repository.unbanAccount === undefined) throw new Error('THIS BACKEND CANNOT LIFT A BAN.');

    await repository.unbanAccount(userId);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      status,
      backend: AUTH_BACKEND,
      usingMockAuth: USING_MOCK_AUTH,
      requiresEmailConfirmation: REQUIRES_EMAIL_CONFIRMATION,
      googleSignInAvailable: GOOGLE_SIGN_IN_AVAILABLE,
      signInWithGoogle,
      signUp,
      signIn,
      signOut,
      updateDisplayName,
      updateEmail,
      updatePassword,
      deleteAccount,
      banAccount,
      unbanAccount,
    }),
    [
      user,
      status,
      signInWithGoogle,
      signUp,
      signIn,
      signOut,
      updateDisplayName,
      updateEmail,
      updatePassword,
      deleteAccount,
      banAccount,
      unbanAccount,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (value === null) throw new Error('useAuth must be used inside <AuthProvider>.');
  return value;
}
