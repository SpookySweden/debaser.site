'use client';

import { useState } from 'react';
import { normaliseAudioTags } from '../lib/audio/tags';
import type { AudioTrack } from '../lib/audio/tracks';
import { PLATE } from '../lib/ui/controls';
import AudioTagPill from './AudioTagPill';
import { useMusicLibrary } from './MusicLibraryProvider';
import { BarredTitle, SongMenuKey, SongMenuPanel } from './SongMenu';

type LibraryRowProps = {
  track: AudioTrack;
  /** Its place in the list, printed as the row's own number so the two columns line up. */
  index: number;
  playing: boolean;
  current: boolean;
  duration: string;
  onPlay: () => void;
};

/**
 * One track in the reader's own music.
 *
 * Two keys: `[ ⋯ ]`, the song settings panel (`./SongMenu.tsx`: lists, like, queue, link, post, folder),
 * which opens under the row, and `[ ▶ PLAY ]`, the row's own play, the same shape the archive's rows have.
 * The heart, the COMMENT key and the row of ADD TO lists all moved into the panel (SPEC-vanity.md), so
 * a list reads as titles rather than as a wall of keys.
 */
export default function LibraryRow({ track, index, playing, current, duration, onPlay }: LibraryRowProps) {
  const tags = normaliseAudioTags(track.tags);
  const [menuOpen, setMenuOpen] = useState(false);
  const barred = useMusicLibrary().barredSrcs.has(track.src);

  return (
    <li className={`border-b border-dotted border-ink px-2 py-1 hover:bg-pointed ${current ? 'bg-sun-pale' : 'bg-paper'}`}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="shrink-0 text-label text-ink">{String(index + 1).padStart(2, '0')}.</span>

        <span className="min-w-0 flex-1">
          <span className="block truncate text-key font-bold text-ink" title={track.title}>
            {barred ? <BarredTitle>{track.title}</BarredTitle> : track.title}
          </span>
          <span className="block truncate text-label text-ink">
            {track.credit.length === 0 ? 'NO CREDIT' : track.credit}
            {/* On a phone the length column is not drawn, so it rides the second line instead. */}
            <span className="sm:hidden"> :: {duration.length === 0 ? '--:--' : duration}</span>
          </span>
        </span>

        {tags.length === 0 ? null : (
          <span className="hidden flex-wrap items-center gap-1 sm:flex">
            {tags.slice(0, 3).map((tag) => (
              <AudioTagPill key={tag} tag={tag} compact />
            ))}
          </span>
        )}

        <span className="hidden shrink-0 text-right text-label font-bold text-ink sm:block">
          {duration.length === 0 ? '--:--' : duration}
        </span>

        <span className="flex shrink-0 items-center gap-1">
          <SongMenuKey open={menuOpen} onToggle={() => setMenuOpen((open) => !open)} title={track.title} />

          <button
            type="button"
            onClick={onPlay}
            className={PLATE}
            title={playing ? `Pause ${track.title}` : `Play ${track.title}`}
          >
            {playing ? '[ ❚❚ ]' : '[ ▶ PLAY ]'}
          </button>
        </span>
      </div>

      {menuOpen ? <SongMenuPanel track={track} fromShelf onClose={() => setMenuOpen(false)} /> : null}
    </li>
  );
}
