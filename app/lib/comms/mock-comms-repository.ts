import { createLocalId } from '../forum/ids';
import { lastMessage, sortThreadsNewestFirst, threadIdFor, validateMessage } from './threads';
import type { CommsMessage, CommsRepository, CommsThread, SendMessageInput } from './types';

/**
 * Comms storage used while Supabase is not wired up.
 *
 * Everything lives in localStorage next to the board's rows and the profiles, so
 * a conversation survives navigation and reloads. `subscribe` mimics the Supabase
 * channel: every write pushes a fresh snapshot to all listeners.
 *
 * Two honest limits, both of which Supabase Realtime removes:
 *
 *   1. this store is per browser, so two accounts only ever talk to each other
 *      here if they are both accounts of this browser, one signed in at a time;
 *   2. only the tab that wrote hears about it - a second tab sees the change on
 *      its next read.
 *
 * `listThreads` filters to the signed-in account, which is the same rule the RLS
 * policies enforce on the real thing.
 */

const STORAGE_KEY = 'debaser.comms.mock.v1';
const STORAGE_VERSION = 1;

type PersistedState = {
  version: number;
  threads: CommsThread[];
};

type Listener = (threads: CommsThread[]) => void;

let state: CommsThread[] | null = null;
const listeners = new Set<Listener>();

function hasStorage(): boolean {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

function isMessageShaped(value: unknown): value is CommsMessage {
  if (typeof value !== 'object' || value === null) return false;
  const row = value as Partial<CommsMessage>;

  return (
    typeof row.id === 'string' &&
    typeof row.threadId === 'string' &&
    typeof row.authorId === 'string' &&
    typeof row.body === 'string' &&
    typeof row.createdAt === 'string'
  );
}

function isThreadShaped(value: unknown): value is CommsThread {
  if (typeof value !== 'object' || value === null) return false;
  const row = value as Partial<CommsThread>;

  return (
    typeof row.id === 'string' &&
    Array.isArray(row.participants) &&
    row.participants.length === 2 &&
    typeof row.createdAt === 'string' &&
    typeof row.updatedAt === 'string' &&
    Array.isArray(row.messages)
  );
}

/** Defensive read: an older or hand-edited payload still loads. */
function loadThreads(): CommsThread[] {
  if (!hasStorage()) return [];

  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (raw === null || raw.length === 0) return [];

  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return [];

    const candidate = parsed as Partial<PersistedState>;
    if (!Array.isArray(candidate.threads)) return [];

    return candidate.threads.filter(isThreadShaped).map((thread) => ({
      ...thread,
      participants: thread.participants.map(String),
      messages: thread.messages.filter(isMessageShaped),
      readAt: typeof thread.readAt === 'object' && thread.readAt !== null ? thread.readAt : {},
    }));
  } catch {
    return [];
  }
}

function ensureState(): CommsThread[] {
  if (state === null) state = loadThreads();
  return state;
}

function snapshot(): CommsThread[] {
  return sortThreadsNewestFirst(ensureState());
}

function persist(): void {
  if (!hasStorage()) return;

  const payload: PersistedState = { version: STORAGE_VERSION, threads: ensureState() };

  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // Storage disabled or full: comms keeps working in memory.
  }
}

function notify(): void {
  const all = snapshot();
  for (const listener of listeners) listener(all);
}

function commit(threads: CommsThread[]): void {
  state = threads;
  persist();
  notify();
}


class MockCommsRepository implements CommsRepository {
  readonly source = 'mock' as const;

  async listThreads(userId: string): Promise<CommsThread[]> {
    return snapshot().filter((thread) => thread.participants.includes(userId));
  }

  async openThread(userId: string, otherId: string): Promise<CommsThread> {
    if (userId === otherId) throw new Error('AN ACCOUNT CANNOT MESSAGE ITSELF.');

    const threads = ensureState();
    const id = threadIdFor(userId, otherId);
    const existing = threads.find((thread) => thread.id === id);
    if (existing !== undefined) return existing;

    const createdAt = new Date().toISOString();
    const thread: CommsThread = {
      id,
      participants: [userId, otherId].sort(),
      createdAt,
      updatedAt: createdAt,
      messages: [],
      // An empty conversation has been "read" by both sides by definition.
      readAt: { [userId]: createdAt, [otherId]: createdAt },
    };

    commit([...threads, thread]);
    return thread;
  }

  async sendMessage(input: SendMessageInput): Promise<CommsThread> {
    const problem = validateMessage(input.body);
    if (problem !== undefined) throw new Error(problem);

    const thread = await this.openThread(input.authorId, input.recipientId);
    const createdAt = new Date().toISOString();
    const message: CommsMessage = {
      id: createLocalId('message'),
      threadId: thread.id,
      authorId: input.authorId,
      authorName: input.authorName,
      body: input.body.trim(),
      createdAt,
    };

    const next: CommsThread = {
      ...thread,
      messages: [...thread.messages, message],
      updatedAt: createdAt,
      // Writing is reading: the sender's own marker moves with the message.
      readAt: { ...thread.readAt, [input.authorId]: createdAt },
    };

    commit(ensureState().map((item) => (item.id === thread.id ? next : item)));
    return next;
  }

  async markRead(userId: string, threadId: string): Promise<CommsThread> {
    const threads = ensureState();
    const thread = threads.find((item) => item.id === threadId);
    if (thread === undefined) throw new Error('THAT CONVERSATION IS NOT HERE YET.');

    const stamp = lastMessage(thread)?.createdAt ?? thread.createdAt;
    // Already read: no write, so this can never loop through the subscription.
    if (thread.readAt[userId] === stamp) return thread;

    const next: CommsThread = { ...thread, readAt: { ...thread.readAt, [userId]: stamp } };
    commit(threads.map((item) => (item.id === threadId ? next : item)));
    return next;
  }

  subscribe(listener: Listener): () => void {
    listeners.add(listener);

    return () => {
      listeners.delete(listener);
    };
  }

  async clearLocalThreads(): Promise<void> {
    if (hasStorage()) {
      try {
        window.localStorage.removeItem(STORAGE_KEY);
      } catch {
        // Nothing to clean up.
      }
    }

    state = [];
    notify();
  }
}

let mockCommsRepository: MockCommsRepository | null = null;

export function getMockCommsRepository(): CommsRepository {
  if (mockCommsRepository === null) mockCommsRepository = new MockCommsRepository();
  return mockCommsRepository;
}
