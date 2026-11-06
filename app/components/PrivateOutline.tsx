'use client';

import { useEffect, useState } from 'react';
import { getWatchRepository } from '../lib/watch/repository';
import type { PrivateLine, PrivateSize, RoomOutline } from '../lib/watch/types';

/** Three sizes, never the real length (decision 13). Characters, not art: a dark bar in the page's ink, so it keeps the site's contrast. */
const BARS: Record<PrivateSize, string> = {
  short: '███ ██',
  medium: '███ █████ ██ ████',
  long: '███ █████ ██ ████ ██████ ███ ████ ██',
};

/** One message nobody may read: heard by a screen reader as PRIVATE MESSAGE rather than as a row of block characters. */
export function PrivateBar({ size }: { size: PrivateSize }) {
  return (
    <span role="img" aria-label="PRIVATE MESSAGE" className="break-words" data-private-bar={size}>
      {BARS[size]}
    </span>
  );
}

function clock(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(whole / 60)).padStart(2, '0')}:${String(whole % 60).padStart(2, '0')}`;
}

/** `ANON-2 :: 02:14 :: ███ █████ ██`, each line as the database handed it over: it holds no words to hide. */
export function PrivateLines({ lines }: { lines: PrivateLine[] }) {
  if (lines.length === 0) return <p>NOTHING SAID YET.</p>;
  return (
    <ul className="flex flex-col gap-0.5" data-private-lines>
      {lines.map((line, index) => (
        // Lines have no identity to an outsider, and the list only grows at the end.
        <li key={index}>
          {line.tag} :: {clock(line.seconds)} :: <PrivateBar size={line.size} />
        </li>
      ))}
    </ul>
  );
}

/**
 * What somebody outside a private room sees of it, under the door (SPEC-privacy-phase-3.md): who by tag, how much, and nothing that says what.
 * Read again every little while, since nothing tells an outsider when it changes.
 */
export default function PrivateOutline({ roomId }: { roomId: string }) {
  const [outline, setOutline] = useState<RoomOutline | null>(null);

  useEffect(() => {
    let alive = true;
    const read = () =>
      void getWatchRepository()
        .readRoomOutline(roomId)
        .then((next) => {
          if (alive) setOutline(next);
        })
        .catch(() => undefined);
    read();
    const timer = window.setInterval(read, 15000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [roomId]);

  if (outline === null) return null;

  return (
    <section className="mt-3 flex flex-col gap-2 text-label font-bold text-ink" data-private-outline>
      <p>
        PRIVATE ROOM :: {outline.live ? 'LIVE' : 'ENDED'} :: {outline.people.length} JOINED
      </p>
      {outline.people.length === 0 ? null : <p className="break-words" data-private-people>{outline.people.join('  ')}</p>}
      <p data-private-queue>{outline.queue} IN QUEUE</p>
      <p data-private-canvas>
        DRAWING :: {outline.strokes} STROKES BY {outline.strokePeople}
      </p>
      <PrivateLines lines={outline.messages} />
    </section>
  );
}
