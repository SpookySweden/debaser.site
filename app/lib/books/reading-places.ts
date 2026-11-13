import { archiveBookId, cleanPlace, isCfi, ownHash, type BookPlace, type PlaceSave } from './types';

/**
 * Keeping your place in every book (SPEC-reading-places.md, Luke 2026-11-13): the pure parts, shared by the reader and /read.
 * - A place as this browser keeps it (`debaser-reader-place:<ref>`): what a visitor's CONTINUE READING is built from. Before
 *   2026-11-13 it was the CFI alone; that still reads, as a place with no title or percent.
 * - The finish line, the two shelves (CONTINUE READING and READ), "when you last read it", and a row's cover.
 * - Your own reading speed in a book, for `7 MIN LEFT IN CHAPTER`.
 */

export const PLACE_KEY_PREFIX = 'debaser-reader-place:';
export const placeKey = (bookRef: string) => `${PLACE_KEY_PREFIX}${bookRef}`;
export const PACE_KEY_PREFIX = 'debaser-reader-pace:';
export const paceKey = (bookRef: string) => `${PACE_KEY_PREFIX}${bookRef}`;

/** The last page: the engine's fraction is where the shown page ends, so the last page reaches 1. */
export const FINISH_LINE = 0.995;

/**
 * Project Gutenberg's licence, the last part of every one of its EPUBs: in a short story it is over half the book. The book
 * ends where it starts, so "how far" and FINISHED measure the book itself.
 */
export const LICENCE_LABEL = /PROJECT\s+GUTENBERG\S*\s+LICEN[CS]E/i;

/** Where in the engine's whole-file fraction the book itself ends (the licence's start), from the contents and the sections. */
export function storyEndOf(labels: readonly { label: string; start: number | null }[]): number {
  const licence = labels.find((item) => LICENCE_LABEL.test(item.label));
  const start = licence?.start;
  return typeof start === 'number' && start > 0.05 && start < 1 ? start : 1;
}

/** The engine's fraction as a share of the book itself (0 to 1). */
export function storyFraction(fraction: number, storyEnd: number): number {
  if (!Number.isFinite(fraction)) return 0;
  return Math.min(1, Math.max(0, fraction / (storyEnd > 0 && storyEnd <= 1 ? storyEnd : 1)));
}

/** When a book was finished, after a page turn landing at `fraction`: kept, made now, or emptied when the reader went back. */
export function finishedAfter(fraction: number, held: string | null, now: Date = new Date()): string | null {
  if (!Number.isFinite(fraction)) return held;
  if (fraction >= FINISH_LINE) return held ?? now.toISOString();
  return null;
}

/** A place this browser kept, read back: the JSON record, or the old bare CFI. Anything else is nothing. */
export function placeFromStored(bookRef: string, raw: string | null): BookPlace | null {
  if (!raw) return null;
  if (isCfi(raw)) return { bookRef, cfi: raw, page: 0, title: '', progress: 0, finishedAt: null, updatedAt: '' };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const record = parsed as Record<string, unknown>;
  const clean = cleanPlace({
    cfi: typeof record.cfi === 'string' ? record.cfi : null,
    page: typeof record.page === 'number' ? record.page : 0,
    title: typeof record.title === 'string' ? record.title : '',
    progress: typeof record.progress === 'number' ? record.progress : 0,
    finishedAt: typeof record.finishedAt === 'string' ? record.finishedAt : null,
  });
  if (!clean.cfi) return null;
  const updatedAt = typeof record.updatedAt === 'string' && !Number.isNaN(Date.parse(record.updatedAt)) ? record.updatedAt : '';
  return { ...clean, bookRef, updatedAt };
}

/** A place as this browser keeps it. A blank title keeps the one it had. */
export function storedPlace(place: PlaceSave, held: BookPlace | null, now: Date = new Date()): string {
  const clean = cleanPlace(place);
  return JSON.stringify({ ...clean, title: clean.title || held?.title || '', updatedAt: now.toISOString() });
}

/** Every place this browser kept (a visitor's /read), from a Storage's keys. Unreadable ones are left out. */
export function browserPlaces(storage: Pick<Storage, 'length' | 'key' | 'getItem'>): BookPlace[] {
  const found: BookPlace[] = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (!key || !key.startsWith(PLACE_KEY_PREFIX)) continue;
    const place = placeFromStored(key.slice(PLACE_KEY_PREFIX.length), storage.getItem(key));
    if (place) found.push(place);
  }
  return found;
}

/** CONTINUE READING (not finished, last read first) and READ (finished, last finished first). */
export function shelves(places: readonly BookPlace[]): { reading: BookPlace[]; read: BookPlace[] } {
  const reading = places.filter((place) => !place.finishedAt).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const read = places.filter((place) => place.finishedAt).sort((a, b) => (b.finishedAt ?? '').localeCompare(a.finishedAt ?? ''));
  return { reading, read };
}

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

