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
import { nextQueuePosition, roomIsLive, roomPrivacyLabel, roomShownName } from '../lib/watch/rules';
import { streamBarState, subscribeToStreamBar } from '../lib/watch/stream-bar';
import { guestReturnRoom } from '../lib/watch/guest-return';
import { announceRoomClientChange, hasStoredGuest } from '../lib/watch/room-client';
import { applyLocalChange, peekRoom, useWatchRoom } from '../lib/watch/use-watch-room';
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
import { artSlot } from '../lib/ui/art/slots';
import ArtMark from './ArtMark';
import PopoutWindow from './PopoutWindow';
import { useAuth } from './AuthProvider';
import { useRoomIdentity } from './use-room-identity';
import DockWindow from './DockWindow';
import { useLedgeHeadroom } from '../lib/companion/use-ledge-headroom';
import RoomDoor from './RoomDoor';
import WatchRoom from './WatchRoom';
import { closeFloating, floatingState, subscribeToFloating } from '../lib/ui/floating-player';
import { answerPlayAsk, playAskState, playInMainRoomLeaving, subscribeToPlayAsk } from '../lib/watch/main-room-play';
import { ownRoomState, subscribeToOwnRoom } from '../lib/watch/own-room-client';
import { askToSaveCanvas } from '../lib/watch/use-room-canvas';

/** Large, over the board, like the arcade but bigger: the video is the point (decision 1). */
/** Wide enough to take the screen: the room opens filling it (`fill`), as the video wants all the room it can get. */
const ROOM_SIZE = { w: 2560, h: 1440 };
const ROOM_MIN = { w: 560, h: 420 };
/** The `[ _ ]` key's tip on a room's window: folded to its key above the player, nothing floats (Luke, 2026-11-16). */
const FOLD_TIP = 'Fold away to a key above the player (keeps playing)';
/** The folded room's hand-drawn mark (`mark-up-wide` in app/lib/ui/art/slots.ts), shown at 40x16; `[ ▲ ]` until it is drawn. */
const UP_MARK_SRC = `/${artSlot('mark-up-wide')?.path ?? 'assets/icons/up-wide.png'}`;
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

  /**
   * Folds the room away to its key above the player (`[ _ ]`), or with its picture floating too (`pip`, `[ PIP ]`), and
   * spends the address the same way, so a link to the room unfolds it again.
   */
  const collapse = useCallback(
    (pip = false) => {
      collapseWatch(pip);
      if (watchFocusFromSearch(asked.length === 0 ? '' : `?${asked}`) !== null) router.replace(pathname);
    },
    [asked, pathname, router],
  );

  return (
    <>
      <WatchWindowBody state={state} ownRoomId={ownRoomId} asked={asked} accountId={accountId} close={close} collapse={collapse} onJoined={() => router.replace(pathname)} />
      <PlayAskWindow />
    </>
  );
}

function WatchWindowBody({
  state,
  ownRoomId,
  asked,
  accountId,
  close,
  collapse,
  onJoined,
}: {
  state: ReturnType<typeof watchWindowState>;
  ownRoomId: string | null;
  asked: string;
  accountId: string | null;
  close: () => void;
  collapse: (pip?: boolean) => void;
  onJoined: () => void;
}) {
  const ownVisitor = useSyncExternalStore(subscribeToOwnRoom, ownRoomVisitorNow, noOwnRoomVisitor);
  const ownVisitorHost = useSyncExternalStore(subscribeToOwnRoom, ownRoomHostNow, noOwnRoom);
  // A link to somebody's own room (`?join=<secret>`): the way in is asked before any window opens.
  const joining = joinSecretFromSearch(asked.length === 0 ? '' : `?${asked}`);
  if (joining !== null) return <JoinByLink key={joining} secret={joining} signedIn={accountId !== null} onDone={onJoined} />;

  // No room window open: your own room's door, whenever it has something on (SPEC-rooms-queues.md, phase 2).
  if (!state.open || state.focus === null) return <OwnRoomDoor />;

  if (state.focus.kind === 'prelive') return <PreLiveWindow mediaItemId={state.focus.mediaItemId} onClose={close} />;

  // Every room, your main room included (SPEC-rooms-perpetual.md): the live room's own window, switched by state. A
  // signed-out visitor's own room too (list 3): it lives in their browser, so it has no link, no chat and nobody else, and
  // GO LIVE asks them to log in; everything else is the same window. (`OwnRoomWindow.tsx`, its old look-alike, is unused.)
  return (
    <RoomWindow
      key={state.focus.roomId}
      roomId={state.focus.roomId}
      mainRoom={state.focus.roomId === ownRoomId}
      visitorHost={ownVisitor && state.focus.roomId === ownRoomId ? ownVisitorHost : null}
      collapsed={state.collapsed}
      pip={state.collapsed && state.pip}
      onCollapse={collapse}
      onLeft={close}
    />
  );
}

