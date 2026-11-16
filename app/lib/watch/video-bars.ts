/**
 * Finding the black bars in a video's picture (SPEC-rooms-your-room.md, part 4; Luke, 2026-11-16: "i want you to find a way
 * to auto detect the bars for every video").
 *
 * Bars are of two kinds, and a still of the picture shows both the same way: the ones a player adds because its frame is
 * not the video's shape (a 4:3 video in YouTube's 16:9 player), and the ones in the video's own pixels (a wide film
 * uploaded inside a 16:9 file). This file is the arithmetic only: it is handed pixels and says how much of each edge is
 * black. Where the pixels come from (a player's published stills, our own file as it plays) is `bar-watch.ts`.
 *
 * It errs towards doing nothing. Trimming a bar that is not one cuts off picture, which is worse than a bar left on. So:
 * - a picture too dark to judge is not counted;
 * - black along an edge is a bar only where picture starts hard against it (a "firm" edge): a title on a black card, a
 *   lit face on a dark stage and a night sky all have black edges, and none has a line where the picture begins;
 * - enough pictures must show the same firm edge, and no picture may show anything inside it: subtitles sitting in a bar
 *   mean trimming it would trim them, and one picture that fills the frame means there is no bar;
 * - an edge counts only when the edge opposite has one the same size, which is what bars are.
 */

/** One edge of one picture: how deep the black along it runs, as a share of the picture, and whether picture starts hard against it. */
export type Edge = { depth: number; firm: boolean };

/** The four edges of one picture. */
export type Bars = { top: Edge; right: Edge; bottom: Edge; left: Edge };

/** What is trimmed off a picture: the same share from both sides (`x`) and from the top and the foot (`y`). */
export type Trim = { x: number; y: number };

export const NO_TRIM: Trim = { x: 0, y: 0 };

/** A pixel this dim on every channel is black. Bars in a compressed still are 0 to about 16; shadows in a picture run higher. */
const BLACK = 30;
/** A row or column is bar when this much of it is black: the rest is the compression's speckle. */
const LINE = 0.97;
/** A picture whose inside (what is left within its black edges) is this black cannot be judged. One black all over has no inside. */
const TOO_DARK = 0.85;
/** Picture starts hard against a bar when one of the first lines past it is at least this much picture (not black). */
const FIRM = 0.5;
const FIRM_LINES = 3;
/** A bar thinner than this share of the picture is not worth trimming (and is as likely an encoder's sliver). */
const LEAST = 0.025;
/** Never more than this from one edge: a tall phone video in a wide file loses about a third from each side. */
const MOST = 0.42;
/** Pictures agree on an edge when their bars are within this share of the picture of each other. */
const AGREE = 0.02;
/** Two opposite bars are a pair when they differ by no more than this share of the picture, or this share of the bigger. */
const PAIR_SLACK = 0.02;
const PAIR_SHARE = 0.3;

/**
 * The black edges of one picture, or null when it is too dark to tell (a night scene, a fade). `pixels` is RGBA, row by
 * row, `width` by `height`. One more line than was counted is taken from each bar found: its last line is the one the
 * compression has smeared half into the picture.
 */
export function readBars(pixels: ArrayLike<number>, width: number, height: number): Bars | null {
  if (width < 8 || height < 8 || pixels.length < width * height * 4) return null;
  const black = new Uint8Array(width * height);
  for (let at = 0; at < width * height; at += 1) {
    const from = at * 4;
    if (pixels[from] <= BLACK && pixels[from + 1] <= BLACK && pixels[from + 2] <= BLACK) black[at] = 1;
  }

  /** How much of a row (between two columns) or of a column (between two rows) is black. */
  const rowShare = (y: number, x0: number, x1: number) => {
    let count = 0;
    for (let x = x0; x < x1; x += 1) count += black[y * width + x];
    return count / (x1 - x0);
  };
  const columnShare = (x: number, y0: number, y1: number) => {
    let count = 0;
    for (let y = y0; y < y1; y += 1) count += black[y * width + x];
    return count / (y1 - y0);
  };

  let top = 0;
  while (top < height && rowShare(top, 0, width) >= LINE) top += 1;
  let bottom = 0;
  while (bottom < height - top && rowShare(height - 1 - bottom, 0, width) >= LINE) bottom += 1;
  if (top + bottom >= height) return null;
  let left = 0;
  while (left < width && columnShare(left, top, height - bottom) >= LINE) left += 1;
  let right = 0;
  while (right < width - left && columnShare(width - 1 - right, top, height - bottom) >= LINE) right += 1;
  if (left + right >= width) return null;

  // What is inside the black edges must itself be a picture, not more darkness.
  const [x0, x1, y0, y1] = [left, width - right, top, height - bottom];
  let inside = 0;
  for (let y = y0; y < y1; y += 1) for (let x = x0; x < x1; x += 1) inside += black[y * width + x];
  if (inside / ((x1 - x0) * (y1 - y0)) > TOO_DARK) return null;

  // Does picture start hard against each edge? One of the first few lines past the black must be mostly picture.
  const firmRow = (from: number, step: 1 | -1) => {
    for (let n = 0; n < FIRM_LINES; n += 1) {
      const y = from + n * step;
      if (y < y0 || y >= y1) break;
      if (1 - rowShare(y, x0, x1) >= FIRM) return true;
    }
    return false;
  };
  const firmColumn = (from: number, step: 1 | -1) => {
    for (let n = 0; n < FIRM_LINES; n += 1) {
      const x = from + n * step;
      if (x < x0 || x >= x1) break;
      if (1 - columnShare(x, y0, y1) >= FIRM) return true;
    }
    return false;
  };
  const edge = (count: number, of: number, firm: boolean): Edge => (count === 0 ? { depth: 0, firm: false } : { depth: Math.min(of, count + 1) / of, firm });
  return {
    top: edge(top, height, firmRow(y0, 1)),
    right: edge(right, width, firmColumn(x1 - 1, -1)),
    bottom: edge(bottom, height, firmRow(y1 - 1, -1)),
    left: edge(left, width, firmColumn(x0, 1)),
  };
}

