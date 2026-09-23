import { createLocalId } from '../forum/ids';
import { dedupeTargets, snippet, sortNotificationsNewestFirst } from './feed';
import type { AppNotification, NotificationsRepository, NotifyInput } from './types';

/**
 * The notification feed used while Supabase is not wired up.
 *
 * It lives in localStorage beside the board's rows, the profiles and the conversations, so tags
 * and replies survive navigation and reloads. `subscribe` mimics the Supabase channel: every
 * write and every read pushes this account's fresh feed to its listeners.
 *
 * `notify` applies the same rules the database does, which is the point of keeping them in
 * ./feed.ts: the actor is never told about their own words, and one account gets one row per
 * post however often it is named in it.
 */

// v1: the feed as it stands - one row per account told, per post they were told about.
const STORAGE_KEY = 'debaser.notifications.mock.v1';
const STORAGE_VERSION = 1;

type PersistedState = {
  version: number;
  items: AppNotification[];
};

type Listener = (items: AppNotification[]) => void;

let state: AppNotification[] | null = null;
const listeners = new Set<{ userId: string; listener: Listener }>();

function hasStorage(): boolean {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

function isNotificationShaped(value: unknown): value is AppNotification {
  if (typeof value !== 'object' || value === null) return false;
  const row = value as Partial<AppNotification>;

  return (
    typeof row.id === 'string' &&
    typeof row.userId === 'string' &&
    (row.kind === 'tag' || row.kind === 'reply') &&
    typeof row.actorName === 'string' &&
    typeof row.threadTitle === 'string' &&
    typeof row.body === 'string' &&
    typeof row.createdAt === 'string'
  );
}

/** Defensive read: an older or hand-edited payload still loads. */
function loadItems(): AppNotification[] {
  if (!hasStorage()) return [];

  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (raw === null || raw.length === 0) return [];

  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return [];

    const candidate = parsed as Partial<PersistedState>;
    if (!Array.isArray(candidate.items)) return [];

    return candidate.items.filter(isNotificationShaped).map((row) => ({
      ...row,
      actorId: typeof row.actorId === 'string' ? row.actorId : null,
      threadId: typeof row.threadId === 'string' ? row.threadId : null,
      readAt: typeof row.readAt === 'string' ? row.readAt : null,
    }));
  } catch {
    return [];
  }
}

function ensureState(): AppNotification[] {
  if (state === null) state = loadItems();
  return state;
}

/** Only ever this account's rows: the same rule RLS keeps on the real thing. */
function feedFor(userId: string): AppNotification[] {
  return sortNotificationsNewestFirst(ensureState().filter((row) => row.userId === userId));
}

function persist(): void {
  if (!hasStorage()) return;

  const payload: PersistedState = { version: STORAGE_VERSION, items: ensureState() };

  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // Storage disabled or full: the feed keeps working in memory.
  }
}

function emit(): void {
  for (const entry of listeners) entry.listener(feedFor(entry.userId));
}

class MockNotificationsRepository implements NotificationsRepository {
  readonly source = 'mock' as const;

  async list(userId: string): Promise<AppNotification[]> {
    return feedFor(userId);
  }

  async notify(input: NotifyInput): Promise<void> {
    const targets = dedupeTargets(input.targets, input.actorId);
    if (targets.length === 0) return;

    const createdAt = new Date().toISOString();
    const rows: AppNotification[] = targets.map((target) => ({
      id: createLocalId('note'),
      userId: target.userId,
      kind: target.kind,
      actorId: input.actorId,
      actorName: input.actorName,
      threadId: input.threadId,
      threadTitle: input.threadTitle,
      body: snippet(input.body),
      createdAt,
      readAt: null,
    }));

    ensureState().push(...rows);
    persist();
    emit();
  }

  async markRead(userId: string, id: string): Promise<void> {
    const row = ensureState().find((item) => item.id === id && item.userId === userId);
    // Already read: no write, so opening the menu cannot turn into a loop through the feed.
    if (row === undefined || row.readAt !== null) return;

    row.readAt = new Date().toISOString();
    persist();
    emit();
  }

  async markAllRead(userId: string): Promise<void> {
    const unread = ensureState().filter((item) => item.userId === userId && item.readAt === null);
    if (unread.length === 0) return;

    const readAt = new Date().toISOString();
    for (const row of unread) row.readAt = readAt;

    persist();
    emit();
  }

  subscribe(userId: string, listener: Listener): () => void {
    const entry = { userId, listener };
    listeners.add(entry);
    listener(feedFor(userId));

    return () => {
      listeners.delete(entry);
    };
  }

  /** Local test tags and replies only; the seed data the app ships with is untouched. */
  async clearLocalNotifications(): Promise<void> {
    state = [];
    persist();
    emit();
  }
}

let mockNotificationsRepository: MockNotificationsRepository | null = null;

export function getMockNotificationsRepository(): NotificationsRepository {
  if (mockNotificationsRepository === null) mockNotificationsRepository = new MockNotificationsRepository();

  return mockNotificationsRepository;
}
