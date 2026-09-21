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
  subscribe(listener: (user: AccountUser | null) => void): () => void;
};