const ownRoomVisitorNow = () => ownRoomState().visitor;
const ownRoomHostNow = () => ownRoomState().hostId;
const noOwnRoomVisitor = () => false;

/**
 * You are in somebody else's room and pressed PLAY on a video (SPEC-rooms-perpetual.md, Luke's Q2 A): play it in your
 * own room (you leave theirs), add it to their queue, or cancel.
 */
function PlayAskWindow() {
  const ask = useSyncExternalStore(subscribeToPlayAsk, playAskState, noPlayAsk);
  const { user } = useAuth();
  const [fault, setFault] = useState<string | null>(null);
  if (ask === null) return null;

  const addToTheirs = () => {
    if (user === null) return;
    const theirs = peekRoom(ask.theirRoomId);
    const position = theirs === null ? 0 : nextQueuePosition(theirs.queue);
    // Their room's rules decide where it goes: straight in with a crown, otherwise on your own list there until a crown pulls it in.
    const crowned = theirs !== null && (theirs.room.hostId === user.id || theirs.crowns.some((crown) => crown.userId === user.id));
    const base = { roomId: ask.theirRoomId, addedBy: user.id, position, inQueue: crowned };
    const added = ask.source.link !== undefined ? getWatchRepository().addToQueue({ ...base, link: ask.source.link }) : getWatchRepository().addToQueue({ ...base, mediaItemId: ask.source.mediaItemId });
    void added.then(
      () => {
        applyLocalChange(ask.theirRoomId, { kind: 'refresh' });
        setFault(null);
        answerPlayAsk();
      },
      (failure: unknown) => setFault(failure instanceof Error ? failure.message : 'IT COULD NOT BE ADDED.'),
    );
  };

  return (
    <PopoutWindow
      title="YOU ARE IN SOMEBODY ELSE'S ROOM"
      onClose={() => {
        setFault(null);
        answerPlayAsk();
      }}
      maxWidth="max-w-md"
    >
      <div className="flex flex-col gap-2 p-2 text-label font-bold text-ink" data-play-ask>
        <p>{ask.title.toUpperCase()}</p>
        {fault !== null ? (
          <p className="w-fit bg-bubble-pale px-1 text-ink-bar" role="alert">
            {fault}
          </p>
        ) : null}
        <p className="flex flex-wrap gap-2">
          <button type="button" className={PLATE_MAIN} data-play-ask-mine onClick={() => playInMainRoomLeaving(ask.source)}>
            [ PLAY IN YOUR ROOM ]
          </button>
          <button type="button" className={PLATE} data-play-ask-theirs onClick={addToTheirs}>
            [ ADD TO THEIR QUEUE ]
          </button>
          <button
            type="button"
            className={PLATE}
            data-play-ask-cancel
            onClick={() => {
              setFault(null);
              answerPlayAsk();
            }}
          >
            [ CANCEL ]
          </button>
        </p>
        <p>PLAY IN YOUR ROOM LEAVES THEIRS.</p>
      </div>
    </PopoutWindow>
  );
}
const noPlayAsk = () => null;

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
 * `folded`: the window is open but folded away (`[ _ ]` or `[ PIP ]`), and the same key brings it back (Luke, 2026-11-16:
 * "collapsing the room goes to a small button above the player like before, not PIP"). Folded, it is there even with
 * nothing on: a folded room always has its way back.
 */
