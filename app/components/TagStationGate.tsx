'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { PLATE_MAIN } from '../lib/ui/controls';
import { useAuth } from './AuthProvider';

/**
 * TAG STATION is for signed-in people only, like MEDIA (SPEC-tag-station.md). This gate is the page's manners: the route refuses
 * a signed-out request on its own, and `web_item_tags` can only be read with a session.
 */
export default function TagStationGate({ children }: { children: ReactNode }) {
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
    <section aria-labelledby="tag-station-sign-in-title" className="flex flex-col items-start gap-3 py-2">
      <h2 id="tag-station-sign-in-title" className="text-headline font-bold text-ink">
        SIGN IN TO USE DISCOVER
      </h2>
      <Link href="/account" className={PLATE_MAIN}>
        [ SIGN IN ]
      </Link>
    </section>
  );
}
