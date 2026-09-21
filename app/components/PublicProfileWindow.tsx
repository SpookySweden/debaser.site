'use client';

import Link from 'next/link';
import { useState } from 'react';
import { authorFromAccount, authorTag } from '../lib/auth/author';
import { profileNameColour } from '../lib/profile/name-colours';
import { presenceLabel } from '../lib/profile/presence';
import { PROFILE_DATA_SOURCE } from '../lib/profile/repository';
import type { ProfileComment, ProfileVisibility } from '../lib/profile/types';
import { usePublicProfile } from '../lib/profile/use-public-profile';
import {
  avatarVersionById,
  canCommentOnPicture,
  canCommentOnProfile,
  currentAvatarVersion,
  profileComments,
  visibleProfileComments,
} from '../lib/profile/visibility';
import { useAuth } from './AuthProvider';
import { useForum } from './ForumProvider';
import ProfileAvatar from './ProfileAvatar';
import ProfileBoardActivity from './ProfileBoardActivity';
import ProfileCommentBox from './ProfileCommentBox';
import ProfileLink from './ProfileLink';
import ProfileName from './ProfileName';
import ProfilePictureCommentWindow from './ProfilePictureCommentWindow';
import ProfilePicturePanel from './ProfilePicturePanel';
import ProfileTagList from './ProfileTagList';
import { usePresence } from './PresenceProvider';
import TimeStamp from './TimeStamp';

const BUTTON =
  'cursor-pointer rounded-none border-t border-l border-white border-r-2 border-b-2 border-black bg-[#c0c0c0] px-2 py-[2px] text-[10px] font-bold text-black hover:bg-gray-300 disabled:cursor-wait disabled:opacity-60';

type PublicProfileWindowProps = {
  userId: string;
  /** Hides the "open your account page" ribbon when mounted on the account page. */
  compact?: boolean;
};

/**
 * What everybody else sees when they click a username or a picture.
 *
 * Reachable at `/profile/<id>` from the board, a thread, a comment or the account
 * page. Everything the owner switched off stays off: tags given by other users
 * and comments left on the profile are hidden by default, and the boxes that
 * would add to them are withheld while they are hidden.
 *
 * The owner sees the same page with the same hands: giving your own profile a tag
 * and commenting on your own bio or picture work exactly like doing it on someone
 * else's page, and guests can do both too (signed Anonymous). The only difference
 * is that the owner also sees what is held back, marked as hidden.
 */
