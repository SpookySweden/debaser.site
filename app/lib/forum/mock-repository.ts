import { AUTO_FILED_BODY, autoThreadTitle } from './anchors';
import { createLocalId } from './ids';
import { SEED_THREADS } from './seed';
import { deriveTags } from './tags';
import type {
  AddCommentResult,
  CreateCommentInput,
  CreateThreadInput,
  ForumAnchor,
  ForumAuthor,
  ForumComment,
  ForumRepository,
  ForumThread,
} from './types';

/**
 * In-memory / localStorage repository used while Supabase is not wired up.
 *
 * - Seeded threads ship with the bundle and are read-only reference posts.
 * - Anything filed in the browser is tagged `origin: 'user'` and persisted to
 *   localStorage, so a post made under an asset on the home page still shows up
 *   on /forum after navigation or a reload.
 * - `subscribe` mimics Supabase Realtime: every mutation pushes a fresh
 *   snapshot to all listeners, which is what keeps several comment boxes on one
 *   page in sync.
 */

const STORAGE_KEY = 'debaser.forum.ugc.v1';
const STORAGE_VERSION = 1;

type PersistedState = {
  version: number;
  /** Threads filed in the browser, comments included. */
  threads: ForumThread[];
  /** Comments added on top of the shipped seed threads. */
  seedComments: ForumComment[];
};

type Listener = (threads: ForumThread[]) => void;

const SEED_COMMENT_IDS = new Set(SEED_THREADS.flatMap((thread) => thread.comments.map((comment) => comment.id)));

let state: ForumThread[] | null = null;
const listeners = new Set<Listener>();

function hasStorage(): boolean {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

function isThreadShaped(value: unknown): value is ForumThread {
  if (typeof value !== 'object' || value === null) return false;
  const row = value as Partial<ForumThread>;
  return (
    typeof row.id === 'string' &&
    typeof row.title === 'string' &&
    typeof row.body === 'string' &&
    typeof row.createdAt === 'string' &&
    typeof row.anchor === 'object' &&
    row.anchor !== null &&
    Array.isArray(row.comments)
  );
}

function isCommentShaped(value: unknown): value is ForumComment {
  if (typeof value !== 'object' || value === null) return false;
  const row = value as Partial<ForumComment>;
  return (
    typeof row.id === 'string' &&
    typeof row.threadId === 'string' &&
    typeof row.body === 'string' &&
    typeof row.createdAt === 'string'
  );
}

function readPersisted(): PersistedState | null {
  if (!hasStorage()) return null;

  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (raw === null || raw.length === 0) return null;

  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return null;

    const candidate = parsed as Partial<PersistedState>;
    return {
      version: STORAGE_VERSION,
      threads: Array.isArray(candidate.threads) ? candidate.threads.filter(isThreadShaped) : [],
      seedComments: Array.isArray(candidate.seedComments) ? candidate.seedComments.filter(isCommentShaped) : [],
    };
  } catch {
    return null;
  }
}

function cloneSeedThreads(): ForumThread[] {
  return SEED_THREADS.map((thread) => ({
    ...thread,
    author: { ...thread.author },
    anchor: { ...thread.anchor },
    tags: [...thread.tags],
    comments: thread.comments.map((comment) => ({ ...comment, tags: [...comment.tags] })),
  }));
}

function loadThreads(): ForumThread[] {
  const persisted = readPersisted();
  const seeded = cloneSeedThreads();

  if (persisted === null) return seeded;

  const hydratedSeeds = seeded.map((thread) => {
    const extra = persisted.seedComments.filter((comment) => comment.threadId === thread.id);
    return extra.length > 0 ? { ...thread, comments: [...thread.comments, ...extra] } : thread;
  });

  return [...persisted.threads, ...hydratedSeeds];
}

function ensureState(): ForumThread[] {
  if (state === null) state = loadThreads();
  return state;
}

function sortNewestFirst(threads: ForumThread[]): ForumThread[] {
  return [...threads].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}

