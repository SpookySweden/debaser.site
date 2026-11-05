'use client';

import Link from 'next/link';
import { useCallback, useState } from 'react';
import { PLATE, PLATE_MAIN, PLATE_PRESSED } from '../lib/ui/controls';
import { getWatchRepository } from '../lib/watch/repository';
import { hasCrown, nextQueuePosition, queueRights, roomIsLive } from '../lib/watch/rules';
import { applyLocalChange, useWatchRoom } from '../lib/watch/use-watch-room';
import { useWatching } from '../lib/watch/use-watching';
import { watchHref } from '../lib/watch/watch-window';
import { isQueueableWebLink, watchLinkForItem, webAnchor } from '../lib/web/bridges';
import type { WebItem } from '../lib/web/types';
import { useAuth } from './AuthProvider';
import CommentWindow from './CommentWindow';
import { CYTUBE_HREF } from './StreamAddKey';
import { useForum } from './ForumProvider';

/**
 * The two bridges on a /web row (SPEC-web.md, Phase 5).
 *
 * DISCUSS opens the item's own comment window, exactly as a track or a concept sheet does: the first
 * comment files the thread (one per item, by anchor), later ones answer it. ADD TO ROOM (WATCH until Luke renamed it, 2026-11-05) puts the item in the
 * stream room the reader hosts, as the platform's own player: one press opens the panel, a second
 * commits, as everything started from the board does.
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

/** Whether a row offers ADD TO ROOM at all: video or audio, on a platform with a fitting player. */
export function canWatch(item: WebItem): boolean {
  const link = watchLinkForItem(item);
  return link !== null && isQueueableWebLink(link);
}

export function WebWatchKey({ item, open, onToggle }: { item: WebItem; open: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      aria-label={open ? `Close the add to room panel for "${item.title}"` : `Add "${item.title}" to your stream room`}
      className={open ? PLATE_PRESSED : PLATE}
    >
      {open ? '[ ■ ADD TO ROOM ]' : '[ ADD TO ROOM ]'}
    </button>
  );
}

/** `listed`: the host's crown was off, so it went onto their own list in the room (SPEC-stream-queue.md). */
type QueueState = { kind: 'idle' } | { kind: 'busy' } | { kind: 'queued'; roomId: string; listed: boolean } | { kind: 'refused'; reason: string };

/** The panel under a row: where the item would go, and the press that puts it there. */
export function WebWatchPanel({ item }: { item: WebItem }) {
  const { user } = useAuth();
  const watching = useWatching(user?.id ?? null);
  const [state, setState] = useState<QueueState>({ kind: 'idle' });
  // The room you are in, if you host it or hold a crown there (SPEC-cytube.md); anybody else is pointed to CYTUBE.
  const roomIn = watching !== null ? watching.roomId : null;
  const { read: inRoom } = useWatchRoom(roomIn, { follow: false });
  const mayAdd = user !== null && inRoom !== undefined && inRoom !== null && (inRoom.room.hostId === user.id || hasCrown(inRoom.crowns, user.id));
  const hostedRoom = mayAdd ? roomIn : null;

  async function queue() {
    if (user === null || hostedRoom === null) return;
    const link = watchLinkForItem(item);
    if (link === null || !isQueueableWebLink(link)) {
      setState({ kind: 'refused', reason: "THIS ITEM CAN'T PLAY IN A ROOM." });
      return;
    }
    setState({ kind: 'busy' });
    try {
      const repository = getWatchRepository();
      const read = await repository.readRoom(hostedRoom);
      if (read === null || !roomIsLive(read.room, Date.now())) {
        setState({ kind: 'refused', reason: 'THAT ROOM IS NOT LIVE ANY MORE.' });
        return;
      }
      if (read.room.hostId !== user.id && !hasCrown(read.crowns, user.id)) {
        setState({ kind: 'refused', reason: 'ONLY THE HOST OR A CROWN ADDS FROM HERE.' });
        return;
      }
      // Straight into the queue with the host's crown on, as the room's own ADD does; onto their list with it off.
      const inQueue = queueRights(read.room, read.crowns, user.id, true).addsTo === 'queue';
      await repository.addToQueue({ roomId: hostedRoom, link, addedBy: user.id, position: nextQueuePosition(read.queue), inQueue });
      applyLocalChange(hostedRoom, { kind: 'refresh' });
      setState({ kind: 'queued', roomId: hostedRoom, listed: !inQueue });
    } catch (failure) {
      setState({ kind: 'refused', reason: failure instanceof Error ? failure.message : 'IT COULD NOT BE QUEUED.' });
    }
  }

  return (
    <div className="mt-2 frame bg-paper p-2 text-label text-ink" role="group" aria-label={`Stream room: ${item.title}`}>
      {user === null ? (
        <p className="font-bold">SIGN IN AND GO LIVE ON STREAM TO WATCH THIS IN A STREAM ROOM.</p>
      ) : state.kind === 'queued' ? (
        <p className="flex flex-wrap items-center gap-2 font-bold" role="status">
          {state.listed ? 'ADDED TO YOUR LIST IN YOUR STREAM ROOM.' : 'QUEUED IN YOUR STREAM ROOM.'}
          <Link href={watchHref({ kind: 'room', roomId: state.roomId })} className={PLATE}>
            [ OPEN ROOM ]
          </Link>
        </p>
      ) : hostedRoom === null ? (
        <p className="flex flex-wrap items-center gap-2 font-bold">
          YOU&apos;RE NOT HOSTING A STREAM ROOM. GO LIVE ON STREAM, THEN COME BACK.
          <Link href={CYTUBE_HREF} className={PLATE}>
            [ STREAM ]
          </Link>
        </p>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <p className="font-bold">ADD THIS TO THE QUEUE OF YOUR ROOM?</p>
          <button type="button" onClick={() => void queue()} disabled={state.kind === 'busy'} className={PLATE_MAIN}>
            {state.kind === 'busy' ? '[ ADDING... ]' : '[ + ADD TO QUEUE ]'}
          </button>
        </div>
      )}
      {state.kind === 'refused' ? (
        <p role="alert" className="mt-1 w-fit bg-bubble-pale px-1 font-bold text-ink-bar">
          {state.reason}
        </p>
      ) : null}
    </div>
  );
}
