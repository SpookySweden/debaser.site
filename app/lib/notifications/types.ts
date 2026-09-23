/**
 * Notifications: who was tagged, who was answered, and who wants a game.
 *
 * A notification is written by the account that did the tagging or the replying, and read by
 * exactly one account - the one it names. Everything the menu shows is a column here: who did
 * it, what kind it was, which post it happened on, a snippet of the words, and when. Whatever
 * the screen needs to say, it reads rather than re-derives, so the menu cannot drift from what
 * happened.
 *
 * Like the board, the profiles and comms, this is storage agnostic: the mock repository in this
 * folder works today and the Supabase one drops in behind the same interface.
 */

export type NotificationsDataSource = 'mock' | 'supabase';

import type { GameId } from '../games/types';

/**
 * A tag is somebody naming you; a reply is somebody answering you; an invite is somebody asking you
 * for a game. The three share one feed because they share one question - what do I owe somebody - and
 * one place to answer it from.
 */
export type NotificationKind = 'tag' | 'reply' | 'invite';

/** How much of the post a notification carries into the menu. */
export const MAX_NOTIFICATION_SNIPPET = 120;

/** How often the feed is re-read when realtime says nothing; see ./feed.ts and the provider. */
export const NOTIFICATIONS_POLL_MS = 30_000;

export type AppNotification = {
  id: string;
  /** The account being told - the only one that may read this row. */
  userId: string;
  kind: NotificationKind;
  /** Who did it. Null once that account is gone, which is why the name is stored too. */
  actorId: string | null;
  /** The tagger's name at the time they wrote it. */
  actorName: string;
  /** The post the tag or the reply lives on; null if that post has since been removed. */
  threadId: string | null;
  /** The post's title at the time of writing, so the menu can name it without a second read. */
  threadTitle: string;
  /** The words themselves, shortened (see `snippet`). */
  body: string;
  /**
   * Game invitations only: which game, and which row to answer.
   *
   * The id is what the menu's `[ ACCEPT ]` opens (`/games?invite=<id>`) and what the two clients
   * name their match channel after, so the invitation is answered and joined in one step. Null on a
   * tag or a reply, where the post is the destination instead.
   */
  gameId: GameId | null;
  inviteId: string | null;
  createdAt: string;
  /** Null until the recipient has seen it: that is what the unread dot is. */
  readAt: string | null;
};

/** One account to notify, and why. */
export type NotifyTarget = {
  userId: string;
  kind: NotificationKind;
};

export type NotifyInput = {
  /** The account doing the tagging or the replying; never notified about its own words. */
  actorId: string | null;
  actorName: string;
  threadId: string;
  threadTitle: string;
  /** The post or reply itself; the store keeps a snippet of it. */
  body: string;
  targets: NotifyTarget[];
  /** Game invitations only: see AppNotification.gameId / .inviteId. */
  gameId?: GameId | null;
  inviteId?: string | null;
};

/**
 * Storage contract for the notification feed.
 *
 * Supabase swap-in plan (the table is section 17 of `supabase/schema.sql`):
 *   `list`        -> `select * from forum_notifications where user_id = $1 order by created_at desc`
 *   `notify`      -> `insert into forum_notifications (user_id, kind, actor_id, ...)`, one row per
 *                    target, which the policy only allows signed by the actor themselves
 *   `markRead`    -> `update forum_notifications set read_at = now() where id = $1`
 *   `markAllRead` -> `update ... set read_at = now() where user_id = $1 and read_at is null`
 *   `subscribe`   -> `supabase.channel('forum_notifications').on('postgres_changes', ...)`
 * RLS: a row is readable, updatable and deletable only by the account it names
 * (`auth.uid() = user_id`), while an insert is allowed for any signed-in, unbanned account as
 * long as it is signed by its author (`actor_id = auth.uid()`) and is not addressed to them.
 *
 * Which is why `notify` hands nothing back. A notification is addressed to somebody else, so the
 * account that files it may not read it: asking PostgREST for the row it has just written
 * (`insert(...).select()` - `Prefer: return=representation`) makes it read a row the read policy
 * refuses, and the whole write is then reported as `new row violates row-level security policy`,
 * with no row filed at all. The write is made without a return for that reason; the recipient's
 * own bell is what shows it, over the realtime subscription or the next poll.
 */
export type NotificationsRepository = {
  readonly source: NotificationsDataSource;
  /** The signed-in account's feed, newest first. */
  list(userId: string): Promise<AppNotification[]>;
  /** Files one row per target; the actor is skipped, so nobody is told what they wrote. */
  notify(input: NotifyInput): Promise<void>;
  /** Marks one notification as seen. */
  markRead(userId: string, id: string): Promise<void>;
  /** Marks the whole feed as seen; the menu's [ MARK ALL READ ]. */
  markAllRead(userId: string): Promise<void>;
  /** Realtime hook: fires with the account's fresh feed whenever it moves. */
  subscribe(userId: string, listener: (items: AppNotification[]) => void): () => void;
  /** Mock-only helper so a local feed can be purged. */
  clearLocalNotifications?(): Promise<void>;
};
