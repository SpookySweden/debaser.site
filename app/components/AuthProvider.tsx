'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  AUTH_BACKEND,
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
  signUp: (input: SignUpInput) => Promise<AuthResult>;
  signIn: (input: SignInInput) => Promise<AuthResult>;
  signOut: () => Promise<void>;
  updateDisplayName: (displayName: string) => Promise<AuthResult>;
  /** Edit the account itself: the address and the password it signs in with. */
  updateEmail: (input: UpdateEmailInput) => Promise<AuthResult>;
  updatePassword: (input: UpdatePasswordInput) => Promise<AuthResult>;
  deleteAccount: () => Promise<AuthResult>;
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

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      status,
      backend: AUTH_BACKEND,
      usingMockAuth: USING_MOCK_AUTH,
      requiresEmailConfirmation: REQUIRES_EMAIL_CONFIRMATION,
      signUp,
      signIn,
      signOut,
      updateDisplayName,
      updateEmail,
      updatePassword,
      deleteAccount,
    }),
    [user, status, signUp, signIn, signOut, updateDisplayName, updateEmail, updatePassword, deleteAccount],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (value === null) throw new Error('useAuth must be used inside <AuthProvider>.');
  return value;
}
