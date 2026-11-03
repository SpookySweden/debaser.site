import { normaliseFolderPath, normaliseArchiveName } from './archive-tree';
import { cleanNote, pictureRefusal, songOwner, type SaveSongNoteInput, type SongNote } from './song-notes';
import type { BroadcastQueue } from './broadcast';
import { validateTrackFile } from './catalogue';
import { playlistId, validatePlaylistName, type LikedTrack, type Playlist, type PlaylistItem } from './library';
import type { CreateFolderInput, LibraryRead, MusicFolder, MusicRepository, OwnQueue, PublishQueueInput, UploadTrackInput } from './repository';
import { normaliseAudioTags } from './tags';
import type { AudioTrack } from './tracks';
import { cappedCounts, type Listen } from './listens';
import { mockCloseness, type CloseRow } from './for-you';
import type { MirrorRow } from './mirror';
import { MOCK_HIDDEN_ACCOUNT_ID } from '../auth/mock-auth';

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
/** Plays logged in this browser (SPEC-vanity.md step 3), every account's, newest last. */
const LISTENS_KEY = 'debaser.audio.listens.v1';

function readListens(): Listen[] {
  if (!hasStorage()) return [];
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(LISTENS_KEY) ?? '[]');
    return Array.isArray(parsed)
      ? parsed.filter((entry): entry is Listen => typeof entry?.userId === 'string' && typeof entry?.src === 'string' && typeof entry?.at === 'string')
      : [];
  } catch {
    return [];
  }
}

/** Profile visits in this browser (SPEC-vanity.md step 5): one entry per pair, like the table. */
const VISITS_KEY = 'debaser.audio.visits.v1';
/** Listening along in this browser: who followed whom, from when to when. */
const FOLLOWS_KEY = 'debaser.audio.follows.v1';

type MockVisit = { visitor: string; profile: string; visits: number; last: string };
type MockFollow = { id: string; listener: string; host: string; started: string; ended: string | null };

function readList<T>(key: string, valid: (entry: T) => boolean): T[] {
  if (!hasStorage()) return [];
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(key) ?? '[]');
    return Array.isArray(parsed) ? (parsed as T[]).filter((entry) => entry !== null && typeof entry === 'object' && valid(entry)) : [];
  } catch {
    return [];
  }
}

function writeList(key: string, list: unknown[]): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(list.slice(-2000)));
  } catch {
    // Storage full or blocked: this one goes unnoted.
  }
}

const readVisits = () => readList<MockVisit>(VISITS_KEY, (entry) => typeof entry.visitor === 'string' && typeof entry.profile === 'string');
const readFollows = () => readList<MockFollow>(FOLLOWS_KEY, (entry) => typeof entry.id === 'string' && typeof entry.listener === 'string');

/** The channel two tabs of this browser tell each other a queue moved on. */
const QUEUE_WIRE = 'debaser.queues.changed';

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
/** `barrs` is optional: records stored before BARR existed have none. */
type LibraryRecord = { likes: LikedTrack[]; playlists: Playlist[]; barrs?: string[] };
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
        barrs: Array.isArray(candidate.barrs) ? candidate.barrs.filter((src) => typeof src === 'string') : [],
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
  // Read from storage on first use: a read that came before any write (a page just loaded) used to find
  // nothing here and report an empty library until the first like.
  const current = libraryState ?? (libraryState = loadLibrary());
  return current[userId] ?? EMPTY_LIBRARY;
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
  if (!hasStorage()) return queueMemory;

  const raw = window.localStorage.getItem(QUEUE_KEY);
  if (raw === null || raw.length === 0) return queueMemory;

  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return queueMemory;

    return parsed.filter(isQueueShaped);
  } catch {
    return queueMemory;
  }
}

/**
 * The rows when there is no storage at all.
 *
 * `localStorage` is absent in a Node process, which is where the checks run - so without this the mock
 * would answer "nothing is broadcasting" to every read and a check of its *scoping* could not be written.
 * The other mock stores answer with an empty list in that case and leave it there, which is fine for a
 * shelf read but wrong here: a broadcast is a *conversation with state*, and the question worth asking
 * about it is whether one account can see another's row.
 */
let queueMemory: (BroadcastQueue & { isPublic: boolean })[] = [];

