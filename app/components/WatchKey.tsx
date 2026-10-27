'use client';

import Link from 'next/link';
import { PLATE_LINK } from '../lib/ui/controls';
import { useWatching } from '../lib/watch/use-watching';
import { watchHref } from '../lib/watch/watch-window';

/**
 * `[ TV ]` beside an account in a live room (decision 4): a text key, no artwork. It opens that room.
 * It comes and goes with the site-wide watching channel, so it is there about a second after the
 * account joins and gone about a second after it leaves; nothing is read from a table to draw it.
 */
export default function WatchKey({ userId }: { userId: string }) {
  const entry = useWatching(userId);
  if (entry === null) return null;

  const tip = entry.hosting
    ? `STREAMING ${entry.title || 'A VIDEO'}`
    : `WATCHING ${entry.title || 'A VIDEO'} WITH ${entry.hostName.toUpperCase()}`;

  return (
    <Link href={watchHref({ kind: 'room', roomId: entry.roomId })} className={`${PLATE_LINK} shrink-0`} title={tip} aria-label={tip} data-watch-key={entry.roomId}>
      [ TV ]
    </Link>
  );
}
