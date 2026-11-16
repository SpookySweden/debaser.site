'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useSyncExternalStore } from 'react';
import { useRouter } from 'next/navigation';
import { PLATE, WINDOW_TITLE_BAR } from '../lib/ui/controls';
import {
  clampFloat,
  defaultFloat,
  FLOAT_AUDIO_SIZE,
  FLOAT_VIDEO_SIZE,
  shouldFloat,
  shownShare,
  visiblePart,
  type ClipRect,
  type FloatRect,
} from '../lib/ui/float-geometry';
import {
  boxOf,
  closeFloating,
  floatingState,
  keptBox,
  letKeptBoxGo,
  noteClock,
  notePlace,
  noteFloating,
  notePlayerElement,
  onFloatingOrder,
  placeOf,
  setFloatAsked,
  subscribeToFloating,
  togglePlayerFullscreen,
  wantBoxShown,
  type FloatingEntry,
} from '../lib/ui/floating-player';
import { FLOAT_GRIPS, footFloor, screenNow, useFloatFrame } from '../lib/ui/use-float-frame';
import { expandWatch } from '../lib/watch/watch-window';
import { DOUBLE_PRESS_MS, listenForTime } from '../lib/web/embed-time';
import { useAuth } from './AuthProvider';
import QueuedPicture from './QueuedPicture';
import WatchInRoomKey from './WatchInRoomKey';

/**
 * The site's one video (SPEC-floating-player.md, `app/lib/ui/floating-player.ts`), drawn once in `layout.tsx`, so it
 * carries on through every page. It sits exactly over its row's box (`PlayerBox.tsx`), clipped to what the page shows of
 * that box, or floats in a corner over the site. Moving between the two changes this layer's position and nothing else:
 * the iframe or `<video>` is the same element with the same address, so it never reloads.
 *
 * Its position is written straight to the element each frame, from where the box is now, and React is told only when
 * it changes between the two. Rows arrive late and push a box along without anything scrolling, so watching for scroll
 * events alone would leave it behind.
 */

/**
 * The wheel over a video in its row. In the page, a frame's unused scrolling passes to the pane around it. This layer is
 * outside every pane, so the player sits in a little scrolling room of its own, held still by `sticky`: its scrolling
 * lands there and is handed to the page's pane. Over the float too, so a float in the way never stops the page scrolling.
 * The room goes back to the middle only once the scrolling has stopped: setting a scroll position cuts short the glide of
 * a real mouse wheel, which a simulated wheel doesn't show.
 *
 * The room must never move by itself: anything that moved it would reach the page as if the reader had scrolled. The
 * video changes size as it goes between its box and the corner, and the browser's scroll anchoring moved the room to
 * match, which pushed the page back and flipped the video again, so scrolling up stuck at that spot (Luke, 2026-11-05).
 * So anchoring is off (`[overflow-anchor:none]`), and the room goes back to the middle at every switch.
 */
const SPARE_SCROLL = 40000;
const ROOM_MIDDLE = SPARE_SCROLL / 2;
const ROOM_REST_MS = 200;

const READER_ACTS = ['wheel', 'touchstart', 'pointerdown', 'keydown'] as const;

/**
 * How long after the site's own pause or play order a frame's "paused, then playing" is not taken for a double press on
 * its picture (`doublePressWatcher`, which hears the two the same way): twice the double press's own window.
 */
const OWN_ORDER_MS = DOUBLE_PRESS_MS * 2;

/** Where the reader last left the float, for this visit. Null: the corner. */
let placed: FloatRect | null = null;

/** The panes around a box that can cut it off, read once per box: walking them each frame is what would be slow. */
function clippingPanes(box: HTMLElement): HTMLElement[] {
  const panes: HTMLElement[] = [];
  for (let node = box.parentElement; node !== null && node !== document.body; node = node.parentElement) {
    if (window.getComputedStyle(node).overflowY !== 'visible') panes.push(node);
  }
  return panes;
}

function rectOf(element: HTMLElement): ClipRect {
  const { left, top, right, bottom } = element.getBoundingClientRect();
  return { left, top, right, bottom };
}

function sizeFor(entry: FloatingEntry) {
  return entry.shape === 'audio' ? FLOAT_AUDIO_SIZE : FLOAT_VIDEO_SIZE;
}

function floatRect(entry: FloatingEntry): FloatRect {
  const screen = screenNow();
  const floor = footFloor();
  return placed === null ? defaultFloat(sizeFor(entry), screen, floor) : clampFloat(placed, screen, floor);
}

