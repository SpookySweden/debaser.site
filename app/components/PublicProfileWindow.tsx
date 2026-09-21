'use client';

import Link from 'next/link';
import { useState } from 'react';
import { authorFromAccount, authorLabel, authorTag } from '../lib/auth/author';
import { formatStamp } from '../lib/forum/format';
import { tagColour } from '../lib/forum/tag-vocabulary';
import { PROFILE_DATA_SOURCE } from '../lib/profile/repository';
import type { ProfileComment, ProfileVisibility } from '../lib/profile/types';
import { usePublicProfile } from '../lib/profile/use-public-profile';
import {
  canCommentOnProfile,
  canGiveTag,
  profileComments,
  validateTagLabel,
  visibleGivenTags,
  visibleProfileComments,
} from '../lib/profile/visibility';
import { useAuth } from './AuthProvider';
import { useForum } from './ForumProvider';
import ProfileBoardActivity from './ProfileBoardActivity';
import ProfileCommentBox from './ProfileCommentBox';
import ProfilePictureHistory from './ProfilePictureHistory';
import ProfileLink from './ProfileLink';
import { tagChipClasses, tagChipStyleFromColour } from './TagBadge';

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

  const displayName = profile.displayName !== 'Anonymous' ? profile.displayName : (forumName ?? 'Anonymous');
  const tags = owner ? profile.tags : visibleGivenTags(profile);
  const comments = owner ? profileComments(profile) : visibleProfileComments(profile);

  return (
    <div className="space-y-3">
      <section className="rounded-none border-2 border-t-white border-l-white border-r-gray-800 border-b-gray-800 bg-[#c0c0c0]">
        <div className="flex items-center justify-between bg-[#000080] px-2 py-1 text-xs font-bold text-white">
          <span>PUBLIC PROFILE :: {displayName.toUpperCase()}</span>
          <span>{owner ? '[ YOUR PROFILE ]' : '[ VISITOR VIEW ]'}</span>
        </div>

        <div className="space-y-1 p-3 text-[10px] font-bold text-black">
          <p>ACCOUNT ID: {userId}</p>
          <p>PLACE: {profile.location.length === 0 ? 'NOT GIVEN' : profile.location}</p>
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
        </div>
      </section>

      <ProfilePictureHistory profile={profile} repository={repository} viewer={viewer} owner={owner} />

      <section className="rounded-none border-2 border-t-white border-l-white border-r-gray-800 border-b-gray-800 bg-[#c0c0c0]">
        <div className="flex items-center justify-between bg-[#000080] px-2 py-1 text-xs font-bold text-white">
          <span>BIOGRAPHY</span>
          <span>[ {profile.bio.length} CHARS ]</span>
        </div>

        <div className="p-3">
          {profile.bio.length === 0 ? (
            <p className="text-[10px] font-bold text-black">
              NO BIO YET{owner ? ' - WRITE ONE IN THE CUSTOMISER.' : '.'}
            </p>
          ) : (
            <p className="whitespace-pre-line text-xs text-black">{profile.bio}</p>
          )}
        </div>
      </section>

      <section className="rounded-none border-2 border-t-white border-l-white border-r-gray-800 border-b-gray-800 bg-[#c0c0c0]">
        <div className="flex items-center justify-between bg-[#000080] px-2 py-1 text-xs font-bold text-white">
          <span>TAGS GIVEN BY OTHER USERS</span>
          <span>[ {profile.visibility.showTags ? `${tags.length} VISIBLE` : 'HIDDEN BY OWNER'} ]</span>
        </div>

        <div className="space-y-2 p-3">
          {profile.tags.length === 0 ? (
            <p className="text-[10px] font-bold text-black">NOBODY HAS GIVEN THIS PROFILE A TAG YET.</p>
          ) : tags.length === 0 ? (
            <p className="text-[10px] font-bold text-black">
              {profile.visibility.showTags
                ? 'EVERY TAG ON THIS PROFILE IS SWITCHED OFF.'
                : 'TAGS ON THIS PROFILE ARE HIDDEN BY DEFAULT.'}
            </p>
          ) : (
            <ul className="flex flex-wrap items-center gap-2">
              {tags.map((tag) => (
                <li key={tag.id} className="flex items-center gap-1">
                  <span
                    className={tagChipClasses({ id: tag.id, kind: 'user', label: tag.label })}
                    style={tagChipStyleFromColour(tag.colour ?? tagColour(tag.label))}
                  >
                    {tag.label}
                  </span>
                  <span className="text-[10px] font-bold text-black">
                    {owner && tag.hidden
                      ? '[ HIDDEN ]'
                      : `FROM ${
                          tag.givenBy.id !== null && tag.givenBy.id === userId ? 'YOU' : authorLabel(tag.givenBy)
                        }`}
                  </span>
                </li>
              ))}
            </ul>
          )}

          {canGiveTag(owner, profile.visibility) ? (
            <GiveTagBox
              owner={owner}
              onGive={async (label) => {
                await repository.giveTag(userId, { label, givenBy: viewer, colour: tagColour(label) });
              }}
            />
          ) : null}

          {owner ? (
            <p className="text-[10px] font-bold text-black">
              A TAG STAYS OFF UNTIL YOU REVEAL IT IN THE CUSTOMISER - VISITORS ONLY SEE THE ONES YOU ALLOW.
            </p>
          ) : null}
        </div>
      </section>

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

      <ProfileBoardActivity userId={userId} displayName={displayName} threads={theirThreads} />
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
                  <ProfileLink author={comment.author}>{authorTag(comment.author)}</ProfileLink>
                  <span>{formatStamp(comment.createdAt)}</span>
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
 * The "give this profile a tag" box.
 *
 * Everyone gets it - visitors, guests and the owner themselves - and every tag
 * arrives hidden, so the owner decides in the customiser which ones visitors see.
 */
function GiveTagBox({ owner, onGive }: { owner: boolean; onGive: (label: string) => Promise<void> }) {
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  async function handleGive() {
    const problem = validateTagLabel(label);
    if (problem !== undefined) {
      setError(problem);
      setStatus(null);
      return;
    }

    setBusy(true);
    setError(null);

    try {
      await onGive(label.trim().toUpperCase());
      setLabel('');
      setStatus(
        owner
          ? 'TAG GIVEN - REVEAL IT IN THE CUSTOMISER WHEN YOU WANT IT SHOWN.'
          : 'TAG GIVEN - THE OWNER DECIDES WHETHER IT SHOWS.',
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'UNKNOWN ERROR');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-none border-2 border-t-gray-600 border-l-gray-600 border-r-white border-b-white bg-white p-2">
      <label htmlFor="give-tag-label" className="block text-[10px] font-bold text-black">
        {owner ? 'GIVE YOUR OWN PROFILE A TAG:' : 'GIVE THIS PROFILE A TAG:'}
      </label>

      <div className="mt-1 flex flex-wrap items-center gap-2">
        <input
          id="give-tag-label"
          value={label}
          onChange={(event) => setLabel(event.target.value)}
          placeholder="e.g. LORE KEEPER"
          className="w-48 rounded-none border-2 border-t-gray-600 border-l-gray-600 border-r-white border-b-white bg-white p-2 font-mono text-xs text-black outline-none"
        />
        <button
          type="button"
          onClick={() => void handleGive()}
          disabled={busy}
          className="cursor-pointer rounded-none border-t border-l border-white border-r-2 border-b-2 border-black bg-[#c0c0c0] px-3 py-1 text-xs font-bold text-black hover:bg-gray-300 disabled:cursor-wait disabled:opacity-60"
        >
          {busy ? '[ WORKING... ]' : '[ GIVE TAG ]'}
        </button>
        {error === null ? null : <p className="text-[10px] font-bold text-[#800000]">{error}</p>}
        {status === null ? null : <p className="text-[10px] font-bold text-black">{status}</p>}
      </div>

      <p className="mt-1 text-[10px] text-gray-700">
        {owner
          ? 'TAGS ARRIVE HIDDEN: REVEAL THE ONES YOU WANT ON YOUR PAGE IN THE CUSTOMISER.'
          : 'TAGS ARRIVE HIDDEN: THE OWNER REVEALS THE ONES THEY WANT ON THEIR PAGE.'}
      </p>
    </div>
  );
}