function persistQueues(rows: (BroadcastQueue & { isPublic: boolean })[]): void {
  queueMemory = rows;

  if (!hasStorage()) return;

  try {
    window.localStorage.setItem(QUEUE_KEY, JSON.stringify(rows));
  } catch {
    // Storage full or blocked: the rows are still in `queueMemory` for this session.
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

/** The cover card's notes in this browser, by track id; a picture is kept as its own data address. */
const NOTES_KEY = 'debaser.audio.notes.v1';

function loadNotes(): Record<string, SongNote> {
  if (!hasStorage()) return {};
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(NOTES_KEY) ?? '{}');
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, SongNote>) : {};
  } catch {
    return {};
  }
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('THE PICTURE COULD NOT BE READ.'));
    reader.readAsDataURL(file);
  });
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

  /**
   * Plays logged in this browser, every account's together (the counts are totals, not anybody's own).
   * The mock leaves out its hidden account but cannot see the mock profile's listening switch: that is
   * the Supabase function's job (`music_play_counts`).
   */
  async logListen(userId: string, src: string): Promise<void> {
    if (!hasStorage()) return;
    try {
      const listens = readListens();
      const now = new Date();
      // The database's 20-second repeat guard, the same here.
      if (listens.some((listen) => listen.userId === userId && listen.src === src && now.getTime() - Date.parse(listen.at) < 20000)) return;
      window.localStorage.setItem(LISTENS_KEY, JSON.stringify([...listens, { userId, src, at: now.toISOString() }].slice(-2000)));
    } catch {
      // Storage full or blocked: the play goes uncounted.
    }
  }

  async playCounts(srcs?: string[]): Promise<Map<string, number>> {
    const wanted = srcs === undefined ? null : new Set(srcs);
    const counts = cappedCounts(readListens(), new Set([MOCK_HIDDEN_ACCOUNT_ID]));
    return wanted === null ? counts : new Map([...counts].filter(([src]) => wanted.has(src)));
  }

  async myPlays(userId: string): Promise<Map<string, number>> {
    const plays = new Map<string, number>();
    for (const listen of readListens()) if (listen.userId === userId) plays.set(listen.src, (plays.get(listen.src) ?? 0) + 1);
    return plays;
  }

  /**
   * `music_for_you` with what the mock knows: visits and listening along (the mock forum and comms keep
   * no replies or messages it could read). Leaves out the hidden account and the asker, like the database.
   */
  async forYou(userId: string): Promise<CloseRow[]> {
    const people = new Map<string, { visits: number[]; followMinutes: number[] }>();
    const partsFor = (person: string) => {
      const parts = people.get(person) ?? { visits: [], followMinutes: [] };
      people.set(person, parts);
      return parts;
    };

    for (const visit of readVisits()) {
      if (visit.visitor === userId) partsFor(visit.profile).visits.push(visit.visits);
      else if (visit.profile === userId) partsFor(visit.visitor).visits.push(visit.visits);
    }
    for (const follow of readFollows()) {
      const other = follow.listener === userId ? follow.host : follow.host === userId ? follow.listener : null;
      if (other === null) continue;
      const end = follow.ended === null ? Date.parse(follow.started) : Date.parse(follow.ended);
      partsFor(other).followMinutes.push((end - Date.parse(follow.started)) / 60000);
    }

    const top = [...people.entries()]
      .filter(([person]) => person !== userId && person !== MOCK_HIDDEN_ACCOUNT_ID)
      .map(([person, parts]) => ({ person, ...mockCloseness(parts) }))
      .filter((entry) => entry.closeness > 0)
      .sort((a, b) => b.closeness - a.closeness)
      .slice(0, 12);

    const listens = readListens();
    return top.flatMap(({ person, closeness, reason }) =>
      [...cappedCounts(listens.filter((listen) => listen.userId === person))].map(([src, plays]) => ({ personId: person, closeness, reason, src, plays })),
    );
  }

  async recordProfileVisit(visitorId: string, profileId: string): Promise<void> {
    if (!hasStorage() || visitorId === profileId) return;
    const visits = readVisits();
    const now = new Date();
    const existing = visits.find((visit) => visit.visitor === visitorId && visit.profile === profileId);

    if (existing === undefined) {
      writeList(VISITS_KEY, [...visits, { visitor: visitorId, profile: profileId, visits: 1, last: now.toISOString() }]);
    } else if (now.getTime() - Date.parse(existing.last) >= 30 * 60000) {
      writeList(VISITS_KEY, visits.map((visit) => (visit === existing ? { ...visit, visits: visit.visits + 1, last: now.toISOString() } : visit)));
    }
  }

  async startFollowLog(listenerId: string, hostId: string): Promise<string | null> {
    if (!hasStorage() || listenerId === hostId) return null;
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    writeList(FOLLOWS_KEY, [...readFollows(), { id, listener: listenerId, host: hostId, started: new Date().toISOString(), ended: null }]);
    return id;
  }

  async stampFollowLog(listenerId: string, entryId: string): Promise<void> {
    if (!hasStorage()) return;
    const ended = new Date().toISOString();
    writeList(FOLLOWS_KEY, readFollows().map((follow) => (follow.id === entryId && follow.listener === listenerId ? { ...follow, ended } : follow)));
  }

  /**
   * `music_mirror` over every file in this browser (the view keeps the reader's own): capped plays per
   * listener, without the hidden account, and the asker's own plays with no id, like the database. The
   * mock cannot see a profile's listening switch.
   */
  async mirror(userId: string): Promise<MirrorRow[]> {
    const listens = readListens().filter((listen) => listen.userId !== MOCK_HIDDEN_ACCOUNT_ID);
    const people = [...new Set(listens.map((listen) => listen.userId))];
    return people.flatMap((person) =>
      [...cappedCounts(listens.filter((listen) => listen.userId === person))].map(([src, plays]) => ({
        src,
        listenerId: person === userId ? null : person,
        plays,
      })),
    );
  }

  async listBarrs(userId: string): Promise<LibraryRead<string>> {
    return { items: [...(recordFor(userId).barrs ?? [])], answered: true };
  }

  async readSongNote(trackId: string): Promise<SongNote | null> {
    return loadNotes()[trackId] ?? null;
  }

  async saveSongNote(input: SaveSongNoteInput): Promise<SongNote> {
    // The database's rule, kept by hand: only the account whose folder the song is in.
    if (songOwner(input.trackId) !== input.ownerId) throw new Error('ONLY THE SONG’S UPLOADER CAN DO THAT.');
    const notes = loadNotes();
    const was = notes[input.trackId];
    let picture: string | null = was?.picturePath ?? null;
    if (input.picture === null) picture = null;
    else if (input.picture !== 'keep') {
      const refusal = pictureRefusal(input.picture);
      if (refusal !== undefined) throw new Error(refusal);
      picture = await readAsDataUrl(input.picture);
    }
    const note: SongNote = { trackId: input.trackId, ownerId: input.ownerId, picturePath: picture, pictureSrc: picture, description: cleanNote(input.description), updatedAt: new Date().toISOString() };
    if (hasStorage()) {
      try {
        window.localStorage.setItem(NOTES_KEY, JSON.stringify({ ...notes, [input.trackId]: note }));
      } catch {
        throw new Error('THE PICTURE IS TOO BIG FOR THIS BROWSER.');
      }
    }
    return note;
  }

  async toggleBarr(userId: string, src: string): Promise<{ barred: boolean }> {
    const record = recordFor(userId);
    const barrs = record.barrs ?? [];
    const already = barrs.includes(src);

    writeRecord(userId, { ...record, barrs: already ? barrs.filter((entry) => entry !== src) : [src, ...barrs] });

    return { barred: !already };
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

  /**
   * This account's own queue - and it takes the account, which is the fix for a real hole.
   *
   * It used to read whichever account had last published *in this browser*, so signing in as a second
   * person on a shared machine showed them the first person's queue, private or not. The Supabase
   * implementation never had that bug because the policy refuses it; a mock has no policy, so it has to be
   * told whose row it is. That is the whole reason the parameter exists.
   */
  async readOwnQueue(userId: string): Promise<OwnQueue | null> {
    return loadQueues().find((queue) => queue.userId === userId) ?? null;
  }

  async publishQueue(input: PublishQueueInput): Promise<void> {
    const current = loadQueues();
    const previous = current.find((queue) => queue.userId === input.userId);
    const rows = current.filter((queue) => queue.userId !== input.userId);

    rows.push({
      userId: input.userId,
      trackId: input.trackId,
      trackIndex: input.trackIndex,
      trackTotal: Math.max(1, input.trackTotal),
      positionSeconds: Math.max(0, input.positionSeconds),
      isPublic: input.isPublic,
      isPlaying: input.isPlaying ?? true,
      // The start survives a move: `startedAt` is when this person began broadcasting, which is what a
      // listener reads as "how long they have been on", so re-writing it on every track change would
      // reset a number that is supposed to grow.
      startedAt: previous?.startedAt ?? new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    persistQueues(rows);
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
