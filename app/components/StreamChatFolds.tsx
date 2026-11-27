'use client';

import Link from 'next/link';
import { useState } from 'react';
import { threadDomId } from '../lib/forum/anchors';
import { useNow } from '../lib/ui/use-now';
import { roomIsLive, streamFoldLabel } from '../lib/watch/rules';
import type { StreamFold } from '../lib/watch/types';
import { usePrivateFold } from '../lib/watch/use-private-folds';
import { PrivateBar } from './PrivateOutline';
import { TimedMessage } from './WatchRoom';
import { explain } from '../lib/ui/explain';

/**
 * `STREAM CHAT` under a video in the archive (decision 8): collapsed, one fold per stream that played
 * the file, newest first, `<date> :: HOSTED BY <host> :: <n> MESSAGES`; open one and its lines read in
 * order, each stamped with where in the video it was said. Not drawn for a file never streamed.
 */
export default function StreamChatFolds({ folds, mediaId }: { folds: StreamFold[] | undefined; mediaId?: string }) {
  const [open, setOpen] = useState(false);
  const hidden = usePrivateFold(mediaId ?? '');
  const privateLine =
    mediaId === undefined || hidden === null ? null : (
      <div className="mt-1 pl-14 text-label font-bold text-ink max-sm:pl-0" data-stream-chat-private>
        <p>{hidden.rooms} PRIVATE {hidden.rooms === 1 ? 'STREAM' : 'STREAMS'}</p>
        {hidden.sizes.length === 0 ? null : (
          <ul>
            {hidden.sizes.map((size, index) => (
              <li key={index}>
                <PrivateBar size={size} />
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  if (folds === undefined || folds.length === 0) return privateLine;

  return (
    <>
    {privateLine}
    <div className="mt-1 pl-14 max-sm:pl-0" data-stream-chat={folds.length}>
      <button type="button" onClick={() => setOpen((value) => !value)} aria-expanded={open} {...explain(open ? 'Folds the stream chat shut.' : 'Opens the chat from every stream that played this, newest first.', 'To read what people said while it played in a room.')} className="cursor-pointer text-left text-label font-bold text-ink hover:underline">
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
    </>
  );
}

function StreamFoldRow({ fold }: { fold: StreamFold }) {
  const [open, setOpen] = useState(false);
  const now = useNow(15000);

  return (
    <li className="text-label text-ink">
      <span className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => setOpen((value) => !value)} aria-expanded={open} {...explain(open ? 'Folds this stream\'s chat shut.' : 'Opens this stream\'s chat, each line stamped with where in the video it was said.', 'One fold for each stream that played it.')} className="cursor-pointer text-left font-bold hover:underline">
          {open ? '[-]' : '[+]'} {streamFoldLabel(fold.room.originalHostLabel, fold.room.startedAt, fold.messages.length)}
        </button>
        {roomIsLive(fold.room, now) ? <span className="bg-acid px-1 font-bold text-ink-plate">LIVE</span> : null}
        {fold.room.forumThreadId === null ? null : (
          <Link href={`/forum#${threadDomId(fold.room.forumThreadId)}`} className="key px-1 py-1 text-label" {...explain('Goes to this stream\'s record on the board.', 'Every file it played, in order, and the replies under it.')}>
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
