'use client';

import { useState, type ReactNode } from 'react';
import { elementAsTrack } from '../lib/audio/profile-track';
import type { ForumAuthor } from '../lib/forum/types';
import {
  canCommentOnElement,
  commentsForElement,
  profileElementById,
  profileElements,
  type ProfileElement,
} from '../lib/profile/elements';
import type { ProfileCommentKind, ProfileRepository, PublicProfile } from '../lib/profile/types';
import { canCommentOnProfile } from '../lib/profile/visibility';
import { HYPER_LABEL, HYPER_MARK, HYPER_STRIP, HYPER_TEXT } from '../lib/ui/hypertext';
import { PLATE_MEDIUM } from '../lib/ui/controls';
import { useMusicPlayer } from './MusicPlayerProvider';
import PopoutWindow from './PopoutWindow';
import ProfileAvatar from './ProfileAvatar';
import ProfileCommentBox from './ProfileCommentBox';
import SheetImage from './SheetImage';

/** The size the drawing is previewed at, so what is on screen is what is commented on. */
const PICTURE_SIZE = 176;

/** What each aspect is called on the strip and in the status line. */
const ASPECT_LABEL: Record<ProfileCommentKind, string> = {
  avatar: 'profile picture',
  song: 'music',
  profile: 'general',
};

/** What each aspect is, in the window's own words, when it is the one being written about. */
const ASPECT_NOTE: Record<ProfileCommentKind, string> = {
  avatar: 'the drawing, as it stands in the version being read.',
  song: 'the track, as it stands in the version being read.',
  profile: 'the profile itself: the name, the biography, the tags and the page - not the picture, and not the music.',
};

/** One choice in a run of them: a link, with the one in force marked by the arrow. */
function Choice({
  active,
  onClick,
  title,
  children,
}: {
  active: boolean;
  onClick: () => void;
  title?: string;
  children: ReactNode;
}) {
  return (
    <button type="button" onClick={onClick} className={HYPER_TEXT} title={title} aria-pressed={active}>
      {active ? <span className={HYPER_MARK}>▸ </span> : null}
      {children}
    </button>
  );
}

/**
 * The versions of the element being written about, so an older drawing can be commented on
 * without leaving the window.
 *
 * Only drawn when there is a choice to make. A drawing carries its picture with it - the
 * pointer resting on `P1` shows what `P1` is - because `P1` on its own is not a thing
 * anybody can remember.
 */
function VersionStrip({
  versions,
  currentId,
  onSelect,
}: {
  versions: ProfileElement[];
  currentId: string;
  onSelect: (versionId: string) => void;
}) {
  if (versions.length <= 1) return null;

  return (
    <div className={`${HYPER_STRIP} mt-1`}>
      <span className={HYPER_LABEL}>VERSION:</span>

      {versions.map((version) => (
        <span key={version.id} className="group relative">
          <Choice
            active={version.id === currentId}
            onClick={() => onSelect(version.id)}
            title={version.kind === 'picture' ? `${version.tag} :: hover to see it` : `Comment on ${version.tag}`}
          >
            {version.tag}
            {version.current ? ' (current)' : ''}
          </Choice>

          {version.kind !== 'picture' ? null : (
            <span className="pointer-events-none absolute bottom-full left-0 z-10 mb-1 hidden w-40 rounded-none border-2 border-t-white border-l-white border-r-gray-800 border-b-gray-800 bg-sun-pale p-1 group-hover:block">
              <SheetImage
                src={version.src}
                alt={version.credit}
                width={PICTURE_SIZE}
                height={PICTURE_SIZE}
                sizes="160px"
              />
            </span>
          )}
        </span>
      ))}
    </div>
  );
}


/** The thing being written about, drawn the way the page draws it. */
function AspectPreview({
  profile,
  aspect,
  shown,
}: {
  profile: PublicProfile;
  aspect: ProfileCommentKind;
  shown: ProfileElement | undefined;
}) {
  const player = useMusicPlayer();
  const playing = shown !== undefined && player.track?.src === shown.src && player.playing;

  return (
    <div className="min-w-0 shrink-0 space-y-1">
      {aspect === 'avatar' && shown !== undefined ? (
        <ProfileAvatar
          version={{
            id: shown.id,
            version: shown.version,
            src: shown.src,
            alt: shown.credit,
            note: shown.note,
            createdAt: shown.createdAt,
          }}
          displayName={profile.displayName}
          size={PICTURE_SIZE}
          hideVersionLabel
        />
      ) : aspect === 'song' && shown !== undefined ? (
        <>
          <div className="w-64 rounded-none border-2 border-t-gray-600 border-l-gray-600 border-r-white border-b-white bg-black px-2 py-1">
            <p className="truncate text-[11px] font-bold text-[#33ff33]">{shown.title}</p>
            <p className="mt-1 truncate text-[9px] text-[#1f9f1f]">
              {shown.tag}
              {shown.current ? ' (current)' : ''} :: {shown.credit}
            </p>
          </div>

          <button
            type="button"
            onClick={() => (playing ? player.toggle() : player.play(elementAsTrack(profile, shown)))}
            className={PLATE_MEDIUM}
          >
            {playing ? '[ ❚❚ PAUSE ]' : '[ ▶ PLAY ]'}
          </button>
        </>
      ) : (
        <p className="w-56 text-[10px] font-bold text-black">{ASPECT_NOTE[aspect]}</p>
      )}

      {aspect !== 'profile' && shown !== undefined && shown.note.length > 0 ? (
        <p className="w-64 text-[10px] whitespace-pre-line text-black">{shown.note}</p>
      ) : null}
    </div>
  );
}

