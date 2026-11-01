'use client';

import Link from 'next/link';
import { useState } from 'react';
import { threadDomId } from '../lib/forum/anchors';
import { useNow } from '../lib/ui/use-now';
import { roomIsLive, streamFoldLabel } from '../lib/watch/rules';
import type { StreamFold } from '../lib/watch/types';
import { TimedMessage } from './WatchRoom';

/**
 * `STREAM CHAT` under a video in the archive (decision 8): collapsed, one fold per stream that played
 * the file, newest first, `<date> :: HOSTED BY <host> :: <n> MESSAGES`; open one and its lines read in
 * order, each stamped with where in the video it was said. Not drawn for a file never streamed.
 */
export default function StreamChatFolds({ folds }: { folds: StreamFold[] | undefined }) {
  const [open, setOpen] = useState(false);
  if (folds === undefined || folds.length === 0) return null;

  return (
    <div className="mt-1 pl-14 max-sm:pl-0" data-stream-chat={folds.length}>
      <button type="button" onClick={() => setOpen((value) => !value)} aria-expanded={open} className="cursor-pointer text-left text-label font-bold text-ink hover:underline">
        {open ? '[-]' : '[+]'} STREAM CHAT ({folds.length})
      </button>
      {open ? (
        <ul className="mt-1 space-y-1">
          {folds.map((fold) => (
            <StreamFoldRow key={fold.room.id} fold={fold} />
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function StreamFoldRow({ fold }: { fold: StreamFold }) {
  const [open, setOpen] = useState(false);
  const now = useNow(15000);

  return (
    <li className="text-label text-ink">
      <span className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => setOpen((value) => !value)} aria-expanded={open} className="cursor-pointer text-left font-bold hover:underline">
          {open ? '[-]' : '[+]'} {streamFoldLabel(fold.room.originalHostLabel, fold.room.startedAt, fold.messages.length)}
        </button>
        {roomIsLive(fold.room, now) ? <span className="bg-acid px-1 font-bold text-ink-plate">LIVE</span> : null}
        {fold.room.forumThreadId === null ? null : (
          <Link href={`/forum#${threadDomId(fold.room.forumThreadId)}`} className="key px-1 py-1 text-label">
            [ THREAD ]
          </Link>
        )}
      </span>
      {open ? (
        fold.messages.length === 0 ? (
          <p className="pl-4 text-ink-quiet">NOTHING WAS SAID.</p>
        ) : (
          <ol className="pl-4 text-prose">
            {fold.messages.map((message) => (
              <TimedMessage key={message.id} message={message} />
            ))}
          </ol>
        )
      ) : null}
    </li>
  );
}
