'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { USING_MOCK_AUTH } from '../lib/auth/auth-repository';
import {
  askForLostAccount,
  askedForLostAccount,
  forgetLostAccount,
  parseLostAccount,
  readLostAccountRaw,
  rememberLostAccount,
  rememberNeverHadOne,
  rememberNotNow,
  saidNeverHadOne,
  showingLoginForm,
  stopAskingForLostAccount,
  subscribeToLostAccount,
} from '../lib/auth/lost-account';
import { readLibrary } from '../lib/character/library';
import { getSupabaseBrowserClient } from '../lib/supabase/client';
import { hasErrors, MIN_PASSWORD_LENGTH, validateSignUp, type CredentialErrors } from '../lib/auth/validation';
import { FIELD, PLATE, PLATE_LARGE, PLATE_MAIN } from '../lib/ui/controls';
import { explain } from '../lib/ui/explain';
import { useAuth } from './AuthProvider';
import PopoutWindow from './PopoutWindow';

const onServer = () => null;
const hiddenOnServer = () => true;
const notAskedOnServer = () => false;

/**
 * The moment anybody signed out enters the site (Luke, 2026-11-06: "it needs to be urgent"): their old address, unless their browser still
 * knows it (`lost-account.ts`), then a new password, then their profile to edit. It's their own sign-up, under their old address, which brings
 * their details and old posts back, and signing in sends up the characters their browser holds. Drawn once in `layout.tsx`.
 *
 * Review fixes (2026-11-17): "it came back on Forum, Media, Stream, Read and Account, where it sits on top of the login
 * form". NOT NOW is now kept in this browser (`rememberNotNow`) until something changes (a lost address turns up),
 * and on /account the window waits to be asked: the LOG IN box carries a one-line offer instead (`LostAccountLine`).
 *
 * FIRSTVISIT (Luke, 2026-11-20: "Gentler first visits: replace the full-page 'HAD AN ACCOUNT?' pop-up with a short guided
 * tour of the desktop"): it no longer opens by itself anywhere. It waits to be asked, by the quiet line
 * (`LostAccountLine`: the board's PROFILE panel for a visitor, the LOG IN box) or by logging in with an address that is
 * waiting to come back. A first visit gets the desktop tour instead (`FirstVisitTour.tsx`).
 */
export default function LostAccountWindow() {
  const raw = useSyncExternalStore(subscribeToLostAccount, readLostAccountRaw, onServer);
  const lost = parseLostAccount(raw);
  const neverHadOne = useSyncExternalStore(subscribeToLostAccount, saidNeverHadOne, hiddenOnServer);
  const [address, setAddress] = useState('');
  const { status, signUp } = useAuth();
  const router = useRouter();
  const said = raw ?? 'asking';
  const asked = useSyncExternalStore(subscribeToLostAccount, askedForLostAccount, notAskedOnServer);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState<CredentialErrors>({});
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // The mock accounts have nothing to lose.
  if (USING_MOCK_AUTH || status !== 'anonymous') return null;
  if (lost === null && neverHadOne) return null;
  // Only when asked (FIRSTVISIT): never by itself, on any page.
  if (!asked) return null;

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

  const away = () => {
    rememberNotNow(said);
    stopAskingForLostAccount();
  };
  const characters = readLibrary().length;
  const holding = characters > 0 ? ` THIS BROWSER STILL HOLDS ${characters} SAVED ${characters === 1 ? 'CHARACTER' : 'CHARACTERS'}: THEY COME BACK TOO.` : '';

  if (lost === null) {
    return (
      <PopoutWindow title="HAD AN ACCOUNT?" onClose={away} dismissOnBackdrop={false} maxWidth="max-w-md" centred>
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
            <button type="submit" disabled={busy} className={`${PLATE_MAIN} min-h-tap`} {...explain('Looks for an old account under the address you typed.', 'Every account was lost by mistake on 6 November. If yours is found, the next step sets a new password and brings back your details and old posts.')}>
              [ FIND MY ACCOUNT ]
            </button>
            <button type="button" onClick={away} className={`${PLATE_LARGE} min-h-tap`} {...explain('Closes this window without getting your account back.', 'It won\'t ask again in this browser unless something changes. The GET IT BACK line under LOG IN brings it back whenever you want.')}>
              [ NOT NOW ]
            </button>
            <button type="button" onClick={rememberNeverHadOne} className={`${PLATE_LARGE} min-h-tap`} {...explain('Says you never had an account here, so this window stops asking.', 'For people new to the site. Remembered in this browser.')}>
              [ I NEVER HAD ONE ]
            </button>
          </div>
        </form>
      </PopoutWindow>
    );
  }

  return (
    <PopoutWindow title="WELCOME BACK" onClose={away} dismissOnBackdrop={false} maxWidth="max-w-md" centred>
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
          <button type="submit" disabled={busy} className={`${PLATE_MAIN} min-h-tap`} {...explain('Sets your new password and brings your old account back, signed in.', 'Your details and old posts come back under your old address; then your profile opens for you to check.')}>
            [ SET PASSWORD ]
          </button>
          <button type="button" onClick={away} className={`${PLATE_LARGE} min-h-tap`} {...explain('Closes this window without getting your account back.', 'It won\'t ask again in this browser unless something changes. The GET IT BACK line under LOG IN brings it back whenever you want.')}>
            [ NOT NOW ]
          </button>
        </div>
      </form>
    </PopoutWindow>
  );
}

/**
 * The login page's way to the window: one line in the LOG IN box. The window never opens over that form unless this
 * is pressed (or the reader logs in with an address that is waiting to come back). Drawn only while the window would
 * have something to say, and still there after NOT NOW: it is the quiet way back, not a nag.
 */
export function LostAccountLine() {
  const raw = useSyncExternalStore(subscribeToLostAccount, readLostAccountRaw, onServer);
  const lost = parseLostAccount(raw);
  const neverHadOne = useSyncExternalStore(subscribeToLostAccount, saidNeverHadOne, hiddenOnServer);
  const asked = useSyncExternalStore(subscribeToLostAccount, askedForLostAccount, notAskedOnServer);
  const { status } = useAuth();
  // Says a login form is on screen for as long as this line's form is, drawn or not.
  useEffect(() => showingLoginForm(), []);

  if (USING_MOCK_AUTH || status !== 'anonymous' || asked) return null;
  if (lost === null && neverHadOne) return null;

  return (
    <p className="mb-3 flex flex-wrap items-center gap-2 text-label font-bold text-ink">
      <span className="wrap-anywhere">{lost === null ? 'HAD AN ACCOUNT BEFORE 6 NOVEMBER?' : `${lost.name.toUpperCase()}, YOUR OLD ACCOUNT IS WAITING.`}</span>
      <button type="button" onClick={askForLostAccount} className={PLATE} {...explain('Opens the window that gets a lost account back.', 'Every account was lost by mistake on 6 November. Type your old address there to get yours back with your posts.')}>
        [ GET IT BACK ]
      </button>
    </p>
  );
}