export default function FloatingPlayer() {
  const { entry, floating } = useSyncExternalStore(subscribeToFloating, floatingState, floatingState);
  const layer = useRef<HTMLDivElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const wheelRoom = useRef<HTMLDivElement>(null);
  /** Where the room was last seen, so only what really moved is handed on. */
  const roomSeen = useRef(ROOM_MIDDLE);
  const roomRest = useRef(0);
  const router = useRouter();
  const playKey = entry === null ? null : `${entry.id}:${entry.play}`;
  /** When the site last told a frame's player to pause or play (`onFloatingOrder`), so that is not read as a double press on it. */
  const orderedAt = useRef(0);

  // Each frame: is there a box, how much of it shows, and so where does the layer go.
  useLayoutEffect(() => {
    const element = layer.current;
    if (element === null || entry === null) return;
    let panes: { box: HTMLElement; list: HTMLElement[] } | null = null;
    let raf = 0;
    let wasFloating: boolean | null = null;
    const place = () => {
      const box = boxOf(entry.id);
      const asked = floatingState().asked;
      let share = 0;
      let boxRect: ClipRect | null = null;
      let clips: ClipRect[] = [];
      // A box in a window that has been folded away is still laid out, only unseen: the video floats rather than
      // sit over nothing.
      if (box !== undefined && box.isConnected && box.closest('[data-minimized="true"]') === null) {
        if (panes === null || panes.box !== box) panes = { box, list: clippingPanes(box) };
        boxRect = rectOf(box);
        clips = [...panes.list.map(rectOf), { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight }];
        share = shownShare(boxRect, clips);
        // Back on the page with the video having been in its box: it stays in view while the page settles.
        if (share < 1 && keptBox() === box) box.scrollIntoView({ block: 'nearest' });
      }
      const floats = shouldFloat(boxRect !== null, asked, share);
      noteFloating(floats);
      const style = element.style;
      if (floats || boxRect === null) {
        const rect = floatRect(entry);
        style.left = `${rect.x}px`;
        style.top = `${rect.y}px`;
        style.width = `${rect.w}px`;
        style.height = `${rect.h}px`;
        style.clipPath = 'none';
        style.zIndex = '';
      } else {
        // A box inside a window (your room's screen, OwnRoomWindow.tsx) is over the page's windows, so the video is
        // lifted over them too; in a page's own row it stays down in the page.
        style.zIndex = box !== undefined && box.closest('[data-dock-window]') !== null ? 'var(--z-index-float)' : '';
        const part = visiblePart(boxRect, clips);
        style.left = `${boxRect.left}px`;
        style.top = `${boxRect.top}px`;
        style.width = `${boxRect.right - boxRect.left}px`;
        style.height = `${boxRect.bottom - boxRect.top}px`;
        const cut = [part.top - boxRect.top, boxRect.right - part.right, boxRect.bottom - part.bottom, part.left - boxRect.left];
        style.clipPath = cut.every((side) => side <= 0) ? 'none' : `inset(${cut.map((side) => `${Math.max(0, side)}px`).join(' ')})`;
      }
      if (floats !== wasFloating) {
        wasFloating = floats;
        if (wheelRoom.current !== null) wheelRoom.current.scrollTop = ROOM_MIDDLE;
        roomSeen.current = ROOM_MIDDLE;
      }
    };
    const tick = () => {
      place();
      raf = window.requestAnimationFrame(tick);
    };
    tick();
    for (const name of READER_ACTS) document.addEventListener(name, letKeptBoxGo, { capture: true, passive: true });
    return () => {
      window.cancelAnimationFrame(raf);
      for (const name of READER_ACTS) document.removeEventListener(name, letKeptBoxGo, { capture: true });
    };
    // `entry` changes only with a new PLAY; a re-render for floating or asked must not restart anything.
  }, [playKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Where a platform's player has got to, for the row that plays it again after it is closed.
  const frameSource = entry?.player.kind === 'frame' ? entry.player.timeFrom : null;
  useEffect(() => {
    const element = frame.current;
    if (element === null || entry === null || frameSource === null) return;
    const id = entry.id;
    const play = entry.play;
    // A press inside the frame counts for our page too, so the browser allows fullscreen from here. Some players may go
    // fullscreen by themselves one day: anything that has changed by the time this looks is left alone.
    let wait = 0;
    const stop = listenForTime(
      element,
      frameSource,
      (seconds) => notePlace(id, seconds),
      () => {
        // A pause and a play the site itself just asked for (the keys under your room's screen, the bar's middle key)
        // look the same from outside as two presses on the picture: they are not a double press.
        if (performance.now() - orderedAt.current < OWN_ORDER_MS) return;
        const before = document.fullscreenElement;
        window.clearTimeout(wait);
        wait = window.setTimeout(() => {
          if (document.fullscreenElement === before) togglePlayerFullscreen();
        }, 300);
      },
      // Where it is, how long it is and whether it is paused, for the keys under your room's screen.
      (said) => noteClock(play, said),
    );
    return () => {
      window.clearTimeout(wait);
      stop();
    };
  }, [playKey, frameSource]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    notePlayerElement(frame.current ?? video.current);
    return () => notePlayerElement(null);
  }, [playKey]);

  // The bar's pause and play for the video (SPEC-rooms-queues.md), where its player takes orders: our own file is a
  // plain `<video>`; YouTube and Vimeo answer messages sent to their frame (the same ones their own scripts send; if
  // they ever change, the key does nothing and the player's own controls still work). Any other player is left alone.
  useEffect(
    () =>
      onFloatingOrder((order) => {
        const file = video.current;
        if (file !== null) {
          if (order === 'pause') file.pause();
          else if (order === 'play') void file.play().catch(() => undefined);
          else if ('seek' in order) file.currentTime = order.seek;
          else {
            file.volume = Math.min(1, Math.max(0, order.volume));
            file.muted = order.muted;
          }
          return;
        }
        const element = frame.current;
        if (element === null || frameSource === null) return;
        let origin: string;
        try {
          origin = new URL(element.src).origin;
        } catch {
          return;
        }
        const tell = (message: object) => element.contentWindow?.postMessage(JSON.stringify(message), origin);
        if (order === 'pause' || order === 'play') {
          orderedAt.current = performance.now();
          tell(frameSource === 'youtube' ? { event: 'command', func: order === 'pause' ? 'pauseVideo' : 'playVideo', args: [] } : { method: order });
        } else if ('seek' in order) {
          tell(frameSource === 'youtube' ? { event: 'command', func: 'seekTo', args: [order.seek, true] } : { method: 'setCurrentTime', value: order.seek });
        } else if (frameSource === 'youtube') {
          // YouTube counts its volume to a hundred, and mutes apart from it.
          tell({ event: 'command', func: 'setVolume', args: [Math.round(Math.min(1, Math.max(0, order.volume)) * 100)] });
          tell({ event: 'command', func: order.muted ? 'mute' : 'unMute', args: [] });
        } else {
          tell({ method: 'setVolume', value: order.muted ? 0 : Math.min(1, Math.max(0, order.volume)) });
        }
      }),
    [playKey, frameSource],
  );

  // Signing out closes it: MEDIA is for signed-in people, and its rows have just gone.
  const { user } = useAuth();
  const wasSignedIn = useRef(false);
  useEffect(() => {
    if (wasSignedIn.current && user === null) closeFloating();
    wasSignedIn.current = user !== null;
  }, [user]);

  const drag = useFloatFrame(
    () => layer.current,
    () => (entry === null ? { x: 0, y: 0, w: 0, h: 0 } : floatRect(entry)),
    (rect) => {
      placed = rect;
    },
  );

  const passScrollToPane = () => {
    const room = wheelRoom.current;
    if (room === null || entry === null) return;
    const moved = room.scrollTop - roomSeen.current;
    if (moved === 0) return;
    roomSeen.current = room.scrollTop;
    window.clearTimeout(roomRest.current);
    roomRest.current = window.setTimeout(() => {
      room.scrollTop = ROOM_MIDDLE;
      roomSeen.current = ROOM_MIDDLE;
    }, ROOM_REST_MS);
    const box = boxOf(entry.id);
    const pane =
      box === undefined || floatingState().floating
        ? document.querySelector('main [data-scroll-pane="page"]')
        : clippingPanes(box).find((candidate) => ['auto', 'scroll'].includes(window.getComputedStyle(candidate).overflowY));
    if (pane !== undefined && pane !== null) pane.scrollTop += moved;
  };

  const goBack = useCallback(() => {
    if (entry === null) return;
    const box = boxOf(entry.id);
    setFloatAsked(false);
    if (box !== undefined) {
      // Its box is in a room window that was folded away (your room, `[ _ ]`): the way back is the window itself.
      if (box.closest('[data-minimized="true"]') !== null) expandWatch();
      else box.scrollIntoView({ block: 'center' });
      return;
    }
    wantBoxShown();
    router.push(entry.home);
  }, [entry, router]);

  if (entry === null) return null;
  const { player } = entry;
  /** Our own file's clock, for the keys under your room's screen (`noteClock`). */
  const tellClock = (file: HTMLVideoElement) => noteClock(entry.play, { seconds: file.currentTime, duration: file.duration, paused: file.paused, volume: file.volume, muted: file.muted });
  // Our own file can use the browser's pop-out, the one that stays above other apps. An outside player can't be lifted
  // out. `floating` is never true on the server, where there is no document to ask.
  const canPopOut = floating && player.kind === 'file' && document.pictureInPictureEnabled === true;

  return (
    <div
      ref={layer}
      data-floating-player={floating ? 'floating' : 'in-box'}
      role={floating ? 'region' : undefined}
      aria-label={floating ? `Floating player: ${entry.title}` : undefined}
      className={`fixed flex flex-col ${floating ? 'z-float frame bg-sun-pale' : 'z-1'}`}
    >
      {floating ? (
        <div {...drag.bar} onDoubleClick={togglePlayerFullscreen} className="cursor-move touch-none select-none" title="Drag to move. Pull an edge to resize. Double press for fullscreen.">
          <div className={WINDOW_TITLE_BAR}>
            <span className="truncate">{entry.title}</span>
            <button type="button" onPointerDown={(event) => event.stopPropagation()} onDoubleClick={(event) => event.stopPropagation()} onClick={closeFloating} aria-label={`Close "${entry.title}"`} className={`${PLATE} shrink-0`}>
              [ × ]
            </button>
          </div>
          {/* The key's window is drawn through it, so what happens in the window must not reach the bar's drag either. */}
          <div className="flex flex-wrap items-center gap-1 px-2 pb-1" onPointerDown={(event) => event.stopPropagation()} onDoubleClick={(event) => event.stopPropagation()}>
            <button type="button" onClick={goBack} aria-label={`Back to where "${entry.title}" came from`} className={PLATE}>
              [ BACK ]
            </button>
            <button type="button" onClick={togglePlayerFullscreen} aria-label={`Fullscreen: "${entry.title}"`} className={PLATE}>
              [ FULL ]
            </button>
            {canPopOut ? (
              <button
                type="button"
                onClick={() => void video.current?.requestPictureInPicture().catch(() => undefined)}
                aria-label={`Pop out "${entry.title}" above other apps`}
                title="The browser's own pop-out: stays above other apps"
                className={PLATE}
              >
                [ POP OUT ]
              </button>
            ) : null}
            {entry.room === undefined ? null : <WatchInRoomKey key={entry.play} source={entry.room} playId={entry.id} title={entry.title} live />}
          </div>
        </div>
      ) : null}

      {/* The same element in the box and in the float, under one `key` per PLAY: this is what never reloads. */}
      <div
        ref={wheelRoom}
        onScroll={passScrollToPane}
        tabIndex={-1}
        data-floating-wheel
        className="relative min-h-0 flex-1 overflow-y-scroll [overflow-anchor:none] [scrollbar-width:none]"
      >
        <div className="sticky top-0 h-full w-full">
        {player.kind === 'frame' ? (
          <iframe
            key={playKey}
            ref={frame}
            src={player.src}
            title={player.frameTitle}
            referrerPolicy={player.referrerPolicy}
            sandbox={player.sandbox}
            allow={player.allow}
            allowFullScreen={player.allowFullScreen}
            className="absolute inset-0 block h-full w-full border border-ink-plate bg-paper"
          />
        ) : player.kind === 'picture' ? (
          <QueuedPicture key={playKey} src={player.src} title={entry.title} className="absolute inset-0 h-full w-full border border-ink bg-ink-plate" />
        ) : (
          <video
            key={playKey}
            ref={video}
            controls
            autoPlay
            preload="metadata"
            src={player.src}
            onLoadedMetadata={(event) => {
              const from = placeOf(entry.id);
              if (from !== null) event.currentTarget.currentTime = from;
              tellClock(event.currentTarget);
            }}
            onTimeUpdate={(event) => {
              notePlace(entry.id, event.currentTarget.currentTime);
              tellClock(event.currentTarget);
            }}
            onPlay={(event) => tellClock(event.currentTarget)}
            onPause={(event) => tellClock(event.currentTarget)}
            onVolumeChange={(event) => tellClock(event.currentTarget)}
            onEnded={() => notePlace(entry.id, null)}
            className="absolute inset-0 block h-full w-full border border-ink bg-ink-plate object-contain"
          >
            <track kind="captions" />
          </video>
        )}
        </div>
        <div aria-hidden="true" style={{ height: SPARE_SCROLL }} />
      </div>

      {floating
        ? FLOAT_GRIPS.map((grip) => <div key={grip.className} aria-hidden="true" className={`absolute z-10 touch-none ${grip.className}`} {...drag.grip(grip.edges)} data-float-grip />)
        : null}
    </div>
  );
}
