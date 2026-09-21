/**
 * Deterministic post stamps.
 *
 * Everything is formatted in UTC from the stored ISO string so the server and
 * the browser render byte-identical markup (no hydration mismatch from
 * relative times like "2 minutes ago").
 *
 * The stamp stops at the minutes and carries no trailing `Z`: on the board it
 * reads as a log line - `POSTED 2026-09-21 04:39` - and never as a raw ISO
 * instant. It is still read as UTC; the drawing components (`<TimeStamp />`)
 * print it in the retro link blue.
 */

/**
 * The instant as the one shape `Date` is required to understand.
 *
 * Supabase hands back what Postgres stores, which is not that shape: a space
 * where the spec wants `T`, six fractional digits rather than three, and an offset
 * written `+00:00` (on some paths `+0000`). Every engine in use parses those by
 * being generous, but none of them has to, and the one that refuses would fall
 * through to the raw string below - a wall of ISO where a stamp belongs, which is
 * exactly what a directory row looks like when it happens. Normalising first means
 * a stamp reads the same everywhere, whatever the database sent.
 */
function toInstant(iso: string): string {
  return iso
    .trim()
    .replace(' ', 'T')
    .replace(/(\.\d{3})\d+/, '$1')
    .replace(/([+-]\d{2})(\d{2})$/, '$1:$2');
}

export function formatStamp(iso: string): string {
  const date = new Date(toInstant(iso));
  if (Number.isNaN(date.getTime())) return iso;

  const pad = (value: number) => String(value).padStart(2, '0');
  const day = `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
  const time = `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`;

  return `${day} ${time}`;
}

export function pluralise(count: number, singular: string, plural?: string): string {
  return count === 1 ? singular : (plural ?? `${singular}S`);
}

export function countReplies(count: number): string {
  return `${count} ${pluralise(count, 'REPLY')}`;
}
