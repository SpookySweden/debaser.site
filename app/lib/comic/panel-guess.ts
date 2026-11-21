import type { PanelBox } from './types';

/**
 * The first guess at a page's panels (SPEC-comic.md, Q10): its gutters are rows and columns that are all the page's background
 * colour, and the page is split along them again and again (an "XY-cut"): top to bottom first, then left to right inside each
 * strip, which is also the reading order. The code only reads Luke's art to find the gutters; it never draws on it. Luke fixes
 * the boxes by hand in the studio, so a rough guess on a page whose art crosses its gutters is fine.
 *
 * Pure: a greyscale picture in, boxes (fractions of the page) out, so `Temp/check-comic.cjs` can try it on made-up pages.
 */

export type GreyPicture = { width: number; height: number; data: Uint8Array };

/** How far from the background a pixel may be and still count as gutter. */
const TOLERANCE = 28;
/** A gutter line may carry this share of stray pixels (dust, a scanner speck). */
const STRAY = 0.004;
/** A gutter is at least this thick, as a share of the page's shorter side. */
const MIN_GUTTER = 0.006;
/** A panel smaller than this share of the page is noise, not a panel. */
const MIN_AREA = 0.012;
const MAX_DEPTH = 8;

type Region = { x0: number; y0: number; x1: number; y1: number };

/** The page's background: the commonest shade round its edge, and how much of the edge wears it. */
export function backgroundShade(picture: GreyPicture): number {
  return edgeShade(picture).shade;
}

function edgeShade(picture: GreyPicture): { shade: number; share: number } {
  const counts = new Uint32Array(256);
  const { width, height, data } = picture;
  for (let x = 0; x < width; x += 1) {
    counts[data[x]] += 1;
    counts[data[(height - 1) * width + x]] += 1;
  }
  for (let y = 0; y < height; y += 1) {
    counts[data[y * width]] += 1;
    counts[data[y * width + width - 1]] += 1;
  }
  let best = 255;
  for (let shade = 0; shade < 256; shade += 1) if (counts[shade] > counts[best]) best = shade;
  // Shades within the gutter tolerance of the commonest count as the same ground (paper is never one exact grey).
  let near = 0;
  for (let shade = Math.max(0, best - TOLERANCE); shade <= Math.min(255, best + TOLERANCE); shade += 1) near += counts[shade];
  return { shade: best, share: near / (2 * (width + height)) };
}

/** Under this share of the edge in one ground, the art runs off the page's edges: no margin, no gutters to read. */
const MARGIN_SHARE = 0.6;

function isGround(value: number, ground: number): boolean {
  return Math.abs(value - ground) <= TOLERANCE;
}

function rowIsGutter(picture: GreyPicture, ground: number, y: number, region: Region): boolean {
  const span = region.x1 - region.x0;
  const allowed = Math.floor(span * STRAY);
  let stray = 0;
  const row = y * picture.width;
  for (let x = region.x0; x < region.x1; x += 1) {
    if (!isGround(picture.data[row + x], ground)) {
      stray += 1;
      if (stray > allowed) return false;
    }
  }
  return true;
}

function columnIsGutter(picture: GreyPicture, ground: number, x: number, region: Region): boolean {
  const span = region.y1 - region.y0;
  const allowed = Math.floor(span * STRAY);
  let stray = 0;
  for (let y = region.y0; y < region.y1; y += 1) {
    if (!isGround(picture.data[y * picture.width + x], ground)) {
      stray += 1;
      if (stray > allowed) return false;
    }
  }
  return true;
}

/** Shrinks a region to the art inside it, or null when it is all background. */
function trim(picture: GreyPicture, ground: number, region: Region): Region | null {
  let { x0, y0, x1, y1 } = region;
  while (y0 < y1 && rowIsGutter(picture, ground, y0, { x0, y0, x1, y1 })) y0 += 1;
  while (y1 > y0 && rowIsGutter(picture, ground, y1 - 1, { x0, y0, x1, y1 })) y1 -= 1;
  while (x0 < x1 && columnIsGutter(picture, ground, x0, { x0, y0, x1, y1 })) x0 += 1;
  while (x1 > x0 && columnIsGutter(picture, ground, x1 - 1, { x0, y0, x1, y1 })) x1 -= 1;
  return x1 - x0 > 0 && y1 - y0 > 0 ? { x0, y0, x1, y1 } : null;
}

/** Splits a trimmed region along its gutters in one direction, or returns null when it has none thick enough. */
function splitAlong(picture: GreyPicture, ground: number, region: Region, across: 'rows' | 'columns', minGutter: number): Region[] | null {
  const start = across === 'rows' ? region.y0 : region.x0;
  const end = across === 'rows' ? region.y1 : region.x1;
  const pieces: Region[] = [];
  let pieceStart = start;
  let run = 0;
  for (let at = start; at < end; at += 1) {
    const gutter = across === 'rows' ? rowIsGutter(picture, ground, at, region) : columnIsGutter(picture, ground, at, region);
    if (gutter) {
      run += 1;
      continue;
    }
    if (run >= minGutter && at - run > pieceStart) {
      const cut = at - run;
      pieces.push(across === 'rows' ? { ...region, y0: pieceStart, y1: cut } : { ...region, x0: pieceStart, x1: cut });
      pieceStart = at;
    }
    run = 0;
  }
  if (pieces.length === 0) return null;
  pieces.push(across === 'rows' ? { ...region, y0: pieceStart, y1: end } : { ...region, x0: pieceStart, x1: end });
  return pieces;
}

/** The guessed panels of a page, in reading order, as fractions of the page. A page with no gutters is one panel. */
export function guessPanels(picture: GreyPicture): PanelBox[] {
  const { width, height } = picture;
  if (width < 8 || height < 8) return [];
  const edge = edgeShade(picture);
  // A splash page, its art to every edge: one panel, the whole page.
  if (edge.share < MARGIN_SHARE) return [{ x: 0, y: 0, w: 1, h: 1 }];
  const ground = edge.shade;
  const minGutter = Math.max(2, Math.round(Math.min(width, height) * MIN_GUTTER));
  const pageArea = width * height;
  const found: Region[] = [];

  const visit = (region: Region, depth: number, preferRows: boolean): void => {
    const trimmed = trim(picture, ground, region);
    if (trimmed === null) return;
    if ((trimmed.x1 - trimmed.x0) * (trimmed.y1 - trimmed.y0) < pageArea * MIN_AREA) return;
    if (depth < MAX_DEPTH) {
      const first = splitAlong(picture, ground, trimmed, preferRows ? 'rows' : 'columns', minGutter);
      const pieces = first ?? splitAlong(picture, ground, trimmed, preferRows ? 'columns' : 'rows', minGutter);
      if (pieces !== null) {
        const nextPreferRows = first !== null ? !preferRows : preferRows;
        for (const piece of pieces) visit(piece, depth + 1, nextPreferRows);
        return;
      }
    }
    found.push(trimmed);
  };

  visit({ x0: 0, y0: 0, x1: width, y1: height }, 0, true);

  return found.map((region) => ({
    x: round(region.x0 / width),
    y: round(region.y0 / height),
    w: round((region.x1 - region.x0) / width),
    h: round((region.y1 - region.y0) / height),
  }));
}

function round(value: number): number {
  return Math.round(value * 10000) / 10000;
}
