import { handMoving, layoutReady, liveWindow, setWindowRect, windowLayoutState, type WindowRect } from './window-layout';

/**
 * A docked window that stays open across pages keeps out of the way of each page's main keys
 * (Luke, 2026-11-16, "4B", from a test run: the PREFERENCES window sat on top of "+ NEW POST").
 *
 * A page marks its main keys with `data-main-key` ("+ NEW POST", "+ UPLOAD", "[ GO LIVE ]"...). When the
 * window opens, when the page changes, when the screen is resized and when the window is dropped, it is
 * checked against those keys; if it covers one it hops, at its own size, to the nearest place that covers
 * none (beside the key, above or below it, or a corner), kept on screen and clear of the music bar. A
 * maximised window, or one being dragged or resized, is left alone; so is one with nowhere free to go.
 */

/** Room kept between the window and a key it moved away from. */
const GAP = 8;

type Box = { left: number; top: number; right: number; bottom: number };

function overlaps(rect: WindowRect, box: Box): boolean {
  return rect.x < box.right + GAP && rect.x + rect.w > box.left - GAP && rect.y < box.bottom + GAP && rect.y + rect.h > box.top - GAP;
}

/** The page's main keys on screen just now, outside every window (a key inside a window moves with it). */
export function mainKeyBoxes(): Box[] {
  const boxes: Box[] = [];
  for (const element of document.querySelectorAll<HTMLElement>('[data-main-key]')) {
    if (element.closest('[data-dock-window], [role="dialog"]') !== null) continue;
    const box = element.getBoundingClientRect();
    if (box.width === 0 || box.height === 0) continue;
    if (box.bottom < 0 || box.top > window.innerHeight || box.right < 0 || box.left > window.innerWidth) continue;
    boxes.push({ left: box.left, top: box.top, right: box.right, bottom: box.bottom });
  }
  return boxes;
}

/** How far down a window's foot may reach: the top of the music player, as the room window keeps (`--music-top`). */
function floor(): number {
  const reach = Number.parseFloat(document.documentElement.style.getPropertyValue('--music-top'));
  return window.innerHeight - (Number.isFinite(reach) ? reach : 0);
}

/**
 * Where a window at `rect` should go so it covers none of `keys`, or null when it already covers none
 * or nowhere on the screen is free. Pure, so a check can ask it with made-up boxes.
 */
export function clearPlace(
  rect: WindowRect,
  keys: Box[],
  area: { left: number; top: number; right: number; bottom: number },
): WindowRect | null {
  if (!keys.some((key) => overlaps(rect, key))) return null;

  const { w, h } = rect;
  const fit = (x: number, y: number): WindowRect => ({
    x: Math.round(Math.max(area.left, Math.min(area.right - w, x))),
    y: Math.round(Math.max(area.top, Math.min(area.bottom - h, y))),
    w,
    h,
  });

  const candidates: WindowRect[] = [];
  for (const key of keys) {
    candidates.push(
      fit(key.left - GAP - w - 1, rect.y),
      fit(key.right + GAP + 1, rect.y),
      fit(rect.x, key.bottom + GAP + 1),
      fit(rect.x, key.top - GAP - h - 1),
    );
  }
  candidates.push(
    fit(area.right - w, area.bottom - h),
    fit(area.left, area.bottom - h),
    fit(area.right - w, area.top),
    fit(area.left, area.top),
  );

  let best: WindowRect | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const candidate of candidates) {
    if (keys.some((key) => overlaps(candidate, key))) continue;
    const distance = Math.hypot(candidate.x - rect.x, candidate.y - rect.y);
    if (distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return best;
}

/** Moves the window `id` off the page's main keys, if it is on one (see the top of this file). */
export function clearMainKeys(id: string): void {
  if (!layoutReady() || handMoving()) return;
  const live = liveWindow(id);
  if (live === undefined || !live.open || live.restore !== null) return;

  const { viewport, top } = windowLayoutState();
  const bottom = Math.max(top + live.rect.h, Math.min(viewport.h, floor()));
  const place = clearPlace(live.rect, mainKeyBoxes(), { left: 0, top, right: viewport.w, bottom });
  if (place !== null) setWindowRect(id, place);
}
