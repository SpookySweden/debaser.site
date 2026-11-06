'use client';

import { useRouter } from 'next/navigation';
import { useState, useSyncExternalStore } from 'react';
import { USING_MOCK_AUTH } from '../lib/auth/auth-repository';
import { forgetLostAccount, parseLostAccount, readLostAccountRaw, rememberLostAccount, rememberNeverHadOne, saidNeverHadOne, subscribeToLostAccount } from '../lib/auth/lost-account';
import { readLibrary } from '../lib/character/library';
import { getSupabaseBrowserClient } from '../lib/supabase/client';
import { hasErrors, MIN_PASSWORD_LENGTH, validateSignUp, type CredentialErrors } from '../lib/auth/validation';
import { FIELD, PLATE_LARGE, PLATE_MAIN } from '../lib/ui/controls';
import { useAuth } from './AuthProvider';
import PopoutWindow from './PopoutWindow';

const onServer = () => null;
const hiddenOnServer = () => true;

/**
 * The moment anybody signed out enters the site (Luke, 2026-11-06: "it needs to be urgent"): their old address, unless their browser still
 * knows it (`lost-account.ts`), then a new password, then their profile to edit. It's their own sign-up, under their old address, which brings
 * their details and old posts back, and signing in sends up the characters their browser holds. Drawn once in `layout.tsx`.
 */
export default function LostAccountWindow() {
  const raw = useSyncExternalStore(subscribeToLostAccount, readLostAccountRaw, onServer);
  const lost = parseLostAccount(raw);
  const neverHadOne = useSyncExternalStore(subscribeToLostAccount, saidNeverHadOne, hiddenOnServer);
  const [address, setAddress] = useState('');
  const { status, signUp } = useAuth();
  const router = useRouter();
  // Which address was put away: logging in with another brings the window back.
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState<CredentialErrors>({});
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // The mock accounts have nothing to lose.
  if (USING_MOCK_AUTH || status !== 'anonymous' || dismissed === (raw ?? 'asking')) return null;
  if (lost === null && neverHadOne) return null;

  const find = async () => {
    setMessage(null);
    const typed = address.trim().toLowerCase();
    if (typed.length === 0) {
      setMessage('TYPE THE ADDRESS YOU USED.');
      return;
    }
    setBusy(true);
    const answer = await getSupabaseBrowserClient()?.rpc('lost_account_name', { mail: typed });
    setBusy(false);
    if (answer === undefined || answer.error !== null) {
      setMessage('COULD NOT LOOK THAT UP. TRY AGAIN.');
      return;
    }
    if (typeof answer.data === 'string' && answer.data.length > 0) rememberLostAccount({ email: typed, name: answer.data });
    else setMessage('NO LOST ACCOUNT UNDER THAT ADDRESS. IF YOURS IS ALREADY BACK, LOG IN.');
  };

  const save = async () => {
    if (lost === null) return;
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

  const away = () => setDismissed(raw ?? 'asking');
  const characters = readLibrary().length;
  const holding = characters > 0 ? ` THIS BROWSER STILL HOLDS ${characters} SAVED ${characters === 1 ? 'CHARACTER' : 'CHARACTERS'}: THEY COME BACK TOO.` : '';

  if (lost === null) {
    return (
      <PopoutWindow title="HAD AN ACCOUNT?" onClose={away} dismissOnBackdrop={false} maxWidth="max-w-md">
        <form
          className="flex flex-col gap-2 p-2"
          onSubmit={(event) => {
            event.preventDefault();
            void find();
          }}
        >
          <p className="text-prose text-ink">{`WE LOST EVERY ACCOUNT BY MISTAKE ON 6 NOVEMBER. TYPE YOUR OLD ADDRESS TO GET YOURS BACK WITH YOUR POSTS.${holding}`}</p>
          <label className="text-label font-bold text-ink">
            YOUR OLD ADDRESS
            <input type="email" autoComplete="email" autoFocus value={address} onChange={(event) => setAddress(event.target.value)} className={FIELD} />
          </label>
          {message ? <p role="alert" className="text-label font-bold text-ink wrap-anywhere">{message}</p> : null}
          <div className="flex flex-wrap items-center gap-2">
            <button type="submit" disabled={busy} className={`${PLATE_MAIN} min-h-tap`}>
              [ FIND MY ACCOUNT ]
            </button>
            <button type="button" onClick={away} className={`${PLATE_LARGE} min-h-tap`}>
              [ NOT NOW ]
            </button>
            <button type="button" onClick={rememberNeverHadOne} className={`${PLATE_LARGE} min-h-tap`}>
              [ I NEVER HAD ONE ]
            </button>
          </div>
        </form>
      </PopoutWindow>
    );
  }

  return (
    <PopoutWindow title="WELCOME BACK" onClose={away} dismissOnBackdrop={false} maxWidth="max-w-md">
      <form
        className="flex flex-col gap-2 p-2"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <p className="text-prose text-ink wrap-anywhere">{`${lost.name.toUpperCase()}, WE LOST EVERY ACCOUNT BY MISTAKE. SET A NEW PASSWORD TO GET YOURS BACK WITH YOUR POSTS.${holding}`}</p>
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
          <button type="button" onClick={away} className={`${PLATE_LARGE} min-h-tap`}>
            [ NOT NOW ]
          </button>
        </div>
      </form>
    </PopoutWindow>
  );
}
