import { createLocalId } from '../forum/ids';
import {
  SITE_ACCOUNT_DISPLAY_NAME,
  SITE_ACCOUNT_ID,
  SITE_ACCOUNT_NAME_COLOUR,
} from '../auth/builtin-account';
import { isNameColour } from './name-colours';
import type { PresenceRecord } from './presence';
import {
  DEFAULT_VISIBILITY,
  avatarVersionById,
  currentAvatarVersion,
  currentSongVersion,
  isSelfGivenTag,
  songVersionById,
  tagArrivesApproved,
  validateAvatarNote,
  validateBio,
  validateLocation,
  validateNameColour,
  validateProfileComment,
  validateSongCredit,
  validateSongTitle,
  validateTagLabel,
  withVisibilityDefaults,
} from './visibility';
import type {
  AddAvatarVersionInput,
  AddProfileCommentInput,
  AddSongVersionInput,
  AvatarVersion,
  GiveTagInput,
  GivenTag,
  ProfileComment,
  ProfileCommentEntry,
  ProfilePatch,
  ProfileRepository,
  PublicProfile,
  SongVersion,
} from './types';

/**
 * Profile storage used while Supabase is not wired up.
 *
 * Everything lives in localStorage next to the board's own rows, so a profile
 * set up in this browser survives navigation and reloads. `subscribe` mimics
 * Supabase Realtime: every write pushes a fresh snapshot to all listeners.
 *
 * The history is append-only. Replacing the picture adds a version; restoring an
 * older drawing adds a version that copies the old `src` and names the version
 * it came from. Comments on the picture store the version id and number they
 * were written against, so they never silently re-point at a newer drawing.
 */

const STORAGE_KEY = 'debaser.profile.mock.v1';
const STORAGE_VERSION = 1;

type PersistedState = {
  version: number;
  profiles: Record<string, PublicProfile>;
};

type Listener = (profile: PublicProfile) => void;

let state: Record<string, PublicProfile> | null = null;
const listeners = new Set<Listener>();

function hasStorage(): boolean {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

function isVersionShaped(value: unknown): value is AvatarVersion {
  if (typeof value !== 'object' || value === null) return false;
  const row = value as Partial<AvatarVersion>;

  return (
    typeof row.id === 'string' &&
    typeof row.version === 'number' &&
    typeof row.src === 'string' &&
    typeof row.createdAt === 'string'
  );
}

function isCommentShaped(value: unknown): value is ProfileComment {
  if (typeof value !== 'object' || value === null) return false;
  const row = value as Partial<ProfileComment>;

  return (
    typeof row.id === 'string' &&
    (row.kind === 'profile' || row.kind === 'avatar' || row.kind === 'song') &&
    typeof row.body === 'string' &&
    typeof row.createdAt === 'string'
  );
}

function isSongVersionShaped(value: unknown): value is SongVersion {
  if (typeof value !== 'object' || value === null) return false;
  const row = value as Partial<SongVersion>;

  return (
    typeof row.id === 'string' &&
    typeof row.version === 'number' &&
    typeof row.src === 'string' &&
    typeof row.title === 'string' &&
    typeof row.createdAt === 'string'
  );
}

function isTagShaped(value: unknown): value is GivenTag {
  if (typeof value !== 'object' || value === null) return false;
  const row = value as Partial<GivenTag>;

  return typeof row.id === 'string' && typeof row.label === 'string' && typeof row.givenAt === 'string';
}

/** Defensive read: an older or hand-edited payload still loads. */
function normaliseProfile(userId: string, value: unknown): PublicProfile | null {
  if (typeof value !== 'object' || value === null) return null;
  const row = value as Partial<PublicProfile>;
  const avatar = row.avatar ?? { versions: [], currentVersionId: null };
  const song = row.song ?? { versions: [], currentVersionId: null };

  return {
    userId,
    displayName: typeof row.displayName === 'string' ? row.displayName : 'Anonymous',
    // Only a swatch hex is kept, so an older or hand-edited row cannot smuggle
    // an arbitrary colour onto a username.
    ...(typeof row.nameColour === 'string' && isNameColour(row.nameColour) ? { nameColour: row.nameColour } : {}),
    bio: typeof row.bio === 'string' ? row.bio : '',
    location: typeof row.location === 'string' ? row.location : '',
    avatar: {
      versions: Array.isArray(avatar.versions) ? avatar.versions.filter(isVersionShaped) : [],
      currentVersionId: typeof avatar.currentVersionId === 'string' ? avatar.currentVersionId : null,
    },
    // A profile filed before songs existed simply has no song, which is what an empty
    // history means - so a payload from an older build loads without a migration.
    song: {
      versions: Array.isArray(song.versions) ? song.versions.filter(isSongVersionShaped) : [],
      currentVersionId: typeof song.currentVersionId === 'string' ? song.currentVersionId : null,
    },
    visibility: withVisibilityDefaults(row.visibility),
    tags: Array.isArray(row.tags) ? row.tags.filter(isTagShaped) : [],
    comments: Array.isArray(row.comments) ? row.comments.filter(isCommentShaped) : [],
    updatedAt: typeof row.updatedAt === 'string' ? row.updatedAt : new Date().toISOString(),
  };
}

function loadProfiles(): Record<string, PublicProfile> {
  if (!hasStorage()) return {};

  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (raw === null || raw.length === 0) return {};

  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return {};

    const candidate = parsed as Partial<PersistedState>;
    const rows: Record<string, unknown> =
      typeof candidate.profiles === 'object' && candidate.profiles !== null ? candidate.profiles : {};

    const profiles: Record<string, PublicProfile> = {};
    for (const [userId, value] of Object.entries(rows)) {
      const profile = normaliseProfile(userId, value);
      if (profile !== null) profiles[userId] = profile;
    }

    return profiles;
  } catch {
    return {};
  }
}

