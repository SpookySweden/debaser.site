import { MAX_BIO_LENGTH, MAX_COMMENT_LENGTH, MAX_LOCATION_LENGTH, MAX_TAG_LABEL_LENGTH } from './types';
import type { AvatarVersion, ProfileComment, ProfileVisibility, PublicProfile } from './types';

/**
 * Profile privacy defaults and the selectors that enforce them.
 *
 * Everything a visitor should not see by default stays off: tags given by other
 * users, and comments left on the profile. Picture comments default to visible
 * because the picture gallery is the point of the page - the owner can still
 * switch them off in the customiser.
 */
export const DEFAULT_VISIBILITY: ProfileVisibility = {
  showTags: false,
  showProfileComments: false,
  showAvatarComments: true,
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

/** Tags a visitor is allowed to see: the global switch, then the per-tag switch. */
export function visibleGivenTags(profile: PublicProfile) {
  if (!profile.visibility.showTags) return [];
  return profile.tags.filter((tag) => !tag.hidden);
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
