import { isSiteAccount } from '../auth/builtin-account';
import { SITE_AUTHOR } from '../forum/site-author';
import type { ForumAuthor } from '../forum/types';
import { ACCENT_COLOUR } from '../ui/controls';
import { isNameColour } from './name-colours';
import {
  MAX_BIO_LENGTH,
  MAX_COMMENT_LENGTH,
  MAX_LOCATION_LENGTH,
  MAX_SONG_CREDIT_LENGTH,
  MAX_SONG_TITLE_LENGTH,
  MAX_TAG_LABEL_LENGTH,
} from './types';
import type {
  AvatarVersion,
  GivenTag,
  ProfileComment,
  ProfileVisibility,
  PublicProfile,
  SongVersion,
} from './types';

/**
 * Profile privacy defaults and the selectors that enforce them.
 *
 * Tags given by other users stay off by default, because a profile's tags are somebody else's
 * writing about you. Comments are the opposite: a profile is a place to talk, and a reader who
 * cannot comment without being told to go and switch something on has been given a page that
 * looks broken. So profile comments - and the picture's, and the track's, which sit beside them
 * and are the point of the page - are on by default, and the owner switches off whatever they
 * would rather not read (`showProfileComments` in the customiser, and the same switch in
 * `supabase/schema.sql` with matching column defaults).
 */
export const DEFAULT_VISIBILITY: ProfileVisibility = {
  showTags: false,
  showProfileComments: true,
  showAvatarComments: true,
  showSongComments: true,
};

export function withVisibilityDefaults(visibility: Partial<ProfileVisibility> | undefined): ProfileVisibility {
  return { ...DEFAULT_VISIBILITY, ...visibility };
}

export function avatarVersionsOldestFirst(profile: PublicProfile): AvatarVersion[] {
  return [...profile.avatar.versions].sort((a, b) => a.version - b.version);
}

export function avatarVersionsNewestFirst(profile: PublicProfile): AvatarVersion[] {
  return avatarVersionsOldestFirst(profile).reverse();
}

export function currentAvatarVersion(profile: PublicProfile | null): AvatarVersion | undefined {
  if (profile === null || profile.avatar.currentVersionId === null) return undefined;

  return profile.avatar.versions.find((version) => version.id === profile.avatar.currentVersionId);
}

export function avatarVersionById(profile: PublicProfile, versionId: string | undefined): AvatarVersion | undefined {
  if (versionId === undefined) return undefined;
  return profile.avatar.versions.find((version) => version.id === versionId);
}

/* The song beside the picture: the same selectors, one track instead of one drawing - */

export function songVersionsOldestFirst(profile: PublicProfile): SongVersion[] {
  return [...profile.song.versions].sort((a, b) => a.version - b.version);
}

export function songVersionsNewestFirst(profile: PublicProfile): SongVersion[] {
  return songVersionsOldestFirst(profile).reverse();
}

export function currentSongVersion(profile: PublicProfile | null): SongVersion | undefined {
  if (profile === null || profile.song.currentVersionId === null) return undefined;

  return profile.song.versions.find((version) => version.id === profile.song.currentVersionId);
}

export function songVersionById(profile: PublicProfile, versionId: string | undefined): SongVersion | undefined {
  if (versionId === undefined) return undefined;
  return profile.song.versions.find((version) => version.id === versionId);
}

/** Whether the song may be commented on: the same rule as the picture. */
export function canCommentOnSong(owner: boolean, visibility: ProfileVisibility): boolean {
  return owner || visibility.showSongComments;
}

export function songComments(profile: PublicProfile): ProfileComment[] {
  return profile.comments.filter((comment) => comment.kind === 'song');
}

export function visibleSongComments(profile: PublicProfile): ProfileComment[] {
  return profile.visibility.showSongComments ? songComments(profile) : [];
}

export function commentsForSongVersion(profile: PublicProfile, version: SongVersion): ProfileComment[] {
  return songComments(profile).filter((comment) => comment.songVersionId === version.id);
}

