'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useCatalogue } from '../lib/media/catalogue';
import { useNow } from '../lib/ui/use-now';
import { playOrder, roomIsLive, streamDate } from '../lib/watch/rules';
import type { WatchMessage, WatchQueueEntry } from '../lib/watch/types';
import { useWatchRoom } from '../lib/watch/use-watch-room';
import { watchHref } from '../lib/watch/watch-window';
import ProfileName from './ProfileName';
import { TimedMessage } from './WatchRoom';

/** The marker on a stream's card while it runs (decision 9). */
export function StreamMarker({ roomId }: { roomId: string }) {
  // Followed only while the room has not ended (`useWatchRoom`), so a board of old streams opens no feeds.
  const { read } = useWatchRoom(roomId);
  const now = useNow(15000);
  if (read === undefined || read === null || !roomIsLive(read.room, now)) return null;

  return <span className="shrink-0 bg-acid px-1 text-label font-bold text-ink-plate">LIVE</span>;
}

/**
 * A stream's forum record (decision 9): drawn from the room, its plays and its chat rather than from the
 * thread's body, so it grows while the stream runs and cannot drift from what happened. Every file in
 * the order it played (a file played twice is there twice), each with its own fold of timed messages.
 * Read-only: replies go under it like any post's.
 */
export default function StreamRecord({ roomId }: { roomId: string }) {
  const { read, error } = useWatchRoom(roomId);
  const catalogue = useCatalogue();
  const now = useNow(15000);

  if (read === undefined) return <p className="text-label font-bold text-ink">{error ?? 'READING THE STREAM...'}</p>;
  if (read === null) return <p className="text-label font-bold text-ink">THIS STREAM IS NOT ON RECORD.</p>;

  const live = roomIsLive(read.room, now);
  const plays = playOrder(read.queue);
  const titleOf = (entry: WatchQueueEntry) =>
    entry.link !== null
      ? entry.link.title
      : entry.mediaItemId === null ? 'A FILE NO LONGER HELD' : (catalogue.items.find((item) => item.id === entry.mediaItemId)?.title ?? 'A FILE NOT HELD');

  // Each line belongs to the play it was said over; a line with no play (a file since removed) goes
  // with the first play of its file.
  const byEntry = new Map<string, WatchMessage[]>();
  for (const message of read.messages) {
    const entryId = message.queueEntryId ?? plays.find((entry) => entry.mediaItemId === message.mediaItemId)?.id;
    if (entryId === undefined) continue;
    byEntry.set(entryId, [...(byEntry.get(entryId) ?? []), message]);
  }

  return (
    <div className="flex flex-col gap-1" data-stream-record={roomId}>
      <p className="flex flex-wrap items-center gap-2 text-label text-ink">
        <span className="font-bold">
          HOSTED BY <ProfileName author={{ id: read.room.originalHostId, displayName: read.room.originalHostLabel }} />
        </span>
        <span>{streamDate(read.room.startedAt)}</span>
        {live ? <span className="bg-acid px-1 font-bold text-ink-plate">LIVE</span> : <span className="font-bold">ENDED</span>}
        {live ? (
          <Link href={watchHref({ kind: 'room', roomId })} className="key px-1 py-1 text-label">
            [ ▶ WATCH ]
          </Link>
        ) : null}
      </p>

      {plays.length === 0 ? (
        <p className="text-label text-ink-quiet">NOTHING PLAYED.</p>
      ) : (
        <ol className="text-label text-ink" aria-label="Files played">
          {plays.map((entry, index) => (
            <PlayRow key={entry.id} number={index + 1} title={titleOf(entry)} href={entry.link?.url.startsWith('https://') ? entry.link.url : undefined} messages={byEntry.get(entry.id) ?? []} />
          ))}
        </ol>
      )}
    </div>
  );
}

/** One play. A link's title opens the original address (it has no /media page); the fold is the key before it. */
function PlayRow({ number, title, href, messages }: { number: number; title: string; href?: string; messages: WatchMessage[] }) {
  const [open, setOpen] = useState(false);
  const said = `${messages.length} MESSAGE${messages.length === 1 ? '' : 'S'}`;

  return (
    <li className="rule-pixel py-1">
      {href === undefined ? (
        <button type="button" onClick={() => setOpen((value) => !value)} aria-expanded={open} className="cursor-pointer text-left font-bold hover:underline">
          {open ? '[-]' : '[+]'} {number}. {title} :: {said}
        </button>
      ) : (
        <span className="font-bold">
          <button
            type="button"
            onClick={() => setOpen((value) => !value)}
            aria-expanded={open}
            aria-label={`${open ? 'Fold' : 'Unfold'} the chat over ${title}`}
            className="cursor-pointer text-left font-bold hover:underline max-sm:min-h-tap"
          >
            {open ? '[-]' : '[+]'} {number}.
          </button>{' '}
          <a href={href} target="_blank" rel="noopener noreferrer" className="wrap-anywhere underline" data-stream-link={href}>
            {title}
          </a>{' '}
          :: {said}
        </span>
      )}
      {open ? (
        messages.length === 0 ? (
          <p className="pl-4 text-ink-quiet">NOTHING WAS SAID.</p>
        ) : (
          <ol className="pl-4 text-prose">
            {messages.map((message) => (
              <TimedMessage key={message.id} message={message} />
            ))}
          </ol>
        )
      ) : null}
    </li>
  );
}
