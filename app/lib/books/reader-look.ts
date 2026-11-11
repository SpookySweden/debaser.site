/**
 * The reader's look and the pure parts of reading (SPEC-reader.md, Luke 2026-11-11): the LOOK settings (text size, line
 * spacing, margins, font, paper), checked whatever was saved; the CSS the engine lays over each chapter; how strongly a
 * highlight's colour is tinted on each paper; and the small sums (the %, minutes left). No browser, no engine: a check holds
 * all of it offline (`Temp/check-reader.cjs`).
 *
 * Colours are never written here: the CSS names the paper's tokens by their values as the page's stylesheet holds them,
 * read in the browser (`paperColours`), so `app/lib/ui/themes.ts` stays the one place a colour lives.
 */
import { HIGHLIGHT_COLOURS, isCfi, type HighlightColour } from './types';

export const PAPERS = ['light', 'dark', 'sepia'] as const;
export type Paper = (typeof PAPERS)[number];

/** The site's faces: its own (IBM Plex Mono), the typewriter face RADI-OH wears, or the book's own type. */
export const READER_FONTS = ['site', 'typewriter', 'book'] as const;
export type ReaderFont = (typeof READER_FONTS)[number];

export const MARGINS = ['narrow', 'normal', 'wide'] as const;
export type Margin = (typeof MARGINS)[number];

export type ReaderSettings = {
  /** Text size, in percent of the book's own (80 to 200, in steps of 10). */
  size: number;
  /** Line spacing (1.2 to 2.2, in steps of 0.1). */
  spacing: number;
  margin: Margin;
  font: ReaderFont;
  paper: Paper;
};

export const SIZE_MIN = 80;
export const SIZE_MAX = 200;
export const SIZE_STEP = 10;
export const SPACING_MIN = 1.2;
export const SPACING_MAX = 2.2;
export const SPACING_STEP = 0.1;

export const DEFAULT_SETTINGS: ReaderSettings = { size: 110, spacing: 1.6, margin: 'normal', font: 'site', paper: 'dark' };

function pick<T extends string>(list: readonly T[], value: unknown, fallback: T): T {
  return typeof value === 'string' && (list as readonly string[]).includes(value) ? (value as T) : fallback;
}

function stepped(value: unknown, min: number, max: number, step: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  const clamped = Math.min(max, Math.max(min, value));
  return Math.round(Math.round((clamped - min) / step) * step * 10 + min * 10) / 10;
}

/** Saved settings (from the account, the browser, anywhere), made safe: anything missing or wrong takes its default. */
export function readerSettingsFrom(saved: unknown): ReaderSettings {
  const value = saved && typeof saved === 'object' && !Array.isArray(saved) ? (saved as Record<string, unknown>) : {};
  return {
    size: stepped(value.size, SIZE_MIN, SIZE_MAX, SIZE_STEP, DEFAULT_SETTINGS.size),
    spacing: stepped(value.spacing, SPACING_MIN, SPACING_MAX, SPACING_STEP, DEFAULT_SETTINGS.spacing),
    margin: pick(MARGINS, value.margin, DEFAULT_SETTINGS.margin),
    font: pick(READER_FONTS, value.font, DEFAULT_SETTINGS.font),
    paper: pick(PAPERS, value.paper, DEFAULT_SETTINGS.paper),
  };
}

/** One setting a step up or down, kept in range. */
export function nudge(settings: ReaderSettings, key: 'size' | 'spacing', direction: 1 | -1): ReaderSettings {
  return key === 'size'
    ? readerSettingsFrom({ ...settings, size: settings.size + direction * SIZE_STEP })
    : readerSettingsFrom({ ...settings, spacing: settings.spacing + direction * SPACING_STEP });
}

/** The engine's layout for a margin: the gap between and around columns (a share of the width), and a column's widest. */
export function marginLayout(margin: Margin): { gap: string; maxInlineSize: string } {
  if (margin === 'narrow') return { gap: '4%', maxInlineSize: '820px' };
  if (margin === 'wide') return { gap: '12%', maxInlineSize: '600px' };
  return { gap: '7%', maxInlineSize: '720px' };
}

/** The paper's two colours, as the stylesheet holds them (read from `--color-reader-<paper>-paper` and `-ink`). */
export type PaperColours = { paper: string; ink: string };

/** The faces, as the stylesheet's own stacks (`--font-body`, `--font-emote`), handed in from the page. */
export type ReaderFaces = { site: string; typewriter: string };

/** A CSS value from the page's stylesheet, made safe to write into a chapter's CSS (no `;`, braces or `<`). */
export function cssValue(value: string): string {
  return value.replace(/[;{}<>\\]/g, '').trim();
}

