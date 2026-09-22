import type { ForumAuthor, ForumThread } from './types';

/**
 * Tagging an account in a post.
 *
 * A mention is `@name` in the words themselves, which is what makes it readable to a person
 * as well as usable by the code: nobody has to learn a control, and the tag survives a copy
 * and paste. A name with a space in it is written with an underscore - `@debaser_site` - so one
 * token is always one account.
 *
 * The *record* of who was tagged is a notification row (see app/lib/notifications), not a column
 * on the post: the notification menu is where a tag has to appear, and storing it twice is how
 * the two come to disagree.
 */

/**
 * The part of an account a tag needs: a name to write into the words, and an id to tell.
 *
 * Deliberately smaller than `AccountUser`, so a post by a guest - who has a name and no account
 * at all - can still be answered: the reply points at whoever wrote it, and only the accounts
 * among them can be told.
 */
export type Mentionable = {
  id: string | null;
  displayName: string;
};

/** What an account's mention looks like in a body. */
export function mentionToken(displayName: string): string {
  return `@${displayName.trim().replace(/\s+/g, '_')}`;
}

/** Longest token worth reading as a mention, and the characters a name may be written with. */
const MENTION = /@([A-Za-z0-9._-]{2,32})/g;

/** Every mention token in a body, in the order they are written, deduplicated. */
export function mentionTokens(body: string): string[] {
  return [...new Set([...body.matchAll(MENTION)].map((match) => match[1]))];
}

/**
 * The accounts a body tags.
 *
 * The token is only a name: it becomes an account by matching one, case-insensitively, with the
 * underscore folded back to the space a display name may contain. A token nobody answers to is
 * just words - which is why this can be run over any body, including one written before tags
 * existed, and will simply find nothing.
 */
export function mentionsIn(body: string, accounts: Mentionable[]): Mentionable[] {
  const tokens = mentionTokens(body).map((token) => token.toLowerCase());

  return accounts.filter((account) =>
    tokens.includes(account.displayName.trim().replace(/\s+/g, '_').toLowerCase()),
  );
}

/**
 * The author a reply is answering.
 *
 * Answering somebody is a tag: a reply under a post is addressed to whoever wrote the post, and a
 * reply to a reply is addressed to whoever wrote that one. The writer is never told about their
 * own words - `dedupeTargets` drops them when the notification is filed
 * (see app/lib/notifications/feed.ts).
 *
 * It only reads the thread that is already on screen, so "who is being answered" is one rule in
 * one place rather than a slightly different `parentId` lookup in each reply box.
 */
export function answeredAuthor(
  thread: Pick<ForumThread, 'author' | 'comments'>,
  parentId: string | undefined,
): ForumAuthor {
  if (parentId === undefined) return thread.author;

  return thread.comments.find((comment) => comment.id === parentId)?.author ?? thread.author;
}

/**
 * Puts a tag into a body, at the end, on the line it belongs to.
 *
 * The picker and the picker's keyboard shortcut do the same thing to the same words, so a tag
 * chosen from a list and a tag typed by hand are indistinguishable afterwards. Tagging somebody
 * twice is a no-op.
 */
export function insertMention(body: string, displayName: string): string {
  const token = mentionToken(displayName);
  const bare = token.slice(1).toLowerCase();
  if (mentionTokens(body).some((found) => found.toLowerCase() === bare)) return body;

  const trimmed = body.replace(/\s+$/, '');
  return `${trimmed}${trimmed.length === 0 ? '' : ' '}${token} `;
}

/** Takes a tag back out of a body, with the space that separated it from the words. */
export function removeMention(body: string, displayName: string): string {
  const token = mentionToken(displayName);
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  return body
    .replace(new RegExp(`\\s*${escaped}\\s*`, 'g'), ' ')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/[ \t]+$/gm, '');
}
