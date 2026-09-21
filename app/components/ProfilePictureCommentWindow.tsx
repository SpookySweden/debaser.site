'use client';

import type { ForumAuthor } from '../lib/forum/types';
import type { ProfileRepository, PublicProfile } from '../lib/profile/types';
import {
  avatarVersionById,
  avatarVersionsNewestFirst,
  currentAvatarVersion,
} from '../lib/profile/visibility';
import PopoutWindow from './PopoutWindow';
import ProfileAvatar from './ProfileAvatar';
import ProfileCommentBox from './ProfileCommentBox';

/** The size the picture is drawn at everywhere, so a preview is never a surprise. */
const PICTURE_SIZE = 176;

type ProfilePictureCommentWindowProps = {
  profile: PublicProfile;
  repository: ProfileRepository;
  /** Who the comment is filed under. */
  viewer: ForumAuthor;
  owner: boolean;
  /** The version on screen, which is the one being commented on. */
  selectedId: string;
  /** Picking another version switches the picture *and* the page behind the window. */
  onSelect: (versionId: string) => void;
  onClose: () => void;
};

/**
 * Commenting on the drawing, in a window of its own.
 *
 * The comment box used to live under the picture on the profile page, which pushed
 * the page's other business further down every time somebody wanted to say something
 * about a drawing. It is behind the `[ COMMENT ]` button beside the version label
 * now, and what the window shows is what you are commenting on: the drawing stays on
 * screen while you type, and choosing another version from the list swaps it (hover
 * the list on a pointer device to preview one first).
 */
export default function ProfilePictureCommentWindow({
  profile,
  repository,
  viewer,
  owner,
  selectedId,
  onSelect,
  onClose,
}: ProfilePictureCommentWindowProps) {
  const versions = avatarVersionsNewestFirst(profile);
  const current = currentAvatarVersion(profile);
  const selected = avatarVersionById(profile, selectedId) ?? current;

  // Nothing to comment on: the window closes itself rather than showing an empty
  // frame, which is what happens if the last drawing is removed while it is open.
  if (selected === undefined) return null;

  const isCurrent = selected.id === profile.avatar.currentVersionId;

  return (
    <PopoutWindow
      title="COMMENT ON THE PICTURE"
      badge="[ PROFILE ]"
      onClose={onClose}
      status={`V${selected.version}${isCurrent ? ' :: CURRENT' : ''} :: THE DRAWING STAYS ON SCREEN WHILE YOU WRITE :: ESC CLOSES`}
    >
      <div className="flex flex-col gap-3 sm:flex-row">
        <div className="shrink-0 text-center">
          <ProfileAvatar version={selected} displayName={profile.displayName} size={PICTURE_SIZE} />
          <p className="mt-1 text-[10px] font-bold text-black">
            V{selected.version}
            {isCurrent ? ' (CURRENT)' : ''}
          </p>
          {selected.note.length === 0 ? null : (
            <p className="mx-auto mt-1 w-44 whitespace-pre-line text-[10px] text-black">{selected.note}</p>
          )}
        </div>

        <div className="min-w-0 flex-1">
          <ProfileCommentBox
            id={`avatar-comment-${profile.userId}`}
            title={owner ? 'COMMENT ON YOUR OWN PICTURE' : 'COMMENT ON THIS PICTURE'}
            placeholder="What do you make of this drawing?"
            submitLabel="[ FILE COMMENT ]"
            versions={versions.map((version) => ({
              id: version.id,
              label: version.id === profile.avatar.currentVersionId ? `V${version.version} (CURRENT)` : `V${version.version}`,
              preview: {
                src: version.src,
                alt: version.alt.length === 0 ? 'profile picture' : version.alt,
                width: PICTURE_SIZE,
                height: PICTURE_SIZE,
              },
            }))}
            versionId={selected.id}
            onVersionChange={onSelect}
            onSubmit={async (body) => {
              await repository.addComment(profile.userId, {
                kind: 'avatar',
                author: viewer,
                body,
                avatarVersionId: selected.id,
              });
            }}
          />
        </div>
      </div>
    </PopoutWindow>
  );
}
