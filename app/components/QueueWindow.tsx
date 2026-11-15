'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import {
  closeQueues,
  openQueues,
  queueTabRequested,
  queuesRequested,
  queueWindowServerState,
  queueWindowState,
  showQueueTab,
  subscribeToQueueWindow,
  type QueueTab,
} from '../lib/audio/queue-window';
import { useCatalogue } from '../lib/media/catalogue';
import { PLATE_LINK } from '../lib/ui/controls';
import { useNow } from '../lib/ui/use-now';
import { ownRoomState, subscribeToOwnRoom } from '../lib/watch/own-room-client';
import { roomIsLive } from '../lib/watch/rules';
import { useWatchRoom } from '../lib/watch/use-watch-room';
import { useAuth } from './AuthProvider';
import DockWindow from './DockWindow';
import { useMusicPlayer } from './MusicPlayerProvider';
import RadioLoops from './RadioLoops';
import StreamQueueWindow from './StreamQueueWindow';

/**
 * The queue window: your room's queue, and where you have been, in two tabs (SPEC-rooms-queues.md).
 *
 * Drawn once, in `layout.tsx`, outside the page - which is what makes it a window rather than a page:
 * opening it or switching a tab re-renders *this*, and the board behind it is not touched at all. The
 * archive and the arcade keep the same arrangement, and `app/lib/audio/queue-window.ts` holds the state
 * so no page has to know the window exists.
 *
 * UP NEXT is your own room's queue, the same queue window a live room has (`StreamQueueWindow`), drawn
 * without a frame of its own: search, add, reorder, take out. It is kept on your account, or in this
 * browser for a signed-out visitor. RADI-OH is the plates of what you played lately, as before. The list
 * of live rooms that used to be the second tab is on the STREAM page's ROOMS tab, where the same list
 * already was; GO PUBLIC is gone, and GO LIVE is how people are let in.
 *
 * **The tabs are the width of the window rather than of their labels.** A tab strip whose tabs are only
 * as wide as their words reads as a row of links; these are `flex-1`, so the strip is equal cells and
 * the window below is visibly one thing with two faces.
 *
 * **Both screens stay mounted**, and the one that is not on is hidden, for the reason `MusicWindow`
 * gives: the browser keeps a search box, a filter and a scroll position, and unmounting to switch would
 * throw all of it away.
 */
export default function QueueWindow() {
  const state = useSyncExternalStore(subscribeToQueueWindow, queueWindowState, queueWindowServerState);
  const search = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();

  /** The query as it stands, without the `?`. */
  const asked = search.toString();
  const query = asked.length === 0 ? '' : `?${asked}`;

  // Read whenever the address changes rather than only as the window mounts: the window and the board
  // share a route, so a link to `/forum?queues=1` changes the query without remounting anything.
  useEffect(() => {
    if (queuesRequested(query)) openQueues(queueTabRequested(query));
  }, [query]);

  /** Closes the window, and spends the address with it, so the same link works twice. */
  const close = useCallback(() => {
    closeQueues();

    if (queuesRequested(query)) router.replace(pathname);
  }, [pathname, query, router]);

  /**
   * Switches tab *and* rewrites the address, so the tab a reader is looking at is the one a reload
   * brings them back to.
   *
   * `scroll: false` because this is a change *within* a window that is already open: letting the router
   * jump to the top of the board would move the thread the reader is reading, which is the one thing a
   * docked window exists to avoid.
   */
  const show = useCallback(
    (tab: QueueTab) => {
      showQueueTab(tab);
      router.replace(tab === 'queues' ? `${pathname}?queues=1` : `${pathname}?queues=${tab}`, { scroll: false });
    },
    [pathname, router],
  );

  if (!state.open) return null;

  // The MIXTAPES tab was cut before it was built (SPEC-efficiency.md), but `?queues=third` can still be
  // linked or stored, so that tab lands on UP NEXT rather than on a window with nothing shown in it.
  const tab = state.tab === 'third' ? 'queues' : state.tab;

  return (
    <DockWindow
      title="QUEUE"
      onClose={close}
      id="queue"
      defaultSize={{ w: 736, h: 600 }}
      minSize={{ w: 420, h: 260 }}
      status="YOUR ROOM"
    >
      <div className="mb-2 flex items-stretch gap-1" role="tablist" aria-label="Queue screens">
        <QueueTabPlate label="UP NEXT" selected={tab === 'queues'} onSelect={() => show('queues')} />
        <QueueTabPlate label="RADI-OH" selected={tab === 'radio'} onSelect={() => show('radio')} />
      </div>

      <div className={tab === 'queues' ? undefined : 'hidden'}>
        <OwnQueue onClose={close} />
      </div>

      <div className={tab === 'radio' ? undefined : 'hidden'}>
        <RadioLoops />
      </div>
    </DockWindow>
  );
}

