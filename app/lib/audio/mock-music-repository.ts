import { normaliseFolderPath, normaliseArchiveName } from './archive-tree';
import { validateTrackFile } from './catalogue';
import { playlistId, validatePlaylistName, type LikedTrack, type Playlist, type PlaylistItem } from './library';
import type { CreateFolderInput, LibraryRead, MusicFolder, MusicRepository, UploadTrackInput } from './repository';
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
}

let mockMusicRepository: MockMusicRepository | null = null;

export function getMockMusicRepository(): MusicRepository {
  if (mockMusicRepository === null) mockMusicRepository = new MockMusicRepository();

  return mockMusicRepository;
}
