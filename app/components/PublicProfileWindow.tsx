'use client';

import Link from 'next/link';
import { useState } from 'react';
import { authorFromAccount } from '../lib/auth/author';
import {
  currentProfileElement,
  profileElementById,
  type ProfileElement,
} from '../lib/profile/elements';
import { profileNameColour } from '../lib/profile/name-colours';
import { presenceLabel } from '../lib/profile/presence';
import { PROFILE_DATA_SOURCE } from '../lib/profile/repository';
import type { ProfileVisibility } from '../lib/profile/types';
import { usePublicProfile } from '../lib/profile/use-public-profile';
import { canCommentOnProfile, profileComments, visibleProfileComments } from '../lib/profile/visibility';
import { useAuth } from './AuthProvider';
import CommentRow, { commentRowData } from './CommentRow';
import ElementComments from './ElementComments';
import ElementCommentWindow, { elementAsTrack } from './ElementCommentWindow';
import { useForum } from './ForumProvider';
import ProfileAvatar from './ProfileAvatar';
import ProfileBoardActivity from './ProfileBoardActivity';
import ProfileCommentBox from './ProfileCommentBox';
import ProfileTrackPanel from './ProfileTrackPanel';
import ProfileTagList from './ProfileTagList';
import { useMusicPlayer } from './MusicPlayerProvider';
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
 * Reachable at `/profile/<id>` from the board, a thread, a comment or the account page.
 * Everything the owner switched off stays off: tags given by other users and comments left
 * on the profile are hidden by default, and the boxes that would add to them are withheld
 * while they are hidden.
 *
 * The page is laid out as two columns, and each column is a thing with its own
 * conversation under it: the drawing (`P1`, `P2`, ...) with its remarks, and the track
 * (`M1`, `M2`, ...) with its remarks. Both columns use the same comment panel, because a
 * drawing and a track are the same shape of thing here - an append-only history, a version
 * being read, and a thread belonging to that version. That is what keeps the page packed
 * rather than pooled: nothing about a drawing is ever found at the foot of the window.
 */
