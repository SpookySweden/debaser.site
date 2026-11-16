'use client';

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCatalogue } from '../lib/media/catalogue';
import { usePublicProfile } from '../lib/profile/use-public-profile';
import { useNow } from '../lib/ui/use-now';
import { PLATE, PLATE_MAIN } from '../lib/ui/controls';
import { cornerSlot, noCornerSlot, subscribeToCornerSlot } from '../lib/ui/corner-shelf';
import { getWatchRepository } from '../lib/watch/repository';
import { roomIsLive, roomPrivacyLabel, roomShownName } from '../lib/watch/rules';
import { streamBarState, subscribeToStreamBar } from '../lib/watch/stream-bar';
import { guestReturnRoom } from '../lib/watch/guest-return';
import { announceRoomClientChange, hasStoredGuest } from '../lib/watch/room-client';
import { applyLocalChange, useWatchRoom } from '../lib/watch/use-watch-room';
import {
  closeWatch,
  collapseWatch,
  expandWatch,
  openWatch,
  subscribeToWatchWindow,
  watchWindowServerState,
  joinSecretFromSearch,
  watchFocusFromSearch,
  watchWindowState,
} from '../lib/watch/watch-window';
import PopoutWindow from './PopoutWindow';
import { useAuth } from './AuthProvider';
import { useRoomIdentity } from './use-room-identity';
import DockWindow from './DockWindow';
import { useLedgeHeadroom } from '../lib/companion/use-ledge-headroom';
import OwnRoomWindow from './OwnRoomWindow';
import RoomDoor from './RoomDoor';
import WatchRoom from './WatchRoom';
import { floatingState, subscribeToFloating } from '../lib/ui/floating-player';
import { ownRoomState, subscribeToOwnRoom } from '../lib/watch/own-room-client';
import { askToSaveCanvas } from '../lib/watch/use-room-canvas';

/** Large, over the board, like the arcade but bigger: the video is the point (decision 1). */
/** Wide enough to take the screen: the room opens filling it (`fill`), as the video wants all the room it can get. */
const ROOM_SIZE = { w: 2560, h: 1440 };
const ROOM_MIN = { w: 560, h: 420 };
/** The `[ _ ]` key's tip on a room's window: folding a room is putting its picture out (SPEC-rooms-your-room.md, part 2). */
const PIP_TIP = 'Picture in picture: the window tucks away and the picture floats';

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
  const { user: account } = useAuth();
  const accountId = account?.id ?? null;
  const ownRoomId = useSyncExternalStore(subscribeToOwnRoom, ownRoomIdNow, noOwnRoom);

  // Back from logging in at the guest window: the room opens again, and the connection a guest was on gives way to the account's (SPEC-guests.md).
  const accountWas = useRef(accountId);
  useEffect(() => {
    if (accountWas.current === accountId) return;
    accountWas.current = accountId;
    if (hasStoredGuest()) announceRoomClientChange();
  }, [accountId]);
  useEffect(() => {
    if (accountId === null) return;
    const room = guestReturnRoom();
    if (room !== null) openWatch({ kind: 'room', roomId: room });
  }, [accountId]);

  useEffect(() => {
    const named = watchFocusFromSearch(asked.length === 0 ? '' : `?${asked}`);
    if (named !== null) openWatch(named);
  }, [asked]);

  /** Closes the window and spends the address, so the same link opens it again later. */
  const close = useCallback(() => {
    closeWatch();
    if (watchFocusFromSearch(asked.length === 0 ? '' : `?${asked}`) !== null) router.replace(pathname);
  }, [asked, pathname, router]);

  /** Folds the room away, its picture floating, and spends the address the same way, so a link to the room unfolds it again. */
  const collapse = useCallback(() => {
    collapseWatch();
    if (watchFocusFromSearch(asked.length === 0 ? '' : `?${asked}`) !== null) router.replace(pathname);
  }, [asked, pathname, router]);

  // A link to somebody's own room (`?join=<secret>`): the way in is asked before any window opens.
  const joining = joinSecretFromSearch(asked.length === 0 ? '' : `?${asked}`);
  if (joining !== null) return <JoinByLink key={joining} secret={joining} signedIn={accountId !== null} onDone={() => router.replace(pathname)} />;

  // No room window open: your own room's door, whenever it has something on (SPEC-rooms-queues.md, phase 2).
  if (!state.open || state.focus === null) return <OwnRoomDoor />;

  if (state.focus.kind === 'prelive') return <PreLiveWindow mediaItemId={state.focus.mediaItemId} onClose={close} />;

  // Your own room has a window of its own: nobody else is in it, so none of a live room's machinery runs. Folded, its
  // video floats and has the way back; there is no folded tile any more (SPEC-rooms-your-room.md, part 2).
  if (state.focus.roomId === ownRoomId) {
    return <OwnRoomWindow key={state.focus.roomId} roomId={state.focus.roomId} collapsed={state.collapsed} onCollapse={collapse} onClose={close} />;
  }

  return <RoomWindow key={state.focus.roomId} roomId={state.focus.roomId} collapsed={state.collapsed} onCollapse={collapse} onLeft={close} />;
}