export function commentCountForSongVersion(profile: PublicProfile, version: SongVersion): number {
  return commentsForSongVersion(profile, version).length;
}

/** How many comments a song version is holding, for the history rows. */
export function songVersionLabel(profile: PublicProfile, version: SongVersion): string {
  return version.id === profile.song.currentVersionId ? `V${version.version} (CURRENT)` : `V${version.version}`;
}

/**
 * The one track an account wears, as the player wants it.
 *
 * The profile page hands this to the site's player rather than drawing a second audio
 * element, so pressing play beside a picture plays that track in the bar at the bottom
 * of the window - and keeps playing it while the reader moves on.
 */
export function songAsPlayerTrack(
  profile: PublicProfile,
  version: SongVersion,
): { id: string; title: string; credit: string; kind: string; src: string; length: string; shelf: 'bucket' } {
  return {
    id: `profile-song-${version.id}`,
    title: version.title.length === 0 ? `${profile.displayName}'s TRACK` : version.title,
    credit: version.credit.length === 0 ? profile.displayName : version.credit,
    kind: `PROFILE SONG :: V${version.version}`,
    src: version.src,
    length: '--:--',
    shelf: 'bucket',
  };
}

/** Tags a visitor is allowed to see: the global switch, then the per-tag switch. */
export function visibleGivenTags(profile: PublicProfile) {
  if (!profile.visibility.showTags) return [];
  return profile.tags.filter((tag) => !tag.hidden);
}

/**
 * Tag rules, in one place, because three surfaces have to agree: the profile page's
 * tag list, the account page's summary and the customiser.
 *
 *   - a tag is *pending* until the profile's owner approves it. `hidden` is that
 *     flag in the store, which is what the database column has always meant, so no
 *     schema change is needed - approving is simply switching it off;
 *   - a tag the house account gives arrives approved. The admin does not need the
 *     approval of the person they are tagging, and may give as many as they like;
 *   - the owner may show exactly one tag they gave themselves, so a page cannot be
 *     stacked with its own badges. The store enforces that on approval, in both
 *     implementations (see the profile repositories), so every surface inherits it.
 */
export const TAGS_BEFORE_EXPANDING = 6;

/**
 * The tag every account is given on arrival.
 *
 * A profile opens empty: no picture, no bio, no tags. That is honest, but it is also a page with
 * nothing on it to say what this place is, and the tag list is the first part of it a visitor reads.
 * So one tag is filed for every account the moment its profile exists - `NEW HERE`, given by the
 * house account, which is the only giver whose tags arrive already approved (see
 * `isAdminGivenTag` below).
 *
 * It is deliberately not a label an owner has to clear before the page looks like theirs: it is the
 * one tag they can delete, and the customiser's tag box already offers that. What it is for is the
 * first minute - a guest opening a fresh profile sees that tags are a thing here and that somebody
 * has been paying attention, rather than an empty heading.
 *
 * The id is fixed and readable rather than generated, because it has to be recognisable across
 * stores: a profile loaded from localStorage, from Supabase or from a mock all carry the *same*
 * row, so `isDefaultTag` can recognise it and no store ends up with a second one.
 */
export const DEFAULT_PROFILE_TAG = {
  id: 'tag-default-new-here',
  label: 'NEW HERE',
} as const;

/**
 * The default tag's colour: the site's own Royal Blue.
 *
 * Taken from `ACCENT_COLOUR` rather than written out again, because it is the same dye the swatch
 * declares for `ena` and a second copy of `#1d3ca6` is a second thing to move when the palette does.
 * A profile's first tag is the archive's welcome, so it wears the archive's colour.
 */
export const DEFAULT_PROFILE_TAG_COLOUR = ACCENT_COLOUR;

/** A tag is the welcome one when it is the tag above - matched on the id, not on the words. */
export function isDefaultTag(tag: GivenTag): boolean {
  return tag.id === DEFAULT_PROFILE_TAG.id;
}

