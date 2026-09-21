'use client';

import { useState } from 'react';
import { authorTag } from '../lib/auth/author';
import type { ForumAuthor } from '../lib/forum/types';
import type { ProfileRepository, PublicProfile } from '../lib/profile/types';
import {
  avatarComments,
  avatarVersionById,
  avatarVersionsNewestFirst,
  currentAvatarVersion,
  visibleAvatarComments,
} from '../lib/profile/visibility';
import ProfileCommentBox from './ProfileCommentBox';
import ProfileLink from './ProfileLink';
import ProfileName from './ProfileName';
import TimeStamp from './TimeStamp';

const BUTTON =
  'cursor-pointer rounded-none border-t border-l border-white border-r-2 border-b-2 border-black bg-[#c0c0c0] px-2 py-[2px] text-[10px] font-bold text-black hover:bg-gray-300 disabled:cursor-wait disabled:opacity-60';

type ProfilePicturePanelProps = {
  profile: PublicProfile;
  repository: ProfileRepository;
  /** Who a new comment is filed under, or null when the viewer cannot comment. */
  viewer: ForumAuthor | null;
  /** Owner view: hidden comments are listed too, and the box is titled as theirs. */
  owner: boolean;
  /** The version being looked at, which is the one the comments below belong to. */
  selectedId: string;
  onSelect: (versionId: string) => void;
};

/**
 * The picture's conversation, and the history behind an expander.
 *
 * The comments come first because they belong to the drawing above them: whichever
 * version is being looked at is the version being talked about, and its comments are
 * the thread. Picking another version from the history switches both - the drawing
 * and the conversation - which is what keeps an older drawing's remarks with the
 * older drawing (see the append-only note in app/lib/profile/types.ts).
 */
export default function ProfilePicturePanel({
  profile,
  repository,
  viewer,
  owner,
  selectedId,
  onSelect,
}: ProfilePicturePanelProps) {
  const versions = avatarVersionsNewestFirst(profile);
  const current = currentAvatarVersion(profile);
  const selected = avatarVersionById(profile, selectedId) ?? current;
  const [historyOpen, setHistoryOpen] = useState(false);

  const listed = owner ? avatarComments(profile) : visibleAvatarComments(profile);
  const thread = selected === undefined ? [] : listed.filter((comment) => comment.avatarVersionId === selected.id);
  const commentsSwitchedOff = !owner && !profile.visibility.showAvatarComments;

  return (
    <div className="space-y-2">
      {selected === undefined ? null : (
        <div className="space-y-1">
          <p className="text-[10px] font-bold">
            COMMENTS ON V{selected.version}
            {selected.id === profile.avatar.currentVersionId ? ' (CURRENT)' : ''} :: {thread.length}
            {commentsSwitchedOff ? ' :: HIDDEN BY THE OWNER' : ''}
          </p>

          {commentsSwitchedOff || thread.length === 0 ? (
            <p className="text-[10px] text-gray-700">
              {commentsSwitchedOff ? 'COMMENTS ON THE PICTURE ARE SWITCHED OFF.' : 'NOTHING HAS BEEN SAID ABOUT THIS ONE YET.'}
            </p>
          ) : (
            <ul className="space-y-1">
              {thread.map((comment) => (
                <li key={comment.id} className="rounded-none border border-gray-500 bg-white p-1">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-[10px] font-bold">
                    <span>
                      <ProfileLink author={comment.author}>
                        <ProfileName author={comment.author}>{authorTag(comment.author)}</ProfileName>
                      </ProfileLink>{' '}
                      <span className="text-gray-700">[ AT V{comment.avatarVersionNumber ?? selected.version} ]</span>
                    </span>
                    <TimeStamp at={comment.createdAt} />
                  </div>
                  <p className="mt-1 whitespace-pre-line text-xs">{comment.body}</p>
                </li>
              ))}
            </ul>
          )}

          {viewer === null || commentsSwitchedOff ? null : (
            <ProfileCommentBox
              id={`avatar-comment-${profile.userId}`}
              title={owner ? 'COMMENT ON YOUR OWN PICTURE' : 'COMMENT ON THIS PICTURE'}
              placeholder="What do you make of this drawing?"
              submitLabel="[ FILE COMMENT ]"
              versions={versions.map((version) => ({
                id: version.id,
                label:
                  version.id === profile.avatar.currentVersionId ? `V${version.version} (CURRENT)` : `V${version.version}`,
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
          )}
        </div>
      )}

      {versions.length === 0 ? null : (
        <div className="space-y-1">
          <div className="flex flex-wrap items-center justify-between gap-1">
            <span className="text-[10px] font-bold">
              VERSION HISTORY :: {versions.length} ON FILE :: EVERY OLDER DRAWING KEEPS ITS OWN COMMENTS
            </span>

            <button type="button" onClick={() => setHistoryOpen(!historyOpen)} className={BUTTON}>
              {historyOpen ? '[ HIDE HISTORY ]' : `[ SHOW HISTORY (${versions.length}) ]`}
            </button>
          </div>

          {historyOpen ? (
            <ul className="space-y-1">
              {versions.map((version) => {
                const count = listed.filter((comment) => comment.avatarVersionId === version.id).length;
                const looking = selected !== undefined && selected.id === version.id;

                return (
                  <li
                    key={version.id}
                    className={`rounded-none border border-gray-500 p-2 text-black ${
                      looking ? 'bg-[#ffffcc]' : 'bg-[#f0f0f0]'
                    }`}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2 text-[10px] font-bold">
                      <span>
                        V{version.version}
                        {version.id === profile.avatar.currentVersionId ? ' [ CURRENT ]' : ''} ::{' '}
                        <TimeStamp at={version.createdAt} /> :: {count} COMMENTS
                      </span>

                      <button
                        type="button"
                        onClick={() => onSelect(version.id)}
                        disabled={looking}
                        className={BUTTON}
                      >
                        {looking ? '[ LOOKING AT THIS ONE ]' : '[ LOOK AT THIS ONE ]'}
                      </button>
                    </div>

                    {version.note.length === 0 ? null : (
                      <p className="mt-1 whitespace-pre-line text-xs">{version.note}</p>
                    )}

                    {version.restoredFromVersion === undefined ? null : (
                      <p className="mt-1 text-[10px] font-bold">COPIED FROM V{version.restoredFromVersion}</p>
                    )}
                  </li>
                );
              })}
            </ul>
          ) : null}
        </div>
      )}
    </div>
  );
}