/**
 * Joining somebody's own room by its link (Luke, 2026-11-14: "if you have someones link you can still join"). The
 * secret in the address is handed to the database, which answers the room only if it is that room's current link and
 * the person is signed in; the room's window then opens as for any room they belong to. A link that has been
 * refreshed, or was never one, is told so plainly. Either way the address is spent, so the secret does not sit in it.
 */
function JoinByLink({ secret, signedIn, onDone }: { secret: string; signedIn: boolean; onDone: () => void }) {
  const [answer, setAnswer] = useState<'asking' | 'dead'>('asking');

  useEffect(() => {
    if (!signedIn) return;
    let alive = true;
    void getWatchRepository()
      .joinByLink(secret)
      .then(
        (roomId) => roomId,
        () => null,
      )
      .then((roomId) => {
        if (!alive) return;
        if (roomId === null) {
          setAnswer('dead');
          return;
        }
        openWatch({ kind: 'room', roomId });
        onDone();
      });
    return () => {
      alive = false;
    };
    // `onDone` is a new function each render; the join is asked once per secret and sign-in.
  }, [secret, signedIn]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <PopoutWindow title="JOIN A ROOM" onClose={onDone}>
      <div className="flex flex-col gap-2 p-2 text-label font-bold text-ink" data-join-by-link={signedIn ? answer : 'signed-out'}>
        {!signedIn ? (
          <p>
            <Link href="/account" className="key px-1 py-1 text-label">
              [ LOG IN ]
            </Link>{' '}
            TO JOIN THIS ROOM. THEN OPEN THE LINK AGAIN.
          </p>
        ) : answer === 'asking' ? (
          <p role="status">ASKING THE ROOM...</p>
        ) : (
          <>
            <p role="alert">THAT LINK DOES NOT WORK ANY MORE. ASK FOR A NEW ONE.</p>
            <p>
              <button type="button" onClick={onDone} className={PLATE}>
                [ OK ]
              </button>
            </p>
          </>
        )}
      </div>
    </PopoutWindow>
  );
}

const noOwnRoom = () => null;
const ownRoomIdNow = () => ownRoomState().roomId;
const screenOn = () => floatingState().entry !== null;
const noScreenOn = () => false;

/**
 * The pop-up above the music bar (Luke's P2: "at any time you can click the pop up above the music player to open the
 * room window like usual"). It is there whenever your own room has something on, a song or a video, and it says what
 * it is in words: `[ ▲ ROOM ]`. Pressing it opens the room window: the screen, the queue, who is here.
 * It is the way in while no room window is open, and only that: it was also the folded window's way back, which is the
 * floating picture's `[ BACK ]` now (SPEC-rooms-your-room.md, part 2).
 */
function OwnRoomDoor() {
  const roomId = useSyncExternalStore(subscribeToOwnRoom, ownRoomIdNow, noOwnRoom);
  const { read } = useWatchRoom(roomId, { follow: false });
  const video = useSyncExternalStore(subscribeToFloating, screenOn, noScreenOn);
  // On the corner shelf above the player (./CornerShelf.tsx), beside `[ ▲ WINDOW ]`; the shelf keeps the page window's foot clear.
  const shelf = useSyncExternalStore(subscribeToCornerSlot, cornerSlot, noCornerSlot);
  const on = roomId !== null && (video || (read !== undefined && read !== null && read.room.currentEntryId !== null));

  if (!on || roomId === null || shelf === null) return null;
  const tip = 'YOUR ROOM: THE SCREEN, THE QUEUE AND WHO IS HERE';

  return createPortal(
    <span className="frame bg-sun-pale p-0.5" data-own-room-door="shut" data-companion-avoid>
      <button type="button" onClick={() => openWatch({ kind: 'room', roomId })} className={PLATE} aria-label={tip} title={tip}>
        [ ▲ ROOM ]
      </button>
    </span>,
    shelf,
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
  const headroom = useLedgeHeadroom();

  return (
    <DockWindow id="stream" fill headroom={headroom} title={`STREAM :: ${name}`} badge="NOT LIVE" onClose={onClose} dock="top" defaultSize={ROOM_SIZE} minSize={ROOM_MIN}>
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
              <Link href="/stream" className={PLATE_MAIN} onClick={onClose}>
                [ GO LIVE ON STREAM ]
              </Link>
              THEN ADD THIS FROM THE QUEUE.
            </p>
          )}
        </div>
      )}
    </DockWindow>
  );
}

