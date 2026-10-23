'use client';

import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import {
  closeQueues,
  openQueues,
  queueTabRequested,
  queuesRequested,
  queueWindowState,
  showQueueTab,
  subscribeToQueueWindow,
  type QueueTab,
} from '../lib/audio/queue-window';
import DockWindow from './DockWindow';
import RadioLoops from './RadioLoops';
import QueueBrowser from './QueueBrowser';

/**
 * The queue window: what you can listen along to, in three tabs.
 *
 * Drawn once, in `layout.tsx`, outside the page - which is what makes it a window rather than a page:
 * opening it, switching a tab or following somebody's queue re-renders *this*, and the board behind it
 * is not touched at all. The archive and the arcade keep the same arrangement, and
 * `app/lib/audio/queue-window.ts` holds the state so no page has to know the window exists.
 *
 * **Three tabs, and they are the width of the window rather than of their labels.** A tab strip whose
 * tabs are only as wide as their words reads as a row of links; these are `flex-1`, so the strip is
 * three equal cells and the window below is visibly one thing with three faces. It is also why the
 * labels are short - `RADI-OH`, `QUEUES`, and a third that is deliberately empty - because a long word
 * in an equal cell is a word that truncates on a phone.
 *
 * **All three screens stay mounted**, and the two that are not on are hidden, for the reason
 * `MusicWindow` gives: the browser keeps a search box, a filter and a scroll position, and unmounting to
 * switch would throw all of it away. Hiding costs nothing here - neither screen subscribes to the
 * other's state, and a hidden one reads nothing.
 */
export default function QueueWindow() {
  const state = useSyncExternalStore(subscribeToQueueWindow, queueWindowState, queueWindowState);
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
      router.replace(tab === 'radio' ? `${pathname}?queues=1` : `${pathname}?queues=${tab}`, { scroll: false });
    },
    [pathname, router],
  );

  if (!state.open) return null;

  return (
    <DockWindow
      title="PLAYLISTS"
      badge="[ QUEUE ]"
      onClose={close}
      id="queue"
      defaultSize={{ w: 736, h: 600 }}
      minSize={{ w: 420, h: 260 }}
      status="LISTEN ALONG :: FOLLOWING SOMEBODY TAKES THE PLAYER OVER, AND WHAT YOU HAD IS KEPT IN RADI-OH"
    >
      <div className="mb-2 flex items-stretch gap-1" role="tablist" aria-label="Queue screens">
        <QueueTabPlate label="RADI-OH" selected={state.tab === 'radio'} onSelect={() => show('radio')} />
        <QueueTabPlate label="QUEUES" selected={state.tab === 'queues'} onSelect={() => show('queues')} />
        <QueueTabPlate label="MIXTAPES" selected={state.tab === 'third'} onSelect={() => show('third')} />
      </div>

      <div className={state.tab === 'radio' ? undefined : 'hidden'}>
        <RadioLoops />
      </div>

      <div className={state.tab === 'queues' ? undefined : 'hidden'}>
        <QueueBrowser />
      </div>

      <div className={state.tab === 'third' ? undefined : 'hidden'}>
        <EmptyTab name="MIXTAPES" />
      </div>
    </DockWindow>
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
          : 'key bg-sun-pale text-ink hover:text-accent-ink'
      }`}
    >
      {label}
    </button>
  );
}

/**
 * The third tab: a screen that says it is not built yet.
 *
 * Drawn rather than omitted, and that is the point - a three-cell strip that suddenly has two cells is a
 * strip that moved. It says what it will hold so the shape is explained rather than looking broken.
 */
function EmptyTab({ name }: { name: string }) {
  return (
    <section className="frame bg-sun-pale p-3">
      <p className="text-key font-bold text-ink">{name} IS NOT BUILT YET.</p>
      <p className="mt-1 text-label text-ink-quiet">
        THE TAB IS HERE SO THE STRIP KEEPS ITS SHAPE. WHAT IT WILL HOLD IS STILL BEING DECIDED, SO
        NOTHING IS DRAWN BENEATH THIS LINE RATHER THAN SOMETHING THAT PRETENDS.
      </p>
    </section>
  );
}