/**
 * The welcome tag, stamped for one account at one moment.
 *
 * Built here rather than in either repository so the mock store and Supabase file *the same row*:
 * two implementations that each wrote their own id would drift the first time one of them changed a
 * word, which is exactly the bug the shared id above exists to prevent.
 *
 * The id is a constant rather than derived from the owner, because one account has one welcome: a
 * profile is only ever built empty once, and a second one would be a bug rather than a feature. The
 * Supabase side derives its uuid from the profile id purely so a re-run of the schema is idempotent;
 * the app never has to, because `emptyProfile` is the only thing that calls this.
 */
export function defaultProfileTag(givenAt: string): GivenTag {
  return {
    id: DEFAULT_PROFILE_TAG.id,
    label: DEFAULT_PROFILE_TAG.label,
    colour: DEFAULT_PROFILE_TAG_COLOUR,
    // The house account gives it, so it arrives approved and is not the owner's own badge - the
    // "only one self-given tag shows" rule does not spend itself on a welcome.
    givenBy: SITE_AUTHOR,
    givenAt,
    hidden: false,
  };
}

/** The house account's tags: approved on arrival, and unlimited. */
export function isAdminGivenTag(tag: GivenTag): boolean {
  return tag.givenBy.id !== null && isSiteAccount(tag.givenBy.id);
}

/** A tag the profile's own owner gave themselves. */
export function isSelfGivenTag(tag: GivenTag, ownerId: string): boolean {
  return tag.givenBy.id === ownerId;
}

export function isApprovedTag(tag: GivenTag): boolean {
  return !tag.hidden;
}

/** Approved tags, oldest first: what the page's tag list shows. */
export function approvedTags(profile: PublicProfile): GivenTag[] {
  return profile.tags.filter((tag) => !tag.hidden);
}

/** Waiting on the owner. Only the owner's view lists these. */
export function pendingTags(profile: PublicProfile): GivenTag[] {
  return profile.tags.filter((tag) => tag.hidden);
}

/**
 * Every comment the page shows *this* reader: the profile's own, the picture's and the track's.
 *
 * `visibleProfileComments` answers for one list - the panel at the foot of the page - and the
 * feed that runs under the columns carries all three, so it needs its own answer. Each kind is
 * gated by the owner's switch for that thread, exactly as the element threads are gated
 * individually (see `visibleElementComments`); the owner's own view of it is simply
 * `profile.comments`, since the owner has nothing hidden from themselves.
 */
export function visibleFeedComments(profile: PublicProfile): ProfileComment[] {
  const visibility = withVisibilityDefaults(profile.visibility);

  return profile.comments.filter((comment) => {
    if (comment.kind === 'profile') return visibility.showProfileComments;
    if (comment.kind === 'avatar') return visibility.showAvatarComments;

    return visibility.showSongComments;
  });
}

/**
 * Whether a tag has to wait for the owner before anybody sees it.
 *
 * Everything except the house account's own tags does - including a tag the owner
 * gives themselves, which still has to be approved (and retires their previous
 * self-given one when it is).
 */
export function tagArrivesApproved(giver: ForumAuthor): boolean {
  return giver.id !== null && isSiteAccount(giver.id);
}

/**
 * Whether the "give this profile a tag" box is offered.
 *
 * The owner always gets it, so tagging your own profile works exactly like
 * tagging somebody else's; a visitor gets it only while the owner lets tags
 * through, so a profile that hides them does not quietly collect more.
 */
export function canGiveTag(owner: boolean, visibility: ProfileVisibility): boolean {
  return owner || visibility.showTags;
}

/** Whether the picture may be commented on: the same rule as the profile itself. */
export function canCommentOnPicture(owner: boolean, visibility: ProfileVisibility): boolean {
  return owner || visibility.showAvatarComments;
}