/**
 * A room: read once, followed while live. It opens as a window. Folded away (`collapsed`, its `[ _ ]` key or `[ PIP ]`)
 * its window tucks out of sight and its picture floats over the site, with `[ BACK ]` on it: folding is PIP, never by
 * itself, and there is no folded tile above the bar any more (SPEC-rooms-your-room.md, part 2).
 */
function RoomWindow({ roomId, collapsed, onCollapse, onLeft }: { roomId: string; collapsed: boolean; onCollapse: () => void; onLeft: () => void }) {
  const { read, error } = useWatchRoom(roomId);
  const headroom = useLedgeHeadroom();
  const [closing, setClosing] = useState(false);
  const { profile } = usePublicProfile(read?.room.hostId ?? null);
  const now = useNow(5000);
  const live = read !== undefined && read !== null && roomIsLive(read.room, now);
  const hostName = profile?.displayName ?? read?.room.originalHostLabel ?? '';
  const userId = useRoomIdentity()?.id ?? null;
  const readable = read !== undefined && read !== null;
  /** Taken out of this stream while in it (SPEC-privacy-phase-2.md): the room goes, and its wires with it. */
  const [removedFor, setRemovedFor] = useState<string | null>(null);
  const removed = removedFor === roomId;
  /** The room itself is on screen, so there is a picture to put out. A door, or a room this person was taken out of, has none. */
  const drawn = readable && !removed;
  // Folded, the floating picture is the only way back: a room that stops being drawn while folded comes back as its window.
  useEffect(() => {
    if (collapsed && !drawn) expandWatch();
  }, [collapsed, drawn]);

  // Somebody who can read the room and is signed in, or a guest, belongs to it from here (an open room going private keeps them).
  // A room they cannot read waits for JOIN at its door.
  useEffect(() => {
    if (userId === null || !readable) return;
    const repository = getWatchRepository();
    void repository.enterRoom(roomId, null).then((said) => {
      if (said === 'removed') setRemovedFor(roomId);
    });
    return repository.subscribeRoomMembers(roomId, (row) => {
      if (row.userId !== userId || row.removedAt === null) return;
      setRemovedFor(roomId);
      applyLocalChange(roomId, { kind: 'refresh' });
    });
  }, [roomId, userId, readable]);

  return (
    <>
      <DockWindow
        // Was "watch" before the room filled the screen; a new id so a size saved for the old room does not stick.
        id="stream"
        fill
        // Somebody's own room, joined by its link, is named as theirs: it is not a stream and has no privacy to pick.
        title={read ? (read.room.origin === 'music' ? `${hostName.toUpperCase()}'S ROOM` : `STREAM :: ${roomShownName(read.room, hostName).toUpperCase()}${read.room.privacy === 'open' ? '' : ` :: ${roomPrivacyLabel(read.room.privacy)}`}`) : 'STREAM'}
        badge={read ? (read.room.origin === 'music' ? 'BY LINK' : live ? 'LIVE' : 'ENDED') : undefined}
        // Leaving with a changed canvas nobody saved asks "save this canvas?" first (SPEC-stream-art.md).
        onClose={() => (removed ? onLeft() : void askToSaveCanvas(roomId).then(() => (read && live ? setClosing(true) : onLeft())))}
        onMinimize={drawn ? onCollapse : undefined}
        minimizeTip={PIP_TIP}
        minimized={collapsed && drawn}
        pictureOut={collapsed && drawn}
        aboveBottomBar
        headroom={headroom}
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
          <RoomDoor roomId={roomId} />
        ) : removed ? (
          <p className="text-label font-bold text-ink" data-room-door="removed">YOU WERE REMOVED FROM THIS STREAM.</p>
        ) : (
          <WatchRoom
            read={read}
            closing={closing}
            onStay={() => setClosing(false)}
            onLeft={onLeft}
            pictureFloats={collapsed}
            onFloatPicture={onCollapse}
            onBackFromFloat={expandWatch}
          />
        )}
      </DockWindow>
      {read === undefined || read === null ? <BarWaiting text={read === null ? 'STREAM' : (error ?? 'READING THE STREAM...')} /> : null}
    </>
  );
}

/** The music bar's stream box before the room has been read (the room draws its own part once it has). */
function BarWaiting({ text }: { text: string }) {
  const target = useSyncExternalStore(subscribeToStreamBar, () => streamBarState().target, () => null);
  if (target === null) return null;
  return createPortal(<span className="min-w-0 flex-1 frame bg-hardware px-2 py-1 text-label font-bold text-ink-bar">{text}</span>, target);
}
