/**
 * Account types.
 *
 * The auth layer is described the same way the forum's storage layer is: one
 * interface, a mock implementation that works today, and a Supabase
 * implementation that drops in once Auth is switched on (see
 * `app/lib/auth/auth-repository.ts`).
 */

export type AuthBackend = 'mock' | 'supabase';

/** Who is signed in, as the rest of the app sees them. */
export type AccountUser = {
  /** `auth.users.id` with Supabase; a local id while the mock backend is on. */
  id: string;
  email: string;
  displayName: string;
  createdAt: string;
  backend: AuthBackend;
  /**
   * True while the house account has this account banned (see the ban methods
   * below). A banned account still signs in and still reads, but every write it
   * makes is refused, and what it already wrote stops being shown to anybody but
   * the admin - so this flag is how the directory says why a name went quiet.
   */
  banned?: boolean;
};

export type SignUpInput = {
  email: string;
  displayName: string;
  password: string;
  confirmPassword: string;
};

export type SignInInput = {
  email: string;
  password: string;
};

export type UpdateEmailInput = {
  email: string;
  /** The current password, asked for again before an address change. */
  currentPassword: string;
};

export type UpdatePasswordInput = {
  currentPassword: string;
  password: string;
  confirmPassword: string;
};

export type AuthFailure = {
  ok: false;
  /** Uppercase, Win95-flavoured message ready for display. */
  error: string;
};

export type AuthSuccess = {
  ok: true;
  user: AccountUser | null;
  /** True when Supabase needs the address confirmed before the first sign-in. */
  confirmationRequired?: boolean;
};

export type AuthResult = AuthSuccess | AuthFailure;

export type AuthRepository = {
  readonly backend: AuthBackend;
  /** True when the backend emails a confirmation link before allowing sign-in. */
  readonly requiresEmailConfirmation: boolean;
  getCurrentUser(): Promise<AccountUser | null>;
  signUp(input: SignUpInput): Promise<AuthResult>;
  signIn(input: SignInInput): Promise<AuthResult>;
  signOut(): Promise<void>;
  updateDisplayName(displayName: string): Promise<AuthResult>;
  /** Changes the address the account signs in with. */
  updateEmail(input: UpdateEmailInput): Promise<AuthResult>;
  /** Changes the password, proving the current one first. */
  updatePassword(input: UpdatePasswordInput): Promise<AuthResult>;
  /** Mock only: wipe the local account. Supabase accounts are removed in the dashboard. */
  deleteAccount?(): Promise<AuthResult>;
  /**
   * Sign in with a Google account.
   *
   * Supabase only, and it leaves the page: the browser is sent to Google and comes
   * back to the account page, where the session arrives through `subscribe` rather
   * than through the promise. The mock backend has no OAuth to offer, so it says so
   * instead of pretending - which is what makes the button honest today and live
   * the moment `NEXT_PUBLIC_AUTH_BACKEND=supabase` (with Google enabled in the
   * Supabase dashboard) is set.
   */
  signInWithGoogle?(): Promise<AuthResult>;
  /**
   * The accounts this browser can see, which is what the comms "new message"
   * picker offers. Supabase answers with `select id, display_name from profiles`
   * (a public read: the board already shows these names on every post).
   */
  listAccounts?(): Promise<AccountUser[]>;
  /**
   * Banning an account, for the house account only.
   *
   * A ban is written onto the profile row (`banned_at`, `banned_reason`, `banned_by`)
   * and enforced by Row Level Security, not by this code: the account keeps reading,
   * loses every write - posts, replies, profile edits, tags, comments, messages and
   * picture uploads - and what it already filed stops being shown to anybody but the
   * admin (supabase/schema.sql, section 12). The database refuses the write outright
   * if anybody but the house account tries it.
   */
  banAccount?(userId: string, reason: string): Promise<void>;
  unbanAccount?(userId: string): Promise<void>;
  /** Every banned account id, so the board and the directory can mark them. */
  listBannedAccountIds?(): Promise<string[]>;
  subscribe(listener: (user: AccountUser | null) => void): () => void;
};
