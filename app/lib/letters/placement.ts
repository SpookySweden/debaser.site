import type { Placement } from './types';

/**
 * Where a new card lands on a letter's canvas: a random spot that keeps clear of the edges and, as far as it can, of the
 * cards already there (it tries a few spots and keeps the one furthest from its nearest neighbour), with a slight tilt.
 * "Randomly and stylishly placed" (Luke, 2026-11-10): scattered like things dropped on a desk, overlapping only a little.
 */
export function placeCard(taken: readonly Placement[], random: () => number = Math.random): Placement {
  let best: Placement | null = null;
  let bestGap = -1;
  for (let attempt = 0; attempt < 24; attempt += 1) {
    const spot = { x: 0.1 + random() * 0.8, y: 0.12 + random() * 0.76 };
    const gap = taken.reduce((nearest, card) => Math.min(nearest, Math.hypot(card.x - spot.x, card.y - spot.y)), Number.POSITIVE_INFINITY);
    if (gap > bestGap) {
      bestGap = gap;
      best = { ...spot, turn: 0 };
    }
  }
  const turn = Math.round((random() - 0.5) * 16);
  return { x: round(best?.x ?? 0.5), y: round(best?.y ?? 0.5), turn };
}

/** SHUFFLE: every card gets a fresh spot, placed one after another so they still keep apart. */
export function scatter<T extends { id: string }>(cards: readonly T[], random: () => number = Math.random): (Placement & { id: string })[] {
  const placed: (Placement & { id: string })[] = [];
  for (const card of cards) placed.push({ id: card.id, ...placeCard(placed, random) });
  return placed;
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
