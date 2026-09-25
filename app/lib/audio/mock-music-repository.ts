import { normaliseFolderPath, normaliseArchiveName } from './archive-tree';
import type { BroadcastQueue } from './broadcast';
import { validateTrackFile } from './catalogue';
import { playlistId, validatePlaylistName, type LikedTrack, type Playlist, type PlaylistItem } from './library';
import type { CreateFolderInput, LibraryRead, MusicFolder, MusicRepository, OwnQueue, PublishQueueInput, UploadTrackInput } from './repository';
import { normaliseAudioTags } from './tags';
import type { AudioTrack } from './tracks';

/**
 * The music shelf used while Supabase is not wired up.
 *
 * The rows live in localStorage - so a track filed in this browser is still on the
 * shelf after a reload - and the audio itself goes through the project's own upload
 * route (`app/api/music/upload`), which writes it into `assets/audio/` beside the
 * hand-filed tracks. That is the same split the profile pictures use: Supabase
 * Storage when there is a session to check, the project folder when there is not.
 *
 * The folders anybody makes live in localStorage too, under their own key, so a browser
 * with no database still behaves like a file browser.
 *
 * Honest limit, the same one the mock stores all have: this shelf is this browser
 * only, so a track filed here is not heard on another machine until the switch in
 * ./repository.ts points at Supabase.
 */

const STORAGE_KEY = 'debaser.audio.mock.v1';
const FOLDER_KEY = 'debaser.audio.folders.v1';
/**
 * The reader's own music, keyed by account.
 *
 * One key holding every account's likes and lists, rather than a key per account: the same browser may
 * be used by two people, and a per-account key would leave the second one's rows invisible to
 * `clearLocalTracks`. `{ [userId]: { likes, playlists } }` also means a guest who signs out and back
 * in finds their own list again.
 */
const LIBRARY_KEY = 'debaser.audio.library.v1';
/**
 * The published queues, keyed by account.
 *
 * One row per account rather than a list of rows, because a person is listening to one thing at a time
 * - the same reason the table's primary key is the account. A private queue is still *stored* here (so
 * going public again does not lose the track) and is filtered out of every read anybody else makes.
 */
const QUEUE_KEY = 'debaser.audio.queues.v1';

/** The channel two tabs of this browser tell each other a queue moved on. */
const QUEUE_WIRE = 'debaser.queues.changed';

/** Who this browser was last signed in as, so "your own queue" can be found on the mock. */
const QUEUE_OWNER_KEY = 'debaser.audio.queues.owner.v1';

const STORAGE_VERSION = 1;

type PersistedState = {
  version: number;
  tracks: AudioTrack[];
};

let state: AudioTrack[] | null = null;
let folderState: MusicFolder[] | null = null;

function hasStorage(): boolean {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

function isTrackShaped(value: unknown): value is AudioTrack {
  if (typeof value !== 'object' || value === null) return false;
  const row = value as Partial<AudioTrack>;

  return typeof row.id === 'string' && typeof row.title === 'string' && typeof row.src === 'string';
}

function loadTracks(): AudioTrack[] {
  if (!hasStorage()) return [];

  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (raw === null || raw.length === 0) return [];

  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return [];

    const candidate = parsed as Partial<PersistedState>;
    if (!Array.isArray(candidate.tracks)) return [];

    return candidate.tracks.filter(isTrackShaped);
  } catch {
    return [];
  }
}

function persist(tracks: AudioTrack[]): void {
  if (!hasStorage()) return;

  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: STORAGE_VERSION, tracks }));
  } catch {
    // Storage full or blocked: the shelf still works for this session.
  }
}

/** A folder row that still makes sense: a path is the whole of it. */
function isFolderShaped(value: unknown): value is MusicFolder {
  if (typeof value !== 'object' || value === null) return false;

  const row = value as Partial<MusicFolder>;
  return typeof row.path === 'string' && row.path.length > 0;
}

function loadFolders(): MusicFolder[] {
  if (!hasStorage()) return [];

  const raw = window.localStorage.getItem(FOLDER_KEY);
  if (raw === null || raw.length === 0) return [];

  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    return parsed.filter(isFolderShaped);
  } catch {
    return [];
  }
}

function persistFolders(folders: MusicFolder[]): void {
  if (!hasStorage()) return;

  try {
    window.localStorage.setItem(FOLDER_KEY, JSON.stringify(folders));
  } catch {
    // Storage full or blocked: the folders still hold for this session.
  }
}

function ensureFolders(): MusicFolder[] {
  if (folderState === null) folderState = loadFolders();

  return folderState;
}

/** One account's shelf: what they liked, and the lists they made. */
type LibraryRecord = { likes: LikedTrack[]; playlists: Playlist[] };
type LibraryState = Record<string, LibraryRecord>;

