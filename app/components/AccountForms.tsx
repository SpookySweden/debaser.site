'use client';

import { useState } from 'react';
import { MIN_PASSWORD_LENGTH, hasErrors, validateSignIn, validateSignUp } from '../lib/auth/validation';
import type { CredentialErrors } from '../lib/auth/validation';
import { FIELD, PLATE_LARGE, PLATE_MAIN } from '../lib/ui/controls';
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
      <label htmlFor={id} className="block text-label font-bold text-ink">
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
      {error === undefined ? null : <p className="mt-1 w-fit bg-bubble-pale px-1 text-label font-bold text-ink-bar">{error}</p>}
    </div>
  );
}

/** The signed-out half of the account page: create an account, or log in. */
export default function AccountForms() {
  const { signUp, signIn } = useAuth();

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
      setSignUpMessage('CHECK YOUR EMAIL TO CONFIRM.');
      setSignUpPassword('');
      setSignUpConfirm('');
      return;
    }
    // Signed in: the forms unmount at once (AccountConsole swaps to the account), so no message.
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

    // Signed in: the forms unmount at once, so a message here would never be seen.
    setSignInPassword('');
  }

  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <section>
        <div className="title-line text-accent-ink">
          <span>CREATE ACCOUNT</span>
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
            placeholder=""
            autoComplete="nickname"
            error={signUpErrors.displayName}
          />
          <Field
            id="account-signup-password"
            label="PASSWORD:"
            type="password"
            value={signUpPassword}
            onChange={setSignUpPassword}
            placeholder={`${MIN_PASSWORD_LENGTH}+ characters`}
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
              <p className="text-label font-bold text-ink">{signUpMessage}</p>
            )}
          </div>
        </form>
      </section>

      <section>
        <div className="title-line text-accent-ink">
          <span>LOG IN</span>
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
          <GoogleSignInButton label="[ LOG IN WITH ]" className="mb-3" />

          <p className="mb-3 border-t border-ink pt-2 text-label font-bold text-ink">OR</p>

          <Field
            id="account-signin-email"
            label="EMAIL OR NAME:"
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
            <button type="submit" disabled={signInBusy} className={PLATE_MAIN}>
              {signInBusy ? '[ WORKING... ]' : '[ LOG IN ]'}
            </button>
            {signInMessage === null ? null : (
              <p className="text-label font-bold text-ink">{signInMessage}</p>
            )}
          </div>
        </form>
      </section>
    </div>
  );
}
