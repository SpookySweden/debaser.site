import { freeSpans, type Span } from './brain';
import { setLedgeCovering } from './ledge';

/**
 * Where the companion walks (SPEC-companion.md, decision 1): along the top edge of the music bar, or the window's
 * bottom edge when the bar is folded or hidden. The docked bar publishes its height as `--bottom-bar`
 * (`../ui/use-edge-reserve.ts`).
 *
 * While a stream room's window covers that strip (Luke, 2026-11-14: "Stand on the window's top edge") the floor is the
 * top edge of that window instead: companions walk along it, above its title bar, between its two corners, and go back
 * to the strip when the window is folded away or closed. The window is marked `data-headroom` (`DockWindow`, `./ledge.ts`).
 *
 * What it steps around rather than over: anything marked `data-companion-avoid` (the folded player tile, the phone
 * card, the stream's TV box), the floating video while it floats, and any other open window that reaches into the band
 * it stands in (the arcade, Preferences): it would be hidden behind one. Each is a block only where it reaches into
 * that band.
 */

export const AVOID_SELECTOR = '[data-companion-avoid], [data-floating-player="floating"], [data-dock-window]';
export const LEDGE_SELECTOR = '[data-dock-window][data-headroom]';

/** Room kept between the figure and anything it steps around. */
const GAP = 6;
/**
 * How far above the strip's line a window's foot may stop and still count as over the strip, when deciding whether it
 * should leave room above itself: one number for every figure, so figures of different heights measuring in turn agree.
 */
const COVER_REACH = 48;
/** Far enough off either side to shut the floor outside a ledge's two corners. */
const FAR = 1_000_000;

export type Floor = {
  /** The y of the line it stands on, from the top of the screen. */
  y: number;
  screen: number;
  /** The two ends of the floor: the whole screen, or a ledge's corners. A place along it is shared as a share of this. */
  left: number;
  right: number;
  spans: Span[];
  /** Standing on a stream room's window rather than on its strip. */
  ledge: boolean;
};

/** A box as plain numbers: what the pure part works on. */
export type FloorBox = { left: number; top: number; right: number; bottom: number };

/** Whether a window reaches down over the strip a figure of this height stands in (wherever its top is). */
export function reachesStrip(ledge: FloorBox, stripY: number, figureHeight: number): boolean {
  return ledge.right > ledge.left && ledge.bottom > stripY - figureHeight && ledge.top < stripY;
}

/** Whether a window covers the strip a figure of this height stands in, with room above it for the figure to stand on it. */
export function ledgeCovers(ledge: FloorBox, stripY: number, figureHeight: number): boolean {
  return reachesStrip(ledge, stripY, figureHeight) && ledge.top >= figureHeight - 0.5;
}

/**
 * The floor, from measured boxes. Pure, for `Temp/check-companion.cjs`.
 *   `ledge`: the stream room's window when one is open, or null. It is the floor only while it covers the strip and has
 *            room above it (`ledgeCovers`); otherwise it is one more thing in the way, like any window.
 *   `blocks`: the boxes of everything else it steps around.
 */
export function floorFrom(screen: number, stripY: number, ledge: FloorBox | null, blocks: readonly FloorBox[], figureWidth: number, figureHeight: number): Floor {
  const onLedge = ledge !== null && ledgeCovers(ledge, stripY, figureHeight);
  const y = onLedge ? Math.round(ledge.top) : stripY;
  const top = y - figureHeight;
  const all = ledge === null || onLedge ? blocks : [...blocks, ledge];
  // Only what reaches into the band it stands in, from its head down to a little under its feet.
  const inWay: Span[] = all.filter((box) => box.right > box.left && box.bottom > top && box.top < y + GAP).map((box) => ({ left: box.left, right: box.right }));
  if (!onLedge) return { y, screen, left: 0, right: screen, spans: freeSpans(screen, inWay, figureWidth, GAP), ledge: false };
  const left = Math.max(0, Math.round(ledge.left));
  const right = Math.min(screen, Math.round(ledge.right));
  // Shut outside the window's two corners (each end block is widened by the gap, so it stops exactly at the corner).
  const ends: Span[] = [{ left: -FAR, right: left - GAP }, { left: right + GAP, right: FAR }];
  return { y, screen, left, right, spans: freeSpans(screen, [...inWay, ...ends], figureWidth, GAP), ledge: true };
}

const boxOf = (element: Element): FloorBox => {
  const box = element.getBoundingClientRect();
  return { left: box.left, top: box.top, right: box.right, bottom: box.bottom };
};

/** A window that is on screen: not folded away, and with a size. */
function shown(element: Element): boolean {
  if (element instanceof HTMLElement && element.dataset.minimized === 'true') return false;
  const box = element.getBoundingClientRect();
  return box.width > 0 && box.height > 0;
}

export function measureFloor(figureWidth: number, figureHeight: number): Floor {
  const root = document.documentElement;
  const bar = Number.parseFloat(root.style.getPropertyValue('--bottom-bar'));
  const screen = root.clientWidth;
  const stripY = window.innerHeight - (Number.isFinite(bar) ? bar : 0);
  const ledge = [...document.querySelectorAll(LEDGE_SELECTOR)].find(shown) ?? null;
  const blocks: FloorBox[] = [];
  for (const element of document.querySelectorAll(AVOID_SELECTOR)) {
    if (element === ledge || !shown(element)) continue;
    blocks.push(boxOf(element));
  }
  const ledgeBox = ledge === null ? null : boxOf(ledge);
  // The window leaves room above itself only while it is over the strip (`./ledge.ts`). Its foot does not move when it
  // does, so this does not flip back and forth.
  setLedgeCovering(ledgeBox !== null && reachesStrip(ledgeBox, stripY, COVER_REACH));
  return floorFrom(screen, stripY, ledgeBox, blocks, figureWidth, figureHeight);
}
