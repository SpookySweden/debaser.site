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
  // Always the reader's own doing (they logged in with it, or looked it up), so the window opens for it here too.
  asked = true;
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

const NOT_NOW_KEY = 'debaser.lost-account.not-now.v1';

/**
 * NOT NOW, kept in this browser for the case it was said about (`said` is the stored lost account, or 'asking'
 * while there is none): the window stays away on every page and reload until that case changes, e.g. a lost
 * address turns up (review fixes, 2026-11-17: it came back on every page and sat on the login form).
 */
export function rememberNotNow(said: string): void {
  try {
    window.localStorage.setItem(NOT_NOW_KEY, said);
  } catch {
    // Nothing to keep without storage: the window still goes away for this page.
  }
  listeners.forEach((listener) => listener());
}

export function saidNotNowTo(said: string): boolean {
  try {
    return window.localStorage.getItem(NOT_NOW_KEY) === said;
  } catch {
    return false;
  }
}

/**
 * Whether the reader asked for the window on this page load: pressed the login page's one-line offer, or logged in
 * with (or looked up) an address that is waiting to come back. Only then does the window open on /account, where
 * it would otherwise sit on the login form. Not stored: a reload is a fresh page.
 */
let asked = false;

export function askedForLostAccount(): boolean {
  return asked;
}

/** The login page's one-line offer, pressed: the window opens, even after NOT NOW. */
export function askForLostAccount(): void {
  asked = true;
  try {
    window.localStorage.removeItem(NOT_NOW_KEY);
  } catch {
    // Nothing to do without storage.
  }
  listeners.forEach((listener) => listener());
}

/**
 * How many login forms are on screen (each carries a `LostAccountLine`: the account page, the STREAM page's guest
 * window). While one is, the window waits to be asked, so it never sits on a login form.
 */
let loginForms = 0;

export function loginFormShown(): boolean {
  return loginForms > 0;
}

/** A login form came on screen; the returned function says it went. */
export function showingLoginForm(): () => void {
  loginForms += 1;
  listeners.forEach((listener) => listener());
  return () => {
    loginForms -= 1;
    listeners.forEach((listener) => listener());
  };
}

/** NOT NOW on the login page puts the window back to the one-line offer. */
export function stopAskingForLostAccount(): void {
  asked = false;
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
