'use client';

import { useCallback, useState } from 'react';
import { PLATE } from '../lib/ui/controls';
import { isQueueableWebLink, watchLinkForItem, webAnchor } from '../lib/web/bridges';
import type { WebItem } from '../lib/web/types';
import CommentWindow from './CommentWindow';
import { useForum } from './ForumProvider';

/**
 * The two bridges on a /web row (SPEC-web.md, Phase 5).
 *
 * DISCUSS opens the item's own comment window, exactly as a track or a concept sheet does: the first
 * comment files the thread (one per item, by anchor), later ones answer it. The room's key is ./WatchInRoomKey.tsx; `canWatch`
 * says whether a row gets it.
 */

/** `onOpen`: told when the window opens (an EVERYWHERE result asks to be saved; save-opened.ts). */
export function WebDiscussKey({ item, onOpen }: { item: WebItem; onOpen?: () => void }) {
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
        className={PLATE}
      >
        [ DISCUSS{count > 0 ? ` (${count})` : ''} ]
      </button>
      {open ? <CommentWindow anchor={anchor} onClose={close} /> : null}
    </>
  );
}

/** Whether a row offers a room at all: video or audio, on a platform with a fitting player. */
export function canWatch(item: WebItem): boolean {
  const link = watchLinkForItem(item);
  return link !== null && isQueueableWebLink(link);
}
