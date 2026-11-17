import { displayTitle } from './site-author';
import type { ForumAnchor, ForumThread } from './types';

/**
 * TALKED ABOUT IN (SPEC-forum-v3.md, Luke's S4A, 2026-11-17): the forum threads about a thing - those filed under it, and
 * those whose post or replies link to its address. A count of conversations, never likes or views. Pure, over the threads
 * the board already holds, so it can be checked without a browser.
 */
export type TalkTarget = {
  /** True for a thread filed under the thing (its doc anchor, a reader's thread for the book). */
  filedUnder: (anchor: ForumAnchor) => boolean;
  /** Addresses that, written in a post or a reply, mean the thing (`/lore/glass-corridor`, `/books/...`). */
  links: string[];
};

export type TalkRow = { threadId: string; title: string; replies: number; at: string };

/** How many threads the line names before it stops: a glance, not a list. */
export const TALK_LIMIT = 5;

export function talkedAboutIn(threads: readonly ForumThread[], target: TalkTarget, limit = TALK_LIMIT): TalkRow[] {
  const links = target.links.filter((link) => link.length > 3);
  const mentions = (text: string) => links.some((link) => text.includes(link));
  const rows: TalkRow[] = [];
  for (const thread of threads) {
    const about = target.filedUnder(thread.anchor) || mentions(thread.body) || thread.comments.some((comment) => mentions(comment.body));
    if (!about) continue;
    const at = thread.comments.reduce((latest, comment) => (comment.createdAt > latest ? comment.createdAt : latest), thread.createdAt);
    rows.push({ threadId: thread.id, title: displayTitle(thread), replies: thread.comments.length, at });
  }
  return rows.sort((a, b) => b.at.localeCompare(a.at)).slice(0, limit);
}
