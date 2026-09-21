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
import ProfileAvatar from './ProfileAvatar';
import ProfileCommentBox from './ProfileCommentBox';
import ProfileLink from './ProfileLink';
import ProfileName from './ProfileName';
import TimeStamp from './TimeStamp';

type ProfilePictureHistoryProps = {
  profile: PublicProfile;
  repository: ProfileRepository;
  /** Who a new comment is filed under, or null when the viewer cannot comment. */
  viewer: ForumAuthor | null;
  /**
   * Owner view: hidden comments are listed too, and the box is titled as the
   * owner's own - the owner can comment on their own picture like anyone else.
   */
  owner: boolean;
};

/**
 * The picture and its documented history.
 *
 * Every version ever filed stays on the page, and each comment keeps the version
 * number it was written against - so a drawing can be replaced (or restored)
 * without silently re-pointing the conversation that happened under it.
 */
export default function ProfilePictureHistory({ profile, repository, viewer, owner }: ProfilePictureHistoryProps) {
  const versions = avatarVersionsNewestFirst(profile);
  const current = currentAvatarVersion(profile);
  const visible = owner ? avatarComments(profile) : visibleAvatarComments(profile);
  const [attachTo, setAttachTo] = useState(current?.id ?? '');

  const attachVersion = avatarVersionById(profile, attachTo) ?? current;

  return (
    <section className="rounded-none border-2 border-t-white border-l-white border-r-gray-800 border-b-gray-800 bg-[#c0c0c0]">
      <div className="flex items-center justify-between bg-[#000080] px-2 py-1 text-xs font-bold text-white">
        <span>PROFILE PICTURE</span>
        <span>[ {versions.length === 0 ? 'NO VERSIONS' : `${versions.length} VERSIONS ON FILE`} ]</span>
      </div>

      <div className="flex flex-col gap-3 p-3 sm:flex-row">
        <ProfileAvatar version={current} displayName={profile.displayName} size={176} />

        <div className="min-w-0 flex-1 text-[10px] font-bold text-black">
          {current === undefined ? (
            <p>
              NO PICTURE YET. THE OWNER CAN FILE ONE FROM THE ACCOUNT PAGE - EVERY CHANGE IS KEPT AS A VERSION AND
              COMMENTED ON SEPARATELY.
            </p>
          ) : (
            <>
              <p>
                CURRENT: V{current.version} :: FILED <TimeStamp at={current.createdAt} />
              </p>
              {current.restoredFromVersion === undefined ? null : <p>RESTORED FROM V{current.restoredFromVersion}</p>}
              <p className="mt-1 whitespace-pre-line text-xs font-normal">
                {current.note.length === 0 ? 'NO NOTE ATTACHED TO THIS VERSION.' : current.note}
              </p>
            </>
          )}

          {profile.visibility.showAvatarComments || owner ? null : (
            <p className="mt-2">COMMENTS ON THIS PICTURE ARE HIDDEN BY THE OWNER.</p>
          )}
        </div>
      </div>

      {versions.length === 0 ? null : (
        <div className="border-t border-gray-500 bg-white p-3 text-black">
          <p className="text-[10px] font-bold">VERSION HISTORY :: NEWEST FIRST</p>

          <ul className="mt-2 space-y-2">
            {versions.map((version) => {
              const attached = visible.filter((comment) => comment.avatarVersionId === version.id);

              return (
                <li key={version.id} className="rounded-none border border-gray-500 bg-[#f0f0f0] p-2">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-[10px] font-bold">
                    <span>
                      V{version.version}
                      {version.id === profile.avatar.currentVersionId ? ' [ CURRENT ]' : ''} ::{' '}
                      <TimeStamp at={version.createdAt} />
                    </span>
                    <span>{attached.length} COMMENTS</span>
                  </div>

                  {version.note.length === 0 ? null : (
                    <p className="mt-1 whitespace-pre-line text-xs">{version.note}</p>
                  )}

                  {attached.length === 0 ? null : (
                    <ul className="mt-1 space-y-1">
                      {attached.map((comment) => (
                        <li key={comment.id} className="rounded-none border border-gray-400 bg-white p-1">
                          <div className="flex flex-wrap items-center justify-between gap-2 text-[10px] font-bold">
                            <span>
                              <ProfileLink author={comment.author}>
                                <ProfileName author={comment.author}>{authorTag(comment.author)}</ProfileName>
                              </ProfileLink>{' '}
                              <span className="text-gray-700">
                                [ AT V{comment.avatarVersionNumber ?? version.version} ]
                              </span>
                            </span>
                            <TimeStamp at={comment.createdAt} />
                          </div>
                          <p className="mt-1 whitespace-pre-line text-xs">{comment.body}</p>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {viewer === null || current === undefined ? null : (
        <div className="border-t border-gray-500 p-3">
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
            versionId={attachTo}
            onVersionChange={setAttachTo}
            onSubmit={async (body) => {
              await repository.addComment(profile.userId, {
                kind: 'avatar',
                author: viewer,
                body,
                avatarVersionId: attachVersion?.id,
              });
            }}
          />
        </div>
      )}
    </section>
  );
}
