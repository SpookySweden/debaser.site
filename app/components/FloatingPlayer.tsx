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
  notePlace,
  noteFloating,
  placeOf,
  setFloatAsked,
  subscribeToFloating,
  wantBoxShown,
  type FloatingEntry,
} from '../lib/ui/floating-player';
import { footFloor, screenNow, useFloatFrame } from '../lib/ui/use-float-frame';
import { listenForTime } from '../lib/web/embed-time';
import { useAuth } from './AuthProvider';
import { GRIPS } from './DockWindow';

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
 * lands there, is handed to the row's pane, and the room goes back to the middle.
 */
const SPARE_SCROLL = 4000;

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
  const router = useRouter();
  const playKey = entry === null ? null : `${entry.id}:${entry.play}`;

  // Each frame: is there a box, how much of it shows, and so where does the layer go.
  useLayoutEffect(() => {
    const element = layer.current;
    if (element === null || entry === null) return;
    let panes: { box: HTMLElement; list: HTMLElement[] } | null = null;
    let raf = 0;
    const place = () => {
      const box = boxOf(entry.id);
      const asked = floatingState().asked;
      let share = 0;
      let boxRect: ClipRect | null = null;
      let clips: ClipRect[] = [];
      if (box !== undefined && box.isConnected) {
        if (panes === null || panes.box !== box) panes = { box, list: clippingPanes(box) };
        boxRect = rectOf(box);
        clips = [...panes.list.map(rectOf), { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight }];
        share = shownShare(boxRect, clips);
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
      } else {
        const part = visiblePart(boxRect, clips);
        style.left = `${boxRect.left}px`;
        style.top = `${boxRect.top}px`;
        style.width = `${boxRect.right - boxRect.left}px`;
        style.height = `${boxRect.bottom - boxRect.top}px`;
        const cut = [part.top - boxRect.top, boxRect.right - part.right, boxRect.bottom - part.bottom, part.left - boxRect.left];
        style.clipPath = cut.every((side) => side <= 0) ? 'none' : `inset(${cut.map((side) => `${Math.max(0, side)}px`).join(' ')})`;
      }
    };
    const tick = () => {
      place();
      raf = window.requestAnimationFrame(tick);
    };
    tick();
    // After the first placing: until the layer has its size, the room is as tall as what is in it, with nowhere to scroll.
    if (wheelRoom.current !== null) wheelRoom.current.scrollTop = SPARE_SCROLL / 2;
    return () => window.cancelAnimationFrame(raf);
    // `entry` changes only with a new PLAY; a re-render for floating or asked must not restart anything.
  }, [playKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Where a platform's player has got to, for the row that plays it again after it is closed.
  const frameSource = entry?.player.kind === 'frame' ? entry.player.timeFrom : null;
  useEffect(() => {
    const element = frame.current;
    if (element === null || entry === null || frameSource === null) return;
    const id = entry.id;
    return listenForTime(element, frameSource, (seconds) => notePlace(id, seconds));
  }, [playKey, frameSource]); // eslint-disable-line react-hooks/exhaustive-deps

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
    const moved = room.scrollTop - SPARE_SCROLL / 2;
    if (moved === 0) return;
    room.scrollTop = SPARE_SCROLL / 2;
    const box = boxOf(entry.id);
    if (box === undefined || floatingState().floating) return;
    const pane = clippingPanes(box).find((candidate) => ['auto', 'scroll'].includes(window.getComputedStyle(candidate).overflowY));
    if (pane !== undefined) pane.scrollTop += moved;
  };

  const goBack = useCallback(() => {
    if (entry === null) return;
    const box = boxOf(entry.id);
    setFloatAsked(false);
    if (box !== undefined) {
      box.scrollIntoView({ block: 'center' });
      return;
    }
    wantBoxShown();
    router.push(entry.home);
  }, [entry, router]);

  if (entry === null) return null;
  const { player } = entry;
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
        <div
          {...drag.bar}
          className={`${WINDOW_TITLE_BAR} cursor-move touch-none select-none`}
          title="Drag to move. Pull an edge to resize."
        >
          <span className="truncate">{entry.title}</span>
          <span className="flex shrink-0 items-center gap-1">
            <button type="button" onPointerDown={(event) => event.stopPropagation()} onClick={goBack} aria-label={`Back to where "${entry.title}" came from`} className={PLATE}>
              [ BACK ]
            </button>
            {canPopOut ? (
              <button
                type="button"
                onPointerDown={(event) => event.stopPropagation()}
                onClick={() => void video.current?.requestPictureInPicture().catch(() => undefined)}
                aria-label={`Pop out "${entry.title}" above other apps`}
                title="The browser's own pop-out: stays above other apps"
                className={PLATE}
              >
                [ POP OUT ]
              </button>
            ) : null}
            <button type="button" onPointerDown={(event) => event.stopPropagation()} onClick={closeFloating} aria-label={`Close "${entry.title}"`} className={PLATE}>
              [ × ]
            </button>
          </span>
        </div>
      ) : null}

      {/* The same element in the box and in the float, under one `key` per PLAY: this is what never reloads. */}
      <div
        ref={wheelRoom}
        onScroll={passScrollToPane}
        tabIndex={-1}
        data-floating-wheel
        className={`relative min-h-0 flex-1 [scrollbar-width:none] ${floating ? 'overflow-hidden' : 'overflow-y-scroll'}`}
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
            }}
            onTimeUpdate={(event) => notePlace(entry.id, event.currentTarget.currentTime)}
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
        ? GRIPS.map((grip) => <div key={grip.className} aria-hidden="true" className={`absolute z-10 touch-none ${grip.className}`} {...drag.grip(grip.edges)} />)
        : null}
    </div>
  );
}
