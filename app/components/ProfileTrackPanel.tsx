'use client';

import { canCommentOnElement, type ProfileElement } from '../lib/profile/elements';
import type { PublicProfile } from '../lib/profile/types';
import { useMusicPlayer } from './MusicPlayerProvider';
import { elementAsTrack } from './ElementCommentWindow';

const BUTTON =
  'cursor-pointer rounded-none border-t border-l border-white border-r-2 border-b-2 border-black bg-[#c0c0c0] px-2 py-[2px] text-[10px] font-bold text-black hover:bg-gray-300 disabled:cursor-wait disabled:opacity-60';

type ProfileTrackPanelProps = {
  profile: PublicProfile;
  /** The version on screen, or nothing while the account has filed none. */
  element: ProfileElement | undefined;
  owner: boolean;
  /** Opens the comment window for the version on screen. */
  onComment: () => void;
};

/**
 * The account's track, beside the picture.
 *
 * The readout and the transport, and nothing else: the thread and the history that go
 * with it are the same panels the drawing uses, drawn underneath it by `ElementComments`
 * (the room above is the readout, the room below is the conversation). Keeping the two
 * apart is what lets the page lay the drawing and the track side by side with their
 * remarks tucked under each of them rather than pooled at the foot of the window.
 *
 * Playing hands the track to the site's player - one player serves every page - so the
 * song keeps going while the reader walks away from the profile.
 */
export default function ProfileTrackPanel({ profile, element, owner, onComment }: ProfileTrackPanelProps) {
  const player = useMusicPlayer();
  const playing = element !== undefined && player.track?.src === element.src && player.playing;
  const writable = element === undefined ? false : canCommentOnElement(owner, profile.visibility, 'track');

  return (
    <div className="rounded-none border-2 border-t-white border-l-white border-r-gray-800 border-b-gray-800 bg-[#c0c0c0] p-2">
      <div className="flex items-center justify-between gap-2 text-[10px] font-bold text-black">
        <span>{owner ? 'YOUR TRACK' : 'THEIR TRACK'}</span>
        <span>[ {element === undefined ? 'NONE FILED' : element.tag} ]</span>
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
            : `[ ${element.tag} ]${element.current ? ' (CURRENT)' : ''} :: ${element.credit}`}
        </p>
      </div>

      {element === undefined ? null : (
        <div className="mt-1 flex flex-wrap items-center gap-1">
          <button
            type="button"
            onClick={() => (playing ? player.toggle() : player.play(elementAsTrack(profile, element)))}
            className={BUTTON}
          >
            {playing ? '[ ❚❚ PAUSE ]' : '[ ▶ PLAY ]'}
          </button>

          {writable ? (
            <button type="button" onClick={onComment} className={BUTTON}>
              [ COMMENT ]
            </button>
          ) : null}

          {element.note.length === 0 ? null : <span className="text-[10px] text-gray-700">{element.note}</span>}
        </div>
      )}
    </div>
  );
}
