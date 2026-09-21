'use client';

import { useState } from 'react';
import type { Track } from '../lib/projects/tracks';

type TrackPlayerProps = {
  track: Track;
};

/**
 * The player for one track.
 *
 * The audio is hand-made and dropped into the project assets folder by hand, like
 * every other asset, so this component is the audio half of the same rule the
 * artwork follows: if the file is there it plays, and if it is not the row says
 * which file it is waiting for instead of leaving a dead control on the page.
 */
function TrackPlayer({ track }: TrackPlayerProps) {
  const [missing, setMissing] = useState(false);

  if (missing) {
    return (
      <span className="text-[10px] font-bold text-black" title={`${track.src} is not in the assets folder yet`}>
        [ AWAITING {track.src} ]
      </span>
    );
  }

  return (
    <audio
      controls
      preload="metadata"
      src={track.src}
      onError={() => setMissing(true)}
      className="h-8 w-full max-w-[260px] rounded-none border border-black bg-[#c0c0c0]"
    >
      TRACK NOT PLAYABLE - CHECK {track.src}
    </audio>
  );
}

/**
 * The track list.
 *
 * Numbered rows, the way a record sleeve lists them: title, what kind of cue it
 * is, who it is credited to, how long it runs, and the player. A track is filed by
 * adding the audio to `assets/audio/` and an entry to the manifest in
 * app/lib/projects/tracks.ts, so nothing here has to be edited to add music.
 */
export default function TrackList({ tracks }: { tracks: Track[] }) {
  if (tracks.length === 0) {
    return (
      <p className="border border-gray-500 bg-white p-3 text-[10px] font-bold text-black">
        NO TRACKS FILED YET - ADD AN ENTRY TO app/lib/projects/tracks.ts.
      </p>
    );
  }

  return (
    <ol className="space-y-2">
      {tracks.map((track, index) => (
        <li
          key={track.id}
          className="flex flex-wrap items-center gap-x-3 gap-y-2 border border-gray-500 bg-white p-2 text-[10px] font-bold text-black"
        >
          <span className="w-6 shrink-0 text-right text-gray-700">{index + 1}.</span>

          <span className="min-w-40 flex-1">
            <span className="block text-xs">{track.title}</span>
            <span className="block text-gray-700">
              {track.kind} :: {track.credit} :: {track.length}
            </span>
          </span>

          <TrackPlayer track={track} />
        </li>
      ))}
    </ol>
  );
}
