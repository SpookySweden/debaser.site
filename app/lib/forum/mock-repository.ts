import { AUTO_FILED_BODY, autoThreadTitle } from './anchors';
import { createLocalId } from './ids';
import { canonicalTagLabel, collectTagLabels } from './tag-vocabulary';
import { deriveTags, mergeTags } from './tags';
import type {
  AddCommentResult,
  CreateCommentInput,
  CreateThreadInput,
  ForumAnchor,
  ForumAuthor,
  ForumComment,
  ForumPreview,
  ForumRepository,
  ForumThread,
} from './types';

/**
 * In-memory / localStorage repository used while Supabase is not wired up.
 *
 * The board ships empty: every row here came from someone using the site, is
 * tagged `origin: 'user'` and is persisted to localStorage, so a post made
 * under an asset on the home page still shows up on /forum after navigation or
 * a reload.
 *
 * The storage key is versioned, so anything written by an older,
 * placeholder-seeded build is ignored instead of being resurrected.
 *
 * - `subscribe` mimics Supabase Realtime: every mutation pushes a fresh
 *   snapshot to all listeners, which is what keeps several comment boxes on one
 *   page in sync.
 */

const STORAGE_KEY = 'debaser.forum.ugc.v2';
const STORAGE_VERSION = 2;

type PersistedState = {
  version: number;
  /** Threads filed in the browser, comments included. */
  threads: ForumThread[];
};

type Listener = (threads: ForumThread[]) => void;

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
    };
  } catch {
    return null;
  }
}

function loadThreads(): ForumThread[] {
  return readPersisted()?.threads ?? [];
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

  const payload: PersistedState = {
    version: STORAGE_VERSION,
    threads: ensureState(),
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

/**
 * Folds chosen spellings onto tags the board already uses, so "lores" lands on
 * "LORE" (and keeps its colour) instead of creating a near-duplicate tag.
 */
function canonicalUserTags(labels: string[], threads: ForumThread[]): string[] {
  const known = collectTagLabels(threads);

  return labels
    .map((label) => canonicalTagLabel(label, known))
    .filter((label) => label.length > 0);
}

function makeComment(
  thread: ForumThread,
  body: string,
  author: ForumAuthor,
  createdAt: string,
  userTags: string[],
  media: ForumPreview | undefined,
  parentId: string | undefined,
): ForumComment {
  return {
    id: createLocalId('comment'),
    threadId: thread.id,
    body,
    author: { ...author },
    createdAt,
    tags: mergeTags(userTags, deriveTags({ text: body, anchor: thread.anchor, maxTags: 3 })),
    ...(media === undefined ? {} : { media }),
    ...(parentId === undefined ? {} : { parentId }),
  };
}

class MockForumRepository implements ForumRepository {
  readonly source = 'mock' as const;

  async listThreads(): Promise<ForumThread[]> {
    return snapshot();
  }

  async createThread(input: CreateThreadInput): Promise<ForumThread> {
    const existing = ensureState();
    const thread: ForumThread = {
      id: createLocalId('thread'),
      title: input.title,
      body: input.body,
      author: { ...input.author },
      createdAt: new Date().toISOString(),
      anchor: { ...input.anchor },
      tags: mergeTags(
        canonicalUserTags(input.userTags ?? [], existing),
        deriveTags({ text: `${input.title}\n${input.body}`, anchor: input.anchor }),
      ),
      comments: [],
      origin: 'user',
      ...(input.media === undefined ? {} : { media: input.media }),
    };

    commit([thread, ...existing]);
    return thread;
  }

  async addComment(input: CreateCommentInput): Promise<AddCommentResult> {
    const threads = ensureState();
    const body = input.body.trim();
    const author = { ...input.author };
    const createdAt = new Date().toISOString();
    const userTags = canonicalUserTags(input.userTags ?? [], threads);

    const existing =
      input.threadId !== undefined
        ? threads.find((thread) => thread.id === input.threadId)
        : input.anchor !== undefined
          ? findThreadByAnchor(threads, input.anchor)
          : undefined;

    if (existing !== undefined) {
      // A reply to a comment only makes sense if that comment is still there.
      if (input.parentId !== undefined) {
        const parentExists = existing.comments.some((comment) => comment.id === input.parentId);
        if (!parentExists) throw new Error('The comment being replied to is no longer on this thread.');
      }

      const comment = makeComment(existing, body, author, createdAt, userTags, input.media, input.parentId);
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
      tags: mergeTags(userTags, deriveTags({ text: `${title}\n${AUTO_FILED_BODY}\n${body}`, anchor })),
      comments: [],
      origin: 'user',
    };

    const comment = makeComment(draft, body, author, createdAt, userTags, input.media, undefined);
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

    state = [];
    notify();
  }
}

let mockRepository: MockForumRepository | null = null;

export function getMockForumRepository(): ForumRepository {
  if (mockRepository === null) mockRepository = new MockForumRepository();
  return mockRepository;
}