export default function PublicProfileWindow({ userId, compact = false }: PublicProfileWindowProps) {
  const { user } = useAuth();
  const forum = useForum();
  const player = useMusicPlayer();
  const { profile, ready, repository } = usePublicProfile(userId);

  const owner = user !== null && user.id === userId;
  const viewer = authorFromAccount(user);
  const theirThreads = forum.threads.filter((thread) => thread.author.id === userId);
  const forumName =
    theirThreads[0]?.author.displayName ??
    forum.threads
      .flatMap((thread) => thread.comments)
      .find((comment) => comment.author.id === userId)?.author.displayName;

  // The name the page is headed with. A profile row that has never been named - an account
  // made by hand, or one created while the sign-up trigger was missing - says 'Anonymous',
  // which is not a name anybody chose: the account's own name is, and so is the byline on
  // anything they have posted.
  const accountName = owner && user !== null ? user.displayName : undefined;
  const displayName =
    profile.displayName !== 'Anonymous' ? profile.displayName : (accountName ?? forumName ?? 'Anonymous');
  const nameColour = profileNameColour(profile);
  const presence = usePresence(userId);

  // Which version of each element is being read. Each one carries its own selection, so
  // reading the second drawing does not move the track, and the thread follows the version
  // it belongs to.
  const [pictureId, setPictureId] = useState('');
  const [trackId, setTrackId] = useState('');
  const picture = profileElementById(profile, 'picture', pictureId) ?? currentProfileElement(profile, 'picture');
  const track = profileElementById(profile, 'track', trackId) ?? currentProfileElement(profile, 'track');

  // One window, whichever element was asked about.
  const [commentingOn, setCommentingOn] = useState<ProfileElement | null>(null);
  const comments = owner ? profileComments(profile) : visibleProfileComments(profile);


  return (
    <div className="space-y-3">
      <section className="rounded-none border-2 border-t-white border-l-white border-r-gray-800 border-b-gray-800 bg-[#c0c0c0]">
        <div className="flex items-center justify-between bg-[#000080] px-2 py-1 text-xs font-bold text-white">
          <span>
            {/* The name in its own colour, or the title bar's white when the account has
                not chosen one: no plate behind it, so a name is never drawn the same
                colour as the thing it sits on. */}
            PUBLIC PROFILE ::{' '}
            <span style={nameColour === undefined ? undefined : { color: nameColour }}>
              {displayName.toUpperCase()}
            </span>
          </span>
          <span>{owner ? '[ YOUR PROFILE ]' : '[ VISITOR VIEW ]'}</span>
        </div>

        {/* The picture and the track side by side, each with its own thread tucked
            underneath: the drawing in the narrow column, the track in the wide one. */}
        <div className="flex flex-col gap-3 p-3 lg:flex-row lg:items-start">
          <div className="w-full space-y-1 lg:w-[212px] lg:shrink-0">
            <ProfileAvatar
              version={
                picture === undefined
                  ? undefined
                  : {
                      id: picture.id,
                      version: picture.version,
                      src: picture.src,
                      alt: picture.credit,
                      note: picture.note,
                      createdAt: picture.createdAt,
                    }
              }
              displayName={displayName}
              size={176}
              hideVersionLabel
            />

            <p className="text-center text-[10px] font-bold text-black">
              {picture === undefined
                ? 'NO PICTURE FILED'
                : `[ ${picture.tag} ]${picture.current ? ' (CURRENT)' : ''}`}
            </p>

            {picture === undefined ? null : (
              <ElementComments
                profile={profile}
                element={picture}
                owner={owner}
                onComment={() => setCommentingOn(picture)}
                onSelect={setPictureId}
              />
            )}
          </div>

          <div className="min-w-0 flex-1 space-y-2">
            <ProfileTrackPanel
              profile={profile}
              element={track}
              owner={owner}
              onComment={() => {
                if (track !== undefined) setCommentingOn(track);
              }}
            />

            {track === undefined ? null : (
              <ElementComments
                profile={profile}
                element={track}
                owner={owner}
                onComment={() => setCommentingOn(track)}
                onSelect={setTrackId}
                onPlay={(element) => player.play(elementAsTrack(profile, element))}
                playing={(element) => player.track?.src === element.src && player.playing}
              />
            )}
          </div>
        </div>


        {/* The account's own details, under the two columns: they are read once, while the
            picture and the track are what the page is for. */}
        <div className="min-w-0 space-y-1 border-t border-gray-500 p-3 text-[10px] font-bold text-black">
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
            PICTURE VERSIONS: {profile.avatar.versions.length} :: TRACK VERSIONS: {profile.song.versions.length} ::
            TAGS GIVEN: {profile.tags.length} :: PROFILE COMMENTS: {profileComments(profile).length}
          </p>
          <p>
            TAGS: {profile.visibility.showTags ? 'VISIBLE' : 'HIDDEN'} :: PROFILE COMMENTS:{' '}
            {profile.visibility.showProfileComments ? 'VISIBLE' : 'HIDDEN'} :: PICTURE COMMENTS:{' '}
            {profile.visibility.showAvatarComments ? 'VISIBLE' : 'HIDDEN'} :: TRACK COMMENTS:{' '}
            {profile.visibility.showSongComments ? 'VISIBLE' : 'HIDDEN'}
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
              TO CHANGE THE PICTURE, THE TRACK, THE BIO OR WHAT VISITORS SEE.
            </p>
          ) : null}

          <div className="border-t border-gray-500 pt-1">
            <ProfileTagList profile={profile} repository={repository} viewer={viewer} owner={owner} />
          </div>
        </div>

        {/* The biography, as a small part of the same window rather than a section of its
            own. */}
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
      </section>

      {commentingOn === null ? null : (
        <ElementCommentWindow
          profile={profile}
          repository={repository}
          viewer={viewer}
          owner={owner}
          element={commentingOn}
          onSelect={(versionId) => {
            // Whichever element was opened, the version chosen becomes the one on screen.
            if (commentingOn.kind === 'picture') setPictureId(versionId);
            else setTrackId(versionId);
          }}
          onClose={() => setCommentingOn(null)}
        />
      )}

      {/* Board activity first, then the comments on the profile itself: what the account
          has filed reads better before the discussion of it. */}
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
  comments: ReturnType<typeof profileComments>;
  hiddenCount: number;
  onComment: (body: string) => Promise<void>;
};

/**
 * Comments left directly on the profile - not on the picture, and not on the track.
 *
 * The same row the element threads use, and the same shape of box: a title bar with the
 * count and the way in, the list behind it, and the box to write in. Closed until it is
 * asked for, because a profile reads as a picture and a track rather than as a comment
 * page; the two element threads are the ones that sit open beside their subjects.
 */
function CommentsSection({
  userId,
  owner,
  viewerId,
  visibility,
  comments,
  hiddenCount,
  onComment,
}: CommentsSectionProps) {
  const [open, setOpen] = useState(false);

  return (
    <section className="rounded-none border-2 border-t-white border-l-white border-r-gray-800 border-b-gray-800 bg-[#c0c0c0]">
      <div className="flex items-center justify-between bg-[#000080] px-2 py-1 text-xs font-bold text-white">
        <span>COMMENTS ON THIS PROFILE</span>
        <span className="flex items-center gap-2">
          <span>[ {visibility.showProfileComments ? `${comments.length} VISIBLE` : 'HIDDEN BY OWNER'} ]</span>
          <button type="button" onClick={() => setOpen(!open)} className={BUTTON}>
            {open ? '[ HIDE ]' : '[ SHOW ]'}
          </button>
        </span>
      </div>

      {!open ? null : (
        <>
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
              <ul className="space-y-2">
                {comments.map((comment) => (
                  <CommentRow key={comment.id} data={commentRowData(comment)} />
                ))}
              </ul>
            )}
          </div>

          {/*
            Everybody gets a box here, the owner included: commenting on your own bio is the
            same action as commenting on somebody else's. Visitors lose the form (and read
            the notice instead) while the owner has comments switched off.
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
        </>
      )}
    </section>
  );
}
