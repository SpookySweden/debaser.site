import { createLocalId } from '../forum/ids';
import type { CreateInviteInput, GameInvite, GameInviteStatus, GamesRepository } from './types';

/**
 * Invitations kept in this browser.
 *
 * The same shape of store as the mock board, the mock feed and the mock profiles, and for the same
 * reason: the site has to work before a project exists, and every screen above this reads the
 * interface rather than the storage. A match started from here reaches another *tab* through
 * `BroadcastChannel` (see ./channel.ts): two tabs of this browser can play, and a different machine
 * cannot, which is the honest limit of a store that lives in localStorage.
 */

const STORAGE_KEY = 'debaser.games.mock.v1';
const STORAGE_VERSION = 1;

type MockState = {
  version: number;
  invites: GameInvite[];
};

let state: MockState | null = null;
const listeners = new Set<(userId: string) => void>();

function hasStorage(): boolean {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

function load(): MockState {
  if (!hasStorage()) return { version: STORAGE_VERSION, invites: [] };

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === null) return { version: STORAGE_VERSION, invites: [] };

    const parsed = JSON.parse(raw) as Partial<MockState>;
    const invites = Array.isArray(parsed.invites) ? parsed.invites.filter(isInviteShaped) : [];

    return { version: STORAGE_VERSION, invites };
  } catch {
    return { version: STORAGE_VERSION, invites: [] };
  }
}

/** A row read back defensively: anything without the fields a screen draws is dropped. */
function isInviteShaped(value: unknown): value is GameInvite {
  if (typeof value !== 'object' || value === null) return false;

  const row = value as Partial<GameInvite>;

  return (
    typeof row.id === 'string' &&
    (row.game === 'tic-tac-toe' || row.game === 'paddle-duel') &&
    typeof row.fromUserId === 'string' &&
    typeof row.toUserId === 'string' &&
    (row.status === 'pending' || row.status === 'accepted' || row.status === 'declined')
  );
}

function ensureState(): MockState {
  state ??= load();

  return state;
}

function persist(): void {
  if (!hasStorage()) return;

  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(ensureState()));
  } catch {
    // A full or blocked store leaves the session working in memory rather than failing the invite.
  }
}

/** Tells the listeners the two accounts this row belongs to, since either of them may be reading. */
function emit(invite: GameInvite | null): void {
  const accounts = invite === null ? [...new Set(ensureState().invites.flatMap((row) => [row.fromUserId, row.toUserId]))] : [invite.fromUserId, invite.toUserId];

  for (const userId of accounts) {
    for (const listener of listeners) listener(userId);
  }
}

const newestFirst = (invites: GameInvite[]): GameInvite[] =>
  [...invites].sort((left, right) => right.createdAt.localeCompare(left.createdAt));

class MockGamesRepository implements GamesRepository {
  readonly source = 'mock' as const;

  async list(userId: string): Promise<GameInvite[]> {
    return newestFirst(ensureState().invites.filter((invite) => invite.fromUserId === userId || invite.toUserId === userId));
  }

  async create(input: CreateInviteInput): Promise<GameInvite> {
    if (input.from.id === input.to.id) throw new Error('YOU CANNOT INVITE YOURSELF.');

    const now = new Date().toISOString();
    const invite: GameInvite = {
      id: createLocalId('invite'),
      game: input.game,
      fromUserId: input.from.id,
      fromName: input.from.displayName,
      toUserId: input.to.id,
      toName: input.to.displayName,
      status: 'pending',
      createdAt: now,
      updatedAt: now,
    };

    ensureState().invites.push(invite);
    persist();
    emit(invite);

    return invite;
  }

  async setStatus(inviteId: string, status: GameInviteStatus): Promise<void> {
    const invite = ensureState().invites.find((row) => row.id === inviteId);
    if (invite === undefined) throw new Error('THAT INVITATION IS NOT THERE.');

    invite.status = status;
    invite.updatedAt = new Date().toISOString();
    persist();
    emit(invite);
  }

  async remove(inviteId: string): Promise<void> {
    const before = ensureState().invites.length;
    ensureState().invites = ensureState().invites.filter((row) => row.id !== inviteId);
    if (ensureState().invites.length === before) return;

    persist();
    emit(null);
  }

  subscribe(userId: string, listener: (invites: GameInvite[]) => void): () => void {
    const forUser = (changed: string) => {
      if (changed !== userId) return;
      void this.list(userId).then(listener);
    };

    listeners.add(forUser);

    return () => listeners.delete(forUser);
  }

  async clearLocalInvites(): Promise<void> {
    state = { version: STORAGE_VERSION, invites: [] };
    persist();
    emit(null);
  }
}

let repository: MockGamesRepository | null = null;

export function getMockGamesRepository(): GamesRepository {
  repository ??= new MockGamesRepository();

  return repository;
}