function OwnRoomDoor({ folded = false }: { folded?: boolean }) {
  const roomId = useSyncExternalStore(subscribeToOwnRoom, ownRoomIdNow, noOwnRoom);
  const { read } = useWatchRoom(roomId, { follow: false });
  const video = useSyncExternalStore(subscribeToFloating, screenOn, noScreenOn);
  // On the corner shelf above the player (./CornerShelf.tsx), beside `[ ▲ WINDOW ]`; the shelf keeps the page window's foot clear.
  const shelf = useSyncExternalStore(subscribeToCornerSlot, cornerSlot, noCornerSlot);
  const on = roomId !== null && (folded || video || (read !== undefined && read !== null && read.room.currentEntryId !== null));

  if (!on || roomId === null || shelf === null) return null;
  const tip = folded ? 'BACK TO YOUR ROOM: THE SCREEN, THE QUEUE AND WHO IS HERE' : 'YOUR ROOM: THE SCREEN, THE QUEUE AND WHO IS HERE';

  return createPortal(
    <span className="frame bg-sun-pale p-0.5" data-own-room-door={folded ? 'folded' : 'shut'} data-companion-avoid>
      <button type="button" onClick={() => (folded ? expandWatch() : openWatch({ kind: 'room', roomId }))} className={PLATE} aria-label={tip} title={tip}>
        [ ▲ ROOM ]
      </button>
    </span>,
    shelf,
  );
}

/**
 * A live room folded away (`[ _ ]` or `[ PIP ]`): its key on the corner shelf above the player, as the folded tile was
 * before 2026-11-16 (Luke: "collapsing the room goes to a small button above the player like before, not PIP"). It says
 * what it is in words, and pressing it brings the room's window back where it was. The room plays on meanwhile.
 */
