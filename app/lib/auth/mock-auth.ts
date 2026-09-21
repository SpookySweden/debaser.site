import { createLocalId } from '../forum/ids';
import {
  SITE_ACCOUNT_ADDRESS,
  SITE_ACCOUNT_DISPLAY_NAME,
  SITE_ACCOUNT_ID,
  SITE_ACCOUNT_PASSWORD,
  resolveSignInAddress,
} from './builtin-account';
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
  normaliseEmail,
  validateDisplayName,
  validateEmailChange,
  validatePasswordChange,
  validateSignIn,
  validateSignUp,
} from './validation';
import type { CredentialErrors } from './validation';

/**
 * Mock auth backend: accounts live in this browser only.
 *
 * It exists so the account screens, the session plumbing and the forum's author
 * attribution can be built and tested before Supabase Auth is switched on.
 *
 * NOT SECURITY. Passwords are salted and hashed so nothing is stored in plain
 * text, but everything sits in localStorage: anyone with access to this browser
 * owns these accounts. Switch to the Supabase backend for real accounts.
 */

const STORAGE_KEY = 'debaser.auth.mock.v1';

type StoredUser = {
  id: string;
  email: string;
  displayName: string;
  createdAt: string;
  salt: string;
  secretHash: string;
  /** True for the house account, which the archive owner signs into. */
  builtIn?: boolean;
};

type PersistedAuth = {
  users: StoredUser[];
  sessionUserId: string | null;
};

type Listener = (user: AccountUser | null) => void;

let state: PersistedAuth | null = null;
const listeners = new Set<Listener>();

function hasStorage(): boolean {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

function isStoredUser(value: unknown): value is StoredUser {
  if (typeof value !== 'object' || value === null) return false;
  const row = value as Partial<StoredUser>;

  return (
    typeof row.id === 'string' &&
    typeof row.email === 'string' &&
    typeof row.displayName === 'string' &&
    typeof row.createdAt === 'string' &&
    typeof row.salt === 'string' &&
    typeof row.secretHash === 'string'
  );
}

function readState(): PersistedAuth {
  if (state !== null) return state;

  const empty: PersistedAuth = { users: [], sessionUserId: null };

  if (!hasStorage()) {
    state = empty;
    return state;
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === null || raw.length === 0) {
      state = empty;
      return state;
    }

    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) {
      state = empty;
      return state;
    }

    const candidate = parsed as Partial<PersistedAuth>;
    state = {
      users: Array.isArray(candidate.users) ? candidate.users.filter(isStoredUser) : [],
      sessionUserId: typeof candidate.sessionUserId === 'string' ? candidate.sessionUserId : null,
    };

    return state;
  } catch {
    state = empty;
    return state;
  }
}

function writeState(next: PersistedAuth): void {
  state = next;

  if (!hasStorage()) return;

  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Storage disabled: the session still works for this tab.
  }
}

function toAccount(user: StoredUser): AccountUser {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    createdAt: user.createdAt,
    backend: 'mock',
  };
}

function currentAccount(): AccountUser | null {
  const current = readState();
  const user = current.users.find((item) => item.id === current.sessionUserId);

  return user === undefined ? null : toAccount(user);
}

function notify(): void {
  const account = currentAccount();
  for (const listener of listeners) listener(account);
}

/** First message in form order, so the UI always reports the topmost problem. */
function firstError(errors: CredentialErrors): string {
  return (
    errors.email ??
    errors.displayName ??
    errors.password ??
    errors.confirmPassword ??
    'SOMETHING WENT WRONG.'
  );
}

async function hashSecret(secret: string, salt: string): Promise<string> {
  const encoder = new TextEncoder();
  const subtle = globalThis.crypto?.subtle;

  if (subtle !== undefined) {
    const digest = await subtle.digest('SHA-256', encoder.encode(`${salt}|${secret}`));
    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  }

  // Non-secure context fallback: still not plain text, still not real security.
  let hash = 5381;
  for (const byte of encoder.encode(`${salt}|${secret}`)) hash = (hash * 33) ^ byte;
  return `fallback:${(hash >>> 0).toString(16)}`;
}

