'use client';

import Image from 'next/image';
import { useCallback, useState } from 'react';
import { GOOGLE_ICON_SRC } from '../lib/auth/google';
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
 * shown at 20x20). Until it exists the key reads `[ G ]`: the words and the picture share one grid cell,
 * so the key keeps the larger of the two boxes and nothing moves when the drawing lands - the picture is
 * only shown once it has loaded, and no logo on this site is drawn in CSS or SVG.
 */
export default function GoogleSignInButton({ size = 'normal', label = '[ LOG IN ]', className }: GoogleSignInButtonProps) {
  const { signInWithGoogle } = useAuth();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [markDrawn, setMarkDrawn] = useState(false);
  const markRef = useCallback((img: HTMLImageElement | null) => {
    if (img?.complete && img.naturalWidth > 0) setMarkDrawn(true);
  }, []);

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
          className={`${key} inline-grid place-items-center disabled:cursor-wait max-sm:min-w-tap`}
        >
          <span aria-hidden="true" className={`col-start-1 row-start-1 ${markDrawn ? 'invisible' : ''}`}>
            [ G ]
          </span>
          <Image
            src={GOOGLE_ICON_SRC}
            alt=""
            width={20}
            height={20}
            // The file as drawn (40x40, k=2): the optimiser would resample it to 32 or 48 and blur it.
            unoptimized
            loading="eager"
            // A cached file can finish before the key mounts, when no load event is left to hear.
            ref={markRef}
            onLoad={() => setMarkDrawn(true)}
            className={`col-start-1 row-start-1 size-5 rounded-none ${markDrawn ? '' : 'opacity-0'}`}
          />
        </button>
      </div>

      {note === null ? null : <p className="w-fit bg-bubble-pale px-1 text-label font-bold text-ink-bar">{note}</p>}
    </div>
  );
}
