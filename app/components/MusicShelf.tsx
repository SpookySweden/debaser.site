'use client';

import { useEffect, useState } from 'react';
import { getMusicRepository } from '../lib/audio/repository';
import type { AudioTrack } from '../lib/audio/tracks';
import { PLATE } from '../lib/ui/controls';
import { useMusicPlayer } from './MusicPlayerProvider';

/**
 * What the shelf actually holds, read from the store rather than from a list in the
 * code: the `mp3` bucket's tracks (uploaded from this page, filed from an account
 * page, or dropped into the bucket by hand) with the archive's own hand-filed tracks
 * after them.
 *
 * It is the same queue the player at the bottom of the window is working from, so a
 * row here and the bar are never out of step - including the track that is playing.
 */
export default function MusicShelf() {
  const player = useMusicPlayer();
  const [tracks, setTracks] = useState<AudioTrack[] | null>(null);

  useEffect(() => {
    let cancelled = false;

    getMusicRepository()
      .listTracks()
      .then((next) => {
        if (!cancelled) setTracks(next);
      })
      .catch(() => {
        if (!cancelled) setTracks([]);
      });

    return () => {
      cancelled = true;
    };
  }, [player.queue]);

  return (
    <section className="rounded-none border-2 border-t-white border-l-white border-r-gray-800 border-b-gray-800 bg-[#c0c0c0]">
      <div className="flex items-center justify-between bg-[#000080] px-2 py-1 text-xs font-bold text-white">
        <span>THE SHELF :: EVERYTHING THE PLAYER CAN REACH</span>
        <span>[ {tracks === null ? 'READING...' : `${tracks.length} TRACKS`} ]</span>
      </div>

      <div className="p-3">
        {tracks === null ? (
          <p className="text-[10px] font-bold text-black">READING THE SHELF...</p>
        ) : tracks.length === 0 ? (
          <p className="text-[10px] font-bold text-black">
            THE BUCKET IS EMPTY AND THE ARCHIVE&apos;S OWN FILES ARE NOT THERE YET - FILE A TRACK BELOW.
          </p>
        ) : (
          <ul className="space-y-1">
            {tracks.map((track, position) => {
              const current = player.track?.src === track.src;

              return (
                <li
                  key={`${track.id}-${position}`}
                  className={`flex flex-wrap items-center gap-2 rounded-none border border-gray-500 p-2 text-[10px] font-bold text-black ${
                    current ? 'bg-[#ffffcc]' : 'bg-white'
                  }`}
                >
                  <span className="w-5 shrink-0 text-right text-gray-700">{position + 1}.</span>

                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{track.title}</span>
                    <span className="block truncate text-gray-700">
                      {track.kind} :: {track.credit} :: {track.shelf === 'bucket' ? 'mp3 BUCKET' : 'ARCHIVE'}
                    </span>
                  </span>

                  <button
                    type="button"
                    onClick={() => player.play(track)}
                    disabled={current && player.playing}
                    className={PLATE}
                  >
                    {current && player.playing ? '[ PLAYING ]' : '[ ▶ PLAY ]'}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
