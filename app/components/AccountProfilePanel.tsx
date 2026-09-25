'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { elementAsTrack } from '../lib/audio/profile-track';
import { currentProfileElement } from '../lib/profile/elements';
import { profileNameColour } from '../lib/profile/name-colours';
import { usePublicProfile } from '../lib/profile/use-public-profile';
import { avatarComments, currentAvatarVersion, profileComments, visibleGivenTags } from '../lib/profile/visibility';
import { PLATE_LINK } from '../lib/ui/controls';
import { useCompactViewport } from '../lib/ui/use-compact-viewport';
import { useMusicPlayer } from './MusicPlayerProvider';
import MusicOptionsPrompt from './MusicOptionsPrompt';
import ProfileAvatar from './ProfileAvatar';
import ProfileCustomiserWindow from './ProfileCustomiserWindow';
import ProfileName from './ProfileName';

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
  const { profile, ready } = usePublicProfile(userId);
  const [customising, setCustomising] = useState(false);
  const [showOptions, setShowOptions] = useState(false);
  const player = useMusicPlayer();
  const compact = useCompactViewport();

  const visibleTags = visibleGivenTags(profile).length;
  const ownTrack = currentProfileElement(profile, 'track');
  /** The src already handed over, so the song is not re-assigned on every render. */
  const assigned = useRef<string | null>(null);

  useEffect(() => {
    if (!ready || ownTrack === undefined) return;
    if (assigned.current === ownTrack.src) return;

    assigned.current = ownTrack.src;

    // No autoplay by default: a phone's player is folded away, so "play by default" is
    // the one way a profile's track starts on its own there. Otherwise the options
    // pop-up asks how it should behave - once - until the visitor says not to show it
    // again (the player's gear reopens it later).
    if (player.playByDefault && compact) {
      player.assign(elementAsTrack(profile, ownTrack), {
        loop: true,
        autoplay: true,
        origin: {
          origin: 'profile',
          href: `/profile/${encodeURIComponent(profile.userId)}`,
          where: `THE PROFILE OF ${profile.displayName.toUpperCase()}`,
        },
      });
      return;
    }

    if (player.promptDismissed) return;

    // Deferred a frame so the pop-up does not set state synchronously in the effect.
    const frame = window.requestAnimationFrame(() => setShowOptions(true));
    return () => window.cancelAnimationFrame(frame);
  }, [compact, ownTrack, player, profile, ready]);

  return (
    <section className="rounded-none border-2 border-t-white border-l-white border-r-black border-b-black bg-sun-pale">
      <div className="flex items-center justify-between bg-ena px-2 py-1 text-xs font-bold text-paper">
        <span>PUBLIC PROFILE</span>
        <span>[ {ready ? 'READY' : 'READING...'} ]</span>
      </div>

      <div className="flex flex-col gap-3 p-3 sm:flex-row">
        <ProfileAvatar version={currentAvatarVersion(profile)} displayName={profile.displayName} size={128} />

        <div className="min-w-0 flex-1 space-y-1 text-[10px] font-bold text-ink">
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
            <button type="button" onClick={() => setCustomising(true)} className={PLATE_LINK}>
              [ CUSTOMISE PUBLIC PROFILE ]
            </button>
            <Link href={`/profile/${encodeURIComponent(userId)}`} className={PLATE_LINK}>
              [ VIEW PUBLIC PROFILE ]
            </Link>
          </div>

          <p className="pt-1 text-ink">
            VISITORS REACH THIS PAGE FROM ANY USERNAME OR PICTURE YOU POST UNDER.
          </p>
        </div>
      </div>

      {customising ? <ProfileCustomiserWindow userId={userId} onClose={() => setCustomising(false)} /> : null}
      {showOptions ? <MusicOptionsPrompt onClose={() => setShowOptions(false)} /> : null}
    </section>
  );
}
