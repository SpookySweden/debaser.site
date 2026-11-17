import { createWindowSlot } from '../ui/window-slot';

/**
 * ONE SEARCH BOX (SPEC-forum-v3.md, Luke's S1B, S2A, S3A, 2026-11-17): the SEARCH window's open-or-shut and the plain
 * matching it does. The site's own things are searched in this browser, over the lists each page already reads through
 * its own store - so whatever the database lets this reader see is all it can find, a private doc included (its rules
 * decide, not this file). The outside platforms come from MEDIA's own search, after.
 */

export type SearchWindowState = { open: boolean; words: string };

const SHUT: SearchWindowState = { open: false, words: '' };
const slot = createWindowSlot<SearchWindowState>(SHUT);

export const searchWindowState = slot.state;
export const searchWindowServerState = (): SearchWindowState => SHUT;
export const subscribeToSearchWindow = slot.subscribe;

export const SEARCH_HREF = '/forum?search=1';

export function openSearch(words = ''): void {
  slot.set({ open: true, words: words.length > 0 ? words : slot.state().words });
}

export function closeSearch(): void {
  if (slot.state().open) slot.set({ ...slot.state(), open: false });
}

export function toggleSearch(): void {
  if (slot.state().open) closeSearch();
  else openSearch();
}

export function searchRequested(search: string): boolean {
  return new URLSearchParams(search).get('search') !== null;
}

/** The words asked for: lower case, one space apart, at most eight (a search, not a paragraph). */
export function searchWords(query: string): string[] {
  return query
    .toLowerCase()
    .split(/\s+/)
    .map((word) => word.trim())
    .filter((word) => word.length > 0)
    .slice(0, 8);
}

/** True when every word is somewhere in the texts: the plain "all these words" every group uses. */
export function matchesWords(words: readonly string[], ...texts: (string | null | undefined)[]): boolean {
  if (words.length === 0) return false;
  const hay = texts
    .filter((text): text is string => typeof text === 'string')
    .join(' ')
    .toLowerCase();
  return words.every((word) => hay.includes(word));
}

/** How many of each group a result list shows: a glance, with the group's own page one press away. */
export const GROUP_LIMIT = 6;

/** One line of somebody's words, for a result row. */
export function resultLine(text: string, limit = 90): string {
  const one = text.replace(/\s+/g, ' ').trim();
  return one.length > limit ? `${one.slice(0, limit).trimEnd()}...` : one;
}
