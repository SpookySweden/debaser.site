import { tagKey } from './tag-vocabulary';
import { postCredit } from './site-author';
import type { ForumAnchorKind, ForumComment, ForumTag, ForumThread, ForumTrack } from './types';

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
 * A tag counts **wherever it sits on the thread**: the tags on the post itself and the tags on any
 * of its replies. That is not a detail - the tag chooser counts both (see `buildTagVocabulary` in
 * ./tag-vocabulary.ts), so a MECHANICS tag typed into a reply makes the MECHANICS chip read
 * `MECHANICS (1)`. If the filter only read `thread.tags` that chip would promise a post the board
 * could not show. `threadTagMatches` also reports *where* each hit was found, so a card can say
 * "matched in a reply" and open it.
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
  /**
   * Keep only posts that carry music: a track filed with the post, or one filed with a reply to it.
   *
   * The board is where an MP3 gets filed (the composer attaches one), so "the music on the board" is
   * a reading of the board rather than a second shelf - and a post with a reply that carries a track
   * is a post somebody came to the music through, which is why a reply's track counts.
   */
  musicOnly?: boolean;
  /**
   * Music tag keys to include: keep posts whose tracks wear at least one of them.
   *
   * These are the sound's own vocabulary (`app/lib/audio/tags.ts`), not the board's - a music tag
   * sits on a track, so choosing one asks a question about the music rather than about the writing.
   */
  musicTagKeys?: string[];
};

/** Canonical keys of the tags on the post itself. */
export function postTagKeys(thread: ForumThread): string[] {
  return thread.tags.map((tag) => tagKey(tag.label));
}

/** Canonical keys of every tag on the post's replies. */
export function replyTagKeys(thread: ForumThread): string[] {
  return thread.comments.flatMap((comment) => comment.tags.map((tag) => tagKey(tag.label)));
}

/**
 * Canonical keys of every tag on the thread, the replies included.
 *
 * Every tag is kept, `source` and the retired housekeeping badges with them, because a hand-written
 * `#tag-board` still has to find the posts that wear one even though the badge itself is no longer
 * drawn.
 */
export function threadTagKeys(thread: ForumThread): string[] {
  return [...new Set([...postTagKeys(thread), ...replyTagKeys(thread)])];
}

/**
 * One tag a thread matched a filter with, and where on the thread it was found.
 *
 * `comment` is undefined for a hit on the post itself; when it is set the tag is on that reply -
 * which is what lets a card name the reply and offer to open it.
 */
export type TagMatch = {
  tag: ForumTag;
  comment?: ForumComment;
};

/**
 * Every tag on the thread that the selected keys include, in the order the thread holds them.
 *
 * Duplicates are kept: two replies tagged SPOILER are two matches, and the card has two replies to
 * point at.
 */
export function threadTagMatches(thread: ForumThread, tagKeys: string[]): TagMatch[] {
  const keys = normaliseKeys(tagKeys);
  if (keys.length === 0) return [];

  const wanted = new Set(keys);
  const matches: TagMatch[] = [];

  for (const tag of thread.tags) {
    if (wanted.has(tagKey(tag.label))) matches.push({ tag });
  }

  for (const comment of thread.comments) {
    for (const tag of comment.tags) {
      if (wanted.has(tagKey(tag.label))) matches.push({ tag, comment });
    }
  }

  return matches;
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

/** How many of the selected tags this thread includes, replies counted. */
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

/**
 * Every track filed on a thread: the post's own first, then those of its replies, in the order a
 * reader meets them.
 */
export function threadTracks(thread: ForumThread): ForumTrack[] {
  const tracks: ForumTrack[] = [];

  if (thread.track !== undefined) tracks.push(thread.track);
  for (const comment of thread.comments) if (comment.track !== undefined) tracks.push(comment.track);

  return tracks;
}

/** True when a post carries music at all - its own track, or one a reply came with. */
export function carriesMusic(thread: ForumThread): boolean {
  return thread.track !== undefined || thread.comments.some((comment) => comment.track !== undefined);
}

/**
 * True when the thread's tracks wear any of the chosen music tags; no choice takes everything.
 *
 * A track's tags are written in the site's one tag grammar (`app/lib/audio/tags.ts`), so they are
 * compared by canonical key here exactly as the board's own tags are - `LO-FI` in a tag list and
 * `lo fi` in a filter are the same tag.
 */
export function matchesMusicTags(thread: ForumThread, musicTagKeys: string[] = []): boolean {
  const wanted = normaliseKeys(musicTagKeys);
  if (wanted.length === 0) return true;

  return threadTracks(thread).some((track) =>
    (track.tags ?? []).some((tag) => wanted.includes(tagKey(tag))),
  );
}

export function selectBoardThreads(threads: ForumThread[], options: BoardQuery): ForumThread[] {
  const needle = options.query.trim().toLowerCase();

  const filtered = threads.filter((thread) => {
    if (options.sourceFilter !== 'all' && thread.anchor.kind !== options.sourceFilter) return false;
    if (!matchesTagFilter(thread, options.tagKeys, options.tagMatchMode)) return false;
    if (options.musicOnly === true && !carriesMusic(thread)) return false;
    if (!matchesMusicTags(thread, options.musicTagKeys)) return false;
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
