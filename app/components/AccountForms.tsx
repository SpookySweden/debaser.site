'use client';

import { useState } from 'react';
import { MIN_PASSWORD_LENGTH, hasErrors, validateSignIn, validateSignUp } from '../lib/auth/validation';
import type { CredentialErrors } from '../lib/auth/validation';
import { FIELD, PLATE_LARGE } from '../lib/ui/controls';
import { useAuth } from './AuthProvider';
import GoogleSignInButton from './GoogleSignInButton';

type FieldProps = {
  id: string;
  label: string;
  type: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  autoComplete: string;
  error: string | undefined;
};

function Field({ id, label, type, value, onChange, placeholder, autoComplete, error }: FieldProps) {
  return (
    <div className="mt-2">
      <label htmlFor={id} className="block text-[10px] font-bold text-ink">
        {label}
      </label>
      <input
        id={id}
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        autoComplete={autoComplete}
        className={FIELD}
      />
      {error === undefined ? null : <p className="mt-1 text-[10px] font-bold text-bubble-pale">{error}</p>}
    </div>
  );
}

/** The signed-out half of the account page: create an account, or log in. */
export default function AccountForms() {
  const { signUp, signIn, requiresEmailConfirmation, usingMockAuth } = useAuth();

  const [signUpEmail, setSignUpEmail] = useState('');
  const [signUpName, setSignUpName] = useState('');
  const [signUpPassword, setSignUpPassword] = useState('');
  const [signUpConfirm, setSignUpConfirm] = useState('');
  const [signUpErrors, setSignUpErrors] = useState<CredentialErrors>({});
  const [signUpBusy, setSignUpBusy] = useState(false);
  const [signUpMessage, setSignUpMessage] = useState<string | null>(null);

  const [signInEmail, setSignInEmail] = useState('');
  const [signInPassword, setSignInPassword] = useState('');
  const [signInErrors, setSignInErrors] = useState<CredentialErrors>({});
  const [signInBusy, setSignInBusy] = useState(false);
  const [signInMessage, setSignInMessage] = useState<string | null>(null);

  async function handleSignUp() {
    const input = {
      email: signUpEmail,
      displayName: signUpName,
      password: signUpPassword,
      confirmPassword: signUpConfirm,
    };

    const errors = validateSignUp(input);
    setSignUpErrors(errors);
    setSignUpMessage(null);
    if (hasErrors(errors)) return;

    setSignUpBusy(true);
    const result = await signUp(input);
    setSignUpBusy(false);

    if (!result.ok) {
      setSignUpMessage(result.error);
      return;
    }

    if (result.confirmationRequired === true) {
      setSignUpMessage('ACCOUNT CREATED. CHECK YOUR EMAIL FOR THE CONFIRMATION LINK, THEN LOG IN.');
      setSignUpPassword('');
      setSignUpConfirm('');
      return;
    }

    setSignUpMessage('ACCOUNT CREATED - YOU ARE SIGNED IN.');
  }

  async function handleSignIn() {
    const input = { email: signInEmail, password: signInPassword };

    const errors = validateSignIn(input);
    setSignInErrors(errors);
    setSignInMessage(null);
    if (hasErrors(errors)) return;

    setSignInBusy(true);
    const result = await signIn(input);
    setSignInBusy(false);

    if (!result.ok) {
      setSignInMessage(result.error);
      return;
    }

    setSignInMessage('SIGNED IN.');
    setSignInPassword('');
  }

  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <section className="rounded-none border-2 border-t-white border-l-white border-r-black border-b-black bg-sun-pale">
        <div className="flex items-center justify-between bg-ena px-2 py-1 text-xs font-bold text-paper">
          <span>CREATE ACCOUNT</span>
          <span>[ SIGN UP ]</span>
        </div>

        <form
          className="p-3"
          onSubmit={(event) => {
            event.preventDefault();
            void handleSignUp();
          }}
        >
          <Field
            id="account-signup-email"
            label="EMAIL ADDRESS:"
            type="email"
            value={signUpEmail}
            onChange={setSignUpEmail}
            placeholder="you@example.com"
            autoComplete="email"
            error={signUpErrors.email}
          />
          <Field
            id="account-signup-name"
            label="DISPLAY NAME:"
            type="text"
            value={signUpName}
            onChange={setSignUpName}
            placeholder="how your posts are signed"
            autoComplete="nickname"
            error={signUpErrors.displayName}
          />
          <Field
            id="account-signup-password"
            label={`PASSWORD (${MIN_PASSWORD_LENGTH}+ CHARACTERS):`}
            type="password"
            value={signUpPassword}
            onChange={setSignUpPassword}
            placeholder="password"
            autoComplete="new-password"
            error={signUpErrors.password}
          />
          <Field
            id="account-signup-confirm"
            label="CONFIRM PASSWORD:"
            type="password"
            value={signUpConfirm}
            onChange={setSignUpConfirm}
            placeholder="repeat password"
            autoComplete="new-password"
            error={signUpErrors.confirmPassword}
          />

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button type="submit" disabled={signUpBusy} className={PLATE_LARGE}>
              {signUpBusy ? '[ WORKING... ]' : '[ CREATE ACCOUNT ]'}
            </button>
            {signUpMessage === null ? null : (
              <p className="text-[10px] font-bold text-ink">{signUpMessage}</p>
            )}
          </div>

          <p className="mt-2 text-[10px] text-ink">
            {requiresEmailConfirmation
              ? 'NEW ACCOUNTS CONFIRM BY EMAIL BEFORE THE FIRST SIGN IN.'
              : usingMockAuth
                ? 'ACCOUNTS HERE ARE HELD ONLY IN THIS BROWSER.'
                : ''}
          </p>
        </form>
      </section>

      <section className="rounded-none border-2 border-t-white border-l-white border-r-black border-b-black bg-sun-pale">
        <div className="flex items-center justify-between bg-ena px-2 py-1 text-xs font-bold text-paper">
          <span>LOG IN</span>
          <span>[ SESSION ]</span>
        </div>

        <form
          className="p-3"
          onSubmit={(event) => {
            event.preventDefault();
            void handleSignIn();
          }}
        >
          {/* One tap, and no password to remember. Wired to Supabase's provider: on
              the mock backend the button says what it needs instead of failing quietly. */}
          <GoogleSignInButton className="mb-3" />

          <p className="mb-3 border-t border-ink pt-2 text-[10px] font-bold text-ink">
            OR SIGN IN WITH THE ACCOUNT&apos;S OWN DETAILS:
          </p>

          <Field
            id="account-signin-email"
            label="EMAIL ADDRESS OR ACCOUNT NAME:"
            type="text"
            value={signInEmail}
            onChange={setSignInEmail}
            placeholder="you@example.com"
            autoComplete="username"
            error={signInErrors.email}
          />
          <Field
            id="account-signin-password"
            label="PASSWORD:"
            type="password"
            value={signInPassword}
            onChange={setSignInPassword}
            placeholder="password"
            autoComplete="current-password"
            error={signInErrors.password}
          />

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button type="submit" disabled={signInBusy} className={PLATE_LARGE}>
              {signInBusy ? '[ WORKING... ]' : '[ LOG IN ]'}
            </button>
            {signInMessage === null ? null : (
              <p className="text-[10px] font-bold text-ink">{signInMessage}</p>
            )}
          </div>

          <p className="mt-2 text-[10px] text-ink">
            READING AND POSTING STAYS OPEN TO GUESTS - AN ACCOUNT JUST SIGNS YOUR POSTS.
          </p>
        </form>
      </section>
    </div>
  );
}
