import { MAX_MESSAGE_LENGTH } from './types';
import type { CommsMessage, CommsThread } from './types';

/**
 * Conversation rules, as data.
 *
 * The thread id is derived from the pair of accounts rather than handed out by
 * the store, so both sides compute the same id with no lookup and "message this
 * account" can never open a second conversation by accident.
 */
export function threadIdFor(a: string, b: string): string {
  const [low, high] = a <= b ? [a, b] : [b, a];
  return `dm:${low}|${high}`;
}

export function isThreadId(value: string): boolean {
  return value.startsWith('dm:') && value.includes('|');
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
