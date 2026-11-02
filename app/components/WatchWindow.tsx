'use client';

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCatalogue } from '../lib/media/catalogue';
import { usePublicProfile } from '../lib/profile/use-public-profile';
import { useNow } from '../lib/ui/use-now';
import { PLATE, PLATE_MAIN } from '../lib/ui/controls';
import { useEdgeReserve } from '../lib/ui/use-edge-reserve';
import { getWatchRepository } from '../lib/watch/repository';
import { roomIsLive, streamAnchor, streamThreadTitle } from '../lib/watch/rules';
import { primeRoom, useWatchRoom } from '../lib/watch/use-watch-room';
import {
  closeWatch,
  collapseWatch,
  expandWatch,
  openWatch,
  subscribeToWatchWindow,
  watchFocusFromSearch,
  watchHref,
  watchWindowState,
} from '../lib/watch/watch-window';
import ArtMark from './ArtMark';
import { useAuth } from './AuthProvider';
import DockWindow from './DockWindow';
import { useForum } from './ForumProvider';
import WatchRoom from './WatchRoom';

/** Large, over the board, like the arcade but bigger: the video is the point (decision 1). */
/** Wide enough to take the screen: the room opens filling it (`fill`), as the video wants all the room it can get. */
const ROOM_SIZE = { w: 2560, h: 1440 };
const ROOM_MIN = { w: 560, h: 420 };
/** The TV box's hand-drawn mark (`mark-tv` in app/lib/ui/art/slots.ts), shown at 24px. */
const TV_MARK_SRC = '/assets/icons/tv.png';
const TV_MARK_SIZE = 24;

/**
 * The stream room, drawn once in `layout.tsx` (SPEC-watch-together.md).
 *
 * It reads the address (`lib/watch/watch-window.ts`) and opens for one of two purposes: the host's
 * window before going live, with the file loaded and `[ GO LIVE ]` (the second of the two presses a
 * start takes), or a room. Closing it is leaving the room; the room itself asks a host first.
 */
export default function WatchWindow() {
  const state = useSyncExternalStore(subscribeToWatchWindow, watchWindowState, watchWindowState);
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

/** The host's window before anybody can see it: the file, and the key that opens the room. */
function PreLiveWindow({ mediaItemId, onClose }: { mediaItemId: string; onClose: () => void }) {
  const { user } = useAuth();
  const forum = useForum();
  const catalogue = useCatalogue();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const item = catalogue.items.find((candidate) => candidate.id === mediaItemId && candidate.kind === 'video');
  const name = user?.displayName ?? 'GUEST';

  async function goLive() {
    if (user === null || item === undefined) return;
    setBusy(true);
    setError(null);

    try {
      const id = crypto.randomUUID();
      const read = await getWatchRepository().openRoom({ id, host: { id: user.id, label: user.displayName }, mediaItemId: item.id });
      primeRoom(read);

      // The forum record, filed as it starts and drawn from the room (decision 9). A room that could not
      // be filed is still a room: the stream goes on, and the thread is what is missing.
      try {
        const thread = await forum.createThread({ title: streamThreadTitle(user.displayName, read.room.startedAt), body: '', anchor: streamAnchor(id) });
        await getWatchRepository().attachThread(id, thread.id);
        // Into the shared copy at once, so the room does not say NOT ON THE BOARD until the echo arrives.
        primeRoom({ ...read, room: { ...read.room, forumThreadId: thread.id } });
      } catch {
        // Said by the room's own line (NOT ON THE BOARD) rather than here: the window is about to change.
      }

      openWatch({ kind: 'room', roomId: id });
      router.replace(watchHref({ kind: 'room', roomId: id }));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'THE STREAM COULD NOT START.');
      setBusy(false);
    }
  }

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
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" onClick={() => void goLive()} disabled={busy} className={PLATE_MAIN}>
                {busy ? '[ GOING LIVE... ]' : '[ GO LIVE ]'}
              </button>
              {error === null ? null : (
                <span className="w-fit bg-bubble-pale px-1 text-label font-bold text-ink-bar" role="alert">
                  {error}
                </span>
              )}
            </div>
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
        title={read ? `STREAM :: ${hostName.toUpperCase()}` : 'STREAM'}
        badge={read ? (live ? 'LIVE' : 'ENDED') : undefined}
        onClose={() => (read && live ? setClosing(true) : onLeft())}
        onMinimize={read ? onCollapse : undefined}
        minimized={collapsed}
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
      {collapsed ? <TvBox live={live} hostName={hostName} /> : null}
    </>
  );
}

/**
 * The room folded away: a framed tile just above the music player's ♪ (`--music-top`, whichever shape the
 * player is in), wiggling every few seconds while the stream is on. Pressing it brings the room back; so do
 * the `[ TV ]` keys and any link to the room (watch-window.ts).
 */
function TvBox({ live, hostName }: { live: boolean; hostName: string }) {
  const tip = live ? `BACK TO THE STREAM WITH ${hostName.toUpperCase()}` : 'BACK TO THE STREAM (ENDED)';
  // The page window's foot keeps clear of it (`--stream-box`, ./SiteWindow.tsx), as it does of the player.
  const box = useRef<HTMLSpanElement>(null);
  useEdgeReserve(box, '--stream-box', true);

  return (
    // A framed tile, like the folded music player under it: a bare key would sit straight on the desktop.
    <span
      ref={box}
      className={`fixed left-2 z-50 frame bg-sun-pale p-0.5 ${live ? 'animate-wiggle hover:animate-none' : ''}`}
      style={{ bottom: 'calc(var(--music-top, 0px) + 0.5rem)' }}
      data-watch-tv-box={live ? 'live' : 'ended'}
    >
      <button type="button" onClick={expandWatch} className={PLATE} aria-label={tip} title={tip}>
        <ArtMark src={TV_MARK_SRC} size={TV_MARK_SIZE} fallback="[ TV ]" />
      </button>
    </span>
  );
}
