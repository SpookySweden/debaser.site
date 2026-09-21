import type { ForumAuthor, ForumThread } from './types';

/**
 * The board as a news wire.
 *
 * Everything that has been filed - posts and replies alike - as one list, newest first,
 * clipped to something that can be read as it goes past. It is deliberately the *same*
 * material the board and the profile threads are made of, so the strip is a second way of
 * looking at the conversation rather than a second conversation: a post and a reply read
 * exactly like a comment does, with the account's name, the time and the words.
 *
 * Pure, so the order and the clipping can be reasoned about without a browser - which is
 * what the rest of the site's lists do (see ./board-query on the board's own filtering).
 */

export type NewsItemKind = 'post' | 'reply';

export type NewsItem = {
  id: string;
  kind: NewsItemKind;
  /** Whoever wrote it: the poster, or the one who replied. */
  author: ForumAuthor;
  /** The words, clipped to one line's worth. */
  text: string;
  createdAt: string;
  /** Where it belongs, so the strip can link to the thread it came from. */
  threadId: string;
  threadTitle: string;
};

/** How much of one item the strip prints before it becomes noise. */
export const NEWS_SLICE = 110;

/** Newest first, which is the only order a wire is ever read in. */
export const NEWS_DEFAULT_LIMIT = 14;

/** One line's worth of somebody's writing. */
export function clipForNews(body: string, limit: number = NEWS_SLICE): string {
  const oneLine = body.replace(/\s+/g, ' ').trim();

  return oneLine.length > limit ? `${oneLine.slice(0, limit).trimEnd()}...` : oneLine;
}

/**
 * Posts and replies as one run of items.
 *
 * A post says what it is with a `POST` tag and a reply with `REPLY`, which is the same
 * idea as the `P2` / `M1` tags on a profile: three characters that say what you are
 * looking at before you read a word of it.
 */
export function buildNewsFeed(threads: ForumThread[], limit: number = NEWS_DEFAULT_LIMIT): NewsItem[] {
  const items: NewsItem[] = [];

  for (const thread of threads) {
    items.push({
      id: `news-post-${thread.id}`,
      kind: 'post',
      author: thread.author,
      text: clipForNews(thread.body.length === 0 ? thread.title : thread.body),
      createdAt: thread.createdAt,
      threadId: thread.id,
      threadTitle: thread.title,
    });

    for (const comment of thread.comments) {
      items.push({
        id: `news-reply-${comment.id}`,
        kind: 'reply',
        author: comment.author,
        text: clipForNews(comment.body),
        createdAt: comment.createdAt,
        threadId: thread.id,
        threadTitle: thread.title,
      });
    }
  }

  return items
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    .slice(0, Math.max(0, limit));
}

/** What an item is stamped with in the strip: `POST` or `REPLY`. */
export function newsTag(item: NewsItem): string {
  return item.kind === 'post' ? 'POST' : 'REPLY';
}
