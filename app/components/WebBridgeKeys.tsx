'use client';

import { useCallback, useState } from 'react';
import { PLATE } from '../lib/ui/controls';
import { explain } from '../lib/ui/explain';
import { isQueueableWebLink, watchLinkForItem, webAnchor } from '../lib/web/bridges';
import type { WebItem } from '../lib/web/types';
import type { DiscussQuery } from '../lib/watch/types';
import CommentWindow from './CommentWindow';
import { useForum } from './ForumProvider';

/**
 * The two bridges on a /web row (SPEC-web.md, Phase 5).
 *
 * DISCUSS opens the item's own comment window, exactly as a track or a concept sheet does: the first
 * comment files the thread (one per item, by anchor), later ones answer it. The room's key is ./WatchInRoomKey.tsx; `canWatch`
 * says whether a row gets it.
 */

/**
 * `onOpen`: told when the window opens (an EVERYWHERE result asks to be saved; save-opened.ts). `short` (Luke's list,
 * 2026-11-14: "comment option smaller"): a MEDIA row's key is the pen alone, `[ ✎ ]`, with the count beside it when there
 * are comments; its name for a screen reader and its tip still say DISCUSS.
 */
export function WebDiscussKey({ item, onOpen, short = false }: { item: WebItem; onOpen?: () => void; short?: boolean }) {
  const forum = useForum();
  const [open, setOpen] = useState(false);
  const anchor = webAnchor(item);
  const count = forum.commentCountForAnchor(anchor);
  const close = useCallback(() => setOpen(false), []);

  return (
    <>
      <button
        type="button"
        onClick={() => {
          onOpen?.();
          setOpen(true);
        }}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`Discuss "${item.title}" on the forum${count > 0 ? ` (${count} comments)` : ''}`}
        title={short ? 'Discuss' : undefined}
        className={PLATE}
        data-discuss-key
        {...explain('Opens the forum talk about this: what people wrote, and a box to add your own.', 'The number is how many comments it has. The talk is on the forum, for everyone to read.')}
        data-discuss-ref={item.id}
      >
        {short ? `[ ✎${count > 0 ? ` ${count}` : ''} ]` : `[ DISCUSS${count > 0 ? ` (${count})` : ''} ]`}
      </button>
      {open ? <CommentWindow anchor={anchor} onClose={close} roomChat={discussQuery(item)} /> : null}
    </>
  );
}

/**
 * What its DISCUSS page looks room chat up by (SPEC-room-chat-discuss.md): the result's own id, which a queue item added from
 * a row keeps, and the address a room would play, for items queued before that (or into your own room, which keeps only it).
 */
export function discussQuery(item: WebItem): DiscussQuery {
  const link = watchLinkForItem(item);
  return { webRef: item.id, mediaItemId: null, urls: link === null ? [] : [link.url] };
}

/** Whether a row offers a room at all: video or audio, on a platform with a fitting player. */
export function canWatch(item: WebItem): boolean {
  const link = watchLinkForItem(item);
  return link !== null && isQueueableWebLink(link);
}
