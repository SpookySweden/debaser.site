'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { getAuthRepository } from '../lib/auth/auth-repository';
import type { AccountUser } from '../lib/auth/types';
import { COMMS_DATA_SOURCE, getCommsRepository } from '../lib/comms/repository';
import { COMMS_POLL_MS, sortThreadsNewestFirst, unreadCount } from '../lib/comms/threads';
import type { CommsEvent, CommsThread } from '../lib/comms/types';
import { commsEventBody } from '../lib/games/events';
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
  /**
   * What the store said when a read failed, in its own words, or null while it is
   * answering. A comms screen that cannot read has to say so: an empty conversation
   * list looks exactly like an account with no conversations, and they are not the
   * same thing at all.
   */
  error: string | null;
  /** Asks the store again after a failure (`[ RETRY ]` on the console). */
  retry: () => void;
  /** The conversation on screen, if any. */
  activeThreadId: string | null;
  setActiveThreadId: (threadId: string | null) => void;
  openThreadWith: (otherId: string) => Promise<CommsThread>;
  /** Opens a group with those accounts in it, and makes it the open conversation. */
  createGroup: (name: string, memberIds: string[]) => Promise<CommsThread>;
  /** Adds an account to a group. Anybody in it may, which is the RLS rule. */
  addMember: (threadId: string, userId: string) => Promise<CommsThread>;
  /**
   * The owner's four. A group belongs to whoever opened it: renaming, handing it on and taking
   * a member out are theirs alone; anybody may leave, and an owner who leaves passes the group
   * on. The database is what enforces it (`supabase/migrations/20260922000016_group_ownership.sql`);
   * these are how the screen asks.
   */
  renameGroup: (threadId: string, name: string) => Promise<CommsThread>;
  transferGroupOwnership: (threadId: string, toUserId: string) => Promise<CommsThread>;
  removeMember: (threadId: string, memberId: string) => Promise<CommsThread>;
  leaveGroup: (threadId: string) => Promise<CommsThread | null>;
  send: (otherId: string, body: string) => Promise<void>;
  /** Writes to a conversation that already exists - which is how a group is written to. */
  sendToThread: (threadId: string, body: string) => Promise<void>;
  /**
   * Files a game event into the DM with that account.
   *
   * A challenge is news between two accounts, so it is written as a *message* in the conversation they
   * already have - same ordering, same read markers, same realtime - rather than into a table of its
   * own that only the arcade would ever read. The body is written by the event's own module
   * (`lib/games/events.ts`), so this store and the screen cannot disagree about what the line says, and
   * the two stores (mock and Supabase) file the same words.
   *
   * Errors are swallowed after a warning, deliberately: a challenge that was filed in the arcade but
   * whose record did not land is a conversation missing a line, and failing here would report it as a
   * challenge that was never sent - which would be false, and worse.
   */
  recordGameEvent: (input: { withUserId: string; event: CommsEvent }) => Promise<void>;
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
  const [error, setError] = useState<string | null>(null);
  const [accounts, setAccounts] = useState<AccountUser[]>([]);
  const [accountsReady, setAccountsReady] = useState(false);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  /** Bumped by `retry`: every read below runs again when it changes. */
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (userId === null) return;

    let cancelled = false;
    const apply = (threads: CommsThread[]) => {
      if (cancelled) return;
      setMine(threads);
      setError(null);
      setReady(true);
    };

    const unsubscribe = repository.subscribe((snapshot) =>
      apply(snapshot.filter((thread) => thread.participants.includes(userId))),
    );

    repository
      .listThreads(userId)
      .then(apply)
      .catch((caught: unknown) => {
        if (cancelled) return;
        // Kept, not swallowed: the console prints it and offers `[ RETRY ]`.
        setError(caught instanceof Error ? caught.message : 'THE COMMS STORE DID NOT ANSWER.');
        setReady(true);
      });

    // And the same read on a timer, so a message arrives even when no event does: a
    // blocked socket, or a project whose realtime channel is quiet (a table missing from
    // the publication - see the note on `openChannel`). A poll that fails leaves what is
    // on screen alone rather than flashing an error over a working page.
    const poll = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      void repository.listThreads(userId).then(apply).catch(() => undefined);
    }, COMMS_POLL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(poll);
      unsubscribe();
    };
  }, [attempt, repository, userId]);

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
  }, [attempt, user]);

  /** The console's `[ RETRY ]`: run the reads above again, once the store is back. */
  const retry = useCallback(() => setAttempt((current) => current + 1), []);

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

  const createGroup = useCallback(
    async (name: string, memberIds: string[]) => {
      if (userId === null) throw new Error('SIGN IN TO OPEN A GROUP.');

      const thread = await repository.createGroup({
        creatorId: userId,
        creatorName: user?.displayName ?? 'Anonymous',
        name,
        memberIds,
      });

      setActiveThreadId(thread.id);
      return thread;
    },
    [repository, user, userId],
  );

  const addMember = useCallback(
    async (threadId: string, memberId: string) => {
      if (userId === null) throw new Error('SIGN IN TO ADD ANYBODY.');

      // `userId` is passed so the browser store can apply the same rule the database does:
      // adding somebody else is anybody's, adding yourself is the group's opener's.
      return repository.addMember(threadId, memberId, userId);
    },
    [repository, userId],
  );

  /**
   * The owner's four, through the store.
   *
   * Each one hands the account asking to the store as well: the project decides that from the
   * session, and the in-browser store has no session to decide it from. Nothing here checks
   * whether the caller owns the group - the screen does not draw the controls for anybody else,
   * and the database refuses the write if it is tried anyway.
   */
  const renameGroup = useCallback(
    async (threadId: string, name: string) => {
      if (userId === null) throw new Error('SIGN IN TO RENAME A GROUP.');

      return repository.renameGroup(threadId, name, userId);
    },
    [repository, userId],
  );

  const transferGroupOwnership = useCallback(
    async (threadId: string, toUserId: string) => {
      if (userId === null) throw new Error('SIGN IN TO HAND A GROUP OVER.');

      return repository.transferGroupOwnership(threadId, toUserId, userId);
    },
    [repository, userId],
  );

  const removeMember = useCallback(
    async (threadId: string, memberId: string) => {
      if (userId === null) throw new Error('SIGN IN TO CHANGE A GROUP.');

      return repository.removeMember(threadId, memberId, userId);
    },
    [repository, userId],
  );

  const leaveGroup = useCallback(
    async (threadId: string) => {
      if (userId === null) throw new Error('SIGN IN TO LEAVE A GROUP.');

      const thread = await repository.leaveGroup(threadId, userId);
      if (thread === null) setActiveThreadId(null);

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

  /** The same write, addressed to a conversation instead of to an account. */
  const sendToThread = useCallback(
    async (threadId: string, body: string) => {
      if (userId === null) throw new Error('SIGN IN TO SEND MESSAGES.');

      await repository.sendMessage({
        authorId: userId,
        threadId,
        authorName: user?.displayName ?? 'Anonymous',
        body,
      });
    },
    [repository, user, userId],
  );

  /**
   * The conversation's record of a game event.
   *
   * Deliberately quiet: it warns and returns rather than throwing. The caller is mid-press on a
   * challenge that *has* been filed in the arcade, and an error from here would be reported as a
   * challenge that failed - which would be a lie about the one thing that did succeed. A missing line
   * in a conversation is worth a console warning, not a broken button.
   */
  const recordGameEvent = useCallback(
    async ({ withUserId, event }: { withUserId: string; event: CommsEvent }) => {
      if (userId === null) return;

      try {
        await repository.sendMessage({
          authorId: userId,
          recipientId: withUserId,
          authorName: user?.displayName ?? 'Anonymous',
          body: commsEventBody(event.kind, event.gameId),
          event,
        });
      } catch (caught) {
        console.warn('comms: could not record the game event in the conversation', caught);
      }
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
      error,
      retry,
      activeThreadId,
      setActiveThreadId,
      openThreadWith,
      createGroup,
      addMember,
      renameGroup,
      transferGroupOwnership,
      removeMember,
      leaveGroup,
      send,
      sendToThread,
      recordGameEvent,
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
      error,
      retry,
      activeThreadId,
      openThreadWith,
      createGroup,
      addMember,
      renameGroup,
      transferGroupOwnership,
      removeMember,
      leaveGroup,
      send,
      sendToThread,
      recordGameEvent,
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
