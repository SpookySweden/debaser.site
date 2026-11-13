import { KEY_FOCUS } from '../ui/controls';
import type { DocAccess } from './types';

/**
 * DOCS' own look (Luke, 2026-11-13: "more like google docs ... usable by a grandad").
 *
 * DOCS is read by someone with poor eyesight, often on a phone that shows the desktop zoomed out, so its
 * keys and its writing are bigger than the rest of the site's, and the reader can step them bigger still
 * (`TEXT SIZE`, ./use-docs-size.ts). The sizes are the site's own tokens: `.docs-ui[data-docs-size]` in globals.css names which
 * token each step uses, and the classes below read them. A DOCS key is still the site's bracket key
 * (`.key`), only with its size from the step and a thumb's height at every width.
 */

/* --- text size ----------------------------------------------------------------------------------- */

export const DOCS_SIZE_MIN = 1;
export const DOCS_SIZE_MAX = 6;
/** A computer starts here: writing at 18px. */
export const DOCS_SIZE_DEFAULT = 2;
/** A phone shows the 1280px desktop at about a third of its size, so it starts four steps up. */
export const DOCS_SIZE_DEFAULT_PHONE = 5;
/** From this step up the comments sit under the page (a side panel would be a dozen letters wide). */
export const DOCS_SIZE_STACKS_FROM = 5;

export function clampDocsSize(value: number): number {
  if (!Number.isFinite(value)) return DOCS_SIZE_DEFAULT;
  return Math.min(DOCS_SIZE_MAX, Math.max(DOCS_SIZE_MIN, Math.round(value)));
}

/* --- keys ---------------------------------------------------------------------------------------- */

const DOC_KEY_BOX = 'docs-key inline-flex min-h-tap cursor-pointer items-center gap-2';

/** A DOCS key: the bracket key, bigger, a thumb tall at every width. */
export const DOC_KEY = `key ${DOC_KEY_BOX} px-2 py-2 ${KEY_FOCUS} active:animate-flash active:translate-y-press active:bg-bubble active:text-ink-plate disabled:cursor-not-allowed`;

/** The same key when it is on (BOLD while the words are bold, the tab you are on): a filled pill in the field ink. */
// Its 2px outline is the rest of `DOC_KEY`'s padding, so a key switched on does not change size.
export const DOC_KEY_ON = `key key-fill key-on ${DOC_KEY_BOX} [--key-fill:var(--color-ink)] px-1.5 py-1.5 text-paper ${KEY_FOCUS}`;

/** The one filled key a DOCS screen has: NEW DOCUMENT, SHARE, CREATE, SAVE. */
export const DOC_KEY_MAIN = `key key-fill ${DOC_KEY_BOX} [--key-fill:var(--color-sun)] [--frame-line:var(--color-ink-plate)] px-3.5 py-1.5 text-ink-plate hover:[--key-fill:var(--color-acid)] ${KEY_FOCUS} active:translate-y-press active:[--key-fill:var(--color-bubble)] disabled:cursor-not-allowed disabled:[--key-fill:var(--color-chrome-dark)] disabled:text-ink`;

/** A fault, said in DOCS' size: White words on a Rose strip (docs/design.md). */
export const DOC_FAULT = 'docs-meta w-fit bg-bubble-pale px-2 py-1 text-ink-bar';

/* --- plain words --------------------------------------------------------------------------------- */

/** Who can open a document, said to the person reading the list: their own, or somebody else's. */
export function accessWords(access: DocAccess, mine: boolean): string {
  if (access === 'private') return 'ONLY YOU';
  if (access === 'shared') return mine ? 'PEOPLE YOU PICKED' : 'SHARED WITH YOU';
  if (access === 'signed_in') return 'ANYONE SIGNED IN';
  return 'EVERYONE';
}

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const pad = (value: number) => String(value).padStart(2, '0');

/** A date and time as a person says it, on the reader's own clock: `13 NOV 2026, 15:49`. */
export function dateWords(iso: string | null | undefined): string {
  const at = iso === null || iso === undefined ? Number.NaN : Date.parse(iso);
  if (Number.isNaN(at)) return 'SOME TIME AGO';
  const date = new Date(at);
  return `${date.getDate()} ${MONTHS[date.getMonth()]} ${date.getFullYear()}, ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/**
 * When something last changed, in plain words: `JUST NOW`, `5 MINUTES AGO`, `TODAY AT 15:49`,
 * `YESTERDAY AT 09:10`, `3 DAYS AGO`, then the date. On the reader's own clock, so it is only drawn in
 * the browser, from rows the browser fetched (never in server-rendered markup, which would disagree).
 */
export function whenWords(iso: string | null | undefined, now: number): string {
  const at = iso === null || iso === undefined ? Number.NaN : Date.parse(iso);
  if (Number.isNaN(at)) return 'SOME TIME AGO';

  const minutes = Math.floor((now - at) / 60_000);
  if (minutes < 1) return 'JUST NOW';
  if (minutes < 60) return minutes === 1 ? '1 MINUTE AGO' : `${minutes} MINUTES AGO`;

  const then = new Date(at);
  const today = new Date(now);
  const midnight = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const clock = `${pad(then.getHours())}:${pad(then.getMinutes())}`;
  if (at >= midnight) return `TODAY AT ${clock}`;
  // Yesterday's own midnight, not 24 hours before today's: the day the clocks change is 23 or 25 hours long.
  if (at >= new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1).getTime()) return `YESTERDAY AT ${clock}`;

  // Whole calendar days, counted from noon to noon so a clock change cannot tip the count.
  const days = Math.round((midnight + 43_200_000 - new Date(then.getFullYear(), then.getMonth(), then.getDate(), 12).getTime()) / 86_400_000);
  if (days < 7) return `${days} DAYS AGO`;
  return `${then.getDate()} ${MONTHS[then.getMonth()]} ${then.getFullYear()}`;
}

/** Who is in a document with you, in plain words. */
export function roomWords(connecting: boolean, others: number, editing: boolean): string {
  if (connecting) return 'CONNECTING...';
  if (others === 0) return editing ? 'ONLY YOU HERE' : 'NOBODY WRITING NOW';
  const people = others + (editing ? 1 : 0);
  return people === 1 ? '1 PERSON WRITING' : `${people} PEOPLE HERE`;
}
