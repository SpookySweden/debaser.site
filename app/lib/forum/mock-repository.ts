import { AUTO_FILED_BODY, autoThreadTitle } from './anchors';
import { locallyBannedAccountIds } from '../auth/mock-auth';
import { isSiteAccount } from '../auth/builtin-account';
import { createLocalId } from './ids';
import { pinExpiry } from './pins';
import { canonicalTagLabel, collectTagLabels } from './tag-vocabulary';
import { deriveTags, mergeTags } from './tags';
import type {
  AddCommentResult,
  CommentPatch,
  CreateCommentInput,
  CreateThreadInput,
  ForumAnchor,
  ForumAuthor,
  ForumComment,
  ForumPreview,
  ForumRepository,
  ForumThread,
  PinThreadInput,
  ThreadPatch,
  ThreadPin,
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
  /** Pins taken from the browser. Absent in a payload written before pins existed. */
  pins?: ThreadPin[];
};

type Listener = (threads: ForumThread[]) => void;
type PinListener = (pins: ThreadPin[]) => void;

let state: ForumThread[] | null = null;
let pinState: ThreadPin[] | null = null;
const listeners = new Set<Listener>();
const pinListeners = new Set<PinListener>();

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

/** Defensive read: a pin row that no longer makes sense is dropped rather than drawn. */
function isPinShaped(value: unknown): value is ThreadPin {
  if (typeof value !== 'object' || value === null) return false;
  const row = value as Partial<ThreadPin>;

  return typeof row.threadId === 'string' && typeof row.pinnedAt === 'string';
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
      pins: Array.isArray(candidate.pins) ? candidate.pins.filter(isPinShaped) : [],
    };
  } catch {
    return null;
  }
}

function loadThreads(): ForumThread[] {
  return readPersisted()?.threads ?? [];
}

function loadPins(): ThreadPin[] {
  return readPersisted()?.pins ?? [];
}

function ensureState(): ForumThread[] {
  if (state === null) state = loadThreads();
  return state;
}

function ensurePins(): ThreadPin[] {
  if (pinState === null) pinState = loadPins();
  return pinState;
}

function sortNewestFirst(threads: ForumThread[]): ForumThread[] {
  return [...threads].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}

function snapshot(): ForumThread[] {
  const banned = locallyBannedAccountIds();
  if (banned.length === 0) return sortNewestFirst(ensureState());

  // A banned account's posts and replies stop being shown, exactly as the readable
  // policies in supabase/schema.sql hide them on the real store. Guests write with
  // no author id, so their rows are never caught by this.
  return sortNewestFirst(ensureState())
    .filter((thread) => thread.author.id === null || !banned.includes(thread.author.id))
    .map((thread) => ({
      ...thread,
      comments: thread.comments.filter(
        (comment) => comment.author.id === null || !banned.includes(comment.author.id),
      ),
    }));
}

/** The mock's stand-in for the database refusing a banned account's writes. */
function assertNotBanned(author: ForumAuthor): void {
  if (author.id !== null && locallyBannedAccountIds().includes(author.id)) {
    throw new Error('THIS ACCOUNT IS BANNED.');
  }
}

