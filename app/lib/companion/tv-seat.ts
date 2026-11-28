/**
 * Where your companion sits to watch the player bar's TV, and how it gets there (SPEC-player-tv.md; Luke, 2026-11-28:
 * "the character will also crawl down and sit to watch the tv").
 *
 * The seat is the box the TV leaves beside itself (`data-tv-seat`, `app/components/PlayerTv.tsx`). On the way down, on
 * the seat and on the way back up it is drawn at half its usual size ("Half size", one block per screen pixel), so its
 * place here is the left edge and the feet of that half-sized figure. The first part is pure, for
 * `Temp/check-player-tv.cjs`.
 */

export type Spot = { x: number; y: number };
export type SeatBox = { left: number; top: number; width: number; height: number; inWindow: boolean };

/** The least it moves in a frame, and the most frames a way down may take (a long one is covered faster). */
export const CRAWL_STEP = 3;
export const CRAWL_FRAMES = 30;
/** Room left under its feet inside the bar's black. */
const FOOT = 2;

/** Where it sits: the middle of the seat, its feet near the foot of it. `figureWidth` is the figure's full size. */
export function seatSpot(seat: SeatBox, figureWidth: number): Spot {
  return { x: Math.round(seat.left + (seat.width - figureWidth / 2) / 2), y: Math.round(seat.top + seat.height - FOOT) };
}

/** One frame of the way from `from` to `to`, in a straight line and never past it. */
export function crawlStep(from: Spot, to: Spot, whole: number): Spot {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const left = Math.hypot(dx, dy);
  const step = Math.max(CRAWL_STEP, whole / CRAWL_FRAMES);
  if (left <= step) return { x: to.x, y: to.y };
  return { x: Math.round(from.x + (dx / left) * step), y: Math.round(from.y + (dy / left) * step) };
}

/** The seat on screen now, or null: no video, no TV, or a bar that is folded, hidden or at phone width. */
export function seatOnScreen(): SeatBox | null {
  for (const element of document.querySelectorAll('[data-tv-seat]')) {
    const box = element.getBoundingClientRect();
    if (box.width <= 0 || box.height <= 0 || box.bottom > window.innerHeight + 1 || box.top < 0) continue;
    return { left: box.left, top: box.top, width: box.width, height: box.height, inWindow: element.closest('[data-dock-window]') !== null };
  }
  return null;
}
