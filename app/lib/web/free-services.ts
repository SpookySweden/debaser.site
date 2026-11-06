/**
 * Where a free service's name in a WATCH list goes (SPEC-kino-sources.md, Luke 2026-11-06). TMDB gives names and no addresses,
 * so a key opens the service's own search for the title. Only services whose search was tried on 2026-11-06 and showed results
 * for a film's words are here: Plex, Kanopy, Pluto, Roku and Channel 4 ignored them, or refused or failed, and show as a name.
 */
const SEARCHES: readonly { name: RegExp; search: (words: string) => string }[] = [
  { name: /^tubi( tv)?$/i, search: (words) => `https://tubitv.com/search/${words}` },
  { name: /^bbc iplayer$/i, search: (words) => `https://www.bbc.co.uk/iplayer/search?q=${words}` },
  { name: /^hoopla$/i, search: (words) => `https://www.hoopladigital.com/search?q=${words}` },
  { name: /^youtube( free)?$/i, search: (words) => `https://www.youtube.com/results?search_query=${words}` },
];

/** The service's own search for a title, or null when there's none known to work. Pure. */
export function freeServiceUrl(name: string, title: string): string | null {
  const known = SEARCHES.find((entry) => entry.name.test(name.trim()));
  return known === undefined ? null : known.search(encodeURIComponent(title));
}