/**
 * UP NEXT: your own room's queue. The room's keeper (`MusicRoomKeeper.tsx`) found or started the room; this reads the
 * same copy the bar plays from, so a song queued anywhere on the site is here at once.
 */
function OwnQueue({ onClose }: { onClose: () => void }) {
  const own = useSyncExternalStore(subscribeToOwnRoom, ownRoomState, ownRoomState);
  const { read } = useWatchRoom(own.roomId, { follow: false });
  const catalogue = useCatalogue();
  const itemsById = useMemo(() => new Map(catalogue.items.map((item) => [item.id, item])), [catalogue.items]);
  // In a live room the bar, the screen and this window are that room's (SPEC-rooms-queues.md, phase 3): the same
  // queue its own window shows, by the same rules (a crown adds straight in). The room's window keeps the copy fresh.
  const { user } = useAuth();
  const liveId = useMusicPlayer().room?.roomId ?? null;
  const liveRoom = useWatchRoom(liveId, { follow: false }).read;
  const now = useNow(5000);

  if (liveId !== null && user !== null && liveRoom !== undefined && liveRoom !== null && roomIsLive(liveRoom.room, now)) {
    return (
      <section aria-label="Up next" data-own-room="live">
        <p className="border-b border-ink px-2 py-1 text-label font-bold text-ink" data-own-room-note="live">
          THE LIVE ROOM&apos;S QUEUE. YOUR OWN QUEUE WAITS FOR YOU UNTIL YOU LEAVE.
        </p>
        <StreamQueueWindow bare read={liveRoom} itemsById={itemsById} live userId={user.id} members={[]} nowLive onClose={onClose} />
      </section>
    );
  }

  if (own.roomId === null || read === undefined || read === null) {
    return <p className="p-3 text-label font-bold text-ink">READING YOUR QUEUE...</p>;
  }

  return (
    <section aria-label="Up next" data-own-room={own.visitor ? 'browser' : 'account'}>
      {own.visitor ? (
        <p className="border-b border-ink px-2 py-1 text-label text-ink" data-own-room-note="visitor">
          KEPT IN THIS BROWSER ONLY.{' '}
          <Link href="/account" className={PLATE_LINK}>
            [ LOG IN ]
          </Link>{' '}
          TO KEEP IT ON YOUR ACCOUNT.
        </p>
      ) : null}
      {own.waiting ? (
        <p role="status" className="border-b border-ink bg-bubble-pale px-2 py-1 text-label font-bold text-ink-bar" data-own-room-note="waiting">
          NOT SAVED YET: THE DATABASE CAN&apos;T BE REACHED. IT CARRIES ON HERE AND SAVES WHEN IT CAN.
        </p>
      ) : null}
      {own.note ? (
        <p role="alert" className="border-b border-ink bg-bubble-pale px-2 py-1 text-label font-bold text-ink-bar" data-own-room-note="refused">
          {own.note}
        </p>
      ) : null}
      {/* Your own room is always open to you: nothing about it waits on a host being there. */}
      <StreamQueueWindow bare read={read} itemsById={itemsById} live userId={own.hostId} members={[]} nowLive={false} onClose={onClose} />
    </section>
  );
}

/** One tab: an equal cell of the strip, pressed in while its screen is the one on. */
function QueueTabPlate({
  label,
  selected,
  onSelect,
}: {
  label: string;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={selected}
      onClick={onSelect}
      className={`min-w-0 flex-1 cursor-pointer truncate px-2 py-1 text-key tracking-wide max-sm:min-h-tap max-sm:px-3 max-sm:text-sm ${
        selected
          ? 'key key-fill [--key-fill:var(--color-ink)] text-paper'
          : 'key'
      }`}
    >
      [ {label} ]
    </button>
  );
}
