/**
 * A Riot ID, `Name#TAG` (SPEC-leaguebot.md). Riot's own rules: the name is 3 to 16 characters, the tag 3 to 5, letters and
 * digits in any script, and the name may hold spaces. We are a little looser (a name of 1 to 16, a tag of 2 to 5) so an old
 * account is never refused, and refuse only what could not be one: `#`, control characters, anything that breaks a query.
 * Pure: the page, the routes and the checks share it.
 */

export type RiotId = { name: string; tag: string };

const NAME = /^[\p{L}\p{N}\p{M} ._]{1,16}$/u;
const TAG = /^[\p{L}\p{N}\p{M}]{2,5}$/u;

/** `Name#TAG` (or `Name #TAG`, `Name-TAG` as OP.GG writes it in an address) read into its parts, or null. */
export function parseRiotId(text: unknown): RiotId | null {
  if (typeof text !== 'string') return null;
  const value = text.normalize('NFC').replace(/\s+/g, ' ').trim();
  let cut = value.lastIndexOf('#');
  if (cut < 0) cut = value.lastIndexOf('-');
  if (cut <= 0) return null;
  return riotIdFrom(value.slice(0, cut), value.slice(cut + 1));
}

/** The two parts checked, or null. */
export function riotIdFrom(name: unknown, tag: unknown): RiotId | null {
  if (typeof name !== 'string' || typeof tag !== 'string') return null;
  const n = name.normalize('NFC').replace(/\s+/g, ' ').trim();
  const t = tag.normalize('NFC').trim();
  return NAME.test(n) && TAG.test(t) ? { name: n, tag: t } : null;
}

export function formatRiotId(id: RiotId): string {
  return `${id.name}#${id.tag}`;
}

/** The same player: Riot IDs are compared without case. */
export function sameRiotId(a: RiotId, b: RiotId): boolean {
  return a.name.toLowerCase() === b.name.toLowerCase() && a.tag.toLowerCase() === b.tag.toLowerCase();
}
