'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { getAuthRepository } from '../lib/auth/auth-repository';
import type { AccountUser } from '../lib/auth/types';
import { COMMS_DATA_SOURCE, getCommsRepository } from '../lib/comms/repository';
import { sortThreadsNewestFirst, unreadCount } from '../lib/comms/threads';
import type { CommsThread } from '../lib/comms/types';
import { formatStamp } from '../lib/forum/format';
import { useAuth } from './AuthProvider';

export type CommsContextValue = {
  /** False until the read lands. */
  ready: boolean;
  /** Null while nobody is signed in: comms is an accounts-only place. */
  userId: string | null;
  /** Conversations this account is in, liveliest first. */
  threads: CommsThread[];
  /** Messages waiting across every conversation, for the nav badge. */
  unreadTotal: number;
  /** Every account this browser can see, for the "new message" picker. */
  accounts: AccountUser[];
  /**
   * False until the account list has been read.
   *
   * Separate from `ready`, which follows the signed-in account's conversations and
   * so stays false for a visitor who is not signed in - the users page lists
   * accounts for guests too, and needs to know when that read is done.
   */
  accountsReady: boolean;
  /** id -> display name, so a message can be signed with a live name. */
  nameById: Map<string, string>;
  /** The conversation on screen, if any. */
  activeThreadId: string | null;
  setActiveThreadId: (threadId: string | null) => void;
  openThreadWith: (otherId: string) => Promise<CommsThread>;
  send: (otherId: string, body: string) => Promise<void>;
  markRead: (threadId: string) => Promise<void>;
  /** Mock-only: file a message from the other side, to see the pop-up work. */
  simulateIncoming: (otherId: string, body: string) => Promise<CommsThread>;
  source: typeof COMMS_DATA_SOURCE;
};

const CommsContext = createContext<CommsContextValue | null>(null);

/**
 * Conversations for the signed-in account, for the whole site.
 *
 * Mounted in `app/layout.tsx` under the auth provider, so the console, the nav's
 * unread badge and the notification window all read the same list. Every write
 * broadcasts the store, so one subscription covers every conversation; the filter
 * to `participants.includes(userId)` is the mock's stand-in for the RLS rule that
 * keeps a thread visible only to its two accounts.
 */
export default function CommsProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const repository = useMemo(() => getCommsRepository(), []);

  const [mine, setMine] = useState<CommsThread[]>([]);
  const [ready, setReady] = useState(false);
  const [accounts, setAccounts] = useState<AccountUser[]>([]);
  const [accountsReady, setAccountsReady] = useState(false);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);

  useEffect(() => {
    if (userId === null) return;

    let cancelled = false;
    const apply = (threads: CommsThread[]) => {
      if (cancelled) return;
      setMine(threads);
      setReady(true);
    };

    const unsubscribe = repository.subscribe((snapshot) =>
      apply(snapshot.filter((thread) => thread.participants.includes(userId))),
    );

    repository
      .listThreads(userId)
      .then(apply)
      .catch(() => {
        if (!cancelled) setReady(true);
      });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [repository, userId]);

  // The picker's names: the accounts this browser can see. Re-read when the
  // signed-in account changes, which is also when a new account is created.
  useEffect(() => {
    const auth = getAuthRepository();
    if (auth.listAccounts === undefined) return;

    let cancelled = false;

    auth
      .listAccounts()
      .then((next) => {
        if (cancelled) return;
        setAccounts(next);
        setAccountsReady(true);
      })
      .catch(() => {
        if (!cancelled) setAccountsReady(true);
      });

    return () => {
      cancelled = true;
    };
  }, [user]);

  // Derived rather than stored, so signing out empties the list with no write.
  const mineForUser = useMemo(
    () => (userId === null ? [] : mine.filter((thread) => thread.participants.includes(userId))),
    [mine, userId],
  );
  const threads = useMemo(() => sortThreadsNewestFirst(mineForUser), [mineForUser]);
  const nameById = useMemo(() => new Map(accounts.map((account) => [account.id, account.displayName])), [accounts]);
  const unreadTotal = useMemo(
    () => (userId === null ? 0 : threads.reduce((total, thread) => total + unreadCount(thread, userId), 0)),
    [threads, userId],
  );


  const openThreadWith = useCallback(
    async (otherId: string) => {
      if (userId === null) throw new Error('SIGN IN TO SEND MESSAGES.');

      const thread = await repository.openThread(userId, otherId);
      setActiveThreadId(thread.id);
      return thread;
    },
    [repository, userId],
  );

  const send = useCallback(
    async (otherId: string, body: string) => {
      if (userId === null) throw new Error('SIGN IN TO SEND MESSAGES.');

      await repository.sendMessage({
        authorId: userId,
        recipientId: otherId,
        authorName: user?.displayName ?? 'Anonymous',
        body,
      });
    },
    [repository, user, userId],
  );

  const markRead = useCallback(
    async (threadId: string) => {
      if (userId === null) return;

      try {
        await repository.markRead(userId, threadId);
      } catch {
        // The conversation is gone: nothing to mark.
      }
    },
    [repository, userId],
  );

  /**
   * Mock-only test aid.
   *
   * A second browser is the only honest way to receive a message today, so this
   * files one from the other side through the very same `sendMessage` call that
   * browser would make - which means the notification pop-up, the mobile hop to
   * /comms and the unread badge are all exercised without a special code path.
   */
  const simulateIncoming = useCallback(
    async (otherId: string, body: string) => {
      if (userId === null) throw new Error('SIGN IN FIRST.');

      const name = nameById.get(otherId) ?? otherId;
      const text = body.trim().length === 0 ? `TEST MESSAGE :: ${formatStamp(new Date().toISOString())}` : body.trim();

      return repository.sendMessage({ authorId: otherId, recipientId: userId, authorName: name, body: text });
    },
    [nameById, repository, userId],
  );

  const value = useMemo<CommsContextValue>(
    () => ({
      ready,
      userId,
      threads,
      unreadTotal,
      accounts,
      accountsReady,
      nameById,
      activeThreadId,
      setActiveThreadId,
      openThreadWith,
      send,
      markRead,
      simulateIncoming,
      source: COMMS_DATA_SOURCE,
    }),
    [
      ready,
      userId,
      threads,
      unreadTotal,
      accounts,
      accountsReady,
      nameById,
      activeThreadId,
      openThreadWith,
      send,
      markRead,
      simulateIncoming,
    ],
  );

  return <CommsContext.Provider value={value}>{children}</CommsContext.Provider>;
}

export function useComms(): CommsContextValue {
  const value = useContext(CommsContext);
  if (value === null) throw new Error('useComms must be used inside <CommsProvider>.');
  return value;
}