/** When, as a row says it: TODAY, YESTERDAY, 3 DAYS AGO, or the date (13 NOV 2026). Nothing for an unknown time. */
export function whenText(iso: string | null, now: Date = new Date()): string {
  if (!iso) return '';
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return '';
  const day = (date: Date) => Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
  const days = Math.round((day(now) - day(then)) / 86_400_000);
  if (days <= 0) return 'TODAY';
  if (days === 1) return 'YESTERDAY';
  if (days < 7) return `${days} DAYS AGO`;
  return `${then.getDate()} ${MONTHS[then.getMonth()]} ${then.getFullYear()}`;
}

/** When a book was finished, to follow "FINISHED": TODAY, YESTERDAY, 3 DAYS AGO, or ON 13 NOV 2026. */
export function finishedWhen(iso: string | null, now: Date = new Date()): string {
  const when = whenText(iso, now);
  return /^[0-9]{1,2} [A-Z]{3} [0-9]{4}$/.test(when) ? `ON ${when}` : when;
}

/**
 * A row's cover, hotlinked from the book's own home (as every thumbnail is): Project Gutenberg's cover for a book with a
 * Gutenberg number, the Internet Archive's picture for one of its books. Null for an IPFS book or your own file.
 */
export function coverOf(bookRef: string): string | null {
  const gutenberg = /^books:OL[1-9][0-9]{0,11}W-pg([1-9][0-9]{0,6})$/.exec(bookRef)?.[1];
  if (gutenberg) return `https://www.gutenberg.org/cache/epub/${gutenberg}/pg${gutenberg}.cover.medium.jpg`;
  const archive = archiveBookId(bookRef);
  if (archive) return `https://archive.org/services/img/${encodeURIComponent(archive)}`;
  return null;
}

/** Where READ goes: the reader at the book, or for your own file /read asking for that file again. */
export function continueHref(bookRef: string): string {
  const hash = ownHash(bookRef);
  return hash ? `/read?file=${hash}` : `/read/${bookRef}`;
}

/** How far through, as the prompt and a row say it. */
export function progressText(place: Pick<BookPlace, 'progress'>): string {
  return `${Math.min(100, Math.max(0, Math.floor(place.progress)))}%`;
}

// ---------- your own reading speed in a book ----------

/** What has been read in this book, in the engine's time units (about a minute's reading each), and in how many minutes. */
export type Pace = { units: number; minutes: number };
export const NO_PACE: Pace = { units: 0, minutes: 0 };

/** A turn longer than this was a pause (a cup of tea), not reading: it doesn't count. */
export const PAUSE_MS = 5 * 60_000;
/** Enough to judge: two minutes of reading, over at least three units. */
export const PACE_MINUTES_MIN = 2;
export const PACE_UNITS_MIN = 3;

/** One page turn: `before` and `after` are when, and how many units were left in the book. Only reading forward counts. */
export function paceAfter(pace: Pace, before: { at: number; left: number }, after: { at: number; left: number }): Pace {
  const read = before.left - after.left;
  const took = after.at - before.at;
  if (!(read > 0) || !(took > 0) || took > PAUSE_MS || read > 30) return pace;
  return { units: pace.units + read, minutes: pace.minutes + took / 60_000 };
}

/** A pace kept in this browser, read back safely. */
export function paceFrom(raw: string | null): Pace {
  if (!raw) return NO_PACE;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const units = Number(parsed.units);
    const minutes = Number(parsed.minutes);
    return Number.isFinite(units) && Number.isFinite(minutes) && units >= 0 && minutes >= 0 ? { units, minutes } : NO_PACE;
  } catch {
    return NO_PACE;
  }
}

/** `7 MIN LEFT IN CHAPTER` from your own pace, once there's enough to judge; nothing before. */
export function chapterLeftText(pace: Pace, unitsLeftInChapter: unknown): string {
  if (pace.minutes < PACE_MINUTES_MIN || pace.units < PACE_UNITS_MIN) return '';
  if (typeof unitsLeftInChapter !== 'number' || !Number.isFinite(unitsLeftInChapter) || unitsLeftInChapter < 0) return '';
  const minutes = Math.ceil(unitsLeftInChapter / (pace.units / pace.minutes));
  if (minutes <= 1) return 'UNDER A MINUTE LEFT IN CHAPTER';
  if (minutes < 60) return `${minutes} MIN LEFT IN CHAPTER`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return `${hours} H${rest > 0 ? ` ${rest} MIN` : ''} LEFT IN CHAPTER`;
}

/** `PAGE 12 OF 300`, for a PDF or a scanned book's pictures. */
export function pageText(page: number, pages: number): string {
  return page > 0 && pages > 0 ? `PAGE ${page} OF ${pages}` : '';
}

// ---------- your own file's fingerprint ----------

/** The SHA-256 of a file's bytes, as 64 hex characters, worked out in this browser. The bytes go nowhere. */
export async function fingerprint(file: Blob): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