function ensureState(): Record<string, PublicProfile> {
  if (state === null) state = loadProfiles();
  // The house account always has a profile: it is the archive's own face, so its
  // dark blue name and its byline work before anybody has opened a customiser.
  // Anything the owner changes wins - this only ever fills a row that is missing.
  state[SITE_ACCOUNT_ID] ??= houseProfile();
  return state;
}

/** The house account's profile as it starts out (see ../auth/builtin-account.ts). */
function houseProfile(): PublicProfile {
  return {
    ...emptyProfile(SITE_ACCOUNT_ID, SITE_ACCOUNT_DISPLAY_NAME),
    nameColour: SITE_ACCOUNT_NAME_COLOUR,
  };
}

function persist(): void {
  if (!hasStorage()) return;

  const payload: PersistedState = { version: STORAGE_VERSION, profiles: ensureState() };

  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // Storage disabled or full: profiles keep working in memory.
  }
}

function commit(profile: PublicProfile): PublicProfile {
  ensureState()[profile.userId] = profile;
  persist();
  for (const listener of listeners) listener(profile);
  return profile;
}

/** A profile nobody has filled in yet: no picture, nothing shown to visitors. */
export function emptyProfile(userId: string, displayName: string): PublicProfile {
  return {
    userId,
    displayName,
    bio: '',
    location: '',
    avatar: { versions: [], currentVersionId: null },
    song: { versions: [], currentVersionId: null },
    visibility: { ...DEFAULT_VISIBILITY },
    tags: [],
    comments: [],
    updatedAt: new Date().toISOString(),
  };
}
/* Presence ------------------------------------------------------------------ */

/**
 * Presence lives under its own storage key.
 *
 * A heartbeat rewrites this row every minute, so keeping it beside the profiles
 * would mean rewriting every profile blob on the same tick for no reason. In
 * Supabase the two are one table again (`profiles.last_seen_at`), which is why
 * the methods sit on the profile repository rather than in a store of their own.
 */
const PRESENCE_STORAGE_KEY = 'debaser.presence.mock.v1';
const PRESENCE_STORAGE_VERSION = 1;

type PersistedPresence = {
  version: number;
  records: PresenceRecord[];
};

let presenceState: Record<string, PresenceRecord> | null = null;
const presenceListeners = new Set<(records: PresenceRecord[]) => void>();

function isPresenceShaped(value: unknown): value is PresenceRecord {
  if (typeof value !== 'object' || value === null) return false;
  const row = value as Partial<PresenceRecord>;

  return typeof row.userId === 'string' && typeof row.lastSeenAt === 'string' && typeof row.online === 'boolean';
}

function loadPresence(): Record<string, PresenceRecord> {
  if (!hasStorage()) return {};

  const raw = window.localStorage.getItem(PRESENCE_STORAGE_KEY);
  if (raw === null || raw.length === 0) return {};

  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return {};

    const candidate = parsed as Partial<PersistedPresence>;
    const rows = Array.isArray(candidate.records) ? candidate.records.filter(isPresenceShaped) : [];

    const records: Record<string, PresenceRecord> = {};
    for (const record of rows) records[record.userId] = record;
    return records;
  } catch {
    return {};
  }
}

function ensurePresence(): Record<string, PresenceRecord> {
  if (presenceState === null) presenceState = loadPresence();
  return presenceState;
}

