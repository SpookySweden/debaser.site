import { tagKey } from './tag-vocabulary';
import { postCredit } from './site-author';
import type { ForumAnchorKind, ForumThread } from './types';

/**
 * Board query: filtering and ordering of the thread list.
 *
 * Pure functions, kept out of the React component so tag inclusion rules can be
 * reasoned about (and tested) directly:
 *
 *   - `any`  keeps posts carrying at least one of the selected tags
 *   - `all`  keeps only posts carrying every selected tag
 *   - the `tags` sort ranks posts by how many of the selected tags they include,
 *     which is what "sort by tag inclusion" means, with newest first as the
 *     tie-breaker.
 *
 * Free text looks at the title, the body, the item the post is filed under, the
 * tags and the accounts on it - so a post is findable by whoever it is credited
 * to, and by anyone who replied.
 */

export type SortMode = 'newest' | 'replies' | 'tags';
export type SourceFilter = 'all' | ForumAnchorKind;
export type TagMatchMode = 'any' | 'all';

export type BoardQuery = {
  /** Free text search across title, body, source item, tags and account names. */
  query: string;
  sourceFilter: SourceFilter;
  /** Canonical tag keys to include. */
  tagKeys: string[];
  tagMatchMode: TagMatchMode;
  sortMode: SortMode;
};

/** Canonical keys of every tag on a post. */
export function threadTagKeys(thread: ForumThread): string[] {
  return thread.tags.map((tag) => tagKey(tag.label));
}

/**
 * Every account name that shows on a post.
 *
 * That is whoever the post is credited to (the site, for a thread an item's
 * comment box opened) plus everybody who replied - so searching an account finds
 * the posts it started and the conversations it joined.
 */
export function threadAccountNames(thread: ForumThread): string[] {
  const names = new Set<string>();

  const credit = postCredit(thread);
  if (credit.displayName.length > 0) names.add(credit.displayName);

  for (const comment of thread.comments) {
    if (comment.author.displayName.length > 0) names.add(comment.author.displayName);
  }

  return [...names];
}

/**
 * Selected keys are normalised and de-duplicated here, so a hand-written hash
 * like `#tag-LORE` behaves exactly like `#tag-lore`.
 */
function normaliseKeys(tagKeys: string[]): string[] {
  return [...new Set(tagKeys.map((key) => tagKey(key)).filter((key) => key.length > 0))];
}

/** How many of the selected tags this post includes. */
export function countTagHits(thread: ForumThread, tagKeys: string[]): number {
  const keys = normaliseKeys(tagKeys);
  if (keys.length === 0) return 0;

  const threadKeys = threadTagKeys(thread);
  return keys.filter((key) => threadKeys.includes(key)).length;
}

export function matchesTagFilter(thread: ForumThread, tagKeys: string[], mode: TagMatchMode): boolean {
  const keys = normaliseKeys(tagKeys);
  if (keys.length === 0) return true;

  const hits = countTagHits(thread, keys);
  return mode === 'all' ? hits === keys.length : hits > 0;
}

export function selectBoardThreads(threads: ForumThread[], options: BoardQuery): ForumThread[] {
  const needle = options.query.trim().toLowerCase();

  const filtered = threads.filter((thread) => {
    if (options.sourceFilter !== 'all' && thread.anchor.kind !== options.sourceFilter) return false;
    if (!matchesTagFilter(thread, options.tagKeys, options.tagMatchMode)) return false;
    if (needle.length === 0) return true;

    return (
      thread.title.toLowerCase().includes(needle) ||
      thread.body.toLowerCase().includes(needle) ||
      thread.anchor.label.toLowerCase().includes(needle) ||
      thread.tags.some((tag) => tag.label.toLowerCase().includes(needle) || tagKey(tag.label).includes(needle)) ||
      threadAccountNames(thread).some((name) => name.toLowerCase().includes(needle))
    );
  });

  return [...filtered].sort((a, b) => {
    if (options.sortMode === 'tags' && options.tagKeys.length > 0) {
      const hitDifference = countTagHits(b, options.tagKeys) - countTagHits(a, options.tagKeys);
      if (hitDifference !== 0) return hitDifference;
    }

    if (options.sortMode === 'replies' && b.comments.length !== a.comments.length) {
      return b.comments.length - a.comments.length;
    }

    return Date.parse(b.createdAt) - Date.parse(a.createdAt);
  });
}
