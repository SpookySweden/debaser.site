'use client';

import Link from 'next/link';
import { useState } from 'react';
import { authorFromAccount } from '../lib/auth/author';
import { elementAsTrack } from '../lib/audio/profile-track';
import {
  canCommentOnElement,
  currentProfileElement,
  profileElementById,
} from '../lib/profile/elements';
import { profileNameColour } from '../lib/profile/name-colours';
import { presenceLabel } from '../lib/profile/presence';
import { PROFILE_DATA_SOURCE } from '../lib/profile/repository';
import type { ProfileCommentKind, ProfileVisibility } from '../lib/profile/types';
import { usePublicProfile } from '../lib/profile/use-public-profile';
import { canCommentOnProfile, profileComments, visibleProfileComments } from '../lib/profile/visibility';
import { HYPER_ARROW, HYPER_LABEL } from '../lib/ui/hypertext';
import { useAuth } from './AuthProvider';
import CommentRow, { commentRowData } from './CommentRow';
import ElementComments from './ElementComments';
import { useForum } from './ForumProvider';
import ProfileAvatar from './ProfileAvatar';
import ProfileBoardActivity from './ProfileBoardActivity';
import ProfileCommentMenu, { type ProfileCommentOption } from './ProfileCommentMenu';
import ProfileCommentWindow from './ProfileCommentWindow';
import ProfileTrackPanel from './ProfileTrackPanel';
import ProfileTagList from './ProfileTagList';
import ProfileWire from './ProfileWire';
import { useMusicPlayer } from './MusicPlayerProvider';
import { usePresence } from './PresenceProvider';
import TimeStamp from './TimeStamp';

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

  // One window, whichever aspect of the profile was asked about: the drawing, the track,
  // or the profile itself. The menu above both columns is the only way in (see
  // ./ProfileCommentMenu), so these three options are what it offers.
  const [commentingOn, setCommentingOn] = useState<ProfileCommentKind | null>(null);
  const comments = owner ? profileComments(profile) : visibleProfileComments(profile);
  const commentOptions: ProfileCommentOption[] = [
    {
      kind: 'avatar',
      ...(picture === undefined ? {} : { tag: picture.tag }),
      available: picture !== undefined && canCommentOnElement(owner, profile.visibility, 'picture'),
      reason: picture === undefined ? 'nothing filed' : 'switched off',
    },
    {
      kind: 'song',
      ...(track === undefined ? {} : { tag: track.tag }),
      available: track !== undefined && canCommentOnElement(owner, profile.visibility, 'track'),
      reason: track === undefined ? 'nothing filed' : 'switched off',
    },
    {
      kind: 'profile',
      available: canCommentOnProfile(owner, profile.visibility),
      reason: 'switched off',
    },
  ];


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

        {/* One comment control for the whole profile, above both columns, drawn whether or
            not anything is filed and whether or not the owner has a thread switched off: the
            menu is what says which of the three is open. */}
        <div className="border-b border-gray-500 px-3 py-1">
          <ProfileCommentMenu options={commentOptions} onChoose={(kind) => setCommentingOn(kind)} />
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
                onSelect={setPictureId}
              />
            )}
          </div>

          <div className="min-w-0 flex-1 space-y-2">
            <ProfileTrackPanel profile={profile} element={track} owner={owner} />

            {track === undefined ? null : (
              <ElementComments
                profile={profile}
                element={track}
                owner={owner}
                onSelect={setTrackId}
                onPlay={(element) => player.play(elementAsTrack(profile, element))}
                playing={(element) => player.track?.src === element.src && player.playing}
              />
            )}

            {/* The empty room a profile has to the right of the drawing, under the track and
                its remarks: the board's wire runs across it, transparent, the full width of
                the column rather than boxed into a panel of its own. */}
            <div className="pt-1">
              <ProfileWire />
            </div>
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
        <ProfileCommentWindow
          profile={profile}
          repository={repository}
          viewer={viewer}
          viewerId={user?.id ?? null}
          owner={owner}
          initial={commentingOn}
          picture={picture}
          track={track}
          onSelect={(kind, versionId) => {
            // Whichever version was chosen in the window becomes the one on screen behind it.
            if (kind === 'avatar') setPictureId(versionId);
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
        owner={owner}
        visibility={profile.visibility}
        comments={comments}
        hiddenCount={owner ? profileComments(profile).length - comments.length : 0}
      />
    </div>
  );
}


type CommentsSectionProps = {
  owner: boolean;
  visibility: ProfileVisibility;
  comments: ReturnType<typeof profileComments>;
  hiddenCount: number;
};

/**
 * Comments left directly on the profile - not on the picture, and not on the track.
 *
 * The same row the element threads use, and the same fold: a small arrow carrying the count,
 * which unfolds the list underneath. There is no box to write in here any more: the profile
 * has one comment control, above both columns, and `general` is one of its three options, so
 * this section only reads. Folded is the default, because a profile reads as a picture and a
 * track rather than as a comment page.
 */
function CommentsSection({ owner, visibility, comments, hiddenCount }: CommentsSectionProps) {
  const [open, setOpen] = useState(false);

  return (
    <section className="rounded-none border-2 border-t-white border-l-white border-r-gray-800 border-b-gray-800 bg-[#c0c0c0]">
      <div className="flex items-center justify-between bg-[#000080] px-2 py-1 text-xs font-bold text-white">
        <span>COMMENTS ON THIS PROFILE</span>
        <span>[ {visibility.showProfileComments ? `${comments.length} VISIBLE` : 'HIDDEN BY OWNER'} ]</span>
      </div>

      <div className="flex flex-wrap items-baseline gap-x-2 px-2 py-1 text-[10px] font-bold text-black">
        <span className={HYPER_LABEL}>general</span>

        <button
          type="button"
          onClick={() => setOpen(!open)}
          className={HYPER_ARROW}
          aria-expanded={open}
          title={open ? 'Fold the comments away' : 'Show the comments'}
        >
          {open ? '▾' : '▸'}
          {comments.length === 0 ? '' : ` ${comments.length}`}
        </button>
      </div>

      {!open ? null : (
        <div className="border-t border-gray-500 p-2 text-black">
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
            <ul className="space-y-1">
              {comments.map((comment) => (
                <CommentRow key={comment.id} data={commentRowData(comment)} />
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