/** Newest first would change the order under the dots, so this is sorted by id. */
function presenceSnapshot(): PresenceRecord[] {
  return Object.values(ensurePresence()).sort((a, b) => a.userId.localeCompare(b.userId));
}

function persistPresence(): void {
  if (!hasStorage()) return;

  const payload: PersistedPresence = { version: PRESENCE_STORAGE_VERSION, records: presenceSnapshot() };

  try {
    window.localStorage.setItem(PRESENCE_STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // Storage disabled or full: presence keeps working in memory.
  }
}

function commitPresence(record: PresenceRecord): PresenceRecord {
  ensurePresence()[record.userId] = record;
  persistPresence();

  const snapshot = presenceSnapshot();
  for (const listener of presenceListeners) listener(snapshot);

  return record;
}

function clearPresence(): void {
  presenceState = {};

  if (hasStorage()) {
    try {
      window.localStorage.removeItem(PRESENCE_STORAGE_KEY);
    } catch {
      // Nothing to clean up.
    }
  }

  for (const listener of presenceListeners) listener([]);
}



class MockProfileRepository implements ProfileRepository {
  readonly source = 'mock' as const;

  async getProfile(userId: string): Promise<PublicProfile | null> {
    return ensureState()[userId] ?? null;
  }

  /** Reads the row (creating an empty one on first write), applies `mutate`, saves. */
  private write(userId: string, mutate: (profile: PublicProfile) => PublicProfile): PublicProfile {
    const current = ensureState()[userId] ?? emptyProfile(userId, 'Anonymous');
    const next = mutate(current);

    return commit({ ...next, userId, updatedAt: new Date().toISOString() });
  }

  async saveProfile(userId: string, patch: ProfilePatch): Promise<PublicProfile> {
    if (patch.bio !== undefined) {
      const problem = validateBio(patch.bio);
      if (problem !== undefined) throw new Error(problem);
    }

    if (patch.location !== undefined) {
      const problem = validateLocation(patch.location);
      if (problem !== undefined) throw new Error(problem);
    }

    if (patch.nameColour !== undefined) {
      const problem = validateNameColour(patch.nameColour);
      if (problem !== undefined) throw new Error(problem);
    }

    return this.write(userId, (profile) => {
      const displayName = patch.displayName === undefined ? profile.displayName : patch.displayName.trim();

      return {
        ...profile,
        displayName: displayName.length === 0 ? profile.displayName : displayName,
        bio: patch.bio === undefined ? profile.bio : patch.bio.trim(),
        location: patch.location === undefined ? profile.location : patch.location.trim(),
        // An empty string is a real choice here: it means "back to the default".
        ...(patch.nameColour === undefined
          ? {}
          : patch.nameColour.length === 0
            ? { nameColour: undefined }
            : { nameColour: patch.nameColour }),
        visibility: withVisibilityDefaults({ ...profile.visibility, ...patch.visibility }),
      };
    });
  }

  async addAvatarVersion(userId: string, input: AddAvatarVersionInput): Promise<PublicProfile> {
    const noteProblem = validateAvatarNote(input.note ?? '');
    if (noteProblem !== undefined) throw new Error(noteProblem);
    if (input.src.trim().length === 0) throw new Error('NO PICTURE WAS CHOSEN.');

    return this.write(userId, (profile) => {
      const version = profile.avatar.versions.length + 1;
      const entry: AvatarVersion = {
        id: createLocalId('avatar-version'),
        version,
        src: input.src.trim(),
        alt: input.alt === undefined || input.alt.length === 0 ? `Profile picture v${version}` : input.alt,
        note: (input.note ?? '').trim(),
        createdAt: new Date().toISOString(),
      };

      return {
        ...profile,
        avatar: { versions: [...profile.avatar.versions, entry], currentVersionId: entry.id },
      };
    });
  }

  async restoreAvatarVersion(userId: string, versionId: string): Promise<PublicProfile> {
    return this.write(userId, (profile) => {
      const previous = profile.avatar.versions.find((version) => version.id === versionId);
      if (previous === undefined) throw new Error('THAT VERSION IS NOT IN THE HISTORY.');

      const version = profile.avatar.versions.length + 1;
      const entry: AvatarVersion = {
        id: createLocalId('avatar-version'),
        version,
        src: previous.src,
        alt: previous.alt,
        note: `RESTORED FROM V${previous.version}${previous.note.length === 0 ? '' : ` :: ${previous.note}`}`,
        createdAt: new Date().toISOString(),
        restoredFromVersion: previous.version,
      };

      return {
        ...profile,
        avatar: { versions: [...profile.avatar.versions, entry], currentVersionId: entry.id },
      };
    });
  }

  async addSongVersion(userId: string, input: AddSongVersionInput): Promise<PublicProfile> {
    const titleProblem = validateSongTitle(input.title);
    if (titleProblem !== undefined) throw new Error(titleProblem);

    const creditProblem = validateSongCredit(input.credit ?? '');
    if (creditProblem !== undefined) throw new Error(creditProblem);

    const noteProblem = validateAvatarNote(input.note ?? '');
    if (noteProblem !== undefined) throw new Error(noteProblem);

    if (input.src.trim().length === 0) throw new Error('NO TRACK WAS CHOSEN.');

    return this.write(userId, (profile) => {
      const version = profile.song.versions.length + 1;
      const entry: SongVersion = {
        id: createLocalId('song-version'),
        version,
        src: input.src.trim(),
        title: input.title.trim(),
        credit: (input.credit ?? '').trim(),
        note: (input.note ?? '').trim(),
        createdAt: new Date().toISOString(),
      };

      return {
        ...profile,
        song: { versions: [...profile.song.versions, entry], currentVersionId: entry.id },
      };
    });
  }

  async restoreSongVersion(userId: string, versionId: string): Promise<PublicProfile> {
    return this.write(userId, (profile) => {
      const previous = profile.song.versions.find((version) => version.id === versionId);
      if (previous === undefined) throw new Error('THAT TRACK IS NOT IN THE HISTORY.');

      const version = profile.song.versions.length + 1;
      const entry: SongVersion = {
        id: createLocalId('song-version'),
        version,
        src: previous.src,
        title: previous.title,
        credit: previous.credit,
        note: `RESTORED FROM V${previous.version}`,
        createdAt: new Date().toISOString(),
        restoredFromVersion: previous.version,
      };

      return {
        ...profile,
        song: { versions: [...profile.song.versions, entry], currentVersionId: entry.id },
      };
    });
  }

  async setTagVisibility(userId: string, tagId: string, hidden: boolean): Promise<PublicProfile> {
    return this.write(userId, (profile) => {
      const target = profile.tags.find((tag) => tag.id === tagId);
      // Approving a tag the owner gave themselves retires their other self-given
      // ones: a page may show exactly one of its own (see ./visibility.ts).
      const retireSelf = !hidden && target !== undefined && isSelfGivenTag(target, userId);

      return {
        ...profile,
        tags: profile.tags.map((tag) => {
          if (tag.id === tagId) return { ...tag, hidden };
          if (retireSelf && isSelfGivenTag(tag, userId)) return { ...tag, hidden: true };
          return tag;
        }),
      };
    });
  }

  async giveTag(userId: string, input: GiveTagInput): Promise<PublicProfile> {
    const problem = validateTagLabel(input.label);
    if (problem !== undefined) throw new Error(problem);

    const label = input.label.trim().toUpperCase();

    return this.write(userId, (profile) => {
      if (profile.tags.some((tag) => tag.label === label)) {
        throw new Error('THAT TAG IS ALREADY ON THIS PROFILE.');
      }

      const tag: GivenTag = {
        id: createLocalId('given-tag'),
        label,
        colour: input.colour,
        givenBy: input.givenBy,
        givenAt: new Date().toISOString(),
        // The house account's tags arrive approved - the admin does not wait on
        // anybody - and everything else waits for the owner (see ./visibility.ts).
        hidden: !tagArrivesApproved(input.givenBy),
      };

      return { ...profile, tags: [...profile.tags, tag] };
    });
  }

  async removeTag(userId: string, tagId: string): Promise<PublicProfile> {
    return this.write(userId, (profile) => ({
      ...profile,
      tags: profile.tags.filter((tag) => tag.id !== tagId),
    }));
  }

  async addComment(userId: string, input: AddProfileCommentInput): Promise<PublicProfile> {
    const problem = validateProfileComment(input.body);
    if (problem !== undefined) throw new Error(problem);

    return this.write(userId, (profile) => {
      let version: AvatarVersion | undefined;
      let song: SongVersion | undefined;

      if (input.kind === 'avatar') {
        version = avatarVersionById(profile, input.avatarVersionId) ?? currentAvatarVersion(profile);
        if (version === undefined) throw new Error('THERE IS NO PICTURE ON THIS PROFILE YET.');
      }

      if (input.kind === 'song') {
        song = songVersionById(profile, input.songVersionId) ?? currentSongVersion(profile);
        if (song === undefined) throw new Error('THERE IS NO SONG ON THIS PROFILE YET.');
      }

      const comment: ProfileComment = {
        id: createLocalId('profile-comment'),
        kind: input.kind,
        author: input.author,
        body: input.body.trim(),
        createdAt: new Date().toISOString(),
        // The version is captured at write time: later changes never re-point it.
        ...(version === undefined ? {} : { avatarVersionId: version.id, avatarVersionNumber: version.version }),
        ...(song === undefined ? {} : { songVersionId: song.id, songVersionNumber: song.version }),
      };

      return { ...profile, comments: [...profile.comments, comment] };
    });
  }

  /**
   * Every comment the store holds, newest first, with the page it was left on.
   *
   * The board shows these as threads of their own (app/lib/forum/profile-threads.ts), so this is the
   * one read that feeds it. A page whose owner has switched comments off is left out: the switch is
   * about the page carrying comments at all, and the board is a reading of those pages.
   */
  async listCommentFeed(limit = 200): Promise<ProfileCommentEntry[]> {
    const profiles = ensureState();

    return Object.values(profiles)
      .filter((profile) => profile.visibility.showProfileComments)
      .flatMap((profile) =>
        profile.comments.map((comment) => ({
          comment,
          userId: profile.userId,
          displayName: profile.displayName,
        })),
      )
      .sort((a, b) => b.comment.createdAt.localeCompare(a.comment.createdAt))
      .slice(0, limit);
  }

  /**
   * The owner's pin on a comment the page carries.
   *
   * Nothing about the comment changes but the mark and the moment it was taken: the words, the
   * byline and the time stay exactly as their author filed them, which is the whole point of a
   * pin being a separate thing rather than an edit. Any of the three kinds can carry one - the
   * page's own remarks, the picture's and the track's - because the feed that runs under the
   * columns carries all three, so a pin on a drawing's remark has somewhere to lead.
   */
  async setCommentPin(userId: string, commentId: string, pinned: boolean): Promise<PublicProfile> {
    return this.write(userId, (profile) => {
      const target = profile.comments.find((comment) => comment.id === commentId);
      if (target === undefined) throw new Error('THAT COMMENT IS NOT ON THIS PROFILE.');

      return {
        ...profile,
        comments: profile.comments.map((comment) =>
          comment.id === commentId
            ? {
                ...comment,
                ...(pinned ? { pinned: true, pinnedAt: new Date().toISOString() } : { pinned: false, pinnedAt: undefined }),
              }
            : comment,
        ),
      };
    });
  }

  subscribe(listener: Listener): () => void {
    listeners.add(listener);

    return () => {
      listeners.delete(listener);
    };
  }

  /**
   * The heartbeat: called as soon as somebody signs in, every minute after that,
   * and whenever the tab comes back to the front.
   */
  async markSeen(userId: string): Promise<PresenceRecord> {
    return commitPresence({ userId, lastSeenAt: new Date().toISOString(), online: true });
  }

  /**
   * The goodbye: the tab is closing, or the visitor signed out.
   *
   * `lastSeenAt` keeps the moment they were last around - that is what turns the
   * dot yellow instead of red - and saying goodbye twice never pushes it forward.
   */
  async markOffline(userId: string): Promise<PresenceRecord> {
    const previous = ensurePresence()[userId];
    const stillOnline = previous === undefined || previous.online;

    return commitPresence({
      userId,
      lastSeenAt: stillOnline ? new Date().toISOString() : (previous?.lastSeenAt ?? new Date().toISOString()),
      online: false,
    });
  }

  async getPresence(userId: string): Promise<PresenceRecord | null> {
    return ensurePresence()[userId] ?? null;
  }

  /** No ids means everything this store knows, which is what the board wants. */
  async listPresence(userIds?: string[]): Promise<PresenceRecord[]> {
    if (userIds === undefined || userIds.length === 0) return presenceSnapshot();

    const wanted = new Set(userIds);
    return presenceSnapshot().filter((record) => wanted.has(record.userId));
  }

  subscribePresence(listener: (records: PresenceRecord[]) => void): () => void {
    presenceListeners.add(listener);

    return () => {
      presenceListeners.delete(listener);
    };
  }

  async clearLocalProfiles(): Promise<void> {
    state = {};
    persist();
    clearPresence();

    for (const profile of Object.values(ensureState())) {
      for (const listener of listeners) listener(profile);
    }
  }
}

let mockProfileRepository: MockProfileRepository | null = null;

export function getMockProfileRepository(): ProfileRepository {
  if (mockProfileRepository === null) mockProfileRepository = new MockProfileRepository();
  return mockProfileRepository;
}

/** Test helper: wipes every profile this browser holds. */
export function resetMockProfiles(): void {
  state = {};
  persist();
  clearPresence();
}