function snapshot(): ForumThread[] {
  return sortNewestFirst(ensureState());
}

function persist(): void {
  if (!hasStorage()) return;

  const current = ensureState();
  const payload: PersistedState = {
    version: STORAGE_VERSION,
    threads: current.filter((thread) => thread.origin === 'user'),
    seedComments: current
      .filter((thread) => thread.origin === 'seed')
      .flatMap((thread) => thread.comments.filter((comment) => !SEED_COMMENT_IDS.has(comment.id))),
  };

  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // Storage disabled or full: the board keeps working in memory.
  }
}

function notify(): void {
  const next = snapshot();
  for (const listener of listeners) listener(next);
}

function commit(next: ForumThread[]): void {
  state = next;
  persist();
  notify();
}

function findThreadByAnchor(threads: ForumThread[], anchor: ForumAnchor): ForumThread | undefined {
  return threads.find((thread) => thread.anchor.kind === anchor.kind && thread.anchor.id === anchor.id);
}

function makeComment(thread: ForumThread, body: string, author: ForumAuthor, createdAt: string): ForumComment {
  return {
    id: createLocalId('comment'),
    threadId: thread.id,
    body,
    author: { ...author },
    createdAt,
    tags: deriveTags({ text: body, anchor: thread.anchor, maxTags: 3 }),
  };
}

class MockForumRepository implements ForumRepository {
  readonly source = 'mock' as const;

  async listThreads(): Promise<ForumThread[]> {
    return snapshot();
  }

  async createThread(input: CreateThreadInput): Promise<ForumThread> {
    const thread: ForumThread = {
      id: createLocalId('thread'),
      title: input.title,
      body: input.body,
      author: { ...input.author },
      createdAt: new Date().toISOString(),
      anchor: { ...input.anchor },
      tags: deriveTags({ text: `${input.title}\n${input.body}`, anchor: input.anchor }),
      comments: [],
      origin: 'user',
    };

    commit([thread, ...ensureState()]);
    return thread;
  }

  async addComment(input: CreateCommentInput): Promise<AddCommentResult> {
    const threads = ensureState();
    const body = input.body.trim();
    const author = { ...input.author };
    const createdAt = new Date().toISOString();

    const existing =
      input.threadId !== undefined
        ? threads.find((thread) => thread.id === input.threadId)
        : input.anchor !== undefined
          ? findThreadByAnchor(threads, input.anchor)
          : undefined;

    if (existing !== undefined) {
      const comment = makeComment(existing, body, author, createdAt);
      const nextThread: ForumThread = { ...existing, comments: [...existing.comments, comment] };
      commit(threads.map((thread) => (thread.id === existing.id ? nextThread : thread)));
      return { thread: nextThread, comment, createdThread: false };
    }

    if (input.anchor === undefined) {
      throw new Error('addComment needs either a threadId or an anchor.');
    }

    const anchor = input.anchor;
    const title = autoThreadTitle(anchor);
    const draft: ForumThread = {
      id: createLocalId('thread'),
      title,
      body: AUTO_FILED_BODY,
      author,
      createdAt,
      anchor: { ...anchor },
      tags: deriveTags({ text: `${title}\n${AUTO_FILED_BODY}\n${body}`, anchor }),
      comments: [],
      origin: 'user',
    };

    const comment = makeComment(draft, body, author, createdAt);
    const nextThread: ForumThread = { ...draft, comments: [comment] };

    commit([nextThread, ...threads]);
    return { thread: nextThread, comment, createdThread: true };
  }

  subscribe(listener: Listener): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }

  async clearLocalPosts(): Promise<void> {
    if (hasStorage()) {
      try {
        window.localStorage.removeItem(STORAGE_KEY);
      } catch {
        // Nothing to clean up.
      }
    }

    state = cloneSeedThreads();
    notify();
  }
}

let mockRepository: MockForumRepository | null = null;

export function getMockForumRepository(): ForumRepository {
  if (mockRepository === null) mockRepository = new MockForumRepository();
  return mockRepository;
}
