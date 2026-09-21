'use client';

import { useState } from 'react';
import { GOOGLE_ICON_SRC, GOOGLE_NEEDS_SUPABASE } from '../lib/auth/google';
import { useAuth } from './AuthProvider';
import SheetImage from './SheetImage';

const BUTTON =
  'inline-flex w-full cursor-pointer items-center justify-center gap-2 rounded-none border-t border-l border-white border-r-2 border-b-2 border-black bg-[#c0c0c0] font-bold text-black hover:bg-gray-300 disabled:cursor-wait disabled:opacity-60';

type GoogleSignInButtonProps = {
  /** 'large' is the one the side panel and the mobile menu use. */
  size?: 'normal' | 'large';
  className?: string;
};

/**
 * Sign in with Google.
 *
 * The backend does the work - on Supabase this sends the browser to Google and
 * back to /account, where the session lands through the auth provider's
 * subscription - so this is the button, the retro mark and the honest answer when
 * the backend cannot do OAuth at all.
 *
 * The mark is a hand-drawn file in `assets/icons/` shown through `SheetImage`, the
 * same slot the concept sheets use: until the drawing exists the button shows
 * "[ ? ]" in the icon box rather than an invented logo, because no logo on this
 * site is drawn in CSS or SVG.
 */
export default function GoogleSignInButton({ size = 'normal', className }: GoogleSignInButtonProps) {
  const { signInWithGoogle, googleSignInAvailable } = useAuth();
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

  // One line, one source: while the backend cannot do OAuth the standing note is
  // the same message a click would produce, so it is never printed twice.
  const note = message ?? (googleSignInAvailable ? null : GOOGLE_NEEDS_SUPABASE);

  return (
    <div className={`space-y-1 ${className ?? ''}`}>
      <button
        type="button"
        onClick={() => void handleClick()}
        disabled={busy}
        title="Sign in with a Google account"
        className={`${BUTTON} ${size === 'large' ? 'px-4 py-2 text-xs' : 'px-3 py-1 text-[10px]'}`}
      >
        <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-none border border-black bg-white">
          <SheetImage src={GOOGLE_ICON_SRC} alt="Google" width={20} height={20} sizes="20px" compact />
        </span>
        {busy ? 'OPENING GOOGLE...' : 'LOG IN WITH GOOGLE'}
      </button>

      {note === null ? null : <p className="text-[10px] font-bold text-[#800000]">{note}</p>}
    </div>
  );
}
