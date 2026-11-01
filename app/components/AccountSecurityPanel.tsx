'use client';

import { useState } from 'react';
import { hasErrors, validateEmailChange, validatePasswordChange } from '../lib/auth/validation';
import type { CredentialErrors } from '../lib/auth/validation';
import { getProfileRepository } from '../lib/profile/repository';
import { FIELD, PLATE_LARGE } from '../lib/ui/controls';
import { useAuth } from './AuthProvider';

const NOTE = 'text-label font-bold text-ink';

type BlockState = {
  busy: boolean;
  message: string | null;
  errors: CredentialErrors;
};

const EMPTY_BLOCK: BlockState = { busy: false, message: null, errors: {} };

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
      <label htmlFor={id} className={`${NOTE} block`}>
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

/**
 * EDIT ACCOUNT: the account itself, as opposed to the public profile.
 *
 * Display name (which also signs your posts and your profile page), the address
 * the account signs in with, and the password. Each block saves on its own and
 * reports its own result, so a failed password change never looks like a failed
 * name change. The write itself goes through the AuthRepository, so the same
 * form drives the mock store today and Supabase Auth when it is switched on.
 */
export default function AccountSecurityPanel() {
  const {
    user,
    updateDisplayName,
    updateEmail,
    updatePassword,
  } = useAuth();

  const [name, setName] = useState(() => user?.displayName ?? '');
  const [nameState, setNameState] = useState<BlockState>(EMPTY_BLOCK);

  const [email, setEmail] = useState(() => user?.email ?? '');
  const [emailPassword, setEmailPassword] = useState('');
  const [emailState, setEmailState] = useState<BlockState>(EMPTY_BLOCK);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordState, setPasswordState] = useState<BlockState>(EMPTY_BLOCK);

  if (user === null) return null;

  // Captured after the guard so the helpers below keep a non-null id.
  const accountId = user.id;

  async function handleName() {
    setNameState({ busy: true, message: null, errors: {} });

    const result = await updateDisplayName(name);

    if (result.ok) {
      // The profile page shows this name too, so keep the two in step.
      await getProfileRepository().saveProfile(accountId, { displayName: name });
    }

    setNameState({
      busy: false,
      message: result.ok ? 'SAVED.' : result.error,
      errors: {},
    });
  }

  async function handleEmail() {
    const errors = validateEmailChange({ email, currentPassword: emailPassword });
    setEmailState({ busy: false, message: null, errors });
    if (hasErrors(errors)) return;

    setEmailState({ busy: true, message: null, errors: {} });

    const result = await updateEmail({ email, currentPassword: emailPassword });

    setEmailState({
      busy: false,
      errors: {},
      message: result.ok
        ? result.confirmationRequired === true
          ? 'CHECK THE NEW ADDRESS TO CONFIRM.'
          : 'EMAIL CHANGED.'
        : result.error,
    });

    if (result.ok) setEmailPassword('');
  }

  async function handlePassword() {
    const errors = validatePasswordChange({ currentPassword, password: newPassword, confirmPassword });
    setPasswordState({ busy: false, message: null, errors });
    if (hasErrors(errors)) return;

    setPasswordState({ busy: true, message: null, errors: {} });

    const result = await updatePassword({ currentPassword, password: newPassword, confirmPassword });

    setPasswordState({
      busy: false,
      errors: {},
      message: result.ok ? 'PASSWORD CHANGED.' : result.error,
    });

    if (result.ok) {
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    }
  }

  return (
    <section
      id="edit-account"
    >
      <div className="title-line text-accent-ink">
        <span>EDIT ACCOUNT</span>
      </div>

      <div className="p-3">
        {/* Display name */}
        <div className="p-2">
          {/* The field's own label is the block's heading, so the name is said once. */}
          <Field
            id="edit-account-name"
            label="DISPLAY NAME"
            type="text"
            value={name}
            onChange={setName}
            placeholder=""
            autoComplete="nickname"
            error={nameState.errors.displayName}
          />
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => void handleName()} disabled={nameState.busy} className={PLATE_LARGE}>
              {nameState.busy ? '[ WORKING... ]' : '[ SAVE NAME ]'}
            </button>
            {nameState.message === null ? null : <p className={NOTE}>{nameState.message}</p>}
          </div>
        </div>

        {/* Sign-in address */}
        <div className="mt-3 p-2">
          <p className={NOTE}>SIGN-IN EMAIL</p>
          <Field
            id="edit-account-email"
            label="EMAIL:"
            type="email"
            value={email}
            onChange={setEmail}
            placeholder="you@example.com"
            autoComplete="email"
            error={emailState.errors.email}
          />
          <Field
            id="edit-account-email-password"
            label="CURRENT PASSWORD:"
            type="password"
            value={emailPassword}
            onChange={setEmailPassword}
            placeholder="current password"
            autoComplete="current-password"
            error={emailState.errors.currentPassword}
          />
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => void handleEmail()} disabled={emailState.busy} className={PLATE_LARGE}>
              {emailState.busy ? '[ WORKING... ]' : '[ CHANGE EMAIL ]'}
            </button>
            {emailState.message === null ? null : <p className={NOTE}>{emailState.message}</p>}
          </div>
        </div>

        {/* Password */}
        <div className="mt-3 p-2">
          <p className={NOTE}>PASSWORD</p>
          <Field
            id="edit-account-current-password"
            label="CURRENT PASSWORD:"
            type="password"
            value={currentPassword}
            onChange={setCurrentPassword}
            placeholder="current password"
            autoComplete="current-password"
            error={passwordState.errors.currentPassword}
          />
          <Field
            id="edit-account-new-password"
            label="NEW PASSWORD:"
            type="password"
            value={newPassword}
            onChange={setNewPassword}
            placeholder="new password"
            autoComplete="new-password"
            error={passwordState.errors.password}
          />
          <Field
            id="edit-account-confirm-password"
            label="CONFIRM NEW PASSWORD:"
            type="password"
            value={confirmPassword}
            onChange={setConfirmPassword}
            placeholder="repeat new password"
            autoComplete="new-password"
            error={passwordState.errors.confirmPassword}
          />
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => void handlePassword()} disabled={passwordState.busy} className={PLATE_LARGE}>
              {passwordState.busy ? '[ WORKING... ]' : '[ CHANGE PASSWORD ]'}
            </button>
            {passwordState.message === null ? null : <p className={NOTE}>{passwordState.message}</p>}
          </div>
        </div>
      </div>
    </section>
  );
}