/**
 * The house account, planted once per session (see ./builtin-account.ts).
 *
 * Storing a password means hashing it, which is async, so this runs on the way
 * into the first async call instead of at import time. It only ever *adds* an
 * account that is not already there: a browser that has signed in before keeps
 * whatever it has, and a house account somebody has deleted stays deleted.
 */
let builtInAccount: Promise<void> | null = null;

async function seedBuiltInAccount(): Promise<void> {
  const current = readState();
  if (current.users.some((user) => user.id === SITE_ACCOUNT_ID)) return;

  const salt = createLocalId('salt');
  const user: StoredUser = {
    id: SITE_ACCOUNT_ID,
    // The store keeps addresses lower-cased, so ADMIN1212 and
    // admin1212@debaser.site both find this row (see resolveSignInAddress).
    email: normaliseEmail(SITE_ACCOUNT_ADDRESS),
    displayName: SITE_ACCOUNT_DISPLAY_NAME,
    createdAt: new Date().toISOString(),
    salt,
    secretHash: await hashSecret(SITE_ACCOUNT_PASSWORD, salt),
    builtIn: true,
  };

  writeState({ ...current, users: [user, ...current.users] });
}

function ensureBuiltInAccount(): Promise<void> {
  builtInAccount ??= seedBuiltInAccount();
  return builtInAccount;
}

class MockAuthRepository implements AuthRepository {
  readonly backend = 'mock' as const;
  readonly requiresEmailConfirmation = false;

  async getCurrentUser(): Promise<AccountUser | null> {
    await ensureBuiltInAccount();
    return currentAccount();
  }

  async signUp(input: SignUpInput): Promise<AuthResult> {
    await ensureBuiltInAccount();
    const errors = validateSignUp(input);
    if (hasErrors(errors)) return { ok: false, error: firstError(errors) };

    const email = normaliseEmail(input.email);
    const current = readState();

    if (current.users.some((item) => item.email === email)) {
      return { ok: false, error: 'AN ACCOUNT ALREADY EXISTS FOR THAT EMAIL ADDRESS.' };
    }

    const salt = createLocalId('salt');
    const user: StoredUser = {
      id: createLocalId('mock-user'),
      email,
      displayName: input.displayName.trim(),
      createdAt: new Date().toISOString(),
      salt,
      secretHash: await hashSecret(input.password, salt),
    };

    writeState({ users: [...current.users, user], sessionUserId: user.id });
    notify();

    return { ok: true, user: toAccount(user) };
  }

  async signIn(input: SignInInput): Promise<AuthResult> {
    await ensureBuiltInAccount();
    const errors = validateSignIn(input);
    if (hasErrors(errors)) return { ok: false, error: firstError(errors) };

    const email = normaliseEmail(resolveSignInAddress(input.email));
    const current = readState();
    const user = current.users.find((item) => item.email === email);

    if (user === undefined) return { ok: false, error: 'NO ACCOUNT FOUND FOR THAT EMAIL ADDRESS.' };

    const secretHash = await hashSecret(input.password, user.salt);
    if (secretHash !== user.secretHash) return { ok: false, error: 'THAT PASSWORD IS NOT CORRECT.' };

    writeState({ ...current, sessionUserId: user.id });
    notify();

    return { ok: true, user: toAccount(user) };
  }

  async signOut(): Promise<void> {
    writeState({ ...readState(), sessionUserId: null });
    notify();
  }

