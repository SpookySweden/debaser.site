'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { type Mentionable } from '../lib/forum/mentions';
import {
  notificationSummary,
  sortNotificationsNewestFirst,
  unreadNotificationCount,
} from '../lib/notifications/feed';
import { NOTIFICATIONS_DATA_SOURCE, getNotificationsRepository } from '../lib/notifications/repository';
import type { AppNotification, NotifyTarget } from '../lib/notifications/types';
import { NOTIFICATIONS_POLL_MS } from '../lib/notifications/types';
import type { GameId } from '../lib/games/types';
import { useAuth } from './AuthProvider';

export type NotificationsContextValue = {
  /** False until the first read lands. */
  ready: boolean;
  /** Null while nobody is signed in: only an account can be told anything. */
  userId: string | null;
  /** The account's feed, newest first. */
  items: AppNotification[];
  /** How many of them are still unseen - the dot on the bell. */
  unread: number;
  /** What the bell says out loud: `3 NEW`, `NOTHING NEW`, `NO NOTIFICATIONS`. */
  summary: string;
  /** Null while the store is answering; the store's own words when it will not. */
  error: string | null;
  retry: () => void;
  /** Marks one as seen; opening a notification is what does it. */
  markRead: (id: string) => Promise<void>;
  /** Marks the whole feed as seen. */
  markAllRead: () => Promise<void>;
  /**
   * Files the tags a post carries, and tells whoever it answers.
   *
   * Never rejects: a post that filed successfully must not be reported as failed because its
   * tag could not be delivered. A feed that cannot be written says so on the bell instead.
   */
  notifyTagged: (input: {
    threadId: string;
    threadTitle: string;
    body: string;
    /** The accounts the words name with `@`. */
    mentions: Mentionable[];
    /** The author this post answers, if it answers one: told as a reply, not as a tag. */
    autoTagId?: string | null;
  }) => Promise<void>;
  /**
   * Files a game invitation for the account it names.
   *
   * The arcade writes the invitation itself (`lib/games`); this is the bell's half, so the challenge
   * and the alert are one press apart. Never rejects, for the same reason `notifyTagged` never does.
   */
  notifyInvited: (input: {
    inviteId: string;
    gameId: GameId;
    /** The game's own title, which is what the menu names in place of a thread. */
    gameTitle: string;
    body: string;
    toUserId: string;
  }) => Promise<void>;
  source: typeof NOTIFICATIONS_DATA_SOURCE;
};

const NotificationsContext = createContext<NotificationsContextValue | null>(null);

/**
 * Tags and replies for the signed-in account, for the whole site.
 *
 * Mounted in `app/layout.tsx` beside the comms provider, so the bell at the top of the side
 * panel, the pop-up menu and the composers all read the same feed and the same unread count.
 * The composers are what *write* to it: filing a post or a reply calls `notifyTagged`, which is
 * where a tag chosen in the mention picker and a reply to somebody's post become the same kind
 * of row.
 */