function persist(): void {
  if (!hasStorage()) return;

  const payload: PersistedState = {
    version: STORAGE_VERSION,
    threads: ensureState(),
    pins: ensurePins(),
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

function notifyPins(): void {
  const next = pinSnapshot();
  for (const listener of pinListeners) listener(next);
}

/** The pins as read: newest first, lapsed ones left in so a screen can say when they went. */
function pinSnapshot(): ThreadPin[] {
  return [...ensurePins()].sort((left, right) => Date.parse(right.pinnedAt) - Date.parse(left.pinnedAt));
}

function commit(next: ForumThread[]): void {
  state = next;
  persist();
  notify();
}

function commitPins(next: ThreadPin[]): void {
  pinState = next;
  persist();
  notifyPins();
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
    assertNotBanned(input.author);

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
    assertNotBanned(input.author);

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

  async listPins(): Promise<ThreadPin[]> {
    return pinSnapshot();
  }

  /**
   * Pins a post, as a moderator.
   *
   * The same rule the database's `is_admin()` policies keep: only the house account may pin,
   * because a pin is the archive speaking rather than a post. Pinning a post that is already
   * pinned replaces the pin - which is how a deadline is extended without unpinning first.
   */
  async pinThread(input: PinThreadInput): Promise<ThreadPin[]> {
    if (!isSiteAccount(input.moderator.id)) {
      throw new Error('ONLY A MODERATOR MAY PIN A POST.');
    }

    if (!ensureState().some((thread) => thread.id === input.threadId)) {
      throw new Error('THAT POST IS NOT ON THE BOARD.');
    }

    const pin: ThreadPin = {
      threadId: input.threadId,
      pinnedById: input.moderator.id,
      pinnedByName: input.moderator.displayName,
      pinnedAt: new Date().toISOString(),
      expiresAt: pinExpiry(input.duration),
    };

    commitPins([pin, ...ensurePins().filter((entry) => entry.threadId !== input.threadId)]);
    return pinSnapshot();
  }

  async unpinThread(threadId: string): Promise<ThreadPin[]> {
    commitPins(ensurePins().filter((entry) => entry.threadId !== threadId));
    return pinSnapshot();
  }

  subscribePins(listener: PinListener): () => void {
    pinListeners.add(listener);
    return () => {
      pinListeners.delete(listener);
    };
  }

  async updateThread(threadId: string, patch: ThreadPatch): Promise<ForumThread> {
    const threads = ensureState();
    const thread = threads.find((item) => item.id === threadId);
    if (thread === undefined) throw new Error('THAT POST IS NOT ON THE BOARD.');

    const title = patch.title === undefined ? thread.title : patch.title.trim();
    const body = patch.body === undefined ? thread.body : patch.body.trim();
    if (title.length === 0) throw new Error('A POST NEEDS A TITLE.');

    // The housekeeping tags are read back out of the new text, exactly as they are
    // when the post is first filed.
    const next: ForumThread = {
      ...thread,
      title,
      body,
      tags: mergeTags(
        canonicalUserTags(
          thread.tags.map((tag) => tag.label),
          threads,
        ),
        deriveTags({ text: `${title}\n${body}`, anchor: thread.anchor }),
      ),
    };

    commit(threads.map((item) => (item.id === threadId ? next : item)));
    return next;
  }

  async deleteThread(threadId: string): Promise<void> {
    // Replies to the post go with it, the way the foreign key cascades in Supabase.
    commit(ensureState().filter((item) => item.id !== threadId));
  }

  async updateComment(commentId: string, patch: CommentPatch): Promise<ForumThread> {
    const threads = ensureState();
    const thread = threads.find((item) => item.comments.some((comment) => comment.id === commentId));
    if (thread === undefined) throw new Error('THAT REPLY IS NOT ON THE BOARD.');

    const body = (patch.body ?? '').trim();
    if (body.length === 0) throw new Error('A REPLY NEEDS SOMETHING IN IT.');

    const next: ForumThread = {
      ...thread,
      comments: thread.comments.map((comment) =>
        comment.id === commentId
          ? {
              ...comment,
              body,
              tags: mergeTags(
                comment.tags.map((tag) => tag.label),
                deriveTags({ text: body, anchor: thread.anchor, maxTags: 3 }),
              ),
            }
          : comment,
      ),
    };

    commit(threads.map((item) => (item.id === thread.id ? next : item)));
    return next;
  }

  async deleteComment(commentId: string): Promise<void> {
    // The replies that answered this one go too, as they do in Supabase.
    commit(
      ensureState().map((thread) => ({
        ...thread,
        comments: thread.comments.filter((comment) => comment.id !== commentId && comment.parentId !== commentId),
      })),
    );
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

    // A pin only means something while the post it marks is there, so clearing the local board
    // clears its pins with it - the same cascade the table keeps with `on delete cascade`.
    commitPins([]);
  }
}

let mockRepository: MockForumRepository | null = null;

export function getMockForumRepository(): ForumRepository {
  if (mockRepository === null) mockRepository = new MockForumRepository();
  return mockRepository;
}
