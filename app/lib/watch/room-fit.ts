'use client';

import { handMoving, liveWindow, onHandResize, setWindowRect, windowMinSize, type WindowRect } from '../ui/window-layout';
import { subscribeToWatchWindow, watchWindowState } from './watch-window';

/**
 * The room window fitted to its picture (Luke, 2026-11-16: "add a button to fit the view window in the room to size in a
 * reasonable way, and do it automatically like when switching from a 4:3 video to a 16:9 please have it neatly resize. if it
 * looks jarring then find a way to make it smoother creatively").
 *
 * - `[ FIT ]` on the room's title line: the picture keeps about the room it has and takes the video's shape, so there are no
 *   bars round it; no wider than the page, no lower than the music bar, never under the window's least size. The window
 *   keeps the edge nearer its side of the screen. A maximised window comes out of it to that size.
 * - By itself, when a new picture's shape is known (a 4:3 video after a 16:9 one), unless the reader has sized the window
 *   by hand (remembered in this browser until FIT is pressed) or it is maximised, folded or fullscreen.
 * - Not a glide: the site's feel is instant (docs/design.md), so the window snaps there in four hard steps, an outline of
 *   an old desktop window being dragged to size, about a sixth of a second in all. One step under `prefers-reduced-motion`.
 */

/** The room window's name in the layout store (`WatchWindow.tsx`), and its element on the page. */
const ROOM = 'room';
const ROOM_ELEMENT = '[data-dock-window="stream"]';
/** This browser's note that the room window was sized by hand: the automatic fit stands back until FIT is pressed. */
const HAND_KEY = 'debaser.site.room-hand-sized.v1';
const STEPS = 4;
const STEP_MS = 40;

/** The picture's box in the room and the shape of what is on it, while the room draws one (`WatchRoom.tsx`). */
type Picture = { box: HTMLElement; shape: number };
let picture: Picture | null = null;
const listeners = new Set<() => void>();

function readHand(): boolean {
  try {
    return window.localStorage.getItem(HAND_KEY) === '1';
  } catch {
    return false;
  }
}
function writeHand(on: boolean): void {
  try {
    if (on) window.localStorage.setItem(HAND_KEY, '1');
    else window.localStorage.removeItem(HAND_KEY);
  } catch {
    // Storage refused: the fit simply does not remember it.
  }
}
if (typeof window !== 'undefined') {
  onHandResize((id) => {
    if (id === ROOM) writeHand(true);
  });
}

