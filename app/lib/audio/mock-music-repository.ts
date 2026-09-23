import { normaliseFolderPath, normaliseArchiveName } from './archive-tree';
import { validateTrackFile } from './catalogue';
import type { CreateFolderInput, MusicFolder, MusicRepository, UploadTrackInput } from './repository';
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
      } catch {
        // Nothing to clean up.
      }
    }

    state = [];
    folderState = [];
  }
}

let mockMusicRepository: MockMusicRepository | null = null;

export function getMockMusicRepository(): MusicRepository {
  if (mockMusicRepository === null) mockMusicRepository = new MockMusicRepository();

  return mockMusicRepository;
}