let libraryState: LibraryState | null = null;

const EMPTY_LIBRARY: LibraryRecord = { likes: [], playlists: [] };

function loadLibrary(): LibraryState {
  if (!hasStorage()) return {};

  const raw = window.localStorage.getItem(LIBRARY_KEY);
  if (raw === null || raw.length === 0) return {};

  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return {};

    // Shallow-checked rather than trusted: this is a value a reader's own browser can edit, and a
    // malformed record should read as an empty shelf rather than throw on the way to drawing one.
    const out: LibraryState = {};

    for (const [userId, record] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof record !== 'object' || record === null) continue;

      const candidate = record as Partial<LibraryRecord>;
      out[userId] = {
        likes: Array.isArray(candidate.likes)
          ? candidate.likes.filter((like) => typeof (like as LikedTrack)?.trackId === 'string')
          : [],
        playlists: Array.isArray(candidate.playlists)
          ? candidate.playlists.filter((list) => typeof (list as Playlist)?.id === 'string')
          : [],
      };
    }

    return out;
  } catch {
    return {};
  }
}

function persistLibrary(next: LibraryState): void {
  libraryState = next;

  if (!hasStorage()) return;

  try {
    window.localStorage.setItem(LIBRARY_KEY, JSON.stringify(next));
  } catch {
    // The change holds for this session and is forgotten on reload.
  }
}

/** This account's record, creating nothing until a write needs it. */
function recordFor(userId: string): LibraryRecord {
  return libraryState?.[userId] ?? EMPTY_LIBRARY;
}

/**
 * Writes one account's record and leaves every other account's alone.
 *
 * Every library write goes through here, which is what makes "did I just clobber somebody else's
 * likes" a question with one answer rather than one per method.
 */
function writeRecord(userId: string, record: LibraryRecord): void {
  const current = libraryState ?? (libraryState = loadLibrary());
  persistLibrary({ ...current, [userId]: record });
}

/**
 * The mock's library, keyed per account in this browser.
 *
 * Honest limit, the same one every mock store has: a like here is this browser's, so it is not on
 * another machine until `NEXT_PUBLIC_MUSIC_DATA_SOURCE=supabase` points the store at the tables in
 * `supabase/migrations/20260930000025_music_library.sql`.
 */

/**
 * The published queues this browser holds.
 *
 * Shaped like the table so the two stores cannot drift in what they mean by a row: one entry per
 * account, carrying the track, the position and the two stamps. `isPublic` is stored *with* the row here
 * (unlike on the server, where the policy does the hiding) because a mock has no policy - so the filter
 * is applied on read instead, in `listQueues`.
 */
function isQueueShaped(value: unknown): value is BroadcastQueue & { isPublic: boolean } {
  if (typeof value !== 'object' || value === null) return false;

  const row = value as Partial<BroadcastQueue & { isPublic: boolean }>;

  return (
    typeof row.userId === 'string' &&
    typeof row.trackId === 'string' &&
    typeof row.positionSeconds === 'number' &&
    typeof row.updatedAt === 'string' &&
    typeof row.isPublic === 'boolean'
  );
}

function loadQueues(): (BroadcastQueue & { isPublic: boolean })[] {
  if (!hasStorage()) return [];

  const raw = window.localStorage.getItem(QUEUE_KEY);
  if (raw === null || raw.length === 0) return [];

  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    return parsed.filter(isQueueShaped);
  } catch {
    return [];
  }
}

function persistQueues(rows: (BroadcastQueue & { isPublic: boolean })[]): void {
  if (!hasStorage()) return;

  try {
    window.localStorage.setItem(QUEUE_KEY, JSON.stringify(rows));
  } catch {
    // Storage full or blocked: the queue holds for this session only.
  }
}

/**
 * Who this browser is, for the mock's "your own queue".
 *
 * Written by `publishQueue` and read by `readOwnQueue`, because the mock has no session of its own -
 * the account is passed into every write by the caller, and this is where the mock remembers which one
 * that was. It is deliberately *not* a claim about who is signed in: the real answer to that question is
 * `AuthProvider`'s, and a store that guessed would be a second authority on it.
 */
function currentQueueOwner(): string | null {
  if (!hasStorage()) return null;

  try {
    return window.localStorage.getItem(QUEUE_OWNER_KEY);
  } catch {
    return null;
  }
}

/** Remembers which account last wrote a queue here, so `readOwnQueue` can find it without a session. */
function rememberQueueOwner(userId: string): void {
  if (!hasStorage()) return;

  try {
    window.localStorage.setItem(QUEUE_OWNER_KEY, userId);
  } catch {
    // Storage blocked: `readOwnQueue` reads as null, and the switch shows as off - which is wrong but
    // harmless, and the press that follows still writes.
  }
}

