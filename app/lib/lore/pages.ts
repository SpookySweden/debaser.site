import type { LorePageSummary } from './types';

/**
 * The pure facts about a lore page: what its address is, how long it is, and how an index reads.
 *
 * Kept apart from the stores for the same reason the board's own rules are (app/lib/forum/tags.ts
 * and friends): these are the parts a check can reason about without a browser or a database, and
 * they are the parts a second store has to agree with rather than re-invent.
 */

/** What a slug may be: lower case words and single hyphens, which is what a link can hold. */
export const LORE_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** The longest slug this site writes. Long enough for a title, short enough for a URL. */
export const LORE_SLUG_LIMIT = 60;

/**
 * A page's address, read off its title: `THE GLASS CORRIDOR` -> `the-glass-corridor`.
 *
 * Accents are folded rather than dropped (`CAFÉ` -> `cafe`), everything that is not a letter or a
 * digit becomes a hyphen, and the hyphens are squeezed and trimmed - so the answer is always
 * something that passes `isLoreSlug`, or nothing at all when the title has no letters in it.
 */
export function loreSlug(title: string): string {
  return title
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, LORE_SLUG_LIMIT)
    .replace(/-+$/g, '');
}

export function isLoreSlug(value: string): boolean {
  return value.length > 0 && value.length <= LORE_SLUG_LIMIT && LORE_SLUG_PATTERN.test(value);
}

/** A slug read back as a title, for the tab and the window title before the row has been read. */
export function titleFromSlug(slug: string): string {
  const words = slug.split('-').filter((word) => word.length > 0);

  return words.length === 0 ? 'LORE PAGE' : words.join(' ').toUpperCase();
}

/** Where a page lives. One place, so a link and a redirect cannot disagree. */
export function lorePagePath(slug: string): string {
  return `/lore/${slug}`;
}

/** How many words are in the writing: what the page's own line counts. */
export function wordCountOf(text: string): number {
  const words = text.trim().match(/\S+/g);

  return words === null ? 0 : words.length;
}

/** The first sentence-ish of the writing, for a hover or a preview that has no summary. */
export function snippetOf(text: string, limit = 140): string {
  const oneLine = text.replace(/\s+/g, ' ').trim();

  return oneLine.length > limit ? `${oneLine.slice(0, limit).trimEnd()}...` : oneLine;
}

/** The index's order: what was written in most recently, first. */
export function sortPagesByUpdated(pages: LorePageSummary[]): LorePageSummary[] {
  return [...pages].sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt));
}
