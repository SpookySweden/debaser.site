import { commentDomId, threadDomId } from '../forum/anchors';
import { lorePagePath } from '../lore/pages';
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
    case 'media':
    case 'kino':
      return `/media?q=${encodeURIComponent(item.title)}`;
    case 'thread':
      return `/forum#${threadDomId(item.ref)}`;
    case 'post':
      return `/forum#${commentDomId(item.ref)}`;
    case 'lore':
      return lorePagePath(item.ref);
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