/**
 * Whether the comment box on the profile itself is offered.
 *
 * Same rule as tags: the owner can always leave a comment on their own page, and
 * visitors only while comments are switched on.
 */
export function canCommentOnProfile(owner: boolean, visibility: ProfileVisibility): boolean {
  return owner || visibility.showProfileComments;
}

export function profileComments(profile: PublicProfile): ProfileComment[] {
  return profile.comments.filter((comment) => comment.kind === 'profile');
}

export function avatarComments(profile: PublicProfile): ProfileComment[] {
  return profile.comments.filter((comment) => comment.kind === 'avatar');
}

export function visibleProfileComments(profile: PublicProfile): ProfileComment[] {
  return profile.visibility.showProfileComments ? profileComments(profile) : [];
}

export function visibleAvatarComments(profile: PublicProfile): ProfileComment[] {
  return profile.visibility.showAvatarComments ? avatarComments(profile) : [];
}

export function commentsForVersion(profile: PublicProfile, version: AvatarVersion): ProfileComment[] {
  return avatarComments(profile).filter((comment) => comment.avatarVersionId === version.id);
}

export function commentCountForVersion(profile: PublicProfile, version: AvatarVersion): number {
  return commentsForVersion(profile, version).length;
}

/** Owner-side view: the customiser always sees everything, hidden or not. */
export function hiddenTagCount(profile: PublicProfile): number {
  return profile.tags.filter((tag) => tag.hidden).length;
}

export function validateBio(bio: string): string | undefined {
  if (bio.length > MAX_BIO_LENGTH) return `BIO MUST BE ${MAX_BIO_LENGTH} CHARACTERS OR FEWER.`;
  return undefined;
}

export function validateLocation(location: string): string | undefined {
  if (location.length > MAX_LOCATION_LENGTH) return `PLACE LINE MUST BE ${MAX_LOCATION_LENGTH} CHARACTERS OR FEWER.`;
  return undefined;
}

export function validateProfileComment(body: string): string | undefined {
  const trimmed = body.trim();
  if (trimmed.length < 2) return 'COMMENT IS TOO SHORT.';
  if (trimmed.length > MAX_COMMENT_LENGTH) return `COMMENT MUST BE ${MAX_COMMENT_LENGTH} CHARACTERS OR FEWER.`;
  return undefined;
}

export function validateTagLabel(label: string): string | undefined {
  const trimmed = label.trim();
  if (trimmed.length < 2) return 'TAG IS TOO SHORT.';
  if (trimmed.length > MAX_TAG_LABEL_LENGTH) return `TAG MUST BE ${MAX_TAG_LABEL_LENGTH} CHARACTERS OR FEWER.`;
  return undefined;
}

export function validateAvatarNote(note: string): string | undefined {
  if (note.length > MAX_COMMENT_LENGTH) return `NOTE MUST BE ${MAX_COMMENT_LENGTH} CHARACTERS OR FEWER.`;
  return undefined;
}

export function validateSongTitle(title: string): string | undefined {
  const trimmed = title.trim();
  if (trimmed.length === 0) return 'THE TRACK NEEDS A TITLE.';
  if (trimmed.length > MAX_SONG_TITLE_LENGTH) {
    return `TITLES MUST BE ${MAX_SONG_TITLE_LENGTH} CHARACTERS OR FEWER.`;
  }

  return undefined;
}

export function validateSongCredit(credit: string): string | undefined {
  if (credit.length > MAX_SONG_CREDIT_LENGTH) {
    return `CREDITS MUST BE ${MAX_SONG_CREDIT_LENGTH} CHARACTERS OR FEWER.`;
  }

  return undefined;
}

/** A name colour is either empty (the default) or one of the eight dyes. */
export function validateNameColour(colour: string): string | undefined {
  if (colour.length === 0) return undefined;
  return isNameColour(colour) ? undefined : 'THAT COLOUR IS NOT ON THE SWATCH.';
}
