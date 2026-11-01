/**
 * The listen log's rules (SPEC-vanity.md step 3), kept pure so the mock store and a check share them
 * with the database function `music_play_counts`.
 */

/** A play counts after this much listening... */
export const LISTEN_SECONDS = 30;
/** ...or after half the file, when the file is shorter than a minute. */
const SHORT_FILE_SECONDS = 60;
/** Each person's plays of one song count at most this many times per day towards any total. */
export const DAILY_CAP = 3;

/**
 * Seconds of actual listening after which a play is logged. A file whose length is not known yet uses
 * the full 30 seconds; a short file needs half of itself, so a 20-second clip counts at 10.
 */
export function listenThreshold(durationSeconds: number): number {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) return LISTEN_SECONDS;
  return durationSeconds < SHORT_FILE_SECONDS ? durationSeconds / 2 : LISTEN_SECONDS;
}

/**
 * How much listening the clock's last step was. A normal tick moves forward by well under two seconds;
 * a seek or a jump back to the start (a loop, a new file) is not listening and adds nothing.
 */
export function heardStep(previous: number, now: number): number {
  const step = now - previous;
  return step > 0 && step < 2 ? step : 0;
}

export type Listen = { userId: string; src: string; at: string };

/**
 * Play counts per file, capped at `DAILY_CAP` per person per song per (UTC) day. `excluded` holds the
 * accounts left out entirely (hidden test accounts, people who switched their listening off).
 */
export function cappedCounts(listens: readonly Listen[], excluded: ReadonlySet<string> = new Set()): Map<string, number> {
  const perDay = new Map<string, number>();

  for (const listen of listens) {
    if (excluded.has(listen.userId)) continue;
    const key = `${listen.src}\u0000${listen.userId}\u0000${listen.at.slice(0, 10)}`;
    perDay.set(key, (perDay.get(key) ?? 0) + 1);
  }

  const totals = new Map<string, number>();
  for (const [key, plays] of perDay) {
    const src = key.split('\u0000')[0];
    totals.set(src, (totals.get(src) ?? 0) + Math.min(plays, DAILY_CAP));
  }

  return totals;
}
