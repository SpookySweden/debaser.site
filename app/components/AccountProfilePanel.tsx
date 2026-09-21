'use client';

import Link from 'next/link';
import { useState } from 'react';
import { usePublicProfile } from '../lib/profile/use-public-profile';
import { avatarComments, currentAvatarVersion, profileComments, visibleGivenTags } from '../lib/profile/visibility';
import ProfileAvatar from './ProfileAvatar';
import ProfileCustomiserWindow from './ProfileCustomiserWindow';

const LINK_BUTTON =
  'rounded-none border-t border-l border-white border-r-2 border-b-2 border-black bg-[#c0c0c0] px-3 py-1 text-[10px] font-bold text-black hover:bg-gray-300';

/**
 * The account page's profile section.
 *
 * Shows the public face as it stands, and opens the customiser pop-up - the
 * self-contained console where the picture, bio, tags and visibility are set.
 */
export default function AccountProfilePanel({ userId }: { userId: string }) {
  const { profile, ready, source } = usePublicProfile(userId);
  const [customising, setCustomising] = useState(false);

  const visibleTags = visibleGivenTags(profile).length;

  return (
    <section className="rounded-none border-2 border-t-white border-l-white border-r-gray-800 border-b-gray-800 bg-[#c0c0c0]">
      <div className="flex items-center justify-between bg-[#000080] px-2 py-1 text-xs font-bold text-white">
        <span>PUBLIC PROFILE</span>
        <span>[ {ready ? 'READY' : 'READING...'} ]</span>
      </div>

      <div className="flex flex-col gap-3 p-3 sm:flex-row">
        <ProfileAvatar version={currentAvatarVersion(profile)} displayName={profile.displayName} size={128} />

        <div className="min-w-0 flex-1 space-y-1 text-[10px] font-bold text-black">
          <p>NAME ON THE PROFILE: {profile.displayName}</p>
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
