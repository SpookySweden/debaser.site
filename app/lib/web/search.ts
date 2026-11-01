import type { WebItem } from './types';

/**
 * WEB search (Phase 4): one field over title, creator, description and tags. A search is a list of whole
 * words, and an item matches when it has every one of them (any order, any of the four fields). Results
 * keep the stream's order, newest first, and its keyset paging.
 *
 * What the reader types is never handed on as typed. `searchWords` keeps only letters and digits, in
 * lower case, at most `MAX_QUERY_LENGTH` characters read and `MAX_QUERY_WORDS` words kept; the Supabase
 * repository passes the result as the one value of a `plainto_tsquery` text search (a parameter, never
 * text pasted into a filter string), against the `search_tsv` column of
 * supabase/migrations/*_web_search_dedupe.sql, built with the 'simple' configuration: no stemming, no
 * stop words, so the mock below and Postgres agree on what a word is.
 * `scripts/check-web-search.cjs` holds both.
 */

export const MAX_QUERY_LENGTH = 100;
export const MAX_QUERY_WORDS = 8;

const WORD = /[\p{L}\p{N}]+/gu;

function words(text: string): string[] {
  return text.normalize('NFKC').toLowerCase().match(WORD) ?? [];
}

/** The words of a search, or null when there is nothing to search for. */
export function searchWords(raw: unknown): string[] | null {
  if (typeof raw !== 'string') return null;
  const found = [...new Set(words(raw.slice(0, MAX_QUERY_LENGTH)))].slice(0, MAX_QUERY_WORDS);
  return found.length > 0 ? found : null;
}

/** The search as the one string handed to the database: its words, space-separated. */
export function searchText(raw: unknown): string | null {
  return searchWords(raw)?.join(' ') ?? null;
}

/** The mock's match: every word is a whole word of the title, creator, description or tags. */
export function matchesSearch(item: WebItem, wanted: readonly string[]): boolean {
  const have = new Set(words([item.title, item.creator ?? '', item.description ?? '', ...(item.tags ?? [])].join(' ')));
  return wanted.every((word) => have.has(word));
}

// --- from: a creator, like the forum's `from:` ---------------------------------------------------------------

/**
 * `from:prelinger` or `from:"prelinger archives"` keeps only items whose creator has those words, side by
 * side, in that order, as whole words ("Rick Prelinger" is `from:prelinger` and `from:"rick prelinger"`,
 * never `from:prel`). Two `from:` are either creator, as on the forum. A name is cut to its words like a
 * search (`searchWords`), so it is letters and digits only wherever it is sent. The box reads the filter
 * itself (web-filters.ts `parseWebSearch`).
 */
export const MAX_AUTHORS = 3;

/** A creator's name as the words it is matched by, or null when it has none. */
export function authorWords(raw: unknown): string[] | null {
  if (typeof raw !== 'string') return null;
  const found = words(raw.slice(0, MAX_QUERY_LENGTH)).slice(0, MAX_QUERY_WORDS);
  return found.length > 0 ? found : null;
}

/** Up to `MAX_AUTHORS` names as their words, repeats and empty ones dropped; null when none is left. */
export function authorList(raw: readonly unknown[] | undefined): string[][] | null {
  const seen = new Set<string>();
  const list: string[][] = [];
  for (const name of raw ?? []) {
    const found = authorWords(name);
    if (found === null || seen.has(found.join(' '))) continue;
    seen.add(found.join(' '));
    list.push(found);
    if (list.length === MAX_AUTHORS) break;
  }
  return list.length > 0 ? list : null;
}

/** Whether the item's creator has one of these names' words, side by side, as whole words. */
export function matchesAuthor(item: Pick<WebItem, 'creator'>, authors: readonly (readonly string[])[]): boolean {
  const have = words(item.creator ?? '').join(' ');
  return authors.some((name) => ` ${have} `.includes(` ${name.join(' ')} `));
}

/**
 * The same match as one case-blind Postgres regex for the `creator` column (`~*`, PostgREST's `imatch`):
 * a name's words with anything but letters and digits between them, and the same (or the start or end)
 * around it. Not `\m`/`\M`/`\W`: Postgres counts `_` as a word letter there, where `words` splits on it
 * ("Prelinger_Archives" is `from:prelinger`). Checked live on 2026-10-31, accented letters included.
 * Words are letters and digits only, so nothing in them is regex syntax.
 */
export function authorPattern(authors: readonly (readonly string[])[]): string {
  const names = authors.map((name) => name.join('[^[:alnum:]]+'));
  return `(^|[^[:alnum:]])(?:${names.join('|')})([^[:alnum:]]|$)`;
}
