import type { ForumAuthor } from '../forum/types';
import type { PresenceRecord } from './presence';

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
export const MAX_SONG_TITLE_LENGTH = 60;
export const MAX_SONG_CREDIT_LENGTH = 40;

/** What the owner lets visitors see. Everything private is off by default. */
export type ProfileVisibility = {
  /** Tags other users gave you: hidden by default. */
  showTags: boolean;
  /** Comments left directly on the profile: hidden by default. */
  showProfileComments: boolean;
  /** Comments left on the picture itself. */
  showAvatarComments: boolean;
  /** Comments left on the song beside the picture. */
  showSongComments: boolean;
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

/**
 * One track in the profile's song history.
 *
 * The same shape as a picture version, and the same rule: the history is append-only,
 * so a comment about a track keeps pointing at the track it was written about.
 */
export type SongVersion = {
  id: string;
  /** 1-based and never reused. */
  version: number;
  /** The audio file (a storage URL, or the archive's own `/assets/audio/...`). */
  src: string;
  title: string;
  /** Who the track is credited to. */
  credit: string;
  /** Why it is there, written by the owner. */
  note: string;
  createdAt: string;
  /** Set when the owner put an older track back. */
  restoredFromVersion?: number;
};

/** The one track an account wears, and the history behind it. */
export type ProfileSong = {
  /** Oldest first. */
  versions: SongVersion[];
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

/** A comment left on the profile, on the picture, or on the song. */
export type ProfileComment = {
  id: string;
  kind: 'profile' | 'avatar' | 'song';
  author: ForumAuthor;
  body: string;
  createdAt: string;
  /** Picture comments record the version they were written against. */
  avatarVersionId?: string;
  avatarVersionNumber?: number;
  /** The same, for the song beside the picture. */
  songVersionId?: string;
  songVersionNumber?: number;
};

export type PublicProfile = {
  userId: string;
  /** Public label; the account name signs posts, this signs the profile page. */
  displayName: string;
  /**
   * One of the 16 hexes in name-colours.ts, drawn on this account's username
   * wherever it appears. Missing means the default: the page's own black.
   */
  nameColour?: string;
  bio: string;
  /** Optional place line, shown next to the name on posts and on the profile. */
  location: string;
  avatar: ProfileAvatar;
  /** The one track beside the picture, with the history behind it. */
  song: ProfileSong;
  visibility: ProfileVisibility;
  tags: GivenTag[];
  comments: ProfileComment[];
  updatedAt: string;
  /**
   * Set while the house account has the account banned (supabase/schema.sql,
   * section 12). A banned account can read and write nothing, and its posts and
   * replies stop being shown to anybody but the admin - so this flag is how the
   * board and the directory say *why* a name has gone quiet.
   */
  banned?: boolean;
  /** The admin's own words, written when the ban was set. */
  bannedReason?: string;
};

export type ProfilePatch = {
  displayName?: string;
  bio?: string;
  location?: string;
  /** A swatch hex from name-colours.ts; an empty string clears it to the default. */
  nameColour?: string;
  visibility?: Partial<ProfileVisibility>;
};

export type AddAvatarVersionInput = {
  src: string;
  alt?: string;
  note?: string;
};

export type AddSongVersionInput = {
  src: string;
  title: string;
  credit?: string;
  note?: string;
};

export type AddProfileCommentInput = {
  kind: ProfileComment['kind'];
  author: ForumAuthor;
  body: string;
  /** Picture comments only: the version to attach (defaults to the current one). */
  avatarVersionId?: string;
  /** Song comments only: the version to attach (defaults to the current one). */
  songVersionId?: string;
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
 *   `saveProfile`         -> `update profiles set display_name, name_colour, bio, show_* where id = auth.uid()`
 *   `addAvatarVersion`    -> insert into profile_avatar_versions + set profiles.current_version_id
 *   `restoreAvatarVersion`-> insert a new version row that copies the old `src`
 *   `giveTag`             -> insert into profile_tags (given_by = auth.uid())
 *   `setTagVisibility`    -> update profile_tags set hidden where the owner matches
 *   `addComment`          -> insert into profile_comments (kind, avatar_version_id)
 *   `subscribe`           -> `supabase.channel('profiles').on('postgres_changes', ...)`
 *   `markSeen`            -> `update profiles set last_seen_at = now(), is_online = true where id = auth.uid()`
 *   `markOffline`         -> `update profiles set is_online = false where id = auth.uid()`
 *   `getPresence`         -> `select id, last_seen_at, is_online from profiles where id = $1`
 *   `listPresence`        -> the same, `where id in (...)` (or every row for `[]`)
 *   `subscribePresence`   -> `supabase.channel('presence')`, ideally Realtime Presence itself:
 *                            connect/disconnect events there are exact, and `is_online` then only
 *                            has to cover the "gone" write from a closing tab
 *
 * DDL for presence (additive):
 *   alter table public.profiles add column last_seen_at timestamptz;
 *   alter table public.profiles add column is_online boolean not null default false;
 * Read access has to widen for these two columns, or presence has to live on a
 * view/function: they are the one part of a profile that is always public, while
 * the rest of the row is gated by the owner's `show_*` flags.
 *
 * RLS: rows are readable when the owner's `show_*` flag allows it, and writable
 * only by the owner (`auth.uid() = user_id`) except `giveTag` / `addComment`,
 * which any signed-in user may insert - the owner included, since tagging and
 * commenting on your own page is the same action as doing it on somebody else's -
 * and only their author may delete.
 *
 * Seeding: the house account (see app/lib/auth/builtin-account.ts) needs its
 * profile row up front, because its dark blue name is drawn on every post an item
 * owns. The mock store fills a missing row in `ensureState`; on Supabase the same
 * row is inserted once, with `insert into public.profiles (id, display_name,
 * name_colour) values ('<the house auth user id>', 'debaser.site', '#000080')`.
 */
export type ProfileRepository = {
  readonly source: ProfileDataSource;
  /** Null when nobody has set that profile up yet. */
  getProfile(userId: string): Promise<PublicProfile | null>;
  saveProfile(userId: string, patch: ProfilePatch): Promise<PublicProfile>;
  addAvatarVersion(userId: string, input: AddAvatarVersionInput): Promise<PublicProfile>;
  /** Append-only restore: keeps the old drawings and their comments intact. */
  restoreAvatarVersion(userId: string, versionId: string): Promise<PublicProfile>;
  /**
   * Files the account's song, or the next one.
   *
   * Same rule as a picture: the file becomes the newest version and the earlier tracks
   * stay in the history with the comments written against them.
   */
  addSongVersion(userId: string, input: AddSongVersionInput): Promise<PublicProfile>;
  /** Puts an older track back by filing a version that copies it. */
  restoreSongVersion(userId: string, versionId: string): Promise<PublicProfile>;
  setTagVisibility(userId: string, tagId: string, hidden: boolean): Promise<PublicProfile>;
  giveTag(userId: string, input: GiveTagInput): Promise<PublicProfile>;
  removeTag(userId: string, tagId: string): Promise<PublicProfile>;
  addComment(userId: string, input: AddProfileCommentInput): Promise<PublicProfile>;
  /** Realtime hook: fires with a fresh snapshot whenever a profile changes. */
  subscribe(listener: (profile: PublicProfile) => void): () => void;

  /**
   * Presence: the account's own browser says it is still there.
   *
   * `markSeen` is the heartbeat while the site is open (the provider beats once a
   * minute, on tab focus, and as soon as somebody signs in); `markOffline` is the
   * goodbye when the tab closes or the visitor signs out. The dot the board draws
   * is worked out from the record alone, so a browser that dies mid-session
   * simply ages out of "online" instead of lying.
   */
  markSeen(userId: string): Promise<PresenceRecord>;
  markOffline(userId: string): Promise<PresenceRecord>;
  getPresence(userId: string): Promise<PresenceRecord | null>;
  /** One read for a whole page of names. No ids means everyone the store knows. */
  listPresence(userIds?: string[]): Promise<PresenceRecord[]>;
  /** Realtime hook: fires with a fresh snapshot whenever presence moves. */
  subscribePresence(listener: (records: PresenceRecord[]) => void): () => void;

  /** Mock-only helper so local test profiles can be purged. */
  clearLocalProfiles?(): Promise<void>;
};