export default function PublicProfileWindow({ userId, compact = false }: PublicProfileWindowProps) {
  const { user } = useAuth();
  const forum = useForum();
  const { profile, ready, repository } = usePublicProfile(userId);

  const owner = user !== null && user.id === userId;
  const viewer = authorFromAccount(user);
  const theirThreads = forum.threads.filter((thread) => thread.author.id === userId);
  const forumName =
    theirThreads[0]?.author.displayName ??
    forum.threads
      .flatMap((thread) => thread.comments)
      .find((comment) => comment.author.id === userId)?.author.displayName;

  // The name the page is headed with. A profile row that has never been named - an
  // account made by hand, or one created while the sign-up trigger was missing - says
  // 'Anonymous', which is not a name anybody chose: the account's own name is, and so
  // is the byline on anything they have posted.
  const accountName = owner && user !== null ? user.displayName : undefined;
  const displayName =
    profile.displayName !== 'Anonymous'
      ? profile.displayName
      : (accountName ?? forumName ?? 'Anonymous');
  // The swatch the owner picked for their username, if any.
  const nameColour = profileNameColour(profile);
  // The lamp beside that name: green / yellow / red, straight from the store.
  const presence = usePresence(userId);
  // Which drawing is being looked at: the comments under the picture belong to it, and
  // picking another from the history switches the picture and its conversation
  // together. Empty until a version is chosen, which falls back to the current one.
  const [selectedVersionId, setSelectedVersionId] = useState('');
  const selectedVersion = avatarVersionById(profile, selectedVersionId) ?? currentAvatarVersion(profile);
  // The comment window, opened from the button beside the version label.
  const [commenting, setCommenting] = useState(false);
  const comments = owner ? profileComments(profile) : visibleProfileComments(profile);

  return (
    <div className="space-y-3">
      <section className="rounded-none border-2 border-t-white border-l-white border-r-gray-800 border-b-gray-800 bg-[#c0c0c0]">
        <div className="flex items-center justify-between bg-[#000080] px-2 py-1 text-xs font-bold text-white">
          <span>
            {/* The name in its own colour, or the title bar's white when the account
                has not chosen one: no plate behind it, so a name is never drawn the
                same colour as the thing it sits on. */}
            PUBLIC PROFILE ::{' '}
            <span style={nameColour === undefined ? undefined : { color: nameColour }}>
              {displayName.toUpperCase()}
            </span>
          </span>
          <span>{owner ? '[ YOUR PROFILE ]' : '[ VISITOR VIEW ]'}</span>
        </div>

        <div className="flex flex-col gap-3 p-3 sm:flex-row">
          {/* The picture keeps the size it has always been drawn at, and the version
              being looked at is the one the comments below belong to. */}
          <div className="shrink-0">
            <ProfileAvatar version={selectedVersion} displayName={displayName} size={176} />

            {/* The version label and the way into the comment window share the bottom
                of the picture's own space: writing about a drawing no longer pushes the
                rest of the page down. */}
            {selectedVersion === undefined ? null : (
              <div className="mt-1 flex items-center justify-between gap-2">
                <p className="text-[10px] font-bold text-black">
                  V{selectedVersion.version}
                  {selectedVersion.id === profile.avatar.currentVersionId ? ' (CURRENT)' : ''}
                </p>

                {canCommentOnPicture(owner, profile.visibility) ? (
                  <button type="button" onClick={() => setCommenting(true)} className={BUTTON}>
                    [ COMMENT ]
                  </button>
                ) : null}
              </div>
            )}
          </div>

          {/* Everything about the account sits to the right of it, tags included. */}
          <div className="min-w-0 flex-1 space-y-1 text-[10px] font-bold text-black">
            <p>ACCOUNT ID: {userId}</p>
            <p>PLACE: {profile.location.length === 0 ? 'NOT GIVEN' : profile.location}</p>
            <p>
              PRESENCE: {presence.status === undefined ? 'CHECKING...' : presenceLabel(presence.status)}
              {presence.record === undefined ? null : (
                <>
                  {' :: LAST SEEN '}
                  <TimeStamp at={presence.record.lastSeenAt} />
                </>
              )}
              {PROFILE_DATA_SOURCE === 'mock' ? ' :: THE MOCK STORE ONLY KNOWS THIS BROWSER' : ''}
            </p>
            <p>
              PICTURE VERSIONS: {profile.avatar.versions.length} :: TAGS GIVEN: {profile.tags.length} :: PROFILE
              COMMENTS: {profileComments(profile).length}
            </p>
            <p>
              TAGS: {profile.visibility.showTags ? 'VISIBLE' : 'HIDDEN'} :: PROFILE COMMENTS:{' '}
              {profile.visibility.showProfileComments ? 'VISIBLE' : 'HIDDEN'} :: PICTURE COMMENTS:{' '}
              {profile.visibility.showAvatarComments ? 'VISIBLE' : 'HIDDEN'}
            </p>
            <p>
              PROFILE STORE: {PROFILE_DATA_SOURCE === 'mock' ? 'MOCK (THIS BROWSER)' : 'SUPABASE'}
              {ready ? '' : ' :: READING...'}
            </p>

            {owner && !compact ? (
              <p>
                THIS IS YOUR PROFILE.{' '}
                <Link href="/account" className="underline hover:bg-gray-300">
                  OPEN THE ACCOUNT PAGE
                </Link>{' '}
                TO CHANGE THE PICTURE, THE BIO OR WHAT VISITORS SEE.
              </p>
            ) : null}

            <div className="border-t border-gray-500 pt-1">
              <ProfileTagList profile={profile} repository={repository} viewer={viewer} owner={owner} />
            </div>
          </div>
        </div>

        {/* The biography, as a small part of the same window rather than a section of
            its own. */}
        <div className="border-t border-gray-500 p-3">
          <p className="text-[10px] font-bold text-black">
            BIOGRAPHY <span className="text-gray-700">[ {profile.bio.length} CHARS ]</span>
          </p>

          {profile.bio.length === 0 ? (
            <p className="mt-1 text-[10px] font-bold text-black">
              NO BIO YET{owner ? ' - WRITE ONE IN THE CUSTOMISER.' : '.'}
            </p>
          ) : (
            <p className="mt-1 whitespace-pre-line text-xs text-black">{profile.bio}</p>
          )}
        </div>

        {/* The drawing's own conversation, then its history: comments first, because
            they are about the picture directly above them. */}
        <div className="border-t border-gray-500 p-3 text-black">
          <ProfilePicturePanel
            profile={profile}
            owner={owner}
            selectedId={selectedVersionId}
            onSelect={setSelectedVersionId}
          />
        </div>
      </section>

      {commenting && selectedVersion !== undefined ? (
        <ProfilePictureCommentWindow
          profile={profile}
          repository={repository}
          viewer={viewer}
          owner={owner}
          selectedId={selectedVersionId}
          onSelect={setSelectedVersionId}
          onClose={() => setCommenting(false)}
        />
      ) : null}

      {/* Board activity first, then the comments on the profile itself: what the
          account has filed reads better before the discussion of it. */}
      <ProfileBoardActivity
        userId={userId}
        displayName={displayName}
        nameColour={nameColour}
        threads={theirThreads}
      />

      <CommentsSection
        userId={userId}
        owner={owner}
        viewerId={user?.id ?? null}
        visibility={profile.visibility}
        comments={comments}
        hiddenCount={owner ? profileComments(profile).length - comments.length : 0}
        onComment={async (body) => {
          await repository.addComment(userId, { kind: 'profile', author: viewer, body });
        }}
      />
    </div>
  );
}

