'use client';

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
    <div className="rounded-none border-2 border-t-white border-l-white border-r-gray-800 border-b-gray-800 bg-[#c0c0c0] p-2">
      <div className="flex items-baseline justify-between gap-2 text-[10px] font-bold text-black">
        <span className="text-gray-700">{owner ? 'your track' : 'their track'}</span>
        <span className="text-gray-700">{element === undefined ? 'nothing filed' : element.tag}</span>
      </div>

      {/* The readout, in the player's own colours: it is the same shelf, one track over. */}
      <div className="mt-1 rounded-none border-2 border-t-gray-600 border-l-gray-600 border-r-white border-b-white bg-black px-2 py-1">
        <p className="truncate text-[11px] font-bold text-[#33ff33]">
          {element === undefined ? 'NOTHING FILED YET' : element.title}
        </p>
        <p className="mt-1 truncate text-[9px] text-[#1f9f1f]">
          {element === undefined
            ? owner
              ? 'FILE A TRACK IN THE CUSTOMISER AND IT PLAYS FROM THE BAR BELOW.'
              : 'THIS ACCOUNT HAS NOT PUT A TRACK UP.'
            : `${element.tag}${element.current ? ' (current)' : ''} :: ${element.credit}`}
        </p>
      </div>

      {element === undefined ? null : (
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => (playing ? player.toggle() : player.play(elementAsTrack(profile, element)))}
            className={PLATE_MEDIUM}
          >
            {playing ? '[ ❚❚ PAUSE ]' : '[ ▶ PLAY ]'}
          </button>

          <span className="text-[10px] text-gray-700">PLAYS THROUGH THE BAR AT THE FOOT OF THE PAGE</span>
        </div>
      )}
    </div>
  );
}
