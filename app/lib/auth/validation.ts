/**
 * Credential rules, shared by the forms and both auth backends so a field can
 * never be accepted by one and rejected by the other.
 */

export const MIN_PASSWORD_LENGTH = 8;
export const MAX_DISPLAY_NAME_LENGTH = 24;

/** Deliberately permissive: the backend is the real authority on addresses. */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function validateEmail(email: string): string | undefined {
  const value = email.trim();

  if (value.length === 0) return 'ENTER AN EMAIL ADDRESS.';
  if (!EMAIL_PATTERN.test(value)) return 'THAT EMAIL ADDRESS DOES NOT LOOK RIGHT.';
  if (value.length > 254) return 'THAT EMAIL ADDRESS IS TOO LONG.';

  return undefined;
}

export function validatePassword(password: string): string | undefined {
  if (password.length === 0) return 'ENTER A PASSWORD.';
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `PASSWORD MUST BE AT LEAST ${MIN_PASSWORD_LENGTH} CHARACTERS.`;
  }
  if (password.length > 200) return 'THAT PASSWORD IS TOO LONG.';

  return undefined;
}

export function validateDisplayName(displayName: string): string | undefined {
  const value = displayName.trim();

  if (value.length === 0) return 'ENTER A DISPLAY NAME.';
  if (value.length < 2) return 'DISPLAY NAME MUST BE AT LEAST 2 CHARACTERS.';
  if (value.length > MAX_DISPLAY_NAME_LENGTH) {
    return `DISPLAY NAME MUST BE ${MAX_DISPLAY_NAME_LENGTH} CHARACTERS OR FEWER.`;
  }

  return undefined;
}

export type CredentialErrors = {
  email?: string;
  password?: string;
  displayName?: string;
  confirmPassword?: string;
  currentPassword?: string;
};

export function validateSignUp(input: {
  email: string;
  displayName: string;
  password: string;
  confirmPassword: string;
}): CredentialErrors {
  const errors: CredentialErrors = {};

  const email = validateEmail(input.email);
  if (email !== undefined) errors.email = email;

  const displayName = validateDisplayName(input.displayName);
  if (displayName !== undefined) errors.displayName = displayName;

  const password = validatePassword(input.password);
  if (password !== undefined) errors.password = password;
  else if (input.confirmPassword !== input.password) errors.confirmPassword = 'PASSWORDS DO NOT MATCH.';

  return errors;
}

/**
 * What a sign-in identifier may be.
 *
 * Signing up still wants a real address, but signing in only has to name an
 * account that already exists - the house account debaser.site signs in with
 * `ADMIN1212`, which is deliberately not an address. So: no spaces, sane length.
 */
export function validateSignInIdentifier(identifier: string): string | undefined {
  const value = identifier.trim();

  if (value.length === 0) return 'ENTER YOUR EMAIL ADDRESS OR ACCOUNT NAME.';
  if (/\s/.test(value)) return 'AN EMAIL ADDRESS OR ACCOUNT NAME CANNOT CONTAIN SPACES.';
  if (value.length > 254) return 'THAT IS TOO LONG TO BE AN EMAIL ADDRESS OR ACCOUNT NAME.';

  return undefined;
}

export function validateSignIn(input: { email: string; password: string }): CredentialErrors {
  const errors: CredentialErrors = {};

  const identifier = validateSignInIdentifier(input.email);
  if (identifier !== undefined) errors.email = identifier;

  if (input.password.length === 0) errors.password = 'ENTER YOUR PASSWORD.';

  return errors;
}

export function hasErrors(errors: CredentialErrors): boolean {
  return Object.values(errors).some((message) => message !== undefined);
}

/** Changing the address the account signs in with. */
export function validateEmailChange(input: { email: string; currentPassword: string }): CredentialErrors {
  const errors: CredentialErrors = {};

  const email = validateEmail(input.email);
  if (email !== undefined) errors.email = email;
  if (input.currentPassword.length === 0) errors.currentPassword = 'ENTER YOUR CURRENT PASSWORD.';

  return errors;
}

/** Changing the password: the new one has to be confirmed and actually new. */
export function validatePasswordChange(input: {
  currentPassword: string;
  password: string;
  confirmPassword: string;
}): CredentialErrors {
  const errors: CredentialErrors = {};

  if (input.currentPassword.length === 0) errors.currentPassword = 'ENTER YOUR CURRENT PASSWORD.';

  const password = validatePassword(input.password);
  if (password !== undefined) errors.password = password;
  else if (input.confirmPassword !== input.password) errors.confirmPassword = 'NEW PASSWORDS DO NOT MATCH.';
  else if (input.password === input.currentPassword) {
    errors.password = 'THE NEW PASSWORD MUST BE DIFFERENT FROM THE CURRENT ONE.';
  }

  return errors;
}
