import { commentDomId, threadDomId } from '../forum/anchors';
import { LORE_PATH } from '../docs/rules';
import { highlightHref } from '../books/types';
import type { LetterItem, LetterKind } from './types';

/** What a card's key says in its pop-up (Luke: "listen, being watch or read case by case"). */
export type LetterVerb = 'WATCH' | 'LISTEN' | 'READ' | 'OPEN';

/** What each kind of thing is called on its card and in its pop-up. */
export const KIND_LABELS: Record<LetterKind, string> = {
  web: 'MEDIA',
  media: 'FILM',
  kino: 'FILM',
  thread: 'THREAD',
  post: 'POST',
  lore: 'LORE',
  file: 'FILE',
  song: 'BEAT BOX SONG',
  profile: 'PERSON',
  link: 'LINK',
  highlight: 'HIGHLIGHT',
};

/** The key a kind of thing gets, where the kind alone says it (a MEDIA row says by its own kind: see LetterItemPopout). */
export function verbOf(kind: LetterKind): LetterVerb {
  switch (kind) {
    case 'media':
    case 'kino':
      return 'WATCH';
    case 'song':
      return 'LISTEN';
    case 'thread':
    case 'post':
    case 'lore':
    case 'highlight':
      return 'READ';
    default:
      return 'OPEN';
  }
}

/** Where a thing lives, for its key: a page on the site, or (a pasted link only) its own address. */
export function hrefOf(item: Pick<LetterItem, 'kind' | 'ref' | 'title'>): string {
  switch (item.kind) {
    case 'web':
      // A book or an audiobook has its own page (SPEC-books.md), and so does one edition of a book, its book's page opened
      // at it (SPEC-book-editions.md); anything else is found on MEDIA by its title.
      if (/^(books|audiobooks):[A-Za-z0-9][A-Za-z0-9._-]{0,200}$/.test(item.ref) || /^edition:OL[1-9][0-9]{0,11}M$/.test(item.ref)) return `/media/book/${item.ref}`;
      return `/media?q=${encodeURIComponent(item.title)}`;
    case 'media':
    case 'kino':
      return `/media?q=${encodeURIComponent(item.title)}`;
    case 'highlight':
      return highlightHref(item.ref) ?? '/media';
    case 'thread':
      return `/forum#${threadDomId(item.ref)}`;
    case 'post':
      return `/forum#${commentDomId(item.ref)}`;
    case 'lore':
      return `${LORE_PATH}/${item.ref}`;
    case 'file':
      return '/files';
    case 'song':
      return '/beatbox';
    case 'profile':
      return `/profile/${encodeURIComponent(item.ref)}`;
    case 'link':
      return isWebAddress(item.ref) ? item.ref : '/';
    default:
      return '/';
  }
}

/** A pasted link: http or https only, and at most 500 characters (what the table keeps). */
export function isWebAddress(value: string): boolean {
  if (value.length > 500) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

/** A picture a card may show: an https address or one of the site's own, as the table allows. */
export function cardPicture(value: string | null | undefined): string | undefined {
  if (!value || value.length > 500) return undefined;
  return value.startsWith('https://') || (value.startsWith('/') && !value.startsWith('//')) ? value : undefined;
}
