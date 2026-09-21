import type { ForumAuthor } from '../forum/types';

/**
 * Domain types for public profiles.
 *
 * A profile is the public face of an account: a picture with a documented
 * history, a bio, the tags other users have given you, and the comments people
 * left on the profile and on the picture itself.
 *
 * Like the forum types, these are storage agnostic so the mock store
 * (app/lib/profile/mock-profile-repository.ts) can be swapped for Supabase
 * without touching a component.
 */

export type ProfileDataSource = 'mock' | 'supabase';

/** Field limits, shared by the forms, the customiser and the repository. */
export const MAX_BIO_LENGTH = 400;
export const MAX_COMMENT_LENGTH = 400;
export const MAX_TAG_LABEL_LENGTH = 24;
export const MAX_LOCATION_LENGTH = 40;

/** What the owner lets visitors see. Everything private is off by default. */
export type ProfileVisibility = {
  /** Tags other users gave you: hidden by default. */
  showTags: boolean;
  /** Comments left directly on the profile: hidden by default. */
  showProfileComments: boolean;
  /** Comments left on the picture itself. */
  showAvatarComments: boolean;
};

/**
 * One picture in the profile's history.
 *
 * The history is append-only: replacing the picture, and even restoring an
 * older one, adds a version instead of overwriting, so comments always keep
 * pointing at the drawing they were written against.
 */
export type AvatarVersion = {
  id: string;
  /** 1-based and never reused: the number comments are stamped with. */
  version: number;
  /** Path under `assets/` (or a storage URL once Supabase Storage is wired). */
  src: string;
  alt: string;
  /** Why the picture changed, written by the owner. */
  note: string;
  createdAt: string;
  /** Set when the owner restored an older drawing instead of drawing a new one. */
  restoredFromVersion?: number;
};

export type ProfileAvatar = {
  /** Oldest first. */
  versions: AvatarVersion[];
  /** The version on display: always the newest entry. */
  currentVersionId: string | null;
};

/** A tag another user gave you. Hidden until you choose to show it. */
export type GivenTag = {
  id: string;
  label: string;
  colour?: string;
  givenBy: ForumAuthor;
  givenAt: string;
  /** Hidden by default; only shows when the owner reveals it. */
  hidden: boolean;
};

/** A comment left on the profile, or on the picture. */
export type ProfileComment = {
  id: string;
  kind: 'profile' | 'avatar';
  author: ForumAuthor;
  body: string;
  createdAt: string;
  /** Picture comments record the version they were written against. */
  avatarVersionId?: string;
  avatarVersionNumber?: number;
};

export type PublicProfile = {
  userId: string;
  /** Public label; the account name signs posts, this signs the profile page. */
  displayName: string;
  bio: string;
  /** Optional place line, shown next to the name on posts and on the profile. */
  location: string;
  avatar: ProfileAvatar;
  visibility: ProfileVisibility;
  tags: GivenTag[];
  comments: ProfileComment[];
  updatedAt: string;
};

export type ProfilePatch = {
  displayName?: string;
  bio?: string;
  location?: string;
  visibility?: Partial<ProfileVisibility>;
};

export type AddAvatarVersionInput = {
  src: string;
  alt?: string;
  note?: string;
};

export type AddProfileCommentInput = {
  kind: ProfileComment['kind'];
  author: ForumAuthor;
  body: string;
  /** Picture comments only: the version to attach (defaults to the current one). */
  avatarVersionId?: string;
};

export type GiveTagInput = {
  label: string;
  colour?: string;
  givenBy: ForumAuthor;
};

export type ProfileCommentKind = ProfileComment['kind'];

/**
 * Storage contract for profiles.
 *
 * Supabase swap-in plan (build order step 3, alongside the forum tables):
 *   `getProfile`          -> `select *, profile_avatar_versions(*), profile_tags(*), profile_comments(*)`
 *   `saveProfile`         -> `update profiles set display_name, bio, show_* where id = auth.uid()`
 *   `addAvatarVersion`    -> insert into profile_avatar_versions + set profiles.current_version_id
 *   `restoreAvatarVersion`-> insert a new version row that copies the old `src`
 *   `giveTag`             -> insert into profile_tags (given_by = auth.uid())
 *   `setTagVisibility`    -> update profile_tags set hidden where the owner matches
 *   `addComment`          -> insert into profile_comments (kind, avatar_version_id)
 *   `subscribe`           -> `supabase.channel('profiles').on('postgres_changes', ...)`
 *
 * RLS: rows are readable when the owner's `show_*` flag allows it, and writable
 * only by the owner (`auth.uid() = user_id`) except `giveTag` / `addComment`,
 * which any signed-in user may insert and only their author may delete.
 */
export type ProfileRepository = {
  readonly source: ProfileDataSource;
  /** Null when nobody has set that profile up yet. */
  getProfile(userId: string): Promise<PublicProfile | null>;
  saveProfile(userId: string, patch: ProfilePatch): Promise<PublicProfile>;
  addAvatarVersion(userId: string, input: AddAvatarVersionInput): Promise<PublicProfile>;
  /** Append-only restore: keeps the old drawings and their comments intact. */
  restoreAvatarVersion(userId: string, versionId: string): Promise<PublicProfile>;
  setTagVisibility(userId: string, tagId: string, hidden: boolean): Promise<PublicProfile>;
  giveTag(userId: string, input: GiveTagInput): Promise<PublicProfile>;
  removeTag(userId: string, tagId: string): Promise<PublicProfile>;
  addComment(userId: string, input: AddProfileCommentInput): Promise<PublicProfile>;
  /** Realtime hook: fires with a fresh snapshot whenever a profile changes. */
  subscribe(listener: (profile: PublicProfile) => void): () => void;
  /** Mock-only helper so local test profiles can be purged. */
  clearLocalProfiles?(): Promise<void>;
};