  async updateEmail(input: UpdateEmailInput): Promise<AuthResult> {
    await ensureBuiltInAccount();
    const errors = validateEmailChange(input);
    if (hasErrors(errors)) return { ok: false, error: firstError(errors) };

    const current = readState();
    const user = current.users.find((item) => item.id === current.sessionUserId);
    if (user === undefined) return { ok: false, error: 'SIGN IN FIRST.' };

    const secretHash = await hashSecret(input.currentPassword, user.salt);
    if (secretHash !== user.secretHash) return { ok: false, error: 'THAT PASSWORD IS NOT CORRECT.' };

    const email = normaliseEmail(input.email);
    if (email === user.email) return { ok: false, error: 'THAT IS ALREADY THE EMAIL ADDRESS ON THIS ACCOUNT.' };

    if (current.users.some((item) => item.email === email && item.id !== user.id)) {
      return { ok: false, error: 'AN ACCOUNT ALREADY EXISTS FOR THAT EMAIL ADDRESS.' };
    }

    const updated: StoredUser = { ...user, email };
    writeState({
      ...current,
      users: current.users.map((item) => (item.id === user.id ? updated : item)),
    });
    notify();

    return { ok: true, user: toAccount(updated) };
  }

  async updatePassword(input: UpdatePasswordInput): Promise<AuthResult> {
    await ensureBuiltInAccount();
    const errors = validatePasswordChange(input);
    if (hasErrors(errors)) return { ok: false, error: firstError(errors) };

    const current = readState();
    const user = current.users.find((item) => item.id === current.sessionUserId);
    if (user === undefined) return { ok: false, error: 'SIGN IN FIRST.' };

    const secretHash = await hashSecret(input.currentPassword, user.salt);
    if (secretHash !== user.secretHash) return { ok: false, error: 'THAT PASSWORD IS NOT CORRECT.' };

    const salt = createLocalId('salt');
    const updated: StoredUser = { ...user, salt, secretHash: await hashSecret(input.password, salt) };
    writeState({
      ...current,
      users: current.users.map((item) => (item.id === user.id ? updated : item)),
    });
    notify();

    return { ok: true, user: toAccount(updated) };
  }

  async updateDisplayName(displayName: string): Promise<AuthResult> {
    await ensureBuiltInAccount();
    const problem = validateDisplayName(displayName);
    if (problem !== undefined) return { ok: false, error: problem };

    const current = readState();
    const user = current.users.find((item) => item.id === current.sessionUserId);
    if (user === undefined) return { ok: false, error: 'SIGN IN FIRST.' };

    const updated: StoredUser = { ...user, displayName: displayName.trim() };
    writeState({
      ...current,
      users: current.users.map((item) => (item.id === user.id ? updated : item)),
    });
    notify();

    return { ok: true, user: toAccount(updated) };
  }

  async deleteAccount(): Promise<AuthResult> {
    await ensureBuiltInAccount();
    const current = readState();
    if (current.sessionUserId === null) return { ok: false, error: 'SIGN IN FIRST.' };

    const user = current.users.find((item) => item.id === current.sessionUserId);
    // The house account is the archive's own byline: it signs in, it is not deleted.
    if (user !== undefined && user.builtIn === true) {
      return { ok: false, error: 'THE HOUSE ACCOUNT CANNOT BE DELETED - IT SIGNS THE ARCHIVE ITSELF.' };
    }

    writeState({
      users: current.users.filter((item) => item.id !== current.sessionUserId),
      sessionUserId: null,
    });
    notify();

    return { ok: true, user: null };
  }

  /** Every account this browser holds, so comms can offer somebody to write to. */
  async listAccounts(): Promise<AccountUser[]> {
    await ensureBuiltInAccount();

    return readState()
      .users.map(toAccount)
      .sort((a, b) => a.displayName.localeCompare(b.displayName) || a.id.localeCompare(b.id));
  }

  subscribe(listener: Listener): () => void {
    listeners.add(listener);

    return () => {
      listeners.delete(listener);
    };
  }
}

let mockAuthRepository: MockAuthRepository | null = null;

export function getMockAuthRepository(): AuthRepository {
  if (mockAuthRepository === null) mockAuthRepository = new MockAuthRepository();
  return mockAuthRepository;
}

/**
 * Wipes every account this browser holds (used by the account page's reset).
 *
 * The house account is re-planted straight away rather than on the next visit to
 * the site: without it nobody could sign in again until a reload, and the board's
 * item-owned posts would lose the account behind their byline.
 */
export function resetMockAuth(): void {
  writeState({ users: [], sessionUserId: null });
  builtInAccount = null;
  void ensureBuiltInAccount();
  notify();
}
