import { threadDomId } from './anchors';
import { isPinLive, pinLabel } from './pins';
import type { ForumAuthor, ForumThread, ThreadPin } from './types';

/**
 * A wire as a list of rows.
 *
 * Everything that has been filed - posts and replies alike - as one list, newest first,
 * clipped to something that can be read as it goes past. It is deliberately the *same*
 * material the board and the profile threads are made of, so the strip is a second way of
 * looking at the conversation rather than a second conversation: a post and a reply read
 * exactly like a comment does, with the account's name, the time and the words.
 *
 * A row is also what a *profile's* wire is made of (see app/lib/profile/feed.ts), which is why
 * what to draw lives in `tag` / `href` rather than being derived from the board here: the two
 * wires share one row shape and one crawl, and differ only in what they are a wire *of*.
 *
 * Pure, so the order and the clipping can be reasoned about without a browser - which is
 * what the rest of the site's lists do (see ./board-query on the board's own filtering).
 */

export type NewsItemKind = 'post' | 'reply';

export type NewsRow = {
  id: string;
  /** `POST` / `REPLY`, or `P2` / `M1` / `PROFILE` when it came from a profile. */
  tag: string;
  /** Whoever wrote it: the poster, or the one who replied. */
  author: ForumAuthor;
  /** The words, clipped to one line's worth. */
  text: string;
  createdAt: string;
  /** Where the row leads when it is clicked. Absent means the row is not a link. */
  href?: string;
  hrefTitle?: string;
  /** True while the row is the post a moderator pinned: the wire draws it as the highlight. */
  pinned?: boolean;
  /** Only on a pinned row: `PINNED FOREVER`, `PINNED 3H LEFT`. */
  pinLabel?: string;
};

export type NewsItem = NewsRow & {
  kind: NewsItemKind;
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

/** The wire's own link back to a post, which is the same anchor the board's links use. */
export function newsHref(threadId: string): string {
  return `/forum#${threadDomId(threadId)}`;
}

/** What an item is stamped with in the strip: `POST` or `REPLY`. */
export function newsTag(item: Pick<NewsItem, 'kind'>): string {
  return item.kind === 'post' ? 'POST' : 'REPLY';
}

export type NewsFeedOptions = {
  /** The pins, so a pinned post can lead the wire; lapsed ones are ignored here. */
  pins?: ThreadPin[];
  /** The moment to read the pins at. Passed in, so a check never depends on the clock. */
  at?: Date;
};

/**
 * Posts and replies as one run of items, with the pinned post in front.
 *
 * A post says what it is with a `POST` tag and a reply with `REPLY`, which is the same
 * idea as the `P2` / `M1` tags on a profile: three characters that say what you are
 * looking at before you read a word of it.
 *
 * A pinned post leads whatever else was filed after it - that is what pinning is for - and it is
 * marked, so the wire can draw it as the highlighted row rather than as one more line. Only the
 * post is lifted: the replies underneath it are conversation, and a pin that dragged them along
 * would be a pin on the whole thread rather than on the announcement.
 */
export function buildNewsFeed(
  threads: ForumThread[],
  limit: number = NEWS_DEFAULT_LIMIT,
  options: NewsFeedOptions = {},
): NewsItem[] {
  const at = options.at ?? new Date();
  const live = (options.pins ?? []).filter((pin) => isPinLive(pin, at));
  const items: NewsItem[] = [];

  for (const thread of threads) {
    const pin = live.find((entry) => entry.threadId === thread.id);

    items.push({
      id: `news-post-${thread.id}`,
      kind: 'post',
      tag: 'POST',
      author: thread.author,
      text: clipForNews(thread.body.length === 0 ? thread.title : thread.body),
      createdAt: thread.createdAt,
      href: newsHref(thread.id),
      hrefTitle: `Open "${thread.title}"`,
      threadId: thread.id,
      threadTitle: thread.title,
      ...(pin === undefined
        ? {}
        : { pinned: true, pinLabel: pinLabel(pin, at) }),
    });

    for (const comment of thread.comments) {
      items.push({
        id: `news-reply-${comment.id}`,
        kind: 'reply',
        tag: 'REPLY',
        author: comment.author,
        text: clipForNews(comment.body),
        createdAt: comment.createdAt,
        href: newsHref(thread.id),
        hrefTitle: `Open "${thread.title}"`,
        threadId: thread.id,
        threadTitle: thread.title,
      });
    }
  }

  return items
    .sort((left, right) => {
      // Pinned first, then newest first, inside each group.
      if (left.pinned !== right.pinned) return left.pinned === true ? -1 : 1;

      return Date.parse(right.createdAt) - Date.parse(left.createdAt);
    })
    .slice(0, Math.max(0, limit));
}