type CommentsSectionProps = {
  userId: string;
  owner: boolean;
  viewerId: string | null;
  visibility: ProfileVisibility;
  comments: ProfileComment[];
  hiddenCount: number;
  onComment: (body: string) => Promise<void>;
};

/** Comments left directly on the profile (not on the picture). */
function CommentsSection({ userId, owner, viewerId, visibility, comments, hiddenCount, onComment }: CommentsSectionProps) {
  return (
    <section className="rounded-none border-2 border-t-white border-l-white border-r-gray-800 border-b-gray-800 bg-[#c0c0c0]">
      <div className="flex items-center justify-between bg-[#000080] px-2 py-1 text-xs font-bold text-white">
        <span>COMMENTS ON THIS PROFILE</span>
        <span>[ {visibility.showProfileComments ? `${comments.length} VISIBLE` : 'HIDDEN BY OWNER'} ]</span>
      </div>

      <div className="p-3 text-black">
        {owner && !visibility.showProfileComments ? (
          <p className="text-[10px] font-bold text-black">
            VISITORS CANNOT SEE THESE COMMENTS RIGHT NOW - SWITCH THEM ON IN THE CUSTOMISER.
          </p>
        ) : null}

        {owner && hiddenCount > 0 ? (
          <p className="text-[10px] font-bold text-black">{hiddenCount} COMMENTS ARE HELD BACK FROM VISITORS.</p>
        ) : null}

        {comments.length === 0 ? (
          <p className="text-[10px] font-bold text-black">
            {visibility.showProfileComments ? 'NO COMMENTS ON THIS PROFILE YET.' : 'NO COMMENTS ARE SHOWING.'}
          </p>
        ) : (
          <ul className="mt-2 space-y-2">
            {comments.map((comment) => (
              <li key={comment.id} className="rounded-none border border-gray-500 bg-[#f0f0f0] p-2">
                <div className="flex flex-wrap items-center justify-between gap-2 text-[10px] font-bold">
                  <ProfileLink author={comment.author}>
                    <ProfileName author={comment.author}>{authorTag(comment.author)}</ProfileName>
                  </ProfileLink>
                  <TimeStamp at={comment.createdAt} />
                </div>
                <p className="mt-1 whitespace-pre-line text-xs">{comment.body}</p>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/*
        Everybody gets a box here, the owner included: commenting on your own bio
        is the same action as commenting on somebody else's. Visitors lose the form
        (and read the notice instead) while the owner has comments switched off.
      */}
      <div className="border-t border-gray-500 p-3">
        {viewerId === null ? (
          <p className="text-[10px] font-bold text-black">
            COMMENTS FROM GUESTS ARE SIGNED ANONYMOUS (GUEST) - LOG IN TO SIGN YOURS.
          </p>
        ) : null}
        <ProfileCommentBox
          id={`profile-comment-${userId}`}
          title={owner ? 'COMMENT ON YOUR OWN PROFILE' : 'COMMENT ON THIS PROFILE'}
          placeholder={owner ? 'Say something on your own profile...' : 'Say something about this profile...'}
          submitLabel="[ FILE COMMENT ]"
          closedNotice={
            canCommentOnProfile(owner, visibility)
              ? null
              : 'COMMENTS ON THIS PROFILE ARE SWITCHED OFF BY THE OWNER.'
          }
          onSubmit={onComment}
        />
      </div>
    </section>
  );
}

/**
 * One section of comments: the profile's own, on the left to the picture's in the
 * window above.
 */
