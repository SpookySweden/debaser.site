'use client';

import type { AudioTrack } from '../lib/audio/tracks';
import type { Track } from '../lib/projects/tracks';
import { PLATE } from '../lib/ui/controls';
import { useMusicPlayer } from './MusicPlayerProvider';

/** A manifest row as the player sees it: the same track, out of the archive's shelf. */
function toAudioTrack(track: Track): AudioTrack {
  return {
    id: track.id,
    title: track.title,
    credit: track.credit,
    kind: track.kind,
    src: track.src,
    length: track.length,
    shelf: 'archive',
  };
}

/**
 * The track list.
 *
 * Numbered rows, the way a record sleeve lists them: title, what kind of cue it is,
 * who it is credited to, how long it runs, and the button that plays it.
 *
 * Playing is the site's own player's job (the bar at the bottom of the window), not a
 * native `<audio>` control per row: one element plays the whole shelf, so a track keeps
 * going while the reader walks to another page. A row whose file has not been drawn or
 * uploaded yet is still a row - pressing it puts the path in the player's readout,
 * which is the same honest "not there yet" the artwork sheets use.
 */
export default function TrackList({ tracks }: { tracks: Track[] }) {
  const player = useMusicPlayer();

  if (tracks.length === 0) {
    return (
      <p className="border border-gray-500 bg-white p-3 text-[10px] font-bold text-black">
        NO TRACKS FILED YET - ADD AN ENTRY TO app/lib/projects/tracks.ts OR FILE ONE BELOW.
      </p>
    );
  }

  return (
    <ol className="space-y-2">
      {tracks.map((track, index) => {
        const audio = toAudioTrack(track);
        const current = player.track?.src === audio.src;

        return (
          <li
            key={track.id}
            className={`flex flex-wrap items-center gap-x-3 gap-y-2 rounded-none border border-gray-500 p-2 text-[10px] font-bold text-black ${
              current ? 'bg-[#ffffcc]' : 'bg-white'
            }`}
          >
            <span className="w-6 shrink-0 text-right text-gray-700">{index + 1}.</span>

            <span className="min-w-40 flex-1">
              <span className="block text-xs">{track.title}</span>
              <span className="block text-gray-700">
                {track.kind} :: {track.credit} :: {track.length}
              </span>
            </span>

            <button
              type="button"
              onClick={() => player.play(audio)}
              disabled={current && player.playing}
              className={PLATE}
            >
              {current && player.playing ? '[ PLAYING ]' : '[ ▶ PLAY ]'}
            </button>
          </li>
        );
      })}
    </ol>
  );
}
