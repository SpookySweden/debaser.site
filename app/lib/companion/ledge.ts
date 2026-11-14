import { createWindowSlot } from '../ui/window-slot';

/**
 * Companions on top of a stream room's window (Luke, 2026-11-14: "the way stream room windows currently are can obscure
 * the characters from view", and his pick of the ways round it: "Stand on the window's top edge").
 *
 * The room's window fills the screen down to the music bar, so the strip companions walk along is behind it. While it
 * covers the strip they walk, sit and dance along the window's top edge instead (`floor.ts`), above its title bar, so
 * they cover none of its keys. A window that fills the screen has no room above it, so it leaves some: it is drawn that
 * much lower (`DockWindow`'s `headroom`), only while a companion is being drawn, and only as much as the tallest needs.
 * Each figure says how tall it is while it is drawn (`holdLedgeHeight`); the window reads the tallest.
 */
const heights = new Map<symbol, number>();
const slot = createWindowSlot<number>(0);

/** A little air between the top of the screen and the tallest companion's head. */
const AIR = 2;

/** The room above itself a stream room's window leaves, in CSS pixels; 0 when no companion is being drawn. */
export const ledgeHeadroomState = slot.state;
export const subscribeToLedgeHeadroom = slot.subscribe;
export const serverLedgeHeadroom = (): number => 0;

/** Whether the room's window is over the strip just now (`floor.ts` says, as it measures). Elsewhere it need leave no room. */
let covering = false;

function publish(): void {
  const tallest = Math.max(0, ...heights.values());
  const headroom = tallest === 0 || !covering ? 0 : tallest + AIR;
  if (slot.state() !== headroom) slot.set(headroom);
}

/**
 * Told by the floor each time it is measured: the room's window reaches down over the companions' strip (so they need
 * its top edge, and it leaves room there), or it does not (a small window out of the way, a phone's tall screen with the
 * window at its top, no window at all), and it stays exactly where it is.
 */
export function setLedgeCovering(next: boolean): void {
  if (covering === next) return;
  covering = next;
  publish();
}

/** A figure of `height` is being drawn, until the function it hands back is called. */
export function holdLedgeHeight(height: number): () => void {
  const key = Symbol('figure');
  heights.set(key, Math.round(height));
  publish();
  return () => {
    heights.delete(key);
    publish();
  };
}
