'use client';

import { useRouter } from 'next/navigation';
import { useState, useSyncExternalStore } from 'react';
import { forgetLostAccount, parseLostAccount, readLostAccountRaw } from '../lib/auth/lost-account';
import { hasErrors, MIN_PASSWORD_LENGTH, validateSignUp, type CredentialErrors } from '../lib/auth/validation';
import { FIELD, PLATE_LARGE, PLATE_MAIN } from '../lib/ui/controls';
import { useAuth } from './AuthProvider';
import DockWindow from './DockWindow';

const noChange = () => () => {};
const onServer = () => null;

/**
 * Asks somebody who was logged in when the accounts were lost for a new password (`lost-account.ts`), then opens their profile to edit.
 * It's their own sign-up, under their old address, which is what brings their details and old posts back. Drawn once in `layout.tsx`.
 */
export default function LostAccountWindow() {
  const raw = useSyncExternalStore(noChange, readLostAccountRaw, onServer);
  const lost = parseLostAccount(raw);
  const { status, signUp } = useAuth();
  const router = useRouter();
  const [dismissed, setDismissed] = useState(false);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState<CredentialErrors>({});
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (lost === null || dismissed || status !== 'anonymous') return null;

  const save = async () => {
    const input = { email: lost.email, displayName: lost.name, password, confirmPassword: confirm };
    const found = validateSignUp(input);
    setErrors(found);
    setMessage(null);
    if (hasErrors(found)) return;
    setBusy(true);
    const result = await signUp(input);
    setBusy(false);
    if (!result.ok) {
      setMessage(result.error);
      return;
    }
    forgetLostAccount();
    router.push('/account?edit=1');
  };

  return (
    <DockWindow title="WELCOME BACK" onClose={() => setDismissed(true)} status="" dock="bottom" id="lost-account" defaultSize={{ w: 420, h: 420 }} minSize={{ w: 280, h: 240 }}>
      <form
        className="flex flex-col gap-2 p-2"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <p className="text-prose text-ink wrap-anywhere">{`${lost.name.toUpperCase()}, WE LOST EVERY ACCOUNT BY MISTAKE. SET A NEW PASSWORD TO GET YOURS BACK WITH YOUR POSTS.`}</p>
        <p className="text-label font-bold text-ink wrap-anywhere">{lost.email}</p>
        <label className="text-label font-bold text-ink">
          NEW PASSWORD
          <input type="password" autoComplete="new-password" autoFocus value={password} minLength={MIN_PASSWORD_LENGTH} onChange={(event) => setPassword(event.target.value)} className={FIELD} />
        </label>
        {errors.password ? <p role="alert" className="text-label font-bold text-ink">{errors.password}</p> : null}
        <label className="text-label font-bold text-ink">
          AGAIN
          <input type="password" autoComplete="new-password" value={confirm} onChange={(event) => setConfirm(event.target.value)} className={FIELD} />
        </label>
        {errors.confirmPassword ? <p role="alert" className="text-label font-bold text-ink">{errors.confirmPassword}</p> : null}
        {message ? <p role="alert" className="text-label font-bold text-ink wrap-anywhere">{message}</p> : null}
        <div className="flex flex-wrap items-center gap-2">
          <button type="submit" disabled={busy} className={`${PLATE_MAIN} min-h-tap`}>
            [ SET PASSWORD ]
          </button>
          <button type="button" onClick={() => setDismissed(true)} className={`${PLATE_LARGE} min-h-tap`}>
            [ NOT NOW ]
          </button>
        </div>
      </form>
    </DockWindow>
  );
}