/**
 * Tells other tabs of this browser that a queue moved.
 *
 * Separate from the store's `subscribe` because the two have different reaches: the listener set wakes
 * *this* tab, and the channel wakes the others. A caller that only had one of them would see a list that
 * was stale in one of the two directions.
 */
function announceQueue(): void {
  if (typeof BroadcastChannel === 'undefined') return;

  const wire = new BroadcastChannel(QUEUE_WIRE);

  try {
    wire.postMessage('changed');
  } finally {
    wire.close();
  }
}

class MockMusicRepository implements MusicRepository {
  readonly source = 'mock' as const;

  async listTracks(): Promise<AudioTrack[]> {
    if (state === null) state = loadTracks();

    return state;
  }

  /** The folders made in this browser. */
  async listFolders(): Promise<MusicFolder[]> {
    return ensureFolders();
  }

  /**
   * Makes a folder, or hands back the one that is already there.
   *
   * A path is unique by its own name, so two people asking for `HEXHAM/GRIDLOCK` are asking for
   * the same folder rather than failing.
   */
  async createFolder(input: CreateFolderInput): Promise<MusicFolder> {
    const path = normaliseFolderPath(input.path);
    if (path === null) throw new Error('A FOLDER NEEDS A NAME.');

    const folders = ensureFolders();
    const existing = folders.find((folder) => folder.path === path);
    if (existing !== undefined) return existing;

    const folder: MusicFolder = {
      path,
      createdBy: input.creatorId,
      createdByLabel: normaliseArchiveName(input.creatorName),
      createdAt: new Date().toISOString(),
    };

    folderState = [...folders, folder].sort((a, b) => a.path.localeCompare(b.path));
    persistFolders(folderState);

    return folder;
  }

  async uploadTrack(input: UploadTrackInput): Promise<AudioTrack> {
    const title = input.title.trim();
    if (title.length === 0) throw new Error('A TRACK NEEDS A TITLE.');

    const problem = validateTrackFile(input.file);
    if (problem !== undefined) throw new Error(problem);

    const form = new FormData();
    form.append('file', input.file);

    const response = await fetch('/api/music/upload', { method: 'POST', body: form });
    const payload = (await response.json()) as { ok?: boolean; src?: string; error?: string };

    if (payload.ok !== true || payload.src === undefined) {
      throw new Error(payload.error ?? 'THE UPLOAD WAS REFUSED.');
    }

    const credit = input.credit.trim().length === 0 ? input.uploaderName : input.credit.trim();
    const tags = normaliseAudioTags(input.tags ?? []);
    const track: AudioTrack = {
      id: payload.src,
      title,
      credit,
      kind: 'UPLOADED TO THE SHELF',
      src: payload.src,
      length: input.length ?? '--:--',
      tags,
      folderPath: normaliseFolderPath(input.folderPath),
      shelf: 'archive',
    };

    const tracks = [...(state ?? loadTracks()), track];
    state = tracks;
    persist(tracks);

    return track;
  }

  async clearLocalTracks(): Promise<void> {
    if (hasStorage()) {
      try {
        window.localStorage.removeItem(STORAGE_KEY);
        window.localStorage.removeItem(FOLDER_KEY);
        window.localStorage.removeItem(LIBRARY_KEY);
      } catch {
        // Nothing to clean up.
      }
    }

    state = [];
    folderState = [];
    libraryState = {};
  }

  /* The reader's own music: per account, in this browser. ------------------------------------- */

  async listLikes(userId: string): Promise<LibraryRead<LikedTrack>> {
    // Newest first, so the shelf's own order is not what decides the head of "my music".
    const items = [...recordFor(userId).likes].sort((a, b) => b.likedAt.localeCompare(a.likedAt));

    // A mock always answers: localStorage is either readable or the reader has bigger problems. The
    // `answered` flag exists for the Supabase store, where a read can genuinely fail, and it is set here
    // too so a caller cannot be right against one store and wrong against the other.
    return { items, answered: true };
  }

  async toggleLike(userId: string, trackId: string): Promise<{ liked: boolean }> {
    const record = recordFor(userId);
    const already = record.likes.some((like) => like.trackId === trackId);

    const likes = already
      ? record.likes.filter((like) => like.trackId !== trackId)
      : [...record.likes, { trackId, likedAt: new Date().toISOString() }];

    writeRecord(userId, { ...record, likes });

    return { liked: !already };
  }

  async listPlaylists(userId: string): Promise<LibraryRead<Playlist>> {
    return { items: [...recordFor(userId).playlists], answered: true };
  }

