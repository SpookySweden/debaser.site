import type { StationTag } from './types';

/**
 * Which words the map can show right now, and where (SPEC-tag-station.md). Zoomed out it shows fewer labels, biggest first,
 * rather than shrinking any: nothing here ever changes a label's size, and no two labels overlap. Pure, so a check can hold it.
 */

export type MapView = { cx: number; cy: number; scale: number };
export type MapSize = { width: number; height: number };
export type PlacedLabel = { tag: StationTag; left: number; top: number; width: number; height: number; forced: boolean };

export const HOME_VIEW: MapView = { cx: 0.5, cy: 0.5, scale: 1 };
const ZOOMS = [1, 1.5, 2.25, 3.5, 5, 8];
/** Every label is a tap target, however small its words. */
const LABEL_HEIGHT = 44;
/** The face is monospaced: each letter is 0.6em wide. */
const LETTER_EM = 0.6;
/** Room for the padding around the word. */
const LABEL_PADDING = 18;
/** Room for a recipe mark ("+ dub"), so a word never changes size when it joins the recipe. */
const MARK_LETTERS = 2;

export function zoomed(scale: number, direction: 1 | -1): number {
  const at = ZOOMS.findIndex((zoom) => zoom >= scale);
  const from = at === -1 ? ZOOMS.length - 1 : at;
  return ZOOMS[Math.min(ZOOMS.length - 1, Math.max(0, from + direction))];
}

export function labelBox(name: string, fontPx: number): { width: number; height: number } {
  return { width: Math.ceil((name.length + MARK_LETTERS) * LETTER_EM * fontPx + LABEL_PADDING), height: Math.max(LABEL_HEIGHT, Math.ceil(fontPx * 1.5)) };
}

/** A word's centre on the map, in pixels. */
export function toScreen(tag: Pick<StationTag, 'x' | 'y'>, view: MapView, size: MapSize): { x: number; y: number } {
  return { x: (tag.x - view.cx) * view.scale * size.width + size.width / 2, y: (tag.y - view.cy) * view.scale * size.height + size.height / 2 };
}

/** The centre that keeps a view on the map: never more empty space than the zoom needs. */
export function clampView(view: MapView): MapView {
  const half = 0.5 / view.scale;
  const clamp = (value: number) => (half >= 0.5 ? 0.5 : Math.min(1 - half, Math.max(half, value)));
  return { cx: clamp(view.cx), cy: clamp(view.cy), scale: view.scale };
}

type Box = { left: number; top: number; width: number; height: number };
const overlaps = (a: Box, b: Box) => a.left < b.left + b.width && b.left < a.left + a.width && a.top < b.top + b.height && b.top < a.top + a.height;

/**
 * Forced words first (the chosen one, its neighbours, whatever has the keyboard), held inside the map; then the commonest
 * words that fit. A word whose centre is off the map is not drawn unless it is forced.
 */
export function placeLabels(tags: readonly StationTag[], view: MapView, size: MapSize, fontPx: number, forced: readonly string[]): PlacedLabel[] {
  if (size.width <= 0 || size.height <= 0) return [];
  const forcedSet = new Set(forced);
  const placed: PlacedLabel[] = [];
  const order = [...tags].sort((a, b) => Number(forcedSet.has(b.name)) - Number(forcedSet.has(a.name)) || b.count - a.count || (a.name < b.name ? -1 : 1));
  // Forced words keep the order they were asked in, so the chosen word always wins its spot.
  const forcedRank = new Map(forced.map((name, index) => [name, index]));
  order.sort((a, b) => (forcedRank.get(a.name) ?? Infinity) - (forcedRank.get(b.name) ?? Infinity));

  for (const tag of order) {
    const isForced = forcedSet.has(tag.name);
    const centre = toScreen(tag, view, size);
    if (!isForced && (centre.x < 0 || centre.x > size.width || centre.y < 0 || centre.y > size.height)) continue;
    const box = labelBox(tag.name, fontPx);
    const width = Math.min(box.width, size.width);
    const left = Math.min(size.width - width, Math.max(0, centre.x - width / 2));
    const top = Math.min(size.height - box.height, Math.max(0, centre.y - box.height / 2));
    const candidate = { left, top, width, height: box.height };
    if (placed.some((other) => overlaps(candidate, other))) {
      if (!isForced) continue;
      // A forced word that lands on another is moved down a row at a time until it's clear, or dropped as a last resort.
      const row = Array.from({ length: Math.ceil(size.height / box.height) }, (_, step) => ({ ...candidate, top: Math.min(size.height - box.height, (top + step * box.height) % size.height) }));
      const free = row.find((spot) => !placed.some((other) => overlaps(spot, other)));
      if (free === undefined) continue;
      placed.push({ tag, ...free, forced: true });
      continue;
    }
    placed.push({ tag, ...candidate, forced: isForced });
  }
  return placed;
}

export type Direction = 'left' | 'right' | 'up' | 'down';
const VECTORS: Record<Direction, { x: number; y: number }> = { left: { x: -1, y: 0 }, right: { x: 1, y: 0 }, up: { x: 0, y: -1 }, down: { x: 0, y: 1 } };

/** The nearest label that really is that way: within 60 degrees of the arrow, with straighter ones preferred. Null when none. */
export function nearestInDirection(labels: readonly PlacedLabel[], fromName: string, direction: Direction): PlacedLabel | null {
  const from = labels.find((label) => label.tag.name === fromName);
  if (from === undefined) return labels[0] ?? null;
  const centre = (label: PlacedLabel) => ({ x: label.left + label.width / 2, y: label.top + label.height / 2 });
  const start = centre(from);
  const vector = VECTORS[direction];
  let best: PlacedLabel | null = null;
  let bestScore = Infinity;
  for (const label of labels) {
    if (label === from) continue;
    const point = centre(label);
    const dx = point.x - start.x;
    const dy = point.y - start.y;
    const distance = Math.hypot(dx, dy);
    if (distance === 0) continue;
    const cosine = (dx * vector.x + dy * vector.y) / distance;
    if (cosine < 0.5) continue;
    const score = distance * (1 + 2 * (1 - cosine));
    if (score < bestScore || (score === bestScore && best !== null && label.tag.name < best.tag.name)) {
      best = label;
      bestScore = score;
    }
  }
  return best;
}
