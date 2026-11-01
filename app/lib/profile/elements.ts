import type { AvatarVersion, ProfileComment, ProfileVisibility, PublicProfile, SongVersion } from './types';
import { avatarComments, songComments, withVisibilityDefaults } from './visibility';

/**
 * The two things on a profile that can be talked about, as one vocabulary.
 *
 * A drawing and a track are the same shape of thing on the page: an append-only history
 * of versions, a comment thread that belongs to whichever version is being looked at, and
 * an owner's note on each. They differ in what they show - a picture is looked at, a
 * track is listened to - so the two histories are read here through one set of helpers
 * and the same comment feature serves both.
 *
 * The tag is what makes a comment self-describing: pictures count `P1`, `P2`, ... and
 * tracks count `M1`, `M2`, ... - so `[ P2 ]` on a comment says exactly which drawing it
 * was written about, and `[ M1 ]` which mix, in the same three characters everywhere a
 * version is named. The number is stored with the comment when it is written (see
 * `avatarVersionNumber` / `songVersionNumber`), so a tag never re-points later.
 */

export type ProfileElementKind = 'picture' | 'track';

/** The one letter a version is counted with: pictures P, tracks M. */
export function elementPrefix(kind: ProfileElementKind): string {
  return kind === 'picture' ? 'P' : 'M';
}

/** `P2`, `M1`: what a version is called and what a comment is stamped with. */
export function elementTag(kind: ProfileElementKind, version: number): string {
  return `${elementPrefix(kind)}${version}`;
}

/** The word for the thing itself, for headings and buttons. */
export function elementNoun(kind: ProfileElementKind): string {
  return kind === 'picture' ? 'PICTURE' : 'TRACK';
}

/** One version of one of them, read the same way whichever it is. */
export type ProfileElement = {
  kind: ProfileElementKind;
  /** The version's own id, which is what a comment points at. */
  id: string;
  /** 1-based, never reused. */
  version: number;
  /** `P2` / `M1`. */
  tag: string;
  /** What the element is called: a picture has no name, a track does. */
  title: string;
  /** What the player streams, or the picture shows. */
  src: string;
  /** Generated alt text for a drawing; the credit for a track. */
  credit: string;
  /** The owner's note for this version. */
  note: string;
  createdAt: string;
  /** True for the version on display. */
  current: boolean;
  /** Set when this version was filed by putting an older one back. */
  restoredFromVersion?: number;
};

function pictureElement(version: AvatarVersion, currentId: string | null): ProfileElement {
  return {
    kind: 'picture',
    id: version.id,
    version: version.version,
    tag: elementTag('picture', version.version),
    title: 'PROFILE PICTURE',
    src: version.src,
    credit: version.alt,
    note: version.note,
    createdAt: version.createdAt,
    current: version.id === currentId,
    ...(version.restoredFromVersion === undefined ? {} : { restoredFromVersion: version.restoredFromVersion }),
  };
}

function trackElement(version: SongVersion, displayName: string, currentId: string | null): ProfileElement {
  return {
    kind: 'track',
    id: version.id,
    version: version.version,
    tag: elementTag('track', version.version),
    title: version.title.length === 0 ? `${displayName}'s TRACK` : version.title,
    src: version.src,
    credit: version.credit.length === 0 ? displayName : version.credit,
    note: version.note,
    createdAt: version.createdAt,

    current: version.id === currentId,
    ...(version.restoredFromVersion === undefined ? {} : { restoredFromVersion: version.restoredFromVersion }),
  };
}

/** One kind's versions, newest first - the order the history and the page read in. */
export function profileElements(profile: PublicProfile, kind: ProfileElementKind): ProfileElement[] {
  if (kind === 'picture') {
    return profile.avatar.versions
      .slice()
      .sort((a, b) => a.version - b.version)
      .map((version) => pictureElement(version, profile.avatar.currentVersionId))
      .reverse();
  }

  return profile.song.versions
    .slice()
    .sort((a, b) => a.version - b.version)
    .map((version) => trackElement(version, profile.displayName, profile.song.currentVersionId))
    .reverse();
}

/** The version on display, whichever element is being read. */
export function currentProfileElement(profile: PublicProfile, kind: ProfileElementKind): ProfileElement | undefined {
  const currentId = kind === 'picture' ? profile.avatar.currentVersionId : profile.song.currentVersionId;

  return profileElements(profile, kind).find((element) => element.id === currentId);
}

/** The version somebody picked, or nothing while they have not picked one. */
export function profileElementById(
  profile: PublicProfile,
  kind: ProfileElementKind,
  versionId: string | undefined,
): ProfileElement | undefined {
  if (versionId === undefined || versionId.length === 0) return undefined;

  return profileElements(profile, kind).find((element) => element.id === versionId);
}

/** Which element a stored comment belongs to. */
export function commentElementKind(comment: ProfileComment): ProfileElementKind | undefined {
  if (comment.kind === 'avatar') return 'picture';
  if (comment.kind === 'song') return 'track';

  return undefined;
}

/**
 * What a comment is stamped with: `P2` for the second drawing, `M1` for the first track.
 *
 * A comment on the profile itself has no tag - there is only one profile to talk about -
 * so it answers nothing and its row prints no chip.
 */
export function commentTag(comment: ProfileComment): string | undefined {
  const kind = commentElementKind(comment);
  if (kind === undefined) return undefined;

  const version = kind === 'picture' ? comment.avatarVersionNumber : comment.songVersionNumber;

  return version === undefined ? undefined : elementTag(kind, version);
}

/** Every comment on that kind of element, owner's view: hidden ones included. */
export function elementComments(profile: PublicProfile, kind: ProfileElementKind): ProfileComment[] {
  return kind === 'picture' ? avatarComments(profile) : songComments(profile);
}

/** The same, as a visitor sees them: nothing while the owner has them switched off. */
export function visibleElementComments(profile: PublicProfile, kind: ProfileElementKind): ProfileComment[] {
  const visibility = withVisibilityDefaults(profile.visibility);

  return canCommentOnElement(false, visibility, kind) ? elementComments(profile, kind) : [];
}

/** The thread of one version. */
export function commentsForElement(profile: PublicProfile, element: ProfileElement): ProfileComment[] {
  return elementComments(profile, element.kind).filter((comment) =>
    element.kind === 'picture' ? comment.avatarVersionId === element.id : comment.songVersionId === element.id,
  );
}

export function commentCountForElement(profile: PublicProfile, element: ProfileElement): number {
  return commentsForElement(profile, element).length;
}

/** Whether that element's thread may be written to: the owner's switch, or the owner. */
export function canCommentOnElement(owner: boolean, visibility: ProfileVisibility, kind: ProfileElementKind): boolean {
  if (owner) return true;

  return kind === 'picture' ? visibility.showAvatarComments : visibility.showSongComments;
}
