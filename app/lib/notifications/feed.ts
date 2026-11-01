import { MAX_NOTIFICATION_SNIPPET, type AppNotification, type NotifyTarget } from './types';

/**
 * The notification feed's rules, as plain functions.
 *
 * Nothing here touches storage or React, so both stores and every screen share one answer to
 * "what does unread mean", "which end is the newest" and "who gets told" - the mock and the
 * database cannot come out different.
 */

/** Window chrome and menu wording for each kind. */
export function notificationLabel(kind: AppNotification['kind']): string {
  if (kind === 'tag') return 'TAGGED YOU';
  if (kind === 'reply') return 'REPLIED TO YOU';

  return 'INVITED YOU TO A GAME';
}

/** Shorter verb for a cramped row. */
export function notificationVerb(kind: AppNotification['kind']): string {
  if (kind === 'tag') return 'TAGGED';
  if (kind === 'reply') return 'REPLIED';

  return 'INVITED';
}

/** One line of the post, as much as fits, with the line breaks taken out of it. */
export function snippet(body: string, limit = MAX_NOTIFICATION_SNIPPET): string {
  const flattened = body.replace(/\s+/g, ' ').trim();
  if (flattened.length <= limit) return flattened;

  return `${flattened.slice(0, Math.max(0, limit - 3)).trimEnd()}...`;
}

/**
 * One row per account, however many times they are named in the same post.
 *
 * Being answered is the stronger signal of the two, so it is the one kept when somebody is both
 * tagged by name and replied to in the same breath: one notification, the one that says a reply
 * is waiting.
 */
export function dedupeTargets(targets: NotifyTarget[], actorId: string | null): NotifyTarget[] {
  const byUser = new Map<string, NotifyTarget>();

  for (const target of targets) {
    if (target.userId.length === 0) continue;
    if (actorId !== null && target.userId === actorId) continue;

    const existing = byUser.get(target.userId);
    if (existing === undefined || target.kind === 'reply') byUser.set(target.userId, target);
  }

  return [...byUser.values()];
}

/** Newest first: the order the feed is read in, and written in. */
export function sortNotificationsNewestFirst(items: AppNotification[]): AppNotification[] {
  return [...items].sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

export function isUnread(item: AppNotification): boolean {
  return item.readAt === null;
}

export function unreadNotifications(items: AppNotification[]): AppNotification[] {
  return items.filter(isUnread);
}

export function unreadNotificationCount(items: AppNotification[]): number {
  return unreadNotifications(items).length;
}

/** What the bell says out loud, so the count is not just a colour. */
export function notificationSummary(items: AppNotification[]): string {
  const unread = unreadNotificationCount(items);
  if (unread === 0) return items.length === 0 ? 'NO NOTIFICATIONS' : 'NOTHING NEW';
  if (unread === 1) return '1 NEW';
  return `${unread} NEW`;
}

/**
 * The feed split into what is waiting and what has been seen.
 *
 * The menu draws these as two groups, the way a mail client does, because the question a feed
 * answers is "what do I owe somebody" and an unread row that is three days old is more urgent than
 * a seen one from this morning. Recency still rules *inside* each group - both halves are taken off
 * the same newest-first list, in order.
 */
export function splitNotifications(items: AppNotification[]): {
  fresh: AppNotification[];
  earlier: AppNotification[];
} {
  return { fresh: unreadNotifications(items), earlier: items.filter((item) => !isUnread(item)) };
}

/** How many of each kind are in the list, for the menu's own status line. */
export function notificationKindCounts(items: AppNotification[]): { tag: number; reply: number; invite: number } {
  const tag = items.filter((item) => item.kind === 'tag').length;
  const invite = items.filter((item) => item.kind === 'invite').length;

  return { tag, reply: items.length - tag - invite, invite };
}

/** The same counts as words: `2 TAGS :: 1 REPLY`, or nothing at all when the feed is empty. */
export function notificationBreakdown(items: AppNotification[]): string {
  if (items.length === 0) return '';

  const { tag, reply, invite } = notificationKindCounts(items);
  // Two forms per word rather than an `S` on the end: a reply's plural is not a reply with an S.
  const word = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;
  const parts = [word(tag, 'TAG', 'TAGS'), word(reply, 'REPLY', 'REPLIES')];
  // An invitation is only worth a word when there is one: the line stays about the board otherwise.
  if (invite > 0) parts.push(word(invite, 'INVITE', 'INVITES'));

  return parts.join(' :: ');
}
