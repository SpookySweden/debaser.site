'use client';

import { formatClock } from '../lib/audio/format';
import { postedTrackAsAudio } from '../lib/audio/forum-tracks';
import { normaliseAudioTags } from '../lib/audio/tags';
import type { ForumTrack } from '../lib/forum/types';
import { PLATE } from '../lib/ui/controls';
import AudioTagPill from './AudioTagPill';
import { useMusicPlayer } from './MusicPlayerProvider';

type InlineTrackPlayerProps = {
  track: ForumTrack;
  /** Whoever posted it: the artist line the widget prints. */
  poster: string;
  /** `POST` / `REPLY` - what the file was filed with. */
  origin?: string;
  /** Tighter spacing, for a track under a reply. */
  compact?: boolean;
};

/**
 * The MP3 that came with a post.
 *
 * One display and one button: what it is, who filed it, its tags, and the way to
 * hear it. The sound comes out of the site's own player - the bar at the bottom of
 * the window - rather than an `<audio>` element of its own, so pressing play here
 * is the same act as pressing play on the shelf, and the track keeps going when
 * the reader walks to another thread (see ./MusicPlayerProvider.tsx).
 *
 * The display is the player's own shape: green on black, inset into the grey plate
 * the site's windows are made of. That is deliberate - a track in a thread should
 * look like the thing playing at the bottom of the window, because it is.
 */
export default function InlineTrackPlayer({ track, poster, origin, compact = false }: InlineTrackPlayerProps) {
  const player = useMusicPlayer();
  const current = player.track?.src === track.src;
  const playing = current && player.playing;
  const tags = normaliseAudioTags(track.tags ?? []);
  /** The running time: the player's own when this is what is playing, else what was filed. */
  const length = current && Number.isFinite(player.duration) ? formatClock(player.duration) : (track.length ?? '--:--');

  function press() {
    // Already the track on the display: the button is a pause. Otherwise it hands
    // the file to the player, which queues it if the shelf does not hold it.
    if (current) {
      player.toggle();
      return;
    }

    player.play(postedTrackAsAudio(track, poster));
  }

  return (
    <div
      className={`rounded-none border border-gray-500 bg-[#c0c0c0] ${compact ? 'p-1' : 'p-[5px]'}`}
      title={`MP3 filed by ${poster}`}
    >
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={press}
          className={PLATE}
          title={playing ? `Pause ${track.title}` : `Play ${track.title}`}
        >
          {playing ? '[ ❚❚ ]' : '[ ▶ ]'}
        </button>

        <span className="min-w-0 flex-1 rounded-none border-2 border-t-gray-600 border-l-gray-600 border-r-white border-b-white bg-black px-2 py-[2px]">
          <span className={`block truncate font-bold text-[#33ff33] ${compact ? 'text-[10px]' : 'text-[11px]'}`}>
            {track.title}
          </span>
          <span className={`block truncate text-[#1f9f1f] ${compact ? 'text-[8px]' : 'text-[9px]'}`}>
            {poster}
            {track.credit.length === 0 || track.credit === poster ? '' : ` :: ${track.credit}`}
            {origin === undefined ? '' : ` :: ${origin}`}
            {` :: ${length}`}
            {playing ? ` :: ${formatClock(player.elapsed)}` : ''}
          </span>
        </span>
      </div>

      {tags.length === 0 ? null : (
        <div className="mt-1 flex flex-wrap items-center gap-1">
          <span className="text-[9px] font-bold text-gray-700">TAGS:</span>
          {tags.map((tag) => (
            <AudioTagPill key={tag} tag={tag} compact />
          ))}
        </div>
      )}
    </div>
  );
}
