/**
 * MARGINALIA and GRAFFITI (SPEC-seeing-machine.md, ideas xi and xii): notes on a page's passages, and drawing over it. Yours, in this
 * browser, until the tables they are shared by exist. Pure; what was stored is read back through one door.
 */
import { readAddress } from './address';
import { cleanQuote, isPageId } from './pages';

export const MARGIN_LENGTH = 300;
export const NOTES_A_PAGE = 50;
export const NOTES_MOST = 500;
export const STROKES_A_PAGE = 200;
export const POINTS_A_STROKE = 400;
export const DRAWN_PAGES_MOST = 30;
export const GRAFFITI_INKS = ['bubble', 'sun', 'ink-bar'] as const;
export type GraffitiInk = (typeof GRAFFITI_INKS)[number];

export type Margin = { id: string; page: string; quote: string; note: string; at: number };
/** Points as x, y, x, y: x in thousandths of the page's width, y in its own measure from its top. */
export type Stroke = { ink: GraffitiInk; points: readonly number[] };
export type Margins = { notes: readonly Margin[]; drawings: Readonly<Record<string, readonly Stroke[]>> };

export const NO_MARGINS: Margins = { notes: [], drawings: {} };

/** A page, whatever part of it is in front. Null for one that can't be written on. */
export function pageOf(address: string | null): string | null {
  return address === null || !/^https?:/.test(address) ? null : address.split('#')[0];
}

export const notesOn = (all: Margins, page: string | null): Margin[] => all.notes.filter((each) => each.page === page);

export function withNote(all: Margins, made: Margin): Margins {
  if (notesOn(all, made.page).length >= NOTES_A_PAGE || cleanQuote(made.quote) === '' || made.note.trim() === '') return all;
  return { ...all, notes: [{ ...made, quote: cleanQuote(made.quote), note: made.note.trim().slice(0, MARGIN_LENGTH) }, ...all.notes].slice(0, NOTES_MOST) };
}

export const withoutNote = (all: Margins, id: string): Margins => ({ ...all, notes: all.notes.filter((each) => each.id !== id) });

/** READER's words stand elsewhere than the page's, so each has its own drawing. */
export const drawingKey = (page: string, reading: boolean): string => (reading ? `${page}#reader` : page);
export const strokesOn = (all: Margins, key: string): readonly Stroke[] => (Object.prototype.hasOwnProperty.call(all.drawings, key) ? all.drawings[key] : []);

export function withStrokes(all: Margins, key: string, strokes: readonly Stroke[]): Margins {
  const others = Object.entries(all.drawings).filter(([each]) => each !== key);
  // The page drawn on longest ago goes first.
  const kept = strokes.length === 0 ? others : [...others.slice(-(DRAWN_PAGES_MOST - 1)), [key, strokes.slice(-STROKES_A_PAGE)] as const];
  return { ...all, drawings: Object.fromEntries(kept) };
}

function strokeFrom(value: unknown): Stroke | null {
  if (typeof value !== 'object' || value === null) return null;
  const { ink, points } = value as Record<string, unknown>;
  const known = GRAFFITI_INKS.find((each) => each === ink);
  if (known === undefined || !Array.isArray(points) || points.length < 2 || points.length > POINTS_A_STROKE * 2 || points.length % 2 !== 0) return null;
  return points.every((each) => typeof each === 'number' && Number.isFinite(each) && Math.abs(each) < 1_000_000) ? { ink: known, points: points as number[] } : null;
}

/** As much as is kept: the pages drawn on longest ago go first. */
export const STORED_MOST = 1_500_000;
export function storedMargins(all: Margins): { margins: Margins; text: string } {
  let margins = all;
  let text = JSON.stringify(margins);
  while (text.length > STORED_MOST && Object.keys(margins.drawings).length > 0) {
    margins = { ...margins, drawings: Object.fromEntries(Object.entries(margins.drawings).slice(1)) };
    text = JSON.stringify(margins);
  }
  return { margins, text };
}

const whole = (value: unknown): string | null => {
  const read = typeof value === 'string' ? readAddress(value) : null;
  return read !== null && read.ok ? pageOf(read.address) : null;
};

export function marginsFrom(value: unknown): Margins {
  if (typeof value !== 'object' || value === null) return NO_MARGINS;
  const { notes, drawings } = value as Record<string, unknown>;
  const read: Margin[] = [];
  for (const each of Array.isArray(notes) ? notes.slice(0, NOTES_MOST) : []) {
    const { id, page, quote, note, at } = (typeof each === 'object' && each !== null ? each : {}) as Record<string, unknown>;
    const where = whole(page);
    if (isPageId(id) && where !== null && cleanQuote(quote) !== '' && typeof note === 'string' && typeof at === 'number' && Number.isFinite(at)) read.push({ id, page: where, quote: cleanQuote(quote), note: note.slice(0, MARGIN_LENGTH), at });
  }
  const drawn: [string, Stroke[]][] = [];
  for (const [key, strokes] of Object.entries(typeof drawings === 'object' && drawings !== null ? drawings : {}).slice(-DRAWN_PAGES_MOST)) {
    const reading = key.endsWith('#reader');
    const where = whole(reading ? key.slice(0, -'#reader'.length) : key);
    if (where === null || !Array.isArray(strokes)) continue;
    const good = strokes.slice(0, STROKES_A_PAGE).map(strokeFrom).filter((each) => each !== null);
    if (good.length > 0) drawn.push([drawingKey(where, reading), good]);
  }
  return { notes: read, drawings: Object.fromEntries(drawn) };
}
