'use client';

import type { Playlist } from '../lib/audio/library';
import { normaliseAudioTags } from '../lib/audio/tags';
import type { AudioTrack } from '../lib/audio/tracks';
import { PLATE, PLATE_ACCENT } from '../lib/ui/controls';
import AudioTagPill from './AudioTagPill';

type LibraryRowProps = {
  track: AudioTrack;
  /** Its place in the list, printed as the row's own number so the two columns line up. */
  index: number;
  /** The lists a track can be put into. Empty for a reader with none, which hides the row of buttons. */
  lists: Playlist[];
  liked: boolean;
  /** Whether it is in the list currently being *viewed*, which is the only membership a row can know. */
  inOpenList: boolean;
  busy: boolean;
  playing: boolean;
  current: boolean;
  duration: string;
  onPlay: () => void;
  onLike: () => void;
  onAddToList: (list: Playlist) => void;
  onComment: () => void;
};

/**
 * One track in the reader's own music.
 *
 * Three gestures, and each is one the site already has:
 *
 *   the heart       the like switch. Pressed in while liked, and it writes straight through - there is
 *                   no save, because a heart that needs confirming is not a heart. Its face *is* the
 *                   state, so a column of them can be read at a glance.
 *   `[ ✎ COMMENT ]` the board's composer, opened with this file already filed (`./NewPostForm.tsx`).
 *                   Navy, because it is the one control here that acts on the board rather than on the
 *                   library - the same accent the archive's `[ INJECT TO POST ]` wears, so the verb
 *                   that reaches out of a window is findable in a list of grey.
 *   `[ ▶ PLAY ]`    the row's own play, the same shape the archive's rows have.
 */
export default function LibraryRow({
  track,
  index,
  lists,
  liked,
  inOpenList,
  busy,
  playing,
  current,
  duration,
  onPlay,
  onLike,
  onAddToList,
  onComment,
}: LibraryRowProps) {
  const tags = normaliseAudioTags(track.tags);

  return (
    <li className={`border-b border-dotted border-ink px-2 py-1 hover:bg-sun ${current ? 'bg-sun-pale' : 'bg-paper'}`}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="shrink-0 text-[10px] text-ink">{String(index + 1).padStart(2, '0')}.</span>

        <span className="min-w-0 flex-1">
          <span className="block truncate text-[11px] font-bold text-ink" title={track.title}>
            {track.title}
          </span>
          <span className="block truncate text-[9px] text-ink">
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

        <span className="hidden shrink-0 text-right text-[10px] font-bold text-ink sm:block">
          {duration.length === 0 ? '--:--' : duration}
        </span>

        <span className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={onLike}
            disabled={busy}
            aria-pressed={liked}
            title={liked ? `Take ${track.title} out of liked` : `Like ${track.title}`}
            className={`cursor-pointer rounded-none border border-ink px-1 text-[10px] font-bold disabled:cursor-not-allowed disabled:bg-chrome-dark disabled:text-ink max-sm:min-h-11 max-sm:min-w-11 max-sm:text-sm ${
              liked ? 'bg-bubble-pale text-paper hover:bg-ena' : 'bg-paper text-ink hover:bg-ice'
            }`}
          >
            {liked ? '♥' : '♡'}
          </button>

          <button
            type="button"
            onClick={onComment}
            title={`Write a post about ${track.title}: the composer opens with this file already filed`}
            className={`${PLATE_ACCENT} hidden sm:inline-flex`}
          >
            [ ✎ COMMENT ]
          </button>

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

      {/* Which lists this track can go into.
          A row of small plates rather than a dropdown: there are rarely more than a handful, and a menu
          that has to be opened to find out whether a track is already in a list hides the very thing the
          reader is asking. The mark is `inOpenList`, which is the only membership a row can honestly
          claim - it knows about the list on screen and nothing about the others, so a track sitting in
          two lists shows its mark only on the one it is being viewed from. */}
      {lists.length === 0 ? null : (
        <div className="mt-1 flex flex-wrap items-center gap-1 pl-8">
          <span className="text-[9px] font-bold text-ink">ADD TO:</span>

          {lists.map((list) => (
            <button
              key={list.id}
              type="button"
              onClick={() => onAddToList(list)}
              disabled={busy}
              title={
                inOpenList && current
                  ? `Take ${track.title} out of ${list.name}`
                  : `Add ${track.title} to ${list.name}`
              }
              className={`cursor-pointer rounded-none border border-ink px-1 text-[9px] font-bold disabled:cursor-not-allowed disabled:bg-chrome-dark disabled:text-ink ${
                inOpenList && current ? 'bg-ena text-sun' : 'bg-sun-pale text-ink hover:bg-ice'
              }`}
            >
              [ {list.name} ]
            </button>
          ))}
        </div>
      )}

      {/* On a phone there is no room for the comment plate beside the heart, so it takes its own line -
          the same trade the archive's rows make, so the plate is never simply missing on a small
          screen. */}
      <div className="mt-1 pl-8 sm:hidden">
        <button
          type="button"
          onClick={onComment}
          title={`Write a post about ${track.title}: the composer opens with this file already filed`}
          className={PLATE_ACCENT}
        >
          [ ✎ COMMENT ]
        </button>
      </div>
    </li>
  );
}
