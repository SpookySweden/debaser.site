import { categoriesOf, categoryWords } from '../media/categories';
import type { CatalogueEntry } from '../media/types';
import { authorList, matchesAuthor, searchWords } from './search';
import type { WebSearch } from './web-filters';

/**
 * The site's own files as one of the archive's servers (Luke, 2026-11-03: "include the old archive page as a
 * 'server' in the web search"). The old archive page is the catalogue (FILES, /files, SPEC-media-catalogue.md):
 * every picture, track and video the site holds. An archive search lists the files its words find under this
 * server's name, before everything else, and each plays or opens the way the catalogue does (WebSiteFiles.tsx).
 *
 * Pure and client-safe: the page reads the catalogue (lib/media/catalogue.ts) and hands it in. Nothing here
 * fetches, and nothing is saved into the WEB stream: these are the site's own files, never WEB rows.
 * `scripts/check-web-site-server.cjs` holds it.
 */

/** The server's name, where another row shows YOUTUBE or INTERNET ARCHIVE (Luke's choice, 2026-11-03). */
export const SITE_SERVER_LABEL = 'DEBASER.SITE';

/** How many of its files a search shows before `[ ALL n FILES ]`. */
export const SITE_FILES_SHOWN = 8;

/** What a search asks of the site's files: its words and the box's filters (web-filters.ts). */
export type SiteSearch = { query: string; filters: Pick<WebSearch, 'source' | 'type' | 'authors' | 'vibe' | 'sort'> };

/**
 * All of a text's words, the way search.ts cuts them (letters and digits, lower case). Not `searchWords`, which
 * keeps only a query's first few: right for what is typed, wrong for a file's own words.
 */
function wordsOf(text: string): string[] {
  return text.normalize('NFKC').toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
}

/** Every word a file can be found by: its own words, where it is filed, its categories' names and its tags. */
function fileWords(entry: CatalogueEntry): Set<string> {
  const { item } = entry;
  return new Set(wordsOf([item.title, item.credit, item.uploadedByLabel, item.folderPath ?? '', categoryWords(entry), ...item.tags].join(' ')));
}

/**
 * The files a search finds, newest first (oldest first under SORT: DATE flipped).
 *
 * - Only in a search with SOURCE ALL: a search of one platform (or KINO) is about that platform.
 * - TYPE keeps its own kind: IMAGE, AUDIO or VIDEO (the site holds no TEXT).
 * - Words are whole words, as everywhere else in the archive search (search.ts), found in the title, credit, who
 *   filed it, its folder, its categories (PROFILE PICTURES, VIDEOS...) or its tags. Every word must be there; with
 *   VIBE on, any one.
 * - `from:` keeps a file whose credit or filer has one of the names (search.ts `matchesAuthor`).
 * - A search with no words and no creator finds nothing: the plain stream does not list the site's files.
 */
export function siteFileMatches(entries: readonly CatalogueEntry[], search: SiteSearch): CatalogueEntry[] {
  const { filters } = search;
  if (filters.source !== 'all') return [];
  const wanted = searchWords(search.query) ?? [];
  const authors = authorList(filters.authors ?? []);
  if (wanted.length === 0 && authors === null) return [];

  const found = entries.filter((entry) => {
    const { item } = entry;
    if (filters.type !== 'all' && item.kind !== filters.type) return false;
    if (authors !== null && !matchesAuthor({ creator: item.credit }, authors) && !matchesAuthor({ creator: item.uploadedByLabel }, authors)) return false;
    if (wanted.length === 0) return true;
    const have = fileWords(entry);
    return filters.vibe ? wanted.some((word) => have.has(word)) : wanted.every((word) => have.has(word));
  });

  const oldestFirst = filters.sort === 'oldest';
  return found.sort((a, b) => (oldestFirst ? a.item.createdAt.localeCompare(b.item.createdAt) : b.item.createdAt.localeCompare(a.item.createdAt)));
}

/** Where a file lives on the catalogue page: its first category (`/files?cat=`), with its uses, tags and EDIT. */
export function siteFileHref(entry: CatalogueEntry): string {
  const category = categoriesOf(entry)[0];
  return category === undefined ? '/files' : `/files?cat=${encodeURIComponent(category)}`;
}
