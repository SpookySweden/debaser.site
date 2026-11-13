import { freeSpans, type Span } from './brain';

/**
 * Where the companion walks (SPEC-companion.md, decision 1): along the top edge of the music bar, or the window's
 * bottom edge when the bar is folded or hidden. The docked bar publishes its height as `--bottom-bar`
 * (`../ui/use-edge-reserve.ts`); nothing else changes the floor.
 *
 * What it steps around rather than over: anything marked `data-companion-avoid` (the folded player tile, the phone
 * card, the stream's TV box) and the floating video while it floats. Each is a block only where it reaches down into
 * the strip the figure stands in.
 */

export const AVOID_SELECTOR = '[data-companion-avoid], [data-floating-player="floating"]';

/** Room kept between the figure and anything it steps around. */
const GAP = 6;

export type Floor = {
  /** The y of the line it stands on, from the top of the screen. */
  y: number;
  screen: number;
  spans: Span[];
};

export function measureFloor(figureWidth: number, figureHeight: number): Floor {
  const root = document.documentElement;
  const bar = Number.parseFloat(root.style.getPropertyValue('--bottom-bar'));
  const screen = root.clientWidth;
  const y = window.innerHeight - (Number.isFinite(bar) ? bar : 0);
  const top = y - figureHeight;
  const blocks: Span[] = [];
  for (const element of document.querySelectorAll(AVOID_SELECTOR)) {
    const box = element.getBoundingClientRect();
    if (box.width === 0 || box.height === 0) continue;
    // Only what reaches into the strip it stands in, from its head down to a little under its feet.
    if (box.bottom <= top || box.top >= y + GAP) continue;
    blocks.push({ left: box.left, right: box.right });
  }
  return { y, screen, spans: freeSpans(screen, blocks, figureWidth, GAP) };
}
