import { threadDomId } from '../forum/anchors';
import { arcadeHref } from '../games/arcade-window';
import { recommendationHref } from '../recommendations/address';
import { watchHref } from '../watch/watch-window';
import type { AppNotification } from './types';

/**
 * Where a notification opens, in one place (the bell's menu, DESK and the balloon all ask here).
 *
 * An address the database filed (a live room, a comic page) wins, but only a site address: never another site, so a
 * row can't send anybody away from DEBASER_OS. A game invitation is the arcade's own address; a letter or a
 * recommendation opens on RECOMMENDED (a letter shows its canvas there); a tag or a reply is its post.
 */
export function isSiteAddress(href: unknown): href is string {
  return typeof href === 'string' && href.length <= 300 && href.startsWith('/') && !href.startsWith('//') && !href.startsWith('/\\');
}

export function notificationHref(item: AppNotification): string | null {
  if (isSiteAddress(item.href)) return item.href;
  if (item.kind === 'invite' && item.inviteId) return arcadeHref({ kind: 'invite', inviteId: item.inviteId });
  if ((item.kind === 'recommend' || item.kind === 'letter') && item.recommendationId) return recommendationHref(item.recommendationId);
  if (item.kind === 'live' && item.roomId) return watchHref({ kind: 'room', roomId: item.roomId });
  if (item.threadId !== null) return `/forum#${threadDomId(item.threadId)}`;

  return null;
}
