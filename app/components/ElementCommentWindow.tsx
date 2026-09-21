'use client';

import type { ForumAuthor } from '../lib/forum/types';
import {
  commentsForElement,
  elementNoun,
  profileElementById,
  profileElements,
  type ProfileElement,
} from '../lib/profile/elements';
import type { ProfileRepository, PublicProfile } from '../lib/profile/types';
import { useMusicPlayer } from './MusicPlayerProvider';
import PopoutWindow from './PopoutWindow';
import ProfileAvatar from './ProfileAvatar';
import ProfileCommentBox from './ProfileCommentBox';

const BUTTON =
  'cursor-pointer rounded-none border-t border-l border-white border-r-2 border-b-2 border-black bg-[#c0c0c0] px-2 py-[2px] text-[10px] font-bold text-black hover:bg-gray-300 disabled:cursor-wait disabled:opacity-60';

/** The size the drawing is previewed at, so what is on screen is what is commented on. */
const PICTURE_SIZE = 176;

/** An element as the player wants it: one place, so the two cannot drift apart. */
export function elementAsTrack(profile: PublicProfile, element: ProfileElement) {
  return {
    id: `profile-track-${element.id}`,
    title: element.title,
    credit: element.credit.length === 0 ? profile.displayName : element.credit,
    kind: `PROFILE TRACK :: ${element.tag}`,
    src: element.src,
    length: '--:--',
    shelf: 'bucket' as const,
  };
}

type ElementCommentWindowProps = {
  profile: PublicProfile;
  repository: ProfileRepository;
  /** Who the comment is filed under. */
  viewer: ForumAuthor;
  owner: boolean;
  /** The version on screen, which is the one being commented on. */
  element: ProfileElement;
  /** Picking another version switches the element *and* the page behind the window. */
  onSelect: (versionId: string) => void;
  onClose: () => void;
};

/**
 * Commenting on a drawing, or on a track, in a window of its own.
 *
 * One window for both, because they are the same act: pick the version you mean (`P2`,
 * `M1`), look at or listen to it while you write, and file the remark. It replaces the two
 * nearly identical windows this used to take, which is what the tags are for - the version
 * options are labelled with the same `P`/`M` tags the rows carry, so a comment and the
 * thing it is about are named identically everywhere.
 *
 * What is on screen stays on screen: the drawing is drawn at the size the page draws it,
 * and a track can be played from here through the site's own player.
 */
export default function ElementCommentWindow({
  profile,
  repository,
  viewer,
  owner,
  element,
  onSelect,
  onClose,
}: ElementCommentWindowProps) {
  const player = useMusicPlayer();
  const kind = element.kind;
  const noun = elementNoun(kind);
  const versions = profileElements(profile, kind);
  // Read live: the profile can move under the window - a comment lands, a version is filed.
  const shown = profileElementById(profile, kind, element.id) ?? element;
  const count = commentsForElement(profile, shown).length;
  const playing = player.track?.src === shown.src && player.playing;

  return (
    <PopoutWindow
      title={`COMMENT ON THE ${noun}`}
      badge={`[ PROFILE :: ${shown.tag} ]`}
      onClose={onClose}
      status={`${shown.tag}${shown.current ? ' :: CURRENT' : ''} :: ${count} COMMENT${
        count === 1 ? '' : 'S'
      } ALREADY :: ESC CLOSES`}
    >
      <div className="flex flex-col gap-3 sm:flex-row">
        <div className="shrink-0 space-y-1">
          {kind === 'picture' ? (
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
          ) : (
            <>
              <div className="w-64 rounded-none border-2 border-t-gray-600 border-l-gray-600 border-r-white border-b-white bg-black px-2 py-1">
                <p className="truncate text-[11px] font-bold text-[#33ff33]">{shown.title}</p>
                <p className="mt-1 truncate text-[9px] text-[#1f9f1f]">
                  [ {shown.tag} ]{shown.current ? ' (CURRENT)' : ''} :: {shown.credit}
                </p>
              </div>

              <button
                type="button"
                onClick={() => (playing ? player.toggle() : player.play(elementAsTrack(profile, shown)))}
                className={BUTTON}
              >
                {playing ? '[ ❚❚ PAUSE ]' : '[ ▶ PLAY ]'}
              </button>
            </>
          )}

          {shown.note.length === 0 ? null : (
            <p className="w-64 whitespace-pre-line text-[10px] text-black">{shown.note}</p>
          )}
        </div>

        <div className="min-w-0 flex-1">
          <ProfileCommentBox
            id={`element-comment-${kind}-${profile.userId}`}
            title={owner ? `COMMENT ON YOUR OWN ${noun}` : `COMMENT ON THIS ${noun}`}
            placeholder={
              kind === 'picture' ? 'What do you make of this drawing?' : 'What do you make of this one?'
            }
            submitLabel="[ FILE COMMENT ]"
            versionLabel="WHICH ONE IS IT ABOUT?"
            versions={versions.map((version) => ({
              id: version.id,
              label: `${version.tag}${version.current ? ' (CURRENT)' : ''}`,
              ...(version.kind === 'picture'
                ? {
                    preview: {
                      src: version.src,
                      alt: version.credit,
                      width: PICTURE_SIZE,
                      height: PICTURE_SIZE,
                    },
                  }
                : {}),
            }))}
            versionId={shown.id}
            onVersionChange={onSelect}
            onSubmit={async (body) => {
              await repository.addComment(profile.userId, {
                kind: kind === 'picture' ? 'avatar' : 'song',
                author: viewer,
                body,
                ...(kind === 'picture' ? { avatarVersionId: shown.id } : { songVersionId: shown.id }),
              });
            }}
          />
        </div>
      </div>
    </PopoutWindow>
  );
}
