'use client';

import { profileContext } from '../lib/audio/track-context';
import { elementAsTrack } from '../lib/audio/profile-track';
import type { ProfileElement } from '../lib/profile/elements';
import type { PublicProfile } from '../lib/profile/types';
import { PLATE_MEDIUM } from '../lib/ui/controls';
import { useMusicPlayer } from './MusicPlayerProvider';

type ProfileTrackPanelProps = {
  profile: PublicProfile;
  /** The version on screen, or nothing while the account has filed none. */
  element: ProfileElement | undefined;
  owner: boolean;
};

/**
 * The account's track, beside the picture.
 *
 * The readout and the transport, and nothing else - no comment button either, because the
 * thread underneath this panel carries the way in (`comment`, on its own caption line), and
 * one way in to one thing is enough. What is left is what a player is: what is playing, and
 * the two buttons that drive it.
 *
 * Playing hands the track to the site's player - one player serves every page - so the
 * song keeps going while the reader walks away from the profile.
 */
export default function ProfileTrackPanel({ profile, element, owner }: ProfileTrackPanelProps) {
  const player = useMusicPlayer();
  const playing = element !== undefined && player.track?.src === element.src && player.playing;

  return (
    <div className="p-2">
      {/* No version tag beside the caption: `M1` is the store's name for it, not the reader's. */}
      <p className="text-label font-bold text-ink">{owner ? 'your track' : 'their track'}</p>

      {/* The readout, in the player's own colours: it is the same shelf, one track over. */}
      <div className="mt-1 frame bg-hardware px-2 py-1">
        <p className="truncate text-key font-bold text-acid">
          {element === undefined ? 'NONE YET' : element.title}
        </p>
        {/* On the Black readout, so the bar ink: the quiet ink is Nigrosine here, 1.18:1 on Black.
            The credit only: an empty slot is the one line above. */}
        {element === undefined ? null : (
          <p className="mt-1 truncate text-label text-ink-bar">{element.credit}</p>
        )}
      </div>

      {element === undefined ? null : (
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() =>
              playing
                ? player.toggle()
                : player.play(elementAsTrack(profile, element), {
                    origin: 'profile',
                    href: `/profile/${encodeURIComponent(profile.userId)}`,
                    where: `THE PROFILE OF ${profile.displayName.toUpperCase()}`,
                    context: profileContext(profile.displayName),
                  })
            }
            className={PLATE_MEDIUM}
          >
            {playing ? '[ ❚❚ PAUSE ]' : '[ ▶ PLAY ]'}
          </button>
        </div>
      )}
    </div>
  );
}
