import { createLocalId } from '../forum/ids';
import { isNameColour } from './name-colours';
import {
  DEFAULT_VISIBILITY,
  avatarVersionById,
  currentAvatarVersion,
  validateAvatarNote,
  validateBio,
  validateLocation,
  validateNameColour,
  validateProfileComment,
  validateTagLabel,
  withVisibilityDefaults,
} from './visibility';
import type {
  AddAvatarVersionInput,
  AddProfileCommentInput,
  AvatarVersion,
  GiveTagInput,
  GivenTag,
  ProfileComment,
  ProfilePatch,
  ProfileRepository,
  PublicProfile,
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
    (row.kind === 'profile' || row.kind === 'avatar') &&
    typeof row.body === 'string' &&
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
  return state;
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
    visibility: { ...DEFAULT_VISIBILITY },
    tags: [],
    comments: [],
    updatedAt: new Date().toISOString(),
  };
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

  async setTagVisibility(userId: string, tagId: string, hidden: boolean): Promise<PublicProfile> {
    return this.write(userId, (profile) => ({
      ...profile,
      tags: profile.tags.map((tag) => (tag.id === tagId ? { ...tag, hidden } : tag)),
    }));
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
        // Tags from other users stay hidden until the owner shows them.
        hidden: true,
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

      if (input.kind === 'avatar') {
        version = avatarVersionById(profile, input.avatarVersionId) ?? currentAvatarVersion(profile);
        if (version === undefined) throw new Error('THERE IS NO PICTURE ON THIS PROFILE YET.');
      }

      const comment: ProfileComment = {
        id: createLocalId('profile-comment'),
        kind: input.kind,
        author: input.author,
        body: input.body.trim(),
        createdAt: new Date().toISOString(),
        // The version is captured at write time: later changes never re-point it.
        ...(version === undefined ? {} : { avatarVersionId: version.id, avatarVersionNumber: version.version }),
      };

      return { ...profile, comments: [...profile.comments, comment] };
    });
  }

  subscribe(listener: Listener): () => void {
    listeners.add(listener);

    return () => {
      listeners.delete(listener);
    };
  }

  async clearLocalProfiles(): Promise<void> {
    state = {};
    persist();
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
}
