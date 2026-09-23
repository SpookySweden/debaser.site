import { clipForNews, type NewsRow } from '../forum/news-feed';
import { commentTag } from './elements';
import type { ProfileComment } from './types';

/**
 * The feed that runs under a profile's two columns: **everything said on the page**.
 *
 * It began as the crawl under the profile picture, carrying only the remarks on that drawing,
 * and it is now the page's whole conversation in one line: a comment on the profile itself, on
 * the picture, or on the track all go past in the same rows, each stamped with what it is about
 * (`PROFILE`, `P2`, `M1`) so a remark is placed before it is read. That is what makes it worth
 * a line across the whole window rather than a crawl in a column - the smallest part of the
 * conversation had the narrowest space on the page, and the space under the track was empty.
 *
 * Because it carries the whole page, it is also the only crawl left on a profile: the two
 * element threads keep their fold and their list (`P1 ▸ 2`) and no longer grow a crawl of their
 * own. Their remarks are already on this line, and the picture's column is 212px wide.
 *
 * **One row in every three is a pinned comment, and any comment on the page can be pinned.**
 * A pin is a request to be read, and a crawl is a bad place for one: a strip that simply walked
 * newest-first would let a pinned remark go by once a pass. So the run is built in threes - the
 * pinned comments taking the leading row in turn, everything else filling the two behind them -
 * which means a reader who catches any part of the run is never more than three rows away from
 * one of them, and two rows away from the conversation at large. With nothing pinned the feed is
 * every comment in a scattered order.
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

/** What a pinned comment is stamped with, in the comments list and on the feed. */
export const PROFILE_PIN_LABEL = 'PINNED';

/**
 * Everything said on the page, newest first: the material the feed is built from.
 *
 * Every kind, deliberately, and in one list: which element a remark was written about is the
 * row's tag rather than a wire of its own. Three separate crawls could only ever show one of
 * the three threads at a time, and the page's conversation is not three conversations.
 */
export function profileWireComments(comments: ProfileComment[]): ProfileComment[] {
  return [...comments].sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));
}

/**
 * The pinned ones, most recently pinned first: the order they take their turns in.
 *
 * Any comment the feed carries can be pinned - the page's own remarks, and the ones left on the
 * picture and the track - so this is not filtered by kind. A pin is taken from the small blue
 * pushpin beside the row in the list it belongs to (see ./visibility for which lists a reader
 * is shown).
 */
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

/** One comment as the feed's row: the same row the board's strip is made of. */
function toRow(comment: ProfileComment, userId: string): NewsRow {
  return {
    id: `news-comment-${comment.id}`,
    // `P2` / `M1` when it was written about an element, `PROFILE` when it was written about the
    // page itself - which is what `commentTag` answers for every kind of comment.
    tag: commentTag(comment) ?? 'PROFILE',
    author: comment.author,
    text: clipForNews(comment.body),
    createdAt: comment.createdAt,
    // Only the page's own remarks have a panel to open. A remark on the picture or the track is
    // read at that element's own fold, which the tag names, and a row that led somewhere else
    // would be a lie about where it came from.
    ...(comment.kind === 'profile'
      ? {
          href: `/profile/${encodeURIComponent(userId)}#${PROFILE_COMMENTS_ANCHOR}`,
          hrefTitle: 'Open the comments on this profile',
        }
      : {}),
    ...(comment.pinned === true ? { pinned: true, pinLabel: PROFILE_PIN_LABEL } : {}),
  };
}

/**
 * The feed's run, in threes, out of every comment on the page.
 *
 * The material is `profileWireComments` - the whole conversation, not one thread of it - so the
 * pinned rows and the rows between them are drawn from the same pool the page is: a pin on a
 * drawing's remark leads a run of three that may be filled by remarks on the track.
 */
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
  // so a page with three comments has a feed of three rows and not fourteen of them repeated.
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

