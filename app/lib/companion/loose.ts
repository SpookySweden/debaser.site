import { spanFor, type Span } from './brain';

/**
 * A character taken out of its window on a profile (Luke, 2026-11-16: "anyone can grab one out of its window; let go, it
 * walks and climbs back in by itself"). Once it is down on the site's floor after being carried, thrown or dropped, this
 * decides each frame of its way home, kept pure: along the floor to under its room, then up the side into it on its
 * climbing frames, a step a frame, as a companion climbs into a profile's room (`visit.ts`). Nothing is sent or saved:
 * it is this reader's screen only.
 */

/** Pixels a frame along the floor, and up or down while it climbs (a companion's own). */
export const LOOSE_WALK = 3;
export const LOOSE_CLIMB = 8;
/** Frames it waits with its room out of sight (scrolled away, covered) before it pops back into it. */
export const LOST_TICKS = 60;

/** Where in its room it can stand, on the screen: the room's floor, and the two ends a figure of its width fits between. */
export type LooseHome = { left: number; right: number; floor: number } | null;

/** The floor it walks along: the line of the site's floor (the music bar's top edge) and its free stretches. */
export type LooseGround = { y: number; spans: readonly Span[] };

export type LooseStage = 'walk' | 'climb' | 'wait' | 'home';

/** Where it is (its left edge, and its feet from the top of the screen), which way it faces, and what it is doing. */
export type Loose = { x: number; y: number; facing: 1 | -1; stage: LooseStage; waited: number };

const toward = (from: number, to: number, step: number): number => (Math.abs(to - from) <= step ? to : from + Math.sign(to - from) * step);

/** Down on the floor where it landed. */
export function startLoose(x: number, y: number, facing: 1 | -1): Loose {
  return { x: Math.round(x), y: Math.round(y), facing, stage: 'walk', waited: 0 };
}

/**
 * One frame of its way home. With its room in sight: along the floor to the stretch under the room's nearest column it
 * can stand in, then up into the room (sideways as it climbs, onto that column). In the room, standing where it can: home.
 * With its room out of sight: off any climb, back down to the floor, and it waits; after `LOST_TICKS` of that it is home
 * anyway (it pops back in where it stood before).
 */
export function looseStep(now: Loose, ground: LooseGround, home: LooseHome): Loose {
  if (now.stage === 'home') return now;
  if (home === null) {
    const waited = now.waited + 1;
    if (waited >= LOST_TICKS) return { ...now, stage: 'home', waited };
    const y = toward(now.y, ground.y, LOOSE_CLIMB);
    return { ...now, y, stage: y === ground.y ? 'wait' : 'climb', waited };
  }
  const column = Math.min(home.right, Math.max(home.left, now.x));
  const strip = spanFor(ground.spans, column);
  const below = strip === null ? column : Math.min(strip.right, Math.max(strip.left, column));
  // On the floor, not yet under its room: walk.
  if (now.y >= ground.y - 0.5 && Math.abs(below - now.x) >= 1) {
    const facing: 1 | -1 = below > now.x ? 1 : -1;
    return { x: toward(now.x, below, LOOSE_WALK), y: ground.y, facing, stage: 'walk', waited: 0 };
  }
  // Under it: up it goes, onto the column as it climbs.
  const x = toward(now.x, column, LOOSE_WALK);
  const y = toward(now.y, home.floor, LOOSE_CLIMB);
  const facing: 1 | -1 = column === now.x ? now.facing : column > now.x ? 1 : -1;
  if (y === home.floor && x === column) return { x, y, facing, stage: 'home', waited: 0 };
  return { x, y, facing, stage: 'climb', waited: 0 };
}
