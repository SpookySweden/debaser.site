/**
 * Somebody who was logged in when the accounts were lost (2026-11-06, about 21:11 UTC). Their browser still holds a session for an
 * account that's gone, and supabase-js wipes that the moment it fails to refresh, taking the only record of who they were with it. So
 * before the client starts, the address and name are moved aside and the dead session removed, and `LostAccountWindow` asks them for a
 * new password. Signing up with that address brings their details and old posts back (`restore_lost_account` in the database).
 * Only the address and name are kept, never a token.
 */

export const LOST_ACCOUNT_KEY = 'debaser.lost-account.v1';

/** The last moment an account could be from before the loss: anything later is a live account. */
const LOST_AT = Date.parse('2026-11-06T21:11:36Z');

export type LostAccount = { email: string; name: string };

type StoredUser = { email?: unknown; created_at?: unknown; is_anonymous?: unknown; user_metadata?: { display_name?: unknown } | null };

/** What a stored session says about a lost account, or null when it's somebody else's business. Pure. */
export function lostAccountFrom(stored: string | null): LostAccount | null {
  if (stored === null) return null;
  try {
    const user = (JSON.parse(stored) as { user?: StoredUser | null } | null)?.user;
    if (typeof user?.email !== 'string' || user.email.length === 0 || user.is_anonymous === true) return null;
    const made = typeof user.created_at === 'string' ? Date.parse(user.created_at) : NaN;
    if (!(made < LOST_AT)) return null;
    const said = user.user_metadata?.display_name;
    return { email: user.email, name: typeof said === 'string' && said.trim().length > 0 ? said.trim() : user.email.split('@')[0] };
  } catch {
    return null;
  }
}

/** Runs before the Supabase client exists. Never throws: a browser with no storage just has nothing to move. */
export function parkLostSession(sessionKey: string): void {
  try {
    const lost = lostAccountFrom(window.localStorage.getItem(sessionKey));
    if (lost === null) return;
    window.localStorage.setItem(LOST_ACCOUNT_KEY, JSON.stringify(lost));
    window.localStorage.removeItem(sessionKey);
  } catch {
    // Nothing to do without storage.
  }
}

const listeners = new Set<() => void>();

export function subscribeToLostAccount(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Somebody logged in with an address that's waiting to come back: the window opens for it. */
export function rememberLostAccount(lost: LostAccount): void {
  try {
    window.localStorage.setItem(LOST_ACCOUNT_KEY, JSON.stringify(lost));
  } catch {
    // Nothing to do without storage.
  }
  listeners.forEach((listener) => listener());
}

export function readLostAccountRaw(): string | null {
  try {
    return window.localStorage.getItem(LOST_ACCOUNT_KEY);
  } catch {
    return null;
  }
}

export function parseLostAccount(raw: string | null): LostAccount | null {
  if (raw === null) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<LostAccount> | null;
    return typeof parsed?.email === 'string' && typeof parsed.name === 'string' ? { email: parsed.email, name: parsed.name } : null;
  } catch {
    return null;
  }
}

const NEVER_HAD_ONE_KEY = 'debaser.lost-account.never.v1';

/** This browser said it never had an account here, so it isn't asked again. */
export function saidNeverHadOne(): boolean {
  try {
    return window.localStorage.getItem(NEVER_HAD_ONE_KEY) !== null;
  } catch {
    return true;
  }
}

export function rememberNeverHadOne(): void {
  try {
    window.localStorage.setItem(NEVER_HAD_ONE_KEY, '1');
  } catch {
    // Nothing to do without storage.
  }
  listeners.forEach((listener) => listener());
}

export function forgetLostAccount(): void {
  try {
    window.localStorage.removeItem(LOST_ACCOUNT_KEY);
  } catch {
    // Nothing to do without storage.
  }
  listeners.forEach((listener) => listener());
}
