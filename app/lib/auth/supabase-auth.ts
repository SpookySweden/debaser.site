import { getSupabaseBrowserClient } from '../supabase/client';
import { resolveSignInAddress } from './builtin-account';
import type {
  AccountUser,
  AuthRepository,
  AuthResult,
  SignInInput,
  SignUpInput,
  UpdateEmailInput,
  UpdatePasswordInput,
} from './types';
import {
  hasErrors,
  validateDisplayName,
  validateEmailChange,
  validatePasswordChange,
  validateSignIn,
  validateSignUp,
} from './validation';
import type { CredentialErrors } from './validation';

/**
 * Supabase auth backend: real accounts, real sessions.
 *
 * Dormant until `NEXT_PUBLIC_AUTH_BACKEND=supabase` is set (see
 * ./auth-repository.ts). Display names live in `user_metadata.display_name`,
 * which needs no extra table; if you later want richer profiles, add:
 *
 *   create table public.profiles (
 *     id uuid primary key references auth.users (id) on delete cascade,
 *     display_name text not null default 'Anonymous',
 *     created_at timestamptz not null default now()
 *   );
 *   alter table public.profiles enable row level security;
 *   create policy "profiles readable" on public.profiles for select using (true);
 *   create policy "profiles writable by owner" on public.profiles
 *     for all using (auth.uid() = id) with check (auth.uid() = id);
 *
 * Threads and comments already store `author_id`, so rows filed while signed in
 * attach to `auth.users.id` with no schema change.
 */

type SupabaseUserLike = {
  id: string;
  email?: string | null;
  created_at?: string;
  user_metadata?: Record<string, unknown> | null;
};

function toAccount(user: SupabaseUserLike): AccountUser {
  const metadata = user.user_metadata ?? {};
  const displayName = typeof metadata.display_name === 'string' ? metadata.display_name : '';

  return {
    id: user.id,
    email: user.email ?? '',
    displayName: displayName.length > 0 ? displayName : (user.email ?? 'Anonymous'),
    createdAt: user.created_at ?? new Date().toISOString(),
    backend: 'supabase',
  };
}

function firstError(errors: CredentialErrors): string {
  return errors.email ?? errors.displayName ?? errors.password ?? errors.confirmPassword ?? 'SOMETHING WENT WRONG.';
}

class SupabaseAuthRepository implements AuthRepository {
  readonly backend = 'supabase' as const;
  readonly requiresEmailConfirmation = true;

  private client() {
    const client = getSupabaseBrowserClient();

    if (client === null) {
      throw new Error('Supabase is not configured: set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.');
    }

    return client;
  }

  async getCurrentUser(): Promise<AccountUser | null> {
    const { data, error } = await this.client().auth.getUser();
    if (error !== null || data.user === null) return null;

    return toAccount(data.user);
  }

  async signUp(input: SignUpInput): Promise<AuthResult> {
    const errors = validateSignUp(input);
    if (hasErrors(errors)) return { ok: false, error: firstError(errors) };

    const { data, error } = await this.client().auth.signUp({
      email: input.email.trim(),
      password: input.password,
      options: { data: { display_name: input.displayName.trim() } },
    });

    if (error !== null) return { ok: false, error: error.message.toUpperCase() };

    // With email confirmation on, signUp returns no session until the link is used.
    if (data.session === null) {
      return { ok: true, user: null, confirmationRequired: true };
    }

    return { ok: true, user: data.user === null ? null : toAccount(data.user) };
  }

  async signIn(input: SignInInput): Promise<AuthResult> {
    const errors = validateSignIn(input);
    if (hasErrors(errors)) return { ok: false, error: firstError(errors) };

    const { data, error } = await this.client().auth.signInWithPassword({
      // The house account is signed into with ADMIN1212 rather than with its
      // address, so the identifier is resolved before Supabase sees it.
      email: resolveSignInAddress(input.email),
      password: input.password,
    });

    if (error !== null) return { ok: false, error: error.message.toUpperCase() };

    return { ok: true, user: data.user === null ? null : toAccount(data.user) };
  }

  async signOut(): Promise<void> {
    await this.client().auth.signOut();
  }

