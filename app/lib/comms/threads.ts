import { MAX_MESSAGE_LENGTH } from './types';
import type { CommsMessage, CommsThread } from './types';

/**
 * Conversation rules, as data.
 *
 * The thread id is derived from the pair of accounts rather than handed out by
 * the store, so both sides compute the same id with no lookup and "message this
 * account" can never open a second conversation by accident.
 */

/**
 * How often an open page asks the store for the conversations again.
 *
 * Realtime is the fast path, not the only one: a socket can be blocked by a network, and
 * a table that is missing from the `supabase_realtime` publication makes a channel quiet
 * without failing (see `openChannel` in ./supabase-comms-repository.ts). A timed read is
 * what makes a message arrive anyway - a few seconds later, and no less real - and it is
 * the same read the channel and every write already make.
 */
export const COMMS_POLL_MS = 15 * 1000;

export function threadIdFor(a: string, b: string): string {
  const [low, high] = a <= b ? [a, b] : [b, a];
  return `dm:${low}|${high}`;
}

/**
 * A group's id.
 *
 * A dm's id can be derived from its pair, which is what makes opening one a lookup;
 * a group has no pair to derive anything from, so its id is minted once, when it is
 * created, and stored on the row. The `grp:` prefix is what tells the two apart
 * without reading the row.
 */
export function groupThreadId(): string {
  const uuid = globalThis.crypto?.randomUUID?.();

  return `grp:${uuid ?? `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`}`;
}

export function isThreadId(value: string): boolean {
  return (value.startsWith('dm:') && value.includes('|')) || value.startsWith('grp:');
}

/**
 * What a conversation is called in a list.
 *
 * A dm is named after the other account. A group is named after itself, with its
 * head count, because how many people are in the room is worth knowing at a glance -
 * the member list itself is one click away on the thread.
 */
export function threadLabel(thread: CommsThread, viewerId: string, nameFor: (userId: string) => string): string {
  if (thread.kind === 'group') {
    const name = thread.name.trim();

    return `${name.length === 0 ? 'GROUP' : name.toUpperCase()} [ ${thread.participants.length} ]`;
  }

  return nameFor(otherParticipant(thread, viewerId));
}

/** The account on the other side of a conversation. */
export function otherParticipant(thread: CommsThread, userId: string): string {
  return thread.participants.find((id) => id !== userId) ?? userId;
}

export function lastMessage(thread: CommsThread): CommsMessage | undefined {
  return thread.messages[thread.messages.length - 1];
}

/**
 * How many messages that account has not seen.
 *
 * Only messages from the other side count: your own writing is never "unread",
 * even before you have reloaded the page.
 */
export function unreadCount(thread: CommsThread, userId: string): number {
  const since = thread.readAt[userId];
  const sinceTime = since === undefined ? Number.NEGATIVE_INFINITY : Date.parse(since);

  return thread.messages.filter(
    (message) => message.authorId !== userId && (Number.isNaN(sinceTime) || Date.parse(message.createdAt) > sinceTime),
  ).length;
}

/** Conversations with the liveliest first, so the list reads like a chat client. */
export function sortThreadsNewestFirst(threads: CommsThread[]): CommsThread[] {
  return [...threads].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
}

/**
 * The conversations holding a message that account has not been told about yet.
 *
 * This is the rule behind the notification: it is pure so the pop-up's behaviour
 * can be reasoned about on its own, and it never counts a message the account
 * wrote itself - sending is not receiving.
 */
export function threadsWithNewMessages(threads: CommsThread[], userId: string, known: Set<string>): CommsThread[] {
  return sortThreadsNewestFirst(
    threads.filter((thread) =>
      thread.messages.some((message) => message.authorId !== userId && !known.has(message.id)),
    ),
  );
}
/**
 * Who owns a group, and what the screen may offer them.
 *
 * A conversation's owner is the account that opened it (`ownerId`). It is the owner's group to
 * name, to hand on, and to take members out of; everybody in it may leave, and an owner who
 * leaves passes it to the next member rather than leaving a group with nobody in charge.
 *
 * These are the *rules the screens read* - what to draw, and what to say when a control is not
 * the caller's to press. The database enforces the same rules where it matters, because a rule
 * that lives only in a component is a rule that anybody with the API key can ignore
 * (`supabase/migrations/20260922_group_ownership.sql`).
 */
export function isGroupOwner(thread: CommsThread, userId: string | null): boolean {
  return userId !== null && thread.kind === 'group' && thread.ownerId === userId;
}

/** True when this account opened the conversation (either kind), which is who may add themselves to it. */
export function openedThread(thread: CommsThread, userId: string | null): boolean {
  return userId !== null && thread.ownerId === userId;
}

/**
 * Who the group belongs to once its owner leaves.
 *
 * The next account in the store's own membership order: `comms_members` is ordered by when
 * each member joined, which is the fair reading of "longest in the group", and the mock keeps
 * its members in a stable sorted order. Null when nobody is left, which is when the group
 * itself goes.
 */
export function nextGroupOwner(participants: string[], leaverId: string): string | null {
  return participants.find((id) => id !== leaverId) ?? null;
}

export function threadWith(threads: CommsThread[], userId: string, otherId: string): CommsThread | undefined {
  const wanted = threadIdFor(userId, otherId);
  return threads.find((thread) => thread.id === wanted);
}

/** The name a message is signed with: the live account name when it is known. */
export function resolveAuthor(
  message: CommsMessage,
  nameById: Map<string, string>,
): { id: string; displayName: string } {
  const live = nameById.get(message.authorId);
  return { id: message.authorId, displayName: live !== undefined && live.length > 0 ? live : message.authorName };
}

export type CommsParticipant = {
  userId: string;
  /** Their name, from the account list when known. */
  displayName: string;
  /** Newest activity in the conversation, for the list row. */
  updatedAt: string;
  preview: string;
  unread: number;
};

/** One row of the conversation list. */
export function participantFromThread(
  thread: CommsThread,
  userId: string,
  nameById: Map<string, string>,
): CommsParticipant {
  const otherId = otherParticipant(thread, userId);
  const newest = lastMessage(thread);

  return {
    userId: otherId,
    displayName: nameById.get(otherId) ?? newest?.authorName ?? otherId,
    updatedAt: thread.updatedAt,
    preview: newest === undefined ? 'NO MESSAGES YET' : newest.body.replace(/\s+/g, ' ').slice(0, 60),
    unread: unreadCount(thread, userId),
  };
}

export function validateMessage(body: string): string | undefined {
  const trimmed = body.trim();
  if (trimmed.length === 0) return 'THE MESSAGE IS EMPTY.';
  if (trimmed.length > MAX_MESSAGE_LENGTH) return `A MESSAGE MUST BE ${MAX_MESSAGE_LENGTH} CHARACTERS OR FEWER.`;
  return undefined;
}