/**
 * One edge across several pictures: how deep its bar is (0 for none), and whether a bar that enough pictures showed was
 * spoilt by one that showed something inside it.
 */
function judgeEdge(edges: readonly Edge[], least: number): { depth: number; spoilt: boolean } {
  const firm = edges.filter((edge) => edge.firm && edge.depth >= LEAST).map((edge) => edge.depth);
  if (firm.length === 0 || firm.length < least) return { depth: 0, spoilt: false };
  const depth = Math.min(...firm);
  // Pictures that each show a hard edge, but not at the same place, are not showing one bar.
  if (Math.max(...firm) - depth > AGREE) return { depth: 0, spoilt: false };
  // Every picture must be black that deep: one that is not has something in the bar, or no bar.
  if (edges.some((edge) => edge.depth < depth - AGREE)) return { depth: 0, spoilt: true };
  return { depth, spoilt: false };
}

/** One pair of opposite edges: the trim both get, or none when they are not a pair of bars. */
function pair(a: number, b: number): number {
  if (a < LEAST || b < LEAST) return 0;
  if (Math.abs(a - b) > Math.max(PAIR_SLACK, PAIR_SHARE * Math.max(a, b))) return 0;
  return Math.min(MOST, Math.min(a, b));
}

/**
 * What several pictures of the same video say is bar, and whether a bar was spoilt on either pair of edges (so a watcher
 * can stop looking for it: `bar-watch.ts`). Pictures too dark to tell (null) are not counted. At least `least` pictures
 * must show a firm edge at the same depth, on both of a pair of edges.
 */
export function judgeBars(reads: readonly (Bars | null)[], least: number): { trim: Trim; spoilt: { x: boolean; y: boolean } } {
  const usable = reads.filter((read): read is Bars => read !== null);
  const of = (side: keyof Bars) => judgeEdge(usable.map((read) => read[side]), least);
  const [top, right, bottom, left] = [of('top'), of('right'), of('bottom'), of('left')];
  const x = pair(left.depth, right.depth);
  const y = pair(top.depth, bottom.depth);
  return { trim: x === 0 && y === 0 ? NO_TRIM : { x, y }, spoilt: { x: left.spoilt || right.spoilt, y: top.spoilt || bottom.spoilt } };
}

/**
 * Whether one picture shows something inside a trim already in force: an edge of it black less deep than the trim. A
 * watcher asks this of each new look, so a held trim is let go the moment subtitles land in a bar, however few looks it has.
 */
export function spoils(read: Bars, trim: Trim): { x: boolean; y: boolean } {
  return {
    x: trim.x > 0 && (read.left.depth < trim.x - AGREE || read.right.depth < trim.x - AGREE),
    y: trim.y > 0 && (read.top.depth < trim.y - AGREE || read.bottom.depth < trim.y - AGREE),
  };
}

/** What several pictures of the same video agree is bar (`judgeBars`, without the reasons). */
export function agreeBars(reads: readonly (Bars | null)[], least: number): Trim {
  return judgeBars(reads, least).trim;
}

export function sameTrim(a: Trim, b: Trim): boolean {
  return Math.abs(a.x - b.x) < 0.004 && Math.abs(a.y - b.y) < 0.004;
}

export function hasTrim(trim: Trim): boolean {
  return trim.x > 0 || trim.y > 0;
}

/** The shape of what is left of a picture of this shape (wide for tall) once its bars are trimmed. */
export function trimmedShape(shape: number, trim: Trim): number {
  return (shape * (1 - 2 * trim.x)) / (1 - 2 * trim.y);
}
