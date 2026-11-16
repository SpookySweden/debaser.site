/**
 * The sound graph behind the music bar's black display (Luke, 2026-11-16: "behind the music player / video player info
 * bar at the bottom of the screen, the black space should have a neat looking colourful sound graph which doesnt make
 * the text in front of it illegible. which reacts to the sound of the media"). Pure, so a check can run every rule here
 * without a browser; the drawing is `app/components/SoundGraph.tsx`.
 *
 * - **Colours are the theme's own** (`GRAPH_ROLES`, read from the page's colour tokens as the theme sets them), lows on
 *   the left to highs on the right.
 * - **The words in front stay readable, by arithmetic, not by eye.** Each colour is drawn see-through over the black
 *   display, and how see-through is worked out from the colours themselves (`safeAlpha`): the most a colour may show
 *   while every word on the display (`LED_INKS`) still measures 4.5:1 or better against the mix. A colour that cannot
 *   show enough at that limit is left out rather than drawn too faint to see.
 * - **Pixel blocks**, the way a shelf stereo's meter reads: bars of short segments, no smoothing between them.
 */

/** The theme's colour jobs the bars wear, left (lows) to right (highs). Every theme sets each of them. */
export const GRAPH_ROLES = ['queue-next-ink', 'acid', 'sun', 'bubble', 'queue-played-ink'] as const;

/** The words on the black display (TrackDetails' `led` tone, the caption): white and the green title. */
export const LED_INKS = ['ink-bar', 'acid'] as const;

/** The display's own black. */
export const LED_BASE = 'hardware';

/** The house rule: every word 4.5:1. Worked to a little above it, so rounding in a browser never takes it under. */
export const MIN_CONTRAST = 4.5;
const MARGIN = 0.15;

/** The most any colour shows, however safe: a graph behind words, not a light show in front of them. */
export const MAX_ALPHA = 0.6;
/** Below this a colour is too faint to read as part of the graph, so it is left out. */
export const MIN_ALPHA = 0.14;

export type Rgb = { r: number; g: number; b: number };

/** A six- or three-digit hex colour, or the comma form a browser reports for a computed colour, as numbers 0-255; null for anything else. */
export function parseColour(value: string): Rgb | null {
  const text = value.trim().toLowerCase();
  const hex = text.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/);
  if (hex) {
    const digits = hex[1].length === 3 ? hex[1].split('').map((d) => d + d).join('') : hex[1];
    return { r: parseInt(digits.slice(0, 2), 16), g: parseInt(digits.slice(2, 4), 16), b: parseInt(digits.slice(4, 6), 16) };
  }
  const rgb = text.match(/^rgba?\(\s*(\d{1,3})[\s,]+(\d{1,3})[\s,]+(\d{1,3})/);
  if (rgb) return { r: Number(rgb[1]), g: Number(rgb[2]), b: Number(rgb[3]) };
  return null;
}

