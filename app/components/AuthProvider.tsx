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

    /*
      Whether the session has been read once. Until it has, `status` stays `loading` and nothing
      downstream draws a guest state.
    */
    let readOnce = false;

    /*
      The account as of now, readable from a callback that was registered once.
      ============================================================================
      The subscription handler is created in this effect and the effect does not re-run, so anything it
      reads from the render closure is the value at mount - always `null`. A ref is how the handler sees
      the *current* answer without the effect having to depend on it (which would tear down and rebuild
      the Supabase subscription on every session change, and lose events in the gap).
    */
    const currentUser = { account: null as AccountUser | null };

    /*
      One answer decides, and a `null` is not it.
      ==================================================================================
      `getCurrentUser()` is the authority: it either names an account or says there is none, and it
      does so after the stored session has been read. `subscribe()` is not an authority on that
      question - `onAuthStateChange` fires *immediately* on subscribe, and the event it opens with
      (`INITIAL_SESSION`) may well carry no session because Supabase has not finished reading
      localStorage. It also fires again on `TOKEN_REFRESHED` and `USER_UPDATED`.

      So a null from the subscription used to overwrite a real account, and the guest fault flashed at
      somebody who was signed in - and kept flashing, on whichever of the two settled last. There is no
      ordering that fixes that, because the two callbacks are independent: what was missing was the
      distinction between *"there is no session"* and *"I have not looked yet"*.

      The rule below is that a null only counts once something has actually said so:
        - the read, when it lands, is final and settles the state either way;
        - the subscription is trusted to *name* an account at any time (signing in, a token refresh,
          a second tab), because a positive is never ambiguous;
        - and it is trusted to clear one only when it says somebody signed out. A bare null from a
          refresh is ignored while we are signed in, because the read already answered.
    */
    const apply = (account: AccountUser | null) => {
      if (cancelled) return;

      currentUser.account = account;
      setUser(account);
      setStatus(account === null ? 'anonymous' : 'signed-in');
    };

    void repository
      .getCurrentUser()
      .then((account) => {
        readOnce = true;
        apply(account);
      })
      .catch(() => {
        // A failed read is not a signed-out reader either, but it is all we are going to get: this
        // is the one place a null is allowed to be taken as an answer.
        readOnce = true;
        apply(null);
      });

    const unsubscribe = repository.subscribe((account) => {
      if (cancelled) return;

      // Always trust a named account: signing in, a token refresh, another tab waking up.
      if (account !== null) {
        readOnce = true;
        apply(account);
        return;
      }

      // A null before the read has landed says nothing yet, because the initial `INITIAL_SESSION`
      // event fires before the stored session is available.
      if (!readOnce) return;

      // A null after it says nothing *either*, while a session is in hand: that is a refresh or the
      // initial event arriving late, not somebody leaving. Signing out goes through `signOut` below,
      // which clears the state directly - so the only path that can mean "gone" already says so.
      if (currentUser.account !== null) return;

      apply(null);
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  /**
   * Applies what a sign-in, sign-up or account edit came back with.
   *
   * Two things this does *not* do, both on purpose:
   *
   *   1. it does not treat a null from a successful sign-up as "signed out". With email confirmation
   *      on, Supabase hands back no session until the link is followed, so a reader who has just
   *      registered would otherwise be told they are an unregistered entity - the exact fault the
   *      banner exists to complain about, shown to the person who just fixed it. The status stays
   *      `loading` in that case, because the session genuinely has not been established yet and the
   *      subscription will settle it when the link is followed in another tab.
   *   2. it does not write `user` twice for the same tick: the subscription fires for a sign-in as
   *      well, and this is the *immediate* answer so the page does not wait a round trip to stop
   *      drawing a guest state.
   */
  const applyResult = useCallback((result: AuthResult): AuthResult => {
    if (!result.ok) return result;

    if (result.user === null) {
      setStatus('loading');
      return result;
    }

    setUser(result.user);
    setStatus('signed-in');

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
