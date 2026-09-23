import { clipForNews, type NewsRow } from '../forum/news-feed';
import type { ProfileComment } from './types';

/**
 * A profile's own wire: the comments left on it, and nothing else.
 *
 * This used to be the board's wire, borrowed: the profile page crawled every post and reply in
 * the archive past the drawing, which was a second copy of /forum on a page about one account.
 * What belongs there is the conversation *about this profile* - so the wire is the profile's own
 * comments, drawn in the same rows and the same crawl, and each row opens the comments panel
 * underneath it.
 *
 * The comment rows carry no `P2` / `M1` tag, because a comment on the profile itself was written
 * about the profile and there is only one of those; the tag says `PROFILE` instead, so the strip
 * still says what you are reading before you read it. Picture and track comments stay in their
 * own threads under those elements - see ./elements on what a comment was written on - which is
 * also why only a comment on the profile *itself* can be pinned.
 *
 * **One row in every three is a pinned comment.** The owner's pin is a request to be read, and a
 * crawl is a bad place for one: a strip that simply walked newest-first would let a pinned remark
 * go by once a pass. So the run is built in threes - the pinned comments taking the leading slot
 * in turn, everything else filling the two behind them - which means a reader who catches any
 * part of the run is never more than three rows away from one of them, and two rows away from the
 * conversation at large. With nothing pinned the wire is every comment in a scattered order.
 */

/** How many rows a profile's wire carries at most: a long conversation still has to read. */
export const PROFILE_NEWS_LIMIT = 14;

/** The anchor the comments panel answers to, so a wire row can open it. */
export const PROFILE_COMMENTS_ANCHOR = 'profile-comments';

/**
 * The run's shape: one pinned row, then this many rows of everything else.
 *
 * It is the number the feature is written in - "a pinned comment every third row" - so it is
 * named rather than spelled out inside an index calculation.
 */
export const PROFILE_NEWS_CYCLE = 3;

/** What a pinned comment is stamped with, in the comments list and on the wire. */
export const PROFILE_PIN_LABEL = 'PINNED';

/** The profile's own comments, newest first: the material the wire is built from. */
export function profileWireComments(comments: ProfileComment[]): ProfileComment[] {
  return comments
    // Defensive: the caller is expected to hand over the profile's own comments, and a comment
    // written on a picture or a track is not one of them.
    .filter((comment) => comment.kind === 'profile')
    .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));
}

/** The pinned ones, most recently pinned first: the order they take their turns in. */
export function pinnedWireComments(comments: ProfileComment[]): ProfileComment[] {
  return profileWireComments(comments)
    .filter((comment) => comment.pinned === true)
    .sort(
      (left, right) =>
        Date.parse(right.pinnedAt ?? right.createdAt) - Date.parse(left.pinnedAt ?? left.createdAt),
    );
}

/**
 * The rest, in a scattered order.
 *
 * `Math.random()` is deliberately not used, and that is the one judgement call in this file: the
 * wire is drawn once on the server and then again in the browser, and a run that came out
 * differently between the two would make the page's markup disagree with itself (React's
 * hydration mismatch, which re-draws the strip and restarts its crawl). So the scatter is derived
 * from the comments themselves - their ids, hashed - which keeps both draws the same run while
 * the order is still arbitrary rather than newest-first: the two rows behind each pin are the
 * page's conversation rather than its filing order.
 */
export function scatteredWireComments(comments: ProfileComment[]): ProfileComment[] {
  const ordered = [...comments];
  let seed = 0x9e3779b9;

  for (const comment of ordered) {
    for (let index = 0; index < comment.id.length; index += 1) {
      seed = (seed * 31 + comment.id.charCodeAt(index)) & 0x7fffffff;
    }
  }

  for (let index = ordered.length - 1; index > 0; index -= 1) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    const swap = seed % (index + 1);
    const held = ordered[index];

    ordered[index] = ordered[swap];
    ordered[swap] = held;
  }

  return ordered;
}

/** One comment as the wire's row: the same row the board's strip is made of. */
function toRow(comment: ProfileComment, userId: string): NewsRow {
  return {
    id: `news-comment-${comment.id}`,
    tag: 'PROFILE',
    author: comment.author,
    text: clipForNews(comment.body),
    createdAt: comment.createdAt,
    href: `/profile/${encodeURIComponent(userId)}#${PROFILE_COMMENTS_ANCHOR}`,
    hrefTitle: 'Open the comments on this profile',
    ...(comment.pinned === true ? { pinned: true, pinLabel: PROFILE_PIN_LABEL } : {}),
  };
}

export function buildProfileNewsFeed(
  comments: ProfileComment[],
  options: { userId: string; limit?: number } = { userId: '' },
): NewsRow[] {
  const limit = Math.max(0, options.limit ?? PROFILE_NEWS_LIMIT);
  const all = profileWireComments(comments);
  if (all.length === 0 || limit === 0) return [];

  const pins = pinnedWireComments(all);
  const rest = scatteredWireComments(all.filter((comment) => comment.pinned !== true));

  // Long enough to give every comment its turn once and every pin a run of three to lead, then
  // bounded by what the strip was asked for. A shorter run is cut off (below) rather than padded,
  // so a profile with three comments has a wire of three rows and not fourteen of them repeated.
  const runs = Math.max(1, Math.ceil(rest.length / (PROFILE_NEWS_CYCLE - 1)), pins.length);
  const length = Math.min(limit, runs * PROFILE_NEWS_CYCLE);

  const rows: NewsRow[] = [];
  let pinTurn = 0;
  let restTurn = 0;

  while (rows.length < length) {
    // The first row of every run of three is a pin's, in the order the pins were taken.
    const pinLeads = rows.length % PROFILE_NEWS_CYCLE === 0 && pinTurn < pins.length;

    const source = pinLeads
      ? pins[pinTurn++]
      : restTurn < rest.length
        ? rest[restTurn++]
        : pins[pinTurn++];

    // Nothing left that has not already been shown: the run is as long as the conversation is.
    // The crawl loops the strip itself, so the wire still goes round and round.
    if (source === undefined) break;

    rows.push(toRow(source, options.userId));
  }

  return rows;
}

