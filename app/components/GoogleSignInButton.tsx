'use client';

import Image from 'next/image';
import { useState } from 'react';
import { GOOGLE_ICON_SRC } from '../lib/auth/google';
import { artOnDisk } from '../lib/ui/art/on-disk';
import { PLATE, PLATE_LARGE } from '../lib/ui/controls';
import { useAuth } from './AuthProvider';

type GoogleSignInButtonProps = {
  /** 'large' takes the bigger key; the side panel and the account page use 'normal'. */
  size?: 'normal' | 'large';
  /** The words on the sign-in key. The account page says `[ LOG IN WITH ]`, because its own email form
      ends in a `[ LOG IN ]` key and two keys with one name would be a guess. */
  label?: string;
  className?: string;
};

/**
 * Sign in with Google: a `[ LOG IN ]` key with the Google mark beside it, and both start the same
 * sign-in.
 *
 * The backend does the work - on Supabase this sends the browser to Google and back to /account, where
 * the session lands through the auth provider's subscription - so this is the two keys and the honest
 * answer when the backend cannot do OAuth at all.
 *
 * The mark is a hand-drawn file in `assets/icons/` (the `mark-signin` slot in app/lib/ui/art/slots.ts,
 * shown at 20x20). Until it exists the key reads `[ GOOGLE ]` in text, and the file is not asked for at all: the
 * build says which art is on disk (`artOnDisk`), so the drawing shows from the first build after it lands. No logo on
 * this site is drawn in CSS or SVG.
 */
const MARK_DRAWN = artOnDisk(GOOGLE_ICON_SRC);
export default function GoogleSignInButton({ size = 'normal', label = '[ LOG IN ]', className }: GoogleSignInButtonProps) {
  const { signInWithGoogle } = useAuth();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function handleClick() {
    setBusy(true);
    setMessage(null);

    const result = await signInWithGoogle();
    setBusy(false);

    // On Supabase this line is never reached: the browser has already left for
    // Google. It is the mock backend's answer that lands here.
    if (!result.ok) setMessage(result.error);
  }

  // Only a click's answer is shown: while the backend cannot do OAuth, the click itself says so
  // (GOOGLE_NEEDS_SUPABASE), rather than a standing note under the keys.
  const note = message;
  const key = size === 'large' ? PLATE_LARGE : PLATE;

  return (
    <div className={`space-y-1 ${className ?? ''}`}>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => void handleClick()}
          disabled={busy}
          title="Sign in with a Google account"
          className={`${key} disabled:cursor-wait`}
        >
          {busy ? '[ OPENING GOOGLE... ]' : label}
        </button>

        <button
          type="button"
          onClick={() => void handleClick()}
          disabled={busy}
          aria-label="Log in with Google"
          title="Sign in with a Google account"
          className={`${key} inline-flex items-baseline justify-center disabled:cursor-wait max-sm:min-w-tap`}
        >
          {MARK_DRAWN ? (
            <Image
              src={GOOGLE_ICON_SRC}
              alt=""
              width={20}
              height={20}
              // The file as drawn (40x40, k=2): the optimiser would resample it to 32 or 48 and blur it.
              unoptimized
              loading="eager"
              className="size-5 self-center rounded-none"
            />
          ) : (
            /* The text mark (review fixes, 2026-11-17: a bare `[ G ]` and a "not found" icon): the word itself, its G a
               size up, built from letters only - not Google's logo, and no file asked for. */
            <span aria-hidden="true" className="whitespace-pre font-bold">
              {'[ '}
              <span className="text-title leading-none">G</span>
              {'OOGLE ]'}
            </span>
          )}
        </button>
      </div>

      {note === null ? null : <p className="w-fit bg-bubble-pale px-1 text-label font-bold text-ink-bar">{note}</p>}
    </div>
  );
}