/** Whether the room has a picture of a known shape to fit to: `[ FIT ]` is drawn only then. */
export function roomFitShape(): number | null {
  return picture?.shape ?? null;
}
export function subscribeToRoomFit(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The room's picture and its shape (null: none, or not known yet). The first known shape, and each new one, fits by itself. */
export function setRoomPicture(box: HTMLElement | null, shape: number | null): void {
  const next = box === null || shape === null || !Number.isFinite(shape) || shape <= 0 ? null : { box, shape };
  const changed = (picture?.shape ?? null) !== (next?.shape ?? null) || picture?.box !== next?.box;
  const newShape = next !== null && (fittedTo === null || Math.abs(fittedTo - next.shape) > 0.01);
  picture = next;
  // No picture (the room shut, a song, the blank screen): the next one fits once again.
  if (next === null) {
    fittedTo = null;
    owed = 0;
  }
  if (changed) for (const listener of listeners) listener();
  if (newShape) fitRoom(true);
}

/** Frames left to wait for the room window to be laid out before an automatic fit (it opens with its picture). */
let owed = 0;
const OWED_FRAMES = 30;
/** An automatic fit skipped while the room was folded: made when it is unfolded. */
let foldedOwe = false;
if (typeof window !== 'undefined') {
  subscribeToWatchWindow(() => {
    if (foldedOwe && !watchWindowState().collapsed) {
      foldedOwe = false;
      // After the window is shown again, so it is measured as drawn.
      requestAnimationFrame(() => fitRoom(true));
    }
  });
}

/** The shape the window was last fitted to, so the same shape again does not fit again. */
let fittedTo: number | null = null;
let stepping: ReturnType<typeof setTimeout> | null = null;

/** Where the room window is drawn now and the box it should have for its picture's shape; null when there is nothing to fit. */
export function roomFitTarget(): { from: WindowRect; to: WindowRect } | null {
  const element = document.querySelector<HTMLElement>(ROOM_ELEMENT);
  if (picture === null || element === null) return null;
  const outer = element.getBoundingClientRect();
  const inner = picture.box.getBoundingClientRect();
  if (outer.width === 0 || inner.width === 0 || inner.height === 0) return null;
  // Everything round the picture (the title line, the side column, the frame) stays the size it is.
  const aroundW = outer.width - inner.width;
  const aroundH = outer.height - inner.height;
  const root = document.documentElement;
  const reach = Number.parseFloat(root.style.getPropertyValue('--music-top'));
  const rem = Number.parseFloat(window.getComputedStyle(root).fontSize) || 16;
  const floor = window.innerHeight - (Number.isFinite(reach) ? reach : 0) - rem * 0.25;
  // The picture keeps about the room it had and takes its new shape: a 4:3 video after a 16:9 one is a little narrower and
  // taller, not a sliver or a wall.
  const area = inner.width * inner.height;
  let pictureW = Math.sqrt(area * picture.shape);
  let pictureH = pictureW / picture.shape;
  // No wider than the page (a margin each side) and no lower than the music bar...
  const widest = window.innerWidth - 16 - aroundW;
  const tallest = floor - outer.top - aroundH;
  const shrink = Math.min(1, widest / pictureW, tallest / pictureH);
  pictureW *= shrink;
  pictureH *= shrink;
  // ...and never under the window's least size.
  const least = windowMinSize(ROOM) ?? { w: 0, h: 0 };
  const grow = Math.max(1, (least.w - aroundW) / pictureW, (least.h - aroundH) / pictureH);
  pictureW *= grow;
  pictureH *= grow;
  const w = Math.round(aroundW + pictureW);
  const h = Math.round(aroundH + pictureH);
  // It keeps the edge nearer its side of the screen: the room sits in the upper right, so it grows and shrinks leftwards.
  const right = outer.left + outer.width / 2 > window.innerWidth / 2;
  const x = Math.max(8, Math.min(window.innerWidth - 8 - w, right ? outer.right - w : outer.left));
  return {
    from: { x: outer.left, y: outer.top, w: outer.width, h: outer.height },
    to: { x, y: outer.top, w, h },
  };
}

/**
 * Fits the room window to its picture: `auto` for the fit a new shape makes by itself, which stands back for a window sized
 * by hand, maximised, folded or fullscreen; otherwise `[ FIT ]`, which always fits and forgets the hand sizing.
 */
export function fitRoom(auto = false): void {
  if (typeof document === 'undefined' || picture === null) return;
  const live = liveWindow(ROOM);
  const element = document.querySelector<HTMLElement>(ROOM_ELEMENT);
  if (live === undefined || !live.open || element === null) {
    // The room tells its picture before its window is laid out (a child's effects run first): tried again next frame, a while.
    if (auto) {
      if (owed === 0) owed = OWED_FRAMES + 1;
      owed -= 1;
      // Given up after half a second or so; the next new picture tries afresh.
      if (owed > 0) requestAnimationFrame(() => fitRoom(true));
    }
    return;
  }
  owed = 0;
  if (auto && element.dataset.minimized === 'true') {
    foldedOwe = true;
    return;
  }
  if (auto && (readHand() || live.restore !== null || document.fullscreenElement !== null || handMoving())) return;
  if (!auto) writeHand(false);
  // From the box it is drawn in (a maximised window's too: it comes out of the maximise to the fitted size).
  const fit = roomFitTarget();
  if (fit === null) return;
  const { from, to: target } = fit;
  fittedTo = picture.shape;
  if (stepping !== null) clearTimeout(stepping);
  const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const steps = still ? 1 : STEPS;
  // Four hard steps, evenly apart and each one held: the site's snapping, not an easing.
  const step = (index: number) => {
    // The reader took hold of a window meanwhile: theirs, not the fit's.
    if (handMoving()) {
      stepping = null;
      return;
    }
    const share = index / steps;
    setWindowRect(ROOM, {
      x: from.x + (target.x - from.x) * share,
      y: from.y + (target.y - from.y) * share,
      w: from.w + (target.w - from.w) * share,
      h: from.h + (target.h - from.h) * share,
    });
    stepping = index < steps ? setTimeout(() => step(index + 1), STEP_MS) : null;
  };
  step(1);
}