function channel(value: number): number {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** WCAG's relative luminance. */
export function luminance(colour: Rgb): number {
  return 0.2126 * channel(colour.r) + 0.7152 * channel(colour.g) + 0.0722 * channel(colour.b);
}

export function contrast(a: Rgb, b: Rgb): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** A colour drawn at `alpha` over `base`, as a canvas mixes it (in the colours' own numbers, the way browsers blend). */
export function mix(colour: Rgb, base: Rgb, alpha: number): Rgb {
  return {
    r: Math.round(colour.r * alpha + base.r * (1 - alpha)),
    g: Math.round(colour.g * alpha + base.g * (1 - alpha)),
    b: Math.round(colour.b * alpha + base.b * (1 - alpha)),
  };
}

/** The worst contrast any of the words has against `colour` at `alpha` over the display. */
export function worstContrast(colour: Rgb, base: Rgb, inks: readonly Rgb[], alpha: number): number {
  const behind = mix(colour, base, alpha);
  return Math.min(...inks.map((ink) => contrast(ink, behind)));
}

/**
 * The most `colour` may show over `base` with every word in `inks` still at 4.5:1 or better, capped at `MAX_ALPHA`; 0 when
 * even the bare display fails (nothing is drawn then). Found by halving, to a hundredth.
 */
export function safeAlpha(colour: Rgb, base: Rgb, inks: readonly Rgb[]): number {
  const need = MIN_CONTRAST + MARGIN;
  if (worstContrast(colour, base, inks, 0) < need) return 0;
  if (worstContrast(colour, base, inks, MAX_ALPHA) >= need) return MAX_ALPHA;
  let low = 0;
  let high = MAX_ALPHA;
  while (high - low > 0.005) {
    const middle = (low + high) / 2;
    if (worstContrast(colour, base, inks, middle) >= need) low = middle;
    else high = middle;
  }
  return Math.floor(low * 100) / 100;
}

/** A bar colour: its numbers, the theme's own value as the page gave it (what the canvas paints with), and its limit. */
export type GraphColour = { rgb: Rgb; css: string; alpha: number };

/**
 * The colours the bars wear, from the theme's values by job (`read` answers a job's colour, as the page has it now):
 * each with the most it may show. Colours too faint at their limit, or unreadable, are left out; an empty answer means
 * the graph draws nothing.
 */
export function graphPalette(read: (job: string) => string): GraphColour[] {
  const base = parseColour(read(LED_BASE));
  const inks = LED_INKS.map((job) => parseColour(read(job)));
  if (base === null || inks.some((ink) => ink === null)) return [];
  const sure = inks as Rgb[];
  const seen = new Set<string>();
  const out: GraphColour[] = [];
  for (const job of GRAPH_ROLES) {
    const css = read(job).trim();
    const rgb = parseColour(css);
    if (rgb === null) continue;
    const key = `${rgb.r},${rgb.g},${rgb.b}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const alpha = safeAlpha(rgb, base, sure);
    if (alpha >= MIN_ALPHA) out.push({ rgb, css, alpha });
  }
  return out;
}

/** How many bars fit across a display `width` CSS pixels wide (each bar `BAR` wide with a `GAP` after it). */
export const BAR = 5;
export const GAP = 2;
/** Each bar is stacked from segments `SEGMENT` high with `SEGMENT_GAP` between: the meter's blocks. */
export const SEGMENT = 3;
export const SEGMENT_GAP = 1;

export function barCount(width: number): number {
  return Math.max(0, Math.min(96, Math.floor((width + GAP) / (BAR + GAP))));
}

/**
 * Where each bar reads in the analyser's bins: spread by pitch, not evenly, so the lows (where most music's energy is)
 * are not one fat bar and the top half of the spectrum does not take most of the graph. `[from, to)` per bar, every range
 * at least one bin, the last ending by `usable` (the bins above it are near-silent for most media).
 */
export function bandEdges(bars: number, bins: number): [number, number][] {
  if (bars <= 0 || bins <= 0) return [];
  const usable = Math.max(1, Math.floor(bins * 0.75));
  const edges: [number, number][] = [];
  let from = 0;
  for (let i = 0; i < bars; i += 1) {
    const share = (i + 1) / bars;
    // Logarithmic: bin = usable ^ share, which starts at 1 and ends at `usable`.
    let to = Math.round(usable ** share);
    if (to <= from) to = from + 1;
    to = Math.min(to, Math.max(from + 1, usable));
    edges.push([from, to]);
    from = to < usable ? to : Math.max(0, usable - 1);
  }
  return edges;
}

/** One bar's level, 0 to 1, from the analyser's bytes over its range: the loudest bin, so a thin sound still shows. */
export function bandLevel(bytes: ArrayLike<number>, from: number, to: number): number {
  let peak = 0;
  for (let i = from; i < to && i < bytes.length; i += 1) if (bytes[i] > peak) peak = bytes[i];
  return peak / 255;
}

/** Falling slower than rising, as a meter's needle does: a bar jumps up at once and settles by `fall` each frame. */
export function settle(was: number, now: number, fall = 0.06): number {
  return now >= was ? now : Math.max(now, was - fall);
}

/**
 * The gentle motion for media the page cannot hear (Luke: where neither way works "the graph moves gently by the play
 * state and never pretends to be the sound"): one slow, low, even swell across every bar, the same shape whatever is
 * playing, so it reads as "playing" and never as a spectrum. `seconds` is the clock; the answer is 0.08 to 0.2.
 */
export function gentleLevel(index: number, seconds: number): number {
  return 0.14 + 0.06 * Math.sin(seconds * 0.9 - index * 0.18);
}

/** Which colour bar `index` of `bars` wears: the palette spread across the width, lows on the left. */
export function colourFor(index: number, bars: number, palette: readonly GraphColour[]): GraphColour | null {
  if (palette.length === 0 || bars <= 0) return null;
  const at = Math.min(palette.length - 1, Math.floor((index / bars) * palette.length));
  return palette[at];
}

/** How many segments of a bar `height` pixels tall a level lights. */
export function litSegments(level: number, height: number): number {
  const total = Math.floor((height + SEGMENT_GAP) / (SEGMENT + SEGMENT_GAP));
  return Math.max(0, Math.min(total, Math.round(Math.max(0, Math.min(1, level)) * total)));
}

/** The frames a second the graph draws at most: enough for a meter, and kind to a machine running a game beside it. */
export const GRAPH_FPS = 30;

/**
 * A YouTube video's id from its player's address (`youtube-nocookie.com/embed/<id>?...`, or youtube.com's), or null for
 * any other player.
 */
export function youtubeIdFromPlayer(src: string): string | null {
  let url: URL;
  try {
    url = new URL(src);
  } catch {
    return null;
  }
  if (!/^(?:www\.)?youtube(?:-nocookie)?\.com$/.test(url.hostname)) return null;
  const match = url.pathname.match(/^\/embed\/([A-Za-z0-9_-]{11})$/);
  return match ? match[1] : null;
}

/** The site's relay of a YouTube video's sound (`/api/audio/relay/<id>`), for the graph only. */
export function relayPath(videoId: string): string {
  return `/api/audio/relay/${videoId}`;
}

/** How far the relay may drift from YouTube's own player before it is moved to where YouTube says it is. */
export const RELAY_DRIFT_SECONDS = 1.5;

/** What the graph is listening to: the whole tab, the bar's song, the relay, nothing it can hear (gentle), or nothing at all. */
export type GraphSource = 'tab' | 'bar' | 'relay' | 'gentle' | 'off';

/**
 * Which of those to use, in order: the tab (it hears everything) when the reader allowed it; the bar's own song when it is
 * playing and its sound can be copied; YouTube's sound through the relay while a YouTube video plays and the relay works;
 * otherwise the gentle motion while anything plays, and nothing when nothing does.
 */
export function pickSource(state: {
  tab: boolean;
  barPlaying: boolean;
  barHeard: boolean;
  videoPlaying: boolean;
  relayable: boolean;
  relayFailed: boolean;
}): GraphSource {
  if (!state.barPlaying && !state.videoPlaying) return 'off';
  if (state.tab) return 'tab';
  if (state.barPlaying && state.barHeard) return 'bar';
  if (!state.barPlaying && state.videoPlaying && state.relayable && !state.relayFailed) return 'relay';
  return 'gentle';
}
