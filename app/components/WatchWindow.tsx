'use client';

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCatalogue } from '../lib/media/catalogue';
import { usePublicProfile } from '../lib/profile/use-public-profile';
import { useNow } from '../lib/ui/use-now';
import { PLATE, PLATE_MAIN } from '../lib/ui/controls';
import { useEdgeReserve } from '../lib/ui/use-edge-reserve';
import { roomIsLive } from '../lib/watch/rules';
import { streamBarState, subscribeToStreamBar } from '../lib/watch/stream-bar';
import { useWatchRoom } from '../lib/watch/use-watch-room';
import {
  closeWatch,
  collapseWatch,
  expandWatch,
  openWatch,
  subscribeToWatchWindow,
  watchWindowServerState,
  watchFocusFromSearch,
  watchWindowState,
} from '../lib/watch/watch-window';
import ArtMark from './ArtMark';
import { useAuth } from './AuthProvider';
import DockWindow from './DockWindow';
import WatchRoom from './WatchRoom';
import { askToSaveCanvas } from '../lib/watch/use-room-canvas';

/** Large, over the board, like the arcade but bigger: the video is the point (decision 1). */
/** Wide enough to take the screen: the room opens filling it (`fill`), as the video wants all the room it can get. */
const ROOM_SIZE = { w: 2560, h: 1440 };
const ROOM_MIN = { w: 560, h: 420 };
/** The folded room's hand-drawn mark (`mark-up-wide` in app/lib/ui/art/slots.ts), shown at 40x16. */
const UP_MARK_SRC = '/assets/icons/up-wide.png';
const UP_MARK_WIDTH = 40;
const UP_MARK_HEIGHT = 16;

/**
 * The stream room, drawn once in `layout.tsx` (SPEC-watch-together.md).
 *
 * It reads the address (`lib/watch/watch-window.ts`) and opens for one of two purposes: an old pre-live
 * address, which now points to CYTUBE (GO LIVE lives there, SPEC-cytube.md), or a room. Closing it is leaving the room; the room itself asks a host first.
 */
export default function WatchWindow() {
  const state = useSyncExternalStore(subscribeToWatchWindow, watchWindowState, watchWindowServerState);
  const search = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const asked = search.toString();

  useEffect(() => {
    const named = watchFocusFromSearch(asked.length === 0 ? '' : `?${asked}`);
    if (named !== null) openWatch(named);
  }, [asked]);

  /** Closes the window and spends the address, so the same link opens it again later. */
  const close = useCallback(() => {
    closeWatch();
    if (watchFocusFromSearch(asked.length === 0 ? '' : `?${asked}`) !== null) router.replace(pathname);
  }, [asked, pathname, router]);

  /** Folds the room away and spends the address the same way, so a link to the room unfolds it again. */
  const collapse = useCallback(() => {
    collapseWatch();
    if (watchFocusFromSearch(asked.length === 0 ? '' : `?${asked}`) !== null) router.replace(pathname);
  }, [asked, pathname, router]);

  if (!state.open || state.focus === null) return null;

  return state.focus.kind === 'prelive' ? (
    <PreLiveWindow mediaItemId={state.focus.mediaItemId} onClose={close} />
  ) : (
    <RoomWindow key={state.focus.roomId} roomId={state.focus.roomId} collapsed={state.collapsed} onCollapse={collapse} onLeft={close} />
  );
}

/**
 * An old "load a file, then GO LIVE" address (`?watch=new&media=`): GO LIVE is only on the CYTUBE page now
 * (SPEC-cytube.md), so the window shows the file and points there. Nothing here starts a room.
 */
function PreLiveWindow({ mediaItemId, onClose }: { mediaItemId: string; onClose: () => void }) {
  const { user } = useAuth();
  const catalogue = useCatalogue();
  const item = catalogue.items.find((candidate) => candidate.id === mediaItemId && candidate.kind === 'video');
  const name = user?.displayName ?? 'GUEST';

  return (
    <DockWindow id="stream" fill title={`STREAM :: ${name}`} badge="NOT LIVE" onClose={onClose} dock="top" defaultSize={ROOM_SIZE} minSize={ROOM_MIN}>
      {catalogue.loading ? (
        <p className="text-label font-bold text-ink">READING THE CATALOGUE...</p>
      ) : item === undefined ? (
        <p className="w-fit bg-bubble-pale px-1 text-label font-bold text-ink-bar">NO SUCH VIDEO.</p>
      ) : (
        <div className="flex flex-col gap-2">
          <p className="text-sm font-bold text-ink">{item.title}</p>
          <video controls preload="metadata" src={item.src} className="aspect-video w-full max-h-[60vh] bg-ink-plate object-contain">
            <track kind="captions" />
          </video>
          {user === null ? (
            <p className="text-label font-bold text-ink">
              <Link href="/account" className="key px-1 py-1 text-label">
                [ LOG IN ]
              </Link>{' '}
              TO STREAM
            </p>
          ) : (
            <p className="flex flex-wrap items-center gap-2 text-label font-bold text-ink">
              <Link href="/cytube" className={PLATE_MAIN} onClick={onClose}>
                [ GO LIVE ON CYTUBE ]
              </Link>
              THEN ADD THIS FROM THE QUEUE.
            </p>
          )}
        </div>
      )}
    </DockWindow>
  );
}

