'use client';

import { useEffect, useState } from 'react';
import { getAuthRepository } from '../lib/auth/auth-repository';
import type { GoogleLink } from '../lib/auth/types';
import { PLATE_LARGE } from '../lib/ui/controls';
import { useAuth } from './AuthProvider';

const NOTE = 'text-label font-bold text-ink';

/**
 * GOOGLE on the account page (Luke, 2026-11-13): a signed-in account can link a Google account to itself, so either way
 * in reaches the same account, and unlink it again while another way in remains. Linking leaves the page for Google and
 * comes back here; the row then reads LINKED and the Google address.
 */
export default function AccountGoogleLink() {
  const { user } = useAuth();
  const [link, setLink] = useState<GoogleLink | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [asked, setAsked] = useState(0);

  useEffect(() => {
    if (!user) return;
    let live = true;
    const read = getAuthRepository().googleLink?.() ?? Promise.resolve(null);
    read
      .then((found) => live && setLink(found))
      .catch(() => live && setLink(null));
    return () => {
      live = false;
    };
  }, [user, asked]);

  if (!user) return null;

  const linkIt = async () => {
    setBusy(true);
    setMessage(null);
    const result = await (getAuthRepository().linkGoogle?.() ?? Promise.resolve({ ok: false as const, error: 'GOOGLE SIGN-IN IS NOT SET UP YET.' }));
    // On success the browser is already leaving for Google; only a refusal stays here to be read.
    if (!result.ok) {
      setMessage(result.error);
      setBusy(false);
    }
  };

  const unlinkIt = async () => {
    setBusy(true);
    setMessage(null);
    const result = await (getAuthRepository().unlinkGoogle?.() ?? Promise.resolve({ ok: false as const, error: 'NO GOOGLE ACCOUNT IS LINKED.' }));
    setMessage(result.ok ? 'GOOGLE UNLINKED.' : result.error);
    setBusy(false);
    setAsked((count) => count + 1);
  };

  return (
    <div className="mt-3 p-2" data-account-google>
      <p className={NOTE}>GOOGLE ACCOUNT</p>
      {link === undefined ? (
        <p className={`${NOTE} mt-1`}>READING...</p>
      ) : link?.linked ? (
        <p className={`${NOTE} mt-1`}>LINKED{link.email ? `: ${link.email.toUpperCase()}` : ''}. YOU CAN SIGN IN WITH GOOGLE OR YOUR EMAIL.</p>
      ) : (
        <p className={`${NOTE} mt-1`}>NOT LINKED. LINK ONE TO SIGN IN WITH GOOGLE AS WELL AS YOUR EMAIL.</p>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {link?.linked ? (
          link.canUnlink ? (
            <button type="button" onClick={() => void unlinkIt()} disabled={busy} className={PLATE_LARGE}>
              {busy ? '[ WORKING... ]' : '[ UNLINK GOOGLE ]'}
            </button>
          ) : null
        ) : (
          <button type="button" onClick={() => void linkIt()} disabled={busy || link === undefined} className={PLATE_LARGE}>
            {busy ? '[ GOING TO GOOGLE... ]' : '[ LINK GOOGLE ACCOUNT ]'}
          </button>
        )}
        {message === null ? null : <p className={NOTE}>{message}</p>}
      </div>
    </div>
  );
}
