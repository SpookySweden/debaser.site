'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { elementAsTrack } from '../lib/audio/profile-track';
import { currentProfileElement } from '../lib/profile/elements';
import { profileNameColour } from '../lib/profile/name-colours';
import { usePublicProfile } from '../lib/profile/use-public-profile';
import { avatarComments, currentAvatarVersion, profileComments, visibleGivenTags } from '../lib/profile/visibility';
import { useCompactViewport } from '../lib/ui/use-compact-viewport';
import { useMusicPlayer } from './MusicPlayerProvider';
import ProfileAvatar from './ProfileAvatar';
import ProfileCustomiserWindow from './ProfileCustomiserWindow';
import ProfileName from './ProfileName';

const LINK_BUTTON =
  'rounded-none border-t border-l border-white border-r-2 border-b-2 border-black bg-[#c0c0c0] px-3 py-1 text-[10px] font-bold text-black hover:bg-gray-300';

/**
 * The account page's profile section.
 *
 * Shows the public face as it stands, and opens the customiser pop-up - the
 * self-contained console where the picture, bio, tags and visibility are set.
 *
 * On a phone it also hands the account's own song to the player, which is folded away
 * there: the music still plays, and the page is not covered by a bar to make it play.
 */
export default function AccountProfilePanel({ userId }: { userId: string }) {
  const { profile, ready, source } = usePublicProfile(userId);
  const [customising, setCustomising] = useState(false);
  const player = useMusicPlayer();
  const compact = useCompactViewport();

  const visibleTags = visibleGivenTags(profile).length;
  const ownTrack = currentProfileElement(profile, 'track');
  /** The src already handed over, so the song is not re-assigned on every render. */
  const assigned = useRef<string | null>(null);

  useEffect(() => {
    // A phone, the profile read, and a track of its own: the track becomes what the player
    // is holding, set to repeat, and it starts at the first touch of the page - a browser
    // will not make a sound before one, so that is as automatic as automatic can be.
    if (!compact || !ready || ownTrack === undefined) return;
    if (assigned.current === ownTrack.src) return;

    assigned.current = ownTrack.src;
    player.assign(elementAsTrack(profile, ownTrack), { loop: true, autoplay: true });
  }, [compact, ownTrack, player, profile, ready]);

  return (
    <section className="rounded-none border-2 border-t-white border-l-white border-r-gray-800 border-b-gray-800 bg-[#c0c0c0]">
      <div className="flex items-center justify-between bg-[#000080] px-2 py-1 text-xs font-bold text-white">
        <span>PUBLIC PROFILE</span>
        <span>[ {ready ? 'READY' : 'READING...'} ]</span>
      </div>

      <div className="flex flex-col gap-3 p-3 sm:flex-row">
        <ProfileAvatar version={currentAvatarVersion(profile)} displayName={profile.displayName} size={128} />

        <div className="min-w-0 flex-1 space-y-1 text-[10px] font-bold text-black">
          <p>
            NAME ON THE PROFILE:{' '}
            <ProfileName
              author={{ id: userId, displayName: profile.displayName }}
              colour={profileNameColour(profile)}
              lamp={false}
            />
          </p>
          <p>BIO: {profile.bio.length === 0 ? 'NOT WRITTEN YET' : `${profile.bio.length} CHARACTERS`}</p>
          <p>
            PICTURE VERSIONS: {profile.avatar.versions.length} :: TAGS GIVEN:{' '}
            {profile.tags.length === 0 ? 'NONE YET' : `${profile.tags.length} (${visibleTags} SHOWING)`}
          </p>
          <p>
            COMMENTS: {profileComments(profile).length} ON THE PROFILE :: {avatarComments(profile).length} ON THE
            PICTURE
          </p>
          <p>
            SHOW TO VISITORS: TAGS {profile.visibility.showTags ? 'YES' : 'NO'} :: PROFILE COMMENTS{' '}
            {profile.visibility.showProfileComments ? 'YES' : 'NO'} :: PICTURE COMMENTS{' '}
            {profile.visibility.showAvatarComments ? 'YES' : 'NO'}
          </p>

          <div className="flex flex-wrap items-center gap-1 pt-1">
            <button type="button" onClick={() => setCustomising(true)} className={LINK_BUTTON}>
              [ CUSTOMISE PUBLIC PROFILE ]
            </button>
            <Link href={`/profile/${encodeURIComponent(userId)}`} className={LINK_BUTTON}>
              [ VIEW PUBLIC PROFILE ]
            </Link>
          </div>

          <p className="pt-1 text-gray-700">
            STORE: {source === 'mock' ? 'MOCK (THIS BROWSER ONLY)' : 'SUPABASE'} :: VISITORS REACH THIS PAGE FROM ANY
            USERNAME OR PICTURE YOU POST UNDER.
          </p>
        </div>
      </div>

      {customising ? <ProfileCustomiserWindow userId={userId} onClose={() => setCustomising(false)} /> : null}
    </section>
  );
}