/**
 * The CSS laid over every chapter: the paper's colours, the font and size, the spacing. The book's own layout otherwise
 * stands (its headings, centring, pictures). Pictures never grow past the page.
 */
export function readerCss(settings: ReaderSettings, colours: PaperColours, faces: ReaderFaces): string {
  const paper = cssValue(colours.paper);
  const ink = cssValue(colours.ink);
  const face = settings.font === 'site' ? cssValue(faces.site) : settings.font === 'typewriter' ? cssValue(faces.typewriter) : '';
  return [
    `html { color-scheme: ${settings.paper === 'dark' ? 'dark' : 'light'}; }`,
    `html, body { background: ${paper} !important; color: ${ink} !important; }`,
    `body { font-size: ${settings.size}% !important; }`,
    face ? `body, p, li, blockquote, dd, dt, td, th, h1, h2, h3, h4, h5, h6, span, div { font-family: ${face} !important; }` : '',
    `p, li, blockquote, dd, div { line-height: ${settings.spacing} !important; hyphens: auto; -webkit-hyphens: auto; }`,
    // A monospaced face justified leaves wide gaps between words: plain paragraphs (no class, so not the book's centred
    // lines) start at the left instead.
    settings.font !== 'book' ? `p:not([class]):not([align]):not([style]) { text-align: start !important; }` : '',
    `p, li, blockquote, dd, dt, td, th, h1, h2, h3, h4, h5, h6, span, div, section, pre { color: inherit !important; background-color: transparent !important; }`,
    `a:link, a:visited { color: inherit !important; text-decoration: underline; }`,
    `img, svg { max-width: 100%; height: auto; }`,
    `pre { white-space: pre-wrap !important; }`,
    `::selection { background: ${ink}; color: ${paper}; }`,
  ]
    .filter(Boolean)
    .join('\n');
}

/**
 * How a highlight's colour lies over the words on each paper: a tint (opacity) and how it mixes. On the pale papers the
 * colour multiplies (the words stay dark through it); on the dark paper it is a thin wash under light words.
 * `Temp/check-reader.cjs` works out every colour on every paper and holds the words above 4.5:1 through it.
 */
export function markTint(paper: Paper): { opacity: number; blend: 'multiply' | 'normal' } {
  return paper === 'dark' ? { opacity: 0.3, blend: 'normal' } : { opacity: 0.45, blend: 'multiply' };
}

/** A highlight colour's token name, for reading its value from the page's stylesheet. */
export function markToken(colour: HighlightColour): string {
  return `--color-mark-${colour}`;
}

export const MARK_LABELS: Record<HighlightColour, string> = { yellow: 'YELLOW', pink: 'PINK', green: 'GREEN', blue: 'BLUE', red: 'RED' };
export { HIGHLIGHT_COLOURS };

/** The % read, from the engine's fraction (0 to 1), as a whole number. */
export function percentOf(fraction: unknown): number {
  return typeof fraction === 'number' && Number.isFinite(fraction) ? Math.min(100, Math.max(0, Math.floor(fraction * 100))) : 0;
}

/** Minutes left in the chapter, as words: the engine's estimate (its "time units" are about a minute of reading). */
export function minutesLeft(units: unknown): string {
  if (typeof units !== 'number' || !Number.isFinite(units) || units < 0) return '';
  const minutes = Math.ceil(units);
  if (minutes <= 1) return 'UNDER A MINUTE LEFT IN THE CHAPTER';
  if (minutes < 60) return `${minutes} MIN LEFT IN THE CHAPTER`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return `${hours} H${rest > 0 ? ` ${rest} MIN` : ''} LEFT IN THE CHAPTER`;
}

/** Where an address asks the reader to open: `?h=<highlight id>` or `?at=<cfi>`; anything else is ignored. */
export function spotFromSearch(search: string): { highlight: string | null; cfi: string | null } {
  const params = new URLSearchParams(search);
  const highlight = params.get('h');
  const at = params.get('at');
  return {
    highlight: highlight !== null && /^[A-Za-z0-9-]{1,64}$/.test(highlight) ? highlight : null,
    cfi: isCfi(at) ? at : null,
  };
}

/** The words chosen with the pointer, as a highlight keeps them: one line of plain text, at most `max` characters. */
export function quoteOf(text: string, max: number): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, max).trim();
}

/** A bookmark's name: the chapter, or where in the book it is. */
export function bookmarkLabel(chapter: string | null | undefined, percent: number): string {
  const name = (chapter ?? '').replace(/\s+/g, ' ').trim();
  return (name ? `${name} · ${percent}%` : `${percent}%`).slice(0, 120);
}