  /**
   * Google sign-in.
   *
   * Supabase owns the whole exchange - it sends the browser to Google and brings it
   * back to /account with a session in the URL - so this only starts it. The
   * session itself lands through `onAuthStateChange`, which `subscribe` already
   * wires to the auth provider, so nothing has to await the round trip.
   *
   * Setup (Supabase dashboard): Authentication -> Providers -> Google, with the
   * client id and secret from Google Cloud, and this site's /account added to the
   * allowed redirect URLs.
   */
  async signInWithGoogle(): Promise<AuthResult> {
    const { error } = await this.client().auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/account`,
        queryParams: { prompt: 'select_account' },
      },
    });

    if (error !== null) return { ok: false, error: error.message.toUpperCase() };

    // ok with no user yet: the visitor is on their way to Google.
    return { ok: true, user: null };
  }

  async updateDisplayName(displayName: string): Promise<AuthResult> {
    const problem = validateDisplayName(displayName);
    if (problem !== undefined) return { ok: false, error: problem };

    const { data, error } = await this.client().auth.updateUser({
      data: { display_name: displayName.trim() },
    });

    if (error !== null) return { ok: false, error: error.message.toUpperCase() };
    if (data.user === null) return { ok: false, error: 'NO SIGNED IN USER TO UPDATE.' };

    return { ok: true, user: toAccount(data.user) };
  }

  /**
   * Supabase wants a recent sign-in before an address change, so the current
   * password is proven first and then `updateUser({ email })` sends the
   * confirmation link to the new address.
   */
  async updateEmail(input: UpdateEmailInput): Promise<AuthResult> {
    const errors = validateEmailChange(input);
    if (hasErrors(errors)) return { ok: false, error: errors.email ?? errors.currentPassword ?? 'CHECK THE FORM.' };

    const client = this.client();
    const { data: current } = await client.auth.getUser();
    const currentEmail = current.user?.email;

    if (current.user === null || currentEmail === undefined || currentEmail === null) {
      return { ok: false, error: 'SIGN IN FIRST.' };
    }

    const check = await client.auth.signInWithPassword({ email: currentEmail, password: input.currentPassword });
    if (check.error !== null) return { ok: false, error: 'THAT PASSWORD IS NOT CORRECT.' };

    const { data, error } = await client.auth.updateUser({ email: input.email.trim() });
    if (error !== null) return { ok: false, error: error.message.toUpperCase() };

    return {
      ok: true,
      user: data.user === null ? null : toAccount(data.user),
      confirmationRequired: true,
    };
  }

  /** The password change proves the current password the same way. */
  async updatePassword(input: UpdatePasswordInput): Promise<AuthResult> {
    const errors = validatePasswordChange(input);
    if (hasErrors(errors)) return { ok: false, error: errors.password ?? errors.currentPassword ?? 'CHECK THE FORM.' };

    const client = this.client();
    const { data: current } = await client.auth.getUser();
    const currentEmail = current.user?.email;

    if (current.user === null || currentEmail === undefined || currentEmail === null) {
      return { ok: false, error: 'SIGN IN FIRST.' };
    }

    const check = await client.auth.signInWithPassword({ email: currentEmail, password: input.currentPassword });
    if (check.error !== null) return { ok: false, error: 'THAT PASSWORD IS NOT CORRECT.' };

    const { data, error } = await client.auth.updateUser({ password: input.password });
    if (error !== null) return { ok: false, error: error.message.toUpperCase() };
    if (data.user === null) return { ok: false, error: 'NO SIGNED IN USER TO UPDATE.' };

    return { ok: true, user: toAccount(data.user) };
  }

  /** Supabase-owned accounts are removed from the dashboard, not from here. */
  subscribe(listener: (user: AccountUser | null) => void): () => void {
    const { data } = this.client().auth.onAuthStateChange((_event, session) => {
      listener(session?.user === undefined || session?.user === null ? null : toAccount(session.user));
    });

    return () => {
      data.subscription.unsubscribe();
    };
  }
}

let supabaseAuthRepository: SupabaseAuthRepository | null = null;

export function getSupabaseAuthRepository(): AuthRepository {
  if (supabaseAuthRepository === null) supabaseAuthRepository = new SupabaseAuthRepository();
  return supabaseAuthRepository;
}
