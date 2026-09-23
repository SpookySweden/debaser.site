'use client';

import { useState } from 'react';
import { MAX_AUDIO_TAGS, STARTER_AUDIO_TAGS, audioTagKey, normaliseAudioTags } from '../lib/audio/tags';
import { FIELD_TIGHT, PLATE } from '../lib/ui/controls';
import AudioTagPill from './AudioTagPill';

type AudioTagChooserProps = {
  id: string;
  value: string[];
  onChange: (tags: string[]) => void;
  /** The pills offered before anything is typed. */
  suggestions?: string[];
};

/**
 * The audio tags of one file, picked.
 *
 * One control for the two places a file is filed from - the browser's own window and the MP3
 * that rides with a post - so a tag is spelled, capped and coloured the same way wherever it is
 * chosen. The pills are the filter's own vocabulary (`../lib/audio/tags`), which is what makes
 * a tag picked here findable in the directory a moment later.
 */
export default function AudioTagChooser({ id, value, onChange, suggestions = STARTER_AUDIO_TAGS }: AudioTagChooserProps) {
  const [draft, setDraft] = useState('');
  const full = value.length >= MAX_AUDIO_TAGS;

  function toggle(label: string) {
    const key = audioTagKey(label);
    if (key.length === 0) return;

    if (value.some((tag) => audioTagKey(tag) === key)) {
      onChange(value.filter((tag) => audioTagKey(tag) !== key));
      return;
    }

    if (full) return;

    onChange(normaliseAudioTags([...value, label]));
  }

  /** The tags picked that are not already offered as pills. */
  const extra = value.filter((tag) => !suggestions.some((starter) => audioTagKey(starter) === audioTagKey(tag)));

  return (
    <div className="mt-2">
      <div className="flex flex-wrap items-center gap-1 text-[10px] font-bold text-black">
        <span>
          TAGS ({value.length}/{MAX_AUDIO_TAGS}):
        </span>

        {suggestions.map((tag) => (
          <AudioTagPill
            key={tag}
            tag={tag}
            compact
            active={value.some((picked) => audioTagKey(picked) === audioTagKey(tag))}
            onToggle={() => toggle(tag)}
          />
        ))}

        {extra.map((tag) => (
          <AudioTagPill key={tag} tag={tag} compact active onToggle={() => toggle(tag)} />
        ))}
      </div>

      <div className="mt-1 flex flex-wrap items-center gap-2">
        <label htmlFor={`${id}-tag`} className="text-[10px] font-bold text-black">
          ANOTHER TAG:
        </label>
        <input
          id={`${id}-tag`}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== 'Enter') return;
            event.preventDefault();
            toggle(draft);
            setDraft('');
          }}
          placeholder="e.g. DRONE"
          className={`${FIELD_TIGHT} w-32 max-sm:w-full`}
        />
        <button
          type="button"
          onClick={() => {
            toggle(draft);
            setDraft('');
          }}
          className={PLATE}
        >
          [ + ADD ]
        </button>

        {full ? <span className="text-[9px] font-bold text-[#800000]">MAX {MAX_AUDIO_TAGS}.</span> : null}
      </div>
    </div>
  );
}