type ProfileCommentWindowProps = {
  profile: PublicProfile;
  repository: ProfileRepository;
  /** Who the comment is filed under. */
  viewer: ForumAuthor;
  /** Null for a guest, which the box says out loud. */
  viewerId: string | null;
  owner: boolean;
  /** Which aspect the window was opened on: the drawing, the track, or the profile. */
  initial: ProfileCommentKind;
  /** The versions being read, which is what the two element aspects comment on. */
  picture: ProfileElement | undefined;
  track: ProfileElement | undefined;
  /** Picking another version moves the page behind the window too. */
  onSelect: (kind: ProfileCommentKind, versionId: string) => void;
  onClose: () => void;
};

/**
 * Commenting on a profile, in a window of its own.
 *
 * One window for the three things a profile can be commented on - the profile picture, the
 * music, and the profile itself - because they are the same act: say what you mean, look at
 * it while you write, file it. Which one is being commented on is the first thing the window
 * asks, as a run of links inside one thin border where the version buttons used to sit:
 * `▸ profile picture (P2)  music (M1)  general`. So a remark on any of the three is one
 * click from the profile, and the profile has one comment window rather than one per
 * surface.
 *
 * What is on screen stays on screen: the drawing is drawn at the size the page draws it, a
 * track can be played from here through the site's own player, and a version that is not the
 * one being read can be chosen from the strip under the choices.
 */
export default function ProfileCommentWindow({
  profile,
  repository,
  viewer,
  viewerId,
  owner,
  initial,
  picture,
  track,
  onSelect,
  onClose,
}: ProfileCommentWindowProps) {
  // Which aspects this viewer may write about at all: an aspect the owner has switched off,
  // or one the account has never filed, is not offered rather than offered and then refused.
  const offered: ProfileCommentKind[] = [];
  if (picture !== undefined && canCommentOnElement(owner, profile.visibility, 'picture')) offered.push('avatar');
  if (track !== undefined && canCommentOnElement(owner, profile.visibility, 'track')) offered.push('song');
  if (canCommentOnProfile(owner, profile.visibility)) offered.push('profile');

  const [aspect, setAspect] = useState<ProfileCommentKind>(
    offered.includes(initial) ? initial : (offered[0] ?? initial),
  );

  // Read live: the profile can move under the window - a comment lands, a version is filed.
  const shown =
    aspect === 'avatar'
      ? (profileElementById(profile, 'picture', picture?.id ?? '') ?? picture)
      : aspect === 'song'
        ? (profileElementById(profile, 'track', track?.id ?? '') ?? track)
        : undefined;

  const versions = profileElements(profile, aspect === 'avatar' ? 'picture' : 'track');
  const count = shown === undefined ? 0 : commentsForElement(profile, shown).length;
  const label = ASPECT_LABEL[aspect];

  return (
    <PopoutWindow
      title={`COMMENT ON THE ${aspect === 'profile' ? 'PROFILE' : label.toUpperCase()}`}
      badge={`[ PROFILE :: ${profile.displayName} ]`}
      onClose={onClose}
      status={
        offered.length === 0
          ? 'COMMENTING ON THIS PROFILE IS SWITCHED OFF :: ESC CLOSES'
          : `ABOUT: ${label.toUpperCase()}${shown === undefined ? '' : ` :: ${shown.tag} :: ${count} ALREADY`} :: ESC CLOSES`
      }
    >
      {offered.length === 0 ? (
        <p className="text-[10px] font-bold text-black">
          NOTHING ON THIS PROFILE CAN BE COMMENTED ON RIGHT NOW - THE OWNER HAS THE THREADS SWITCHED OFF.
        </p>
      ) : (
        <div className="flex flex-col gap-3 sm:flex-row">
          <AspectPreview profile={profile} aspect={aspect} shown={shown} />

          <div className="min-w-0 flex-1">
            <ProfileCommentBox
              id={`profile-comment-${aspect}-${profile.userId}`}
              title={owner ? `COMMENT ON YOUR OWN ${label.toUpperCase()}` : `COMMENT ON THIS ${label.toUpperCase()}`}
              placeholder={
                aspect === 'avatar'
                  ? 'What do you make of this drawing?'
                  : aspect === 'song'
                    ? 'What do you make of this one?'
                    : 'Say something about this profile...'
              }
              submitLabel="[ FILE COMMENT ]"
              chooser={
                <div>
                  <div className={HYPER_STRIP}>
                    <span className={HYPER_LABEL}>ABOUT:</span>

                    {offered.map((option) => (
                      <Choice
                        key={option}
                        active={option === aspect}
                        onClick={() => setAspect(option)}
                        title={ASPECT_NOTE[option]}
                      >
                        {ASPECT_LABEL[option]}
                        {option === 'avatar' && picture !== undefined ? ` (${picture.tag})` : ''}
                        {option === 'song' && track !== undefined ? ` (${track.tag})` : ''}
                      </Choice>
                    ))}
                  </div>

                  {aspect === 'profile' || shown === undefined ? null : (
                    <VersionStrip
                      versions={versions}
                      currentId={shown.id}
                      onSelect={(versionId) => onSelect(aspect, versionId)}
                    />
                  )}
                </div>
              }
              footer={
                viewerId === null ? 'COMMENTS FROM GUESTS ARE SIGNED ANONYMOUS (GUEST) - LOG IN TO SIGN YOURS.' : null
              }
              onSubmit={async (body) => {
                if (aspect === 'profile') {
                  await repository.addComment(profile.userId, { kind: 'profile', author: viewer, body });
                  return;
                }

                if (shown === undefined) return;

                await repository.addComment(profile.userId, {
                  kind: aspect,
                  author: viewer,
                  body,
                  ...(aspect === 'avatar' ? { avatarVersionId: shown.id } : { songVersionId: shown.id }),
                });
              }}
            />
          </div>
        </div>
      )}
    </PopoutWindow>
  );
}