  async savePlaylist(input: { ownerId: string; name: string; items?: PlaylistItem[] }): Promise<Playlist> {
    const problem = validatePlaylistName(input.name);
    if (problem !== undefined) throw new Error(problem);

    const record = recordFor(input.ownerId);
    const id = playlistId(input.ownerId, input.name);
    const existing = record.playlists.find((list) => list.id === id);

    const playlist: Playlist = {
      id,
      ownerId: input.ownerId,
      name: input.name.trim(),
      createdAt: existing?.createdAt ?? new Date().toISOString(),
      // An edit keeps whatever is in the list; only a caller that passes items replaces them.
      items: input.items ?? existing?.items ?? [],
    };

    const playlists = existing === undefined
      ? [...record.playlists, playlist]
      : record.playlists.map((list) => (list.id === id ? playlist : list));

    writeRecord(input.ownerId, { ...record, playlists });

    return playlist;
  }

  async togglePlaylistTrack(input: { ownerId: string; playlistId: string; trackId: string }): Promise<Playlist> {
    const record = recordFor(input.ownerId);
    const list = record.playlists.find((entry) => entry.id === input.playlistId);

    if (list === undefined) throw new Error('THERE IS NO PLAYLIST BY THAT NAME.');

    const already = list.items.some((item) => item.trackId === input.trackId);

    const items = already
      ? list.items.filter((item) => item.trackId !== input.trackId)
      : [...list.items, { trackId: input.trackId, addedAt: new Date().toISOString() }];

    const next: Playlist = { ...list, items };
    writeRecord(input.ownerId, {
      ...record,
      playlists: record.playlists.map((entry) => (entry.id === next.id ? next : entry)),
    });

    return next;
  }

  async removePlaylist(ownerId: string, playlistIdToRemove: string): Promise<void> {
    const record = recordFor(ownerId);

    writeRecord(ownerId, {
      ...record,
      playlists: record.playlists.filter((list) => list.id !== playlistIdToRemove),
    });
  }

  /* ---------------------------------------------------------------------------------------------
   * Broadcast queues
   *
   * **Honest limit, and it is a real one.** This store lives in this browser's localStorage, so a
   * queue published here reaches *this machine* and no other. `BroadcastChannel` lets two tabs of the
   * same site see each other, which is enough to walk the flow - but a different person on a different
   * machine cannot, and no care here changes that. Following somebody across machines needs
   * `NEXT_PUBLIC_MUSIC_DATA_SOURCE=supabase` and the `music_queues` table.
   * ------------------------------------------------------------------------------------------- */

  async listQueues(): Promise<BroadcastQueue[]> {
    return loadQueues()
      .filter((queue) => queue.isPublic)
      .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
  }

  async readOwnQueue(): Promise<OwnQueue | null> {
    const own = currentQueueOwner();

    return own === null ? null : (loadQueues().find((queue) => queue.userId === own) ?? null);
  }

  async publishQueue(input: PublishQueueInput): Promise<void> {
    const rows = loadQueues().filter((queue) => queue.userId !== input.userId);
    const previous = loadQueues().find((queue) => queue.userId === input.userId);

    rows.push({
      userId: input.userId,
      trackId: input.trackId,
      trackIndex: input.trackIndex,
      trackTotal: Math.max(1, input.trackTotal),
      positionSeconds: Math.max(0, input.positionSeconds),
      isPublic: input.isPublic,
      // The start survives a move: `startedAt` is when this person began broadcasting, which is what a
      // listener reads as "how long they have been on", so re-writing it on every track change would
      // reset a number that is supposed to grow.
      startedAt: previous?.startedAt ?? new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    persistQueues(rows);
    rememberQueueOwner(input.userId);
    announceQueue();
  }

  async clearQueue(userId: string): Promise<void> {
    persistQueues(loadQueues().filter((queue) => queue.userId !== userId));
    announceQueue();
  }

  /**
   * This browser's own writes, and other tabs of it.
   *
   * A `BroadcastChannel` rather than a timer, for the reason the game channel is one: two tabs of the
   * same site are the only two clients this store can reach, so the channel is exactly the reach it
   * has. Where `BroadcastChannel` does not exist the subscription is silent rather than broken.
   */
  subscribeToQueues(onChange: () => void): () => void {
    if (typeof BroadcastChannel === 'undefined') return () => undefined;

    const wire = new BroadcastChannel(QUEUE_WIRE);

    wire.onmessage = () => onChange();

    return () => {
      wire.onmessage = null;
      wire.close();
    };
  }
}

let mockMusicRepository: MockMusicRepository | null = null;

export function getMockMusicRepository(): MusicRepository {
  if (mockMusicRepository === null) mockMusicRepository = new MockMusicRepository();

  return mockMusicRepository;
}
