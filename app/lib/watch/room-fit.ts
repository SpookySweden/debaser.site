'use client';

import { handMoving, liveWindow, setWindowRect, windowMinSize, type WindowRect } from '../ui/window-layout';
import { subscribeToWatchWindow, watchWindowState } from './watch-window';

/**
 * The room window fitted to its picture (Luke, 2026-11-16: "add a button to fit the view window in the room to size in a
 * reasonable way, and do it automatically like when switching from a 4:3 video to a 16:9 please have it neatly resize. if it
 * looks jarring then find a way to make it smoother creatively"; 2026-11-20: "make stream room 'fit' by default as if fit
 * button was pressed each time media changes or is opened").
 *
 * - `[ FIT ]` on the room's title line: the picture keeps about the room it has and takes the video's shape, so there are no
 *   bars round it; no wider than the page, no lower than the music bar, never under the window's least size. The window
 *   keeps the edge nearer its side of the screen. A maximised window comes out of it to that size.
 * - By itself, exactly as FIT, each time the room opens or is unfolded with a picture on, and each time what is on changes
 *   (the same shape again too), even after the reader sized the window by hand. Not while it is maximised (the reader asked
 *   for the whole page). Folded or fullscreen, the fit waits for the window to be seen again.
 * - Not a glide: the site's feel is instant (docs/design.md), so the window snaps there in four hard steps, an outline of
 *   an old desktop window being dragged to size, about a sixth of a second in all. One step under `prefers-reduced-motion`.
 */

/** The room window's name in the layout store (`WatchWindow.tsx`), and its element on the page. */
const ROOM = 'room';
const ROOM_ELEMENT = '[data-dock-window="stream"]';
const STEPS = 4;
const STEP_MS = 40;

/** The picture's box in the room, the shape of what is on it and which play that is, while the room draws one (`WatchRoom.tsx`). */
type Picture = { box: HTMLElement; shape: number; play: string | null };
let picture: Picture | null = null;
const listeners = new Set<() => void>();

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

/** The play and shape the window was last fitted to: a new play, or a new shape for the same one, fits again. */
let fitted: { play: string | null; shape: number } | null = null;

/**
 * The room's picture, the shape of what is on it (null: none, or not known yet) and which play it is (the queue row). The first
 * picture after none (the room opened) and each new play fit by themselves, as if FIT were pressed.
 */
export function setRoomPicture(box: HTMLElement | null, shape: number | null, play: string | null = null): void {
  const next = box === null || shape === null || !Number.isFinite(shape) || shape <= 0 ? null : { box, shape, play };
  const changed = (picture?.shape ?? null) !== (next?.shape ?? null) || picture?.box !== next?.box;
  const fresh = next !== null && (fitted === null || fitted.play !== next.play || Math.abs(fitted.shape - next.shape) > 0.01);
  picture = next;
  // No picture (the room shut, a song, the blank screen): the next one fits once again.
  if (next === null) {
    fitted = null;
    owed = 0;
  }
  if (changed) for (const listener of listeners) listener();
  if (fresh) fitRoom(true);
}

/** Frames left to wait for the room window to be laid out before an automatic fit (it opens with its picture). */
let owed = 0;
const OWED_FRAMES = 30;
/** An automatic fit put off while the room was folded or fullscreen: made when it is seen again. */
let later = false;
if (typeof window !== 'undefined') {
  // Unfolded is opened: the room fits, as FIT would, whether or not a fit was put off.
  let wasFolded = watchWindowState().collapsed;
  subscribeToWatchWindow(() => {
    const now = watchWindowState();
    const unfolded = wasFolded && now.open && !now.collapsed;
    wasFolded = now.open && now.collapsed;
    if (unfolded || (later && now.open && !now.collapsed)) {
      later = false;
      // After the window is shown again, so it is measured as drawn.
      requestAnimationFrame(() => fitRoom(true));
    }
  });
  document.addEventListener('fullscreenchange', () => {
    if (later && document.fullscreenElement === null) {
      later = false;
      requestAnimationFrame(() => fitRoom(true));
    }
  });
}

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
 * Fits the room window to its picture: `auto` for the fit made by itself (the room opened, unfolded, or something new on), which
 * stands back only for a maximised window and waits while the room is folded or fullscreen; otherwise `[ FIT ]`.
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
  if (auto && (element.dataset.minimized === 'true' || document.fullscreenElement !== null)) {
    later = true;
    return;
  }
  if (auto && (live.restore !== null || handMoving())) return;
  // From the box it is drawn in (a maximised window's too: it comes out of the maximise to the fitted size).
  const fit = roomFitTarget();
  if (fit === null) return;
  const { from, to: target } = fit;
  fitted = { play: picture.play, shape: picture.shape };
  if (stepping !== null) clearTimeout(stepping);
  const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const steps = still ? 1 : STEPS;
  // Four hard steps, evenly apart and each one held: the site's snapping, not an easing.
  const step = (index: number) => {
    // The reader took hold of a window meanwhile, or filled the page with it: theirs, not the fit's.
    if (handMoving() || (index > 1 && liveWindow(ROOM)?.restore !== null)) {
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
