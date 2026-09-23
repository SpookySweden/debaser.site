'use client';

import { useState } from 'react';
import { normaliseAudioTags } from '../lib/audio/tags';
import type { ForumAuthor, ForumTrack } from '../lib/forum/types';
import { PLATE, PLATE_LARGE } from '../lib/ui/controls';
import AudioTagPill from './AudioTagPill';
import TrackPickerWindow from './TrackPickerWindow';

type TrackControlProps = {
  id: string;
  /** The track filed with this post, or null while there is none. */
  value: ForumTrack | null;
  onChange: (track: ForumTrack | null) => void;
  /** Who is posting: an account may file a file, a guest may only attach one the archive holds. */
  author: ForumAuthor;
};

/**
 * The soundtrack control a composer carries: one plate, one window - or the track already filed.
 *
 * This used to be a three-source fieldset at the bottom of the composer, under the auto-tags, the
 * tag chooser, the mention picker and the artwork thumbnails, so filing a track meant scrolling past
 * the post to find the control for it. It is one plate in the action row now, beside `[ FILE POST ]`,
 * and the picking happens in `./TrackPickerWindow` - a press to open it, a press to attach, with the
 * post being written still in front of the reader.
 *
 * With a track filed the plate becomes the track: its name, credit and running time from the file
 * itself, and the one control that takes it back off.
 */
export default function TrackControl({ id, value, onChange, author }: TrackControlProps) {
  const [open, setOpen] = useState(false);

  if (value === null) {
    return (
      <>
        <button
          type="button"
          id={id}
          onClick={() => setOpen(true)}
          aria-haspopup="dialog"
          aria-expanded={open}
          title="File an MP3 with this post: one the archive holds, one from this machine, or a link"
          className={PLATE_LARGE}
        >
          [ ♪ SOUNDTRACK ]
        </button>

        {open ? (
          <TrackPickerWindow
            id={`${id}-window`}
            author={author}
            onClose={() => setOpen(false)}
            onPick={(track) => {
              onChange(track);
              setOpen(false);
            }}
          />
        ) : null}
      </>
    );
  }

  const filed = normaliseAudioTags(value.tags);

  return (
    <span className="flex min-w-0 flex-wrap items-center gap-2 text-[10px] font-bold text-black">
      <span className="min-w-0">
        <span className="block truncate">
          ♪ {value.title}
          {value.length === undefined ? '' : ` :: ${value.length}`}
        </span>
        <span className="block truncate font-normal text-gray-700">
          {value.credit.length === 0 ? author.displayName : value.credit}
        </span>
      </span>

      {filed.length === 0 ? null : (
        <span className="flex flex-wrap items-center gap-1">
          {filed.map((tag) => (
            <AudioTagPill key={tag} tag={tag} compact />
          ))}
        </span>
      )}

      <button
        type="button"
        onClick={() => onChange(null)}
        title={`Take ${value.title} off this post`}
        className={PLATE}
      >
        [ CLEAR ]
      </button>
    </span>
  );
}
