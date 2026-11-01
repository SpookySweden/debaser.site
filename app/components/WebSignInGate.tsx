'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { PLATE_MAIN } from '../lib/ui/controls';
import { useAuth } from './AuthProvider';

/**
 * WEB is for signed-in people only (SPEC-media-servers.md decision 4, Luke 2026-11-01). Signed out, the page
 * shows this prompt instead of the stream, so nothing of the stream is read or asked for. The search route
 * refuses a signed-out request on its own as well (web-session.ts): this gate is the page's manners, the
 * route and the database's Row Level Security are the lock.
 *
 * The header's WEB key stays for everyone, so a visitor learns WEB exists and lands here.
 */
export default function WebSignInGate({ children }: { children: ReactNode }) {
  const { status } = useAuth();

  if (status === 'signed-in') return <>{children}</>;

  if (status === 'loading') {
    return (
      <p role="status" className="text-title font-bold text-ink">
        CHECKING YOUR SIGN-IN...
      </p>
    );
  }

  return (
    <section aria-labelledby="web-sign-in-title" className="flex flex-col items-start gap-3 py-2">
      <h2 id="web-sign-in-title" className="text-headline font-bold text-ink">
        SIGN IN TO USE WEB
      </h2>
      <p className="text-prose text-ink">WEB is for people with an account. Sign in, and the stream and its search open here.</p>
      <Link href="/account" className={PLATE_MAIN}>
        [ SIGN IN ]
      </Link>
    </section>
  );
}