function FoldedRoomKey({ live, label }: { live: boolean; label: string }) {
  const shelf = useSyncExternalStore(subscribeToCornerSlot, cornerSlot, noCornerSlot);
  if (shelf === null) return null;
  const tip = live ? `BACK TO THE ROOM: ${label}` : `BACK TO THE ROOM (ENDED): ${label}`;
  return createPortal(
    <span className="frame bg-sun-pale p-0.5" data-room-shelf-key={live ? 'live' : 'ended'} data-companion-avoid>
      <button type="button" onClick={expandWatch} className={`${PLATE} inline-flex items-center gap-1`} aria-label={tip} title={tip}>
        <ArtMark src={UP_MARK_SRC} size={UP_MARK_HEIGHT} width={UP_MARK_WIDTH} fallback="[ ▲ ]" />
        <span>{live ? 'ROOM :: LIVE' : 'ROOM :: ENDED'}</span>
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
 * A room: read once, followed while live. It opens as a window. Folded away (`collapsed`) its window tucks out of sight
 * and plays on, and its key on the corner shelf above the player (`FoldedRoomKey`) brings it back. `[ _ ]` folds it
 * and nothing more; `[ PIP ]` (`pip`) folds it with its picture floating over the site, and the same key is the way
 * back (Luke, 2026-11-16: "collapsing the room goes to a small button above the player like before, not PIP").
 */
function RoomWindow({
  roomId,
  mainRoom,
  visitorHost,
  collapsed,
  pip,
  onCollapse,
  onLeft,
}: {
  roomId: string;
  mainRoom: boolean;
  /** A signed-out visitor's own room: their browser's id, which hosts it. It lives in this browser and is joined by nobody. */
  visitorHost: string | null;
  collapsed: boolean;
  pip: boolean;
  onCollapse: (pip?: boolean) => void;
  onLeft: () => void;
}) {
  const { read, error } = useWatchRoom(roomId);
  // Your main room's window plays the room itself: whatever the floating player had on gives way, so nothing plays twice.
  useEffect(() => {
    if (mainRoom) closeFloating();
  }, [mainRoom]);
  const headroom = useLedgeHeadroom();
  const [closing, setClosing] = useState(false);
  // A visitor's browser id is no account: nothing to look up.
  const { profile } = usePublicProfile(visitorHost !== null ? null : (read?.room.hostId ?? null));
  const now = useNow(5000);
  const live = read !== undefined && read !== null && roomIsLive(read.room, now);
  const hostName = profile?.displayName ?? read?.room.originalHostLabel ?? '';
  /** Somebody's own room by its owner's name; a visitor's own is simply YOUR ROOM. */
  const roomOwnerTitle = visitorHost !== null ? 'YOUR ROOM' : `${hostName.toUpperCase()}'S ROOM`;
  const userId = useRoomIdentity()?.id ?? null;
  /** Who hosts from here: the account (or guest), or the visitor in their own browser room. */
  const selfId = visitorHost ?? userId;
  const readable = read !== undefined && read !== null;
  /** Taken out of this stream while in it (SPEC-privacy-phase-2.md): the room goes, and its wires with it. */
  const [removedFor, setRemovedFor] = useState<string | null>(null);
  const removed = removedFor === roomId;
  /** The room itself is on screen, so there is something to fold. A door, or a room this person was taken out of, has nothing playing. */
  const drawn = readable && !removed;
  // A room that stops being drawn while folded comes back as its window: nothing is left playing out of sight.
  useEffect(() => {
    if (collapsed && !drawn) expandWatch();
  }, [collapsed, drawn]);

  // Somebody who can read the room and is signed in, or a guest, belongs to it from here (an open room going private keeps them).
  // A room they cannot read waits for JOIN at its door.
  useEffect(() => {
    // A visitor's own browser room has no members to enter or watch: nobody can join it.
    if (userId === null || !readable || visitorHost !== null) return;
    const repository = getWatchRepository();
    void repository.enterRoom(roomId, null).then((said) => {
      if (said === 'removed') setRemovedFor(roomId);
    });
    return repository.subscribeRoomMembers(roomId, (row) => {
      if (row.userId !== userId || row.removedAt === null) return;
      setRemovedFor(roomId);
      applyLocalChange(roomId, { kind: 'refresh' });
    });
  }, [roomId, userId, readable, visitorHost]);

  return (
    <>
      <DockWindow
        // Was "watch" before the room filled the screen; a new id so a size saved for the old room does not stick.
        id="stream"
        fill
        // Somebody's own room, joined by its link, is named as theirs: it is not a stream and has no privacy to pick.
        title={read ? (read.room.origin === 'music' ? roomOwnerTitle : `STREAM :: ${roomShownName(read.room, hostName).toUpperCase()}${read.room.privacy === 'open' ? '' : ` :: ${roomPrivacyLabel(read.room.privacy)}`}`) : 'STREAM'}
        badge={read ? (read.room.origin === 'music' ? (read.room.isPublic ? 'LIVE' : mainRoom ? 'PRIVATE' : 'BY LINK') : live ? 'LIVE' : 'ENDED') : undefined}
        // Your main room's X folds it away and it plays on (SPEC-rooms-perpetual.md): you never leave it by closing the
        // window, only by LEAVE or END ROOM. Anybody else leaving with a changed canvas nobody saved is asked first.
        onClose={() =>
          mainRoom && drawn && read !== undefined && read !== null && read.room.endedAt === null && read.room.hostId === selfId
            ? onCollapse(false)
            : removed
              ? onLeft()
              : void askToSaveCanvas(roomId).then(() => (read && live ? setClosing(true) : onLeft()))
        }
        onMinimize={drawn ? () => onCollapse(false) : undefined}
        minimizeTip={FOLD_TIP}
        minimized={collapsed && drawn}
        pictureOut={pip && drawn}
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
            pictureFloats={pip}
            onFloatPicture={() => onCollapse(true)}
          />
        )}
      </DockWindow>
      {collapsed && drawn && read ? (
        <FoldedRoomKey live={read.room.origin === 'music' || live} label={read.room.origin === 'music' ? roomOwnerTitle : roomShownName(read.room, hostName).toUpperCase()} />
      ) : null}
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