/** A room: read once, followed while live. Folded away (`collapsed`) it plays on out of sight. */
function RoomWindow({ roomId, collapsed, onCollapse, onLeft }: { roomId: string; collapsed: boolean; onCollapse: () => void; onLeft: () => void }) {
  const { read, error } = useWatchRoom(roomId);
  const [closing, setClosing] = useState(false);
  const { profile } = usePublicProfile(read?.room.hostId ?? null);
  const now = useNow(5000);
  const live = read !== undefined && read !== null && roomIsLive(read.room, now);
  const hostName = profile?.displayName ?? read?.room.originalHostLabel ?? '';

  return (
    <>
      <DockWindow
        // Was "watch" before the room filled the screen; a new id so a size saved for the old room does not stick.
        id="stream"
        fill
        title={read ? `${read.room.origin === 'music' ? 'MUSIC' : 'STREAM'} :: ${hostName.toUpperCase()}` : 'STREAM'}
        badge={read ? (live ? 'LIVE' : read.room.origin === 'music' ? 'OFF' : 'ENDED') : undefined}
        // Leaving with a changed canvas nobody saved asks "save this canvas?" first (SPEC-stream-art.md).
        onClose={() => void askToSaveCanvas(roomId).then(() => (read && live ? setClosing(true) : onLeft()))}
        onMinimize={read ? onCollapse : undefined}
        minimized={collapsed}
        aboveBottomBar
        dock="top"
        defaultSize={ROOM_SIZE}
        minSize={ROOM_MIN}
      >
        {read === undefined ? (
          error === null ? (
            <p className="text-label font-bold text-ink">READING THE STREAM...</p>
          ) : (
            <p className="w-fit bg-bubble-pale px-1 text-label font-bold text-ink-bar" role="alert">
              {error}
            </p>
          )
        ) : read === null ? (
          <p className="text-label font-bold text-ink">NO SUCH STREAM.</p>
        ) : (
          <WatchRoom read={read} closing={closing} onStay={() => setClosing(false)} onLeft={onLeft} />
        )}
      </DockWindow>
      {collapsed ? <UpBox live={live} hostName={hostName} /> : null}
      {read === undefined || read === null ? <BarWaiting text={read === null ? 'NO SUCH STREAM.' : (error ?? 'READING THE STREAM...')} /> : null}
    </>
  );
}

/** The music bar's stream box before the room has been read (the room draws its own part once it has). */
function BarWaiting({ text }: { text: string }) {
  const target = useSyncExternalStore(subscribeToStreamBar, () => streamBarState().target, () => null);
  if (target === null) return null;
  return createPortal(<span className="min-w-0 flex-1 frame bg-hardware px-2 py-1 text-label font-bold text-ink-bar">{text}</span>, target);
}

/**
 * The room folded away: a framed tile with a wide up arrow just above the music bar's TV key (`--music-top`,
 * whichever shape the player is in; Luke, 2026-11-03). Pressing it brings the room back; so does any link to
 * the room (watch-window.ts). Still: the TV key under it is the one that wiggles.
 */
function UpBox({ live, hostName }: { live: boolean; hostName: string }) {
  const tip = live ? `BACK TO THE STREAM WITH ${hostName.toUpperCase()}` : 'BACK TO THE STREAM (ENDED)';
  // The page window's foot keeps clear of it (`--stream-box`, ./SiteWindow.tsx), as it does of the player.
  const box = useRef<HTMLSpanElement>(null);
  useEdgeReserve(box, '--stream-box', true);

  return (
    // A framed tile, like the folded music player under it: a bare key would sit straight on the desktop.
    <span
      ref={box}
      className="fixed z-50 frame bg-sun-pale p-0.5"
      // Over the bar's left key (`--music-key-left`, ./MusicPlayer.tsx); the folded tile and the phone card sit at 0.5rem.
      style={{ bottom: 'calc(var(--music-top, 0px) + 0.5rem)', left: 'var(--music-key-left, 0.5rem)' }}
      data-watch-tv-box={live ? 'live' : 'ended'}
    >
      <button type="button" onClick={expandWatch} className={PLATE} aria-label={tip} title={tip}>
        <ArtMark src={UP_MARK_SRC} size={UP_MARK_HEIGHT} width={UP_MARK_WIDTH} fallback="[ ▲ ]" />
      </button>
    </span>
  );
}
