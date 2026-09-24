/**
 * How long ago, in words.
 *
 * A profile's last-seen line is read as a *length of time* - nobody works out how long ago
 * `2026-09-23 04:39` was - so the one wording for it lives here and every screen that says "how long
 * ago" says it this way. `Intl.RelativeTimeFormat` does the words natively, so no table of plurals is
 * kept beside it, and the unit is chosen by the thresholds below: 90 minutes reads as "2 HOURS AGO"
 * rather than as a count of minutes, and 40 days as "1 MONTH AGO" rather than as a count of days.
 *
 * Everything is uppercased, because that is how this site writes: the pixel face has no lowercase
 * glyphs, and every label on every panel is already capitals.
 */

export type RelativeUnit = 'second' | 'minute' | 'hour' | 'day' | 'week' | 'month' | 'year';

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;

/** One unit: how long it is, and how much of it reads better as the next one up. */
type UnitStep = {
  unit: RelativeUnit;
  ms: number;
  /** Past this much elapsed, the next unit in the list is the honest one. */
  upTo: number;
};

/** The largest unit that fits. The thresholds are the shape `Intl` itself uses for its own choice. */
const YEARS: UnitStep = { unit: 'year', ms: 365 * DAY, upTo: Number.POSITIVE_INFINITY };
const UNITS: UnitStep[] = [
  { unit: 'second', ms: SECOND, upTo: 45 * SECOND },
  { unit: 'minute', ms: MINUTE, upTo: 45 * MINUTE },
  { unit: 'hour', ms: HOUR, upTo: 22 * HOUR },
  { unit: 'day', ms: DAY, upTo: 6 * DAY },
  { unit: 'week', ms: WEEK, upTo: 4 * WEEK },
  { unit: 'month', ms: 30 * DAY, upTo: 320 * DAY },
  YEARS,
];

/**
 * How long ago a stamp was, as a count and a unit.
 *
 * Null for a stamp that cannot be read at all - a blank column, or one written by hand - so a caller
 * can say "never seen" rather than inventing a time from nothing. A stamp in the future (two clocks
 * disagreeing, or a row dated by another machine) counts as the least it can: one unit, never a
 * negative, because "in -1 minutes" is not a thing a reader should ever be shown.
 */
export function relativeParts(
  iso: string | null | undefined,
  now: number,
): { value: number; unit: RelativeUnit } | null {
  if (iso === null || iso === undefined || iso.trim() === '') return null;

  const then = Date.parse(iso);
  if (Number.isNaN(then)) return null;

  const elapsed = Math.max(0, now - then);
  const step = UNITS.find((candidate) => elapsed < candidate.upTo) ?? YEARS;

  return { value: Math.max(1, Math.round(elapsed / step.ms)), unit: step.unit };
}

/** The platform's own words, built once: a formatter is not free, and the locale never changes. */
const FORMAT = new Intl.RelativeTimeFormat('en', { numeric: 'always', style: 'long' });

/**
 * "1 SECOND AGO", "4 MINUTES AGO", "3 MONTHS AGO".
 *
 * `numeric: 'always'` is deliberate. `Intl` would otherwise answer "YESTERDAY" for a day and
 * "LAST WEEK" for a month, which are two different kinds of fact: "1 DAY AGO" is a measurement a
 * reader can compare with the clock, and the site's other stamps are all measurements.
 */
export function relativeTime(iso: string | null | undefined, now: number): string {
  const parts = relativeParts(iso, now);
  if (parts === null) return 'AT AN UNKNOWN TIME';

  return FORMAT.format(-parts.value, parts.unit).toUpperCase();
}

/**
 * The one letter each unit is written with, where there is no room for the word.
 *
 * `m` is minutes and months, which looks like a collision and is not one: the ladder never has both
 * live at once, because a value under an hour is minutes and a value over four weeks is months. The
 * pair is fixed here rather than derived, so the letters are one decision rather than a habit that
 * drifts between screens.
 */
const SUFFIX: Record<RelativeUnit, string> = {
  second: 's',
  minute: 'm',
  hour: 'h',
  day: 'd',
  week: 'w',
  month: 'm',
  year: 'y',
};

/**
 * "22s", "5m", "3h", "4d", "2w", "6m", "1y".
 *
 * The same ladder as `relativeTime`, in one character instead of a sentence - for a column of accounts
 * where the words would be the widest thing on the row and the least of what it says. It is deliberately
 * *not* a second set of thresholds: both readers walk `UNITS`, so "45 minutes" cannot become "45m" in
 * one place and "1h" in another.
 *
 * No spaces and no "AGO": this is a reading to be scanned down, and the column's heading is what says
 * what it means.
 */
export function relativeShort(iso: string | null | undefined, now: number): string {
  const parts = relativeParts(iso, now);
  if (parts === null) return '--';

  return `${parts.value}${SUFFIX[parts.unit]}`;
}
