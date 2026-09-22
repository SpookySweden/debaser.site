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
  return kind === 'tag' ? 'TAGGED YOU' : 'REPLIED TO YOU';
}

/** Shorter verb for a cramped row. */
export function notificationVerb(kind: AppNotification['kind']): string {
  return kind === 'tag' ? 'TAGGED' : 'REPLIED';
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