export default function NotificationsProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const repository = useMemo(() => getNotificationsRepository(), []);

  const [items, setItems] = useState<AppNotification[]>([]);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Bumped by `retry`: every read below runs again when it changes. */
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (userId === null) return;

    let cancelled = false;
    const apply = (feed: AppNotification[]) => {
      if (cancelled) return;
      setItems(sortNotificationsNewestFirst(feed));
      setError(null);
      setReady(true);
    };

    const unsubscribe = repository.subscribe(userId, apply);

    repository
      .list(userId)
      .then(apply)
      .catch((caught: unknown) => {
        if (cancelled) return;
        // Kept, not swallowed: the menu prints it, because an empty feed and a feed nobody
        // could read look the same and they are not the same at all.
        setError(caught instanceof Error ? caught.message : 'THE NOTIFICATION STORE DID NOT ANSWER.');
        setReady(true);
      });

    // The same read on a timer, so a tag still arrives when no event does: a blocked socket, or
    // a table missing from the realtime publication. A failed poll leaves what is on screen alone.
    const poll = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      void repository.list(userId).then(apply).catch(() => undefined);
    }, NOTIFICATIONS_POLL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(poll);
      unsubscribe();
    };
  }, [attempt, repository, userId]);

  const retry = useCallback(() => setAttempt((current) => current + 1), []);

  const markRead = useCallback(
    async (id: string) => {
      if (userId === null) return;

      const readAt = new Date().toISOString();
      setItems((current) =>
        current.map((item) => (item.id === id && item.readAt === null ? { ...item, readAt } : item)),
      );

      try {
        await repository.markRead(userId, id);
      } catch (caught: unknown) {
        setError(caught instanceof Error ? caught.message : 'THE NOTIFICATION STORE DID NOT ANSWER.');
      }
    },
    [repository, userId],
  );

  const markAllRead = useCallback(async () => {
    if (userId === null) return;

    const readAt = new Date().toISOString();
    setItems((current) => current.map((item) => (item.readAt === null ? { ...item, readAt } : item)));

    try {
      await repository.markAllRead(userId);
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : 'THE NOTIFICATION STORE DID NOT ANSWER.');
    }
  }, [repository, userId]);

  const notifyTagged = useCallback<NotificationsContextValue['notifyTagged']>(
    async ({ threadId, threadTitle, body, mentions, autoTagId = null }) => {
      if (user === null) return;

      const targets: NotifyTarget[] = [
        ...mentions
          .filter((account): account is Mentionable & { id: string } => account.id !== null)
          .map((account) => ({ userId: account.id, kind: 'tag' as const })),
        ...(autoTagId === null ? [] : [{ userId: autoTagId, kind: 'reply' as const }]),
      ];

      // Nobody is told about their own words, and nothing is written for an empty list.
      if (targets.length === 0) return;

      try {
        await repository.notify({
          actorId: user.id,
          actorName: user.displayName,
          threadId,
          threadTitle,
          body,
          targets,
        });
      } catch (caught: unknown) {
        // The post is filed; only the tag is not. Said on the bell rather than thrown back at a
        // writer whose post went through.
        console.warn('notification feed: could not file a tag', caught);
        setError(caught instanceof Error ? caught.message : 'THE NOTIFICATION STORE DID NOT ANSWER.');
      }
    },
    [repository, user],
  );

  /**
   * Files a game invitation for the account it names.
   *
   * The invitation row belongs to the arcade's own store (`lib/games`); this is the bell's half of
   * the same act, so the challenge and the alert are one press apart. A tag and an invitation are the
   * same shape of news - somebody wants something from you - which is why they share the feed and
   * the same unread dot.
   */
  const notifyInvited = useCallback<NotificationsContextValue['notifyInvited']>(
    async ({ inviteId, gameId, gameTitle, body, toUserId }) => {
      if (user === null) return;

      try {
        await repository.notify({
          actorId: user.id,
          actorName: user.displayName,
          // An invitation has no post behind it: the menu names the game instead of a thread.
          threadId: '',
          threadTitle: gameTitle,
          body,
          targets: [{ userId: toUserId, kind: 'invite' }],
          gameId,
          inviteId,
        });
      } catch (caught: unknown) {
        console.warn('notification feed: could not file an invitation', caught);
        setError(caught instanceof Error ? caught.message : 'THE NOTIFICATION STORE DID NOT ANSWER.');
      }
    },
    [repository, user],
  );

  const value = useMemo<NotificationsContextValue>(
    () => ({
      // A visitor with no session has no feed to read, so there is nothing to wait for and
      // nothing in it - said here rather than by clearing state the moment the session ends.
      ready: userId === null ? true : ready,
      userId,
      items: userId === null ? [] : items,
      unread: userId === null ? 0 : unreadNotificationCount(items),
      summary: userId === null ? notificationSummary([]) : notificationSummary(items),
      error,
      retry,
      markRead,
      markAllRead,
      notifyTagged,
      notifyInvited,
      source: NOTIFICATIONS_DATA_SOURCE,
    }),
    [error, items, markAllRead, markRead, notifyTagged, notifyInvited, ready, retry, userId],
  );

  return <NotificationsContext.Provider value={value}>{children}</NotificationsContext.Provider>;
}

export function useNotifications(): NotificationsContextValue {
  const value = useContext(NotificationsContext);
  if (value === null) throw new Error('useNotifications must be used inside <NotificationsProvider>');

  return value;
}
