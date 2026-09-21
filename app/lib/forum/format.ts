/**
 * Deterministic post stamps.
 *
 * Everything is formatted in UTC from the stored ISO string so the server and
 * the browser render byte-identical markup (no hydration mismatch from
 * relative times like "2 minutes ago").
 */
export function formatStamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;

  const pad = (value: number) => String(value).padStart(2, '0');
  const day = `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
  const time = `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`;

  return `${day} ${time}Z`;
}

export function pluralise(count: number, singular: string, plural?: string): string {
  return count === 1 ? singular : (plural ?? `${singular}S`);
}

export function countReplies(count: number): string {
  return `${count} ${pluralise(count, 'REPLY')}`;
}
