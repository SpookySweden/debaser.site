import { UMAP } from 'umap-js';
import { strength } from './closeness';
import type { Partner } from './types';

/**
 * Where each word sits on the map (SPEC-tag-station.md). SERVER ONLY: this is what brings in the UMAP library.
 *
 * Each word is described by its row of closeness scores to every other word, and two words sit near each other when their
 * rows look alike, so two rare words that never met can still be neighbours through the words they both meet. The seed is
 * fixed and the input sorted, so the same data always draws the same map.
 */

/** Words laid out by UMAP; rarer ones past this are placed beside their strongest partner. Keeps the build to seconds. */
const MAX_LAID_OUT = 1000;
const SEED = 20261105;
/** Keeps labels off the very edge of the map. */
const MARGIN = 0.04;

type LayoutInput = { name: string; count: number; partners: readonly Partner[] };
export type Place = { x: number; y: number };

/** A small seeded random number source, so nothing in the layout depends on the moment it ran. */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = state;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

/** One minus the cosine of two rows: 0 for rows that point the same way, 1 for rows with nothing in common. */
function cosineDistance(a: number[], b: number[]): number {
  let dot = 0;
  let sizeA = 0;
  let sizeB = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    sizeA += a[i] * a[i];
    sizeB += b[i] * b[i];
  }
  return sizeA === 0 || sizeB === 0 ? 1 : 1 - dot / Math.sqrt(sizeA * sizeB);
}

/**
 * Stretches one axis so words spread across the map: half the true position, half the word's rank along the axis. UMAP
 * packs words into tight clumps, which reads well as dots and badly as text; the order along the axis is what survives.
 */
function spread(values: number[]): number[] {
  const low = Math.min(...values);
  const high = Math.max(...values);
  const span = high - low || 1;
  const order = values.map((value, index) => ({ value, index })).sort((a, b) => a.value - b.value || a.index - b.index);
  const rank = new Array<number>(values.length);
  order.forEach(({ index }, position) => {
    rank[index] = values.length === 1 ? 0.5 : position / (values.length - 1);
  });
  return values.map((value, index) => {
    const mixed = 0.5 * ((value - low) / span) + 0.5 * rank[index];
    return Math.round((MARGIN + mixed * (1 - 2 * MARGIN)) * 1000) / 1000;
  });
}

export function layoutTags(input: readonly LayoutInput[], maxLaidOut: number = MAX_LAID_OUT): Map<string, Place> {
  const places = new Map<string, Place>();
  if (input.length === 0) return places;

  // Commonest first, then by name, so which words make the cut never changes between runs.
  const chosen = [...input].sort((a, b) => b.count - a.count || (a.name < b.name ? -1 : 1)).slice(0, maxLaidOut);
  const column = new Map(chosen.map((tag, index) => [tag.name, index]));
  const rows = chosen.map((tag, index) => {
    const row = new Array<number>(chosen.length).fill(0);
    row[index] = 1;
    for (const partner of tag.partners) {
      const at = column.get(partner.name);
      if (at !== undefined) row[at] = strength(partner);
    }
    return row;
  });

  let coordinates: number[][];
  if (rows.length < 4) {
    // Too few for UMAP to mean anything: a plain line across the middle.
    coordinates = rows.map((_, index) => [index, index % 2]);
  } else {
    const umap = new UMAP({
      nComponents: 2,
      nNeighbors: Math.min(12, rows.length - 1),
      minDist: 0.25,
      nEpochs: 300,
      distanceFn: cosineDistance,
      random: seeded(SEED),
    });
    coordinates = umap.fit(rows);
  }

  const xs = spread(coordinates.map((point) => point[0]));
  const ys = spread(coordinates.map((point) => point[1]));
  chosen.forEach((tag, index) => places.set(tag.name, { x: xs[index], y: ys[index] }));

  // Whatever missed the cut goes just beside its strongest partner that made it, or to the middle.
  const random = seeded(SEED + 1);
  const rest = input.filter((tag) => !places.has(tag.name)).sort((a, b) => (a.name < b.name ? -1 : 1));
  for (const tag of rest) {
    const anchor = [...tag.partners].sort((a, b) => strength(b) - strength(a)).find((partner) => places.has(partner.name));
    const base = anchor ? places.get(anchor.name)! : { x: 0.5, y: 0.5 };
    const nudge = () => (random() - 0.5) * 0.04;
    const clamp = (value: number) => Math.round(Math.min(1 - MARGIN, Math.max(MARGIN, value)) * 1000) / 1000;
    places.set(tag.name, { x: clamp(base.x + nudge()), y: clamp(base.y + nudge()) });
  }
  return places;
}
