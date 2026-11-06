'use client';

import { useRef } from 'react';
import { changeSound, loadSound, removeSound, soundBuffer } from '../../lib/animate/sound';
import { updateSettings, useStudio } from '../../lib/animate/store';
import { PLATE_MEDIUM } from '../../lib/ui/controls';
import { AnimatePanelFrame } from './AnimatePanels';
import AnimateSlider from './AnimateSlider';

/** The sound for this shot: one file, where it starts, how loud, and whether stepping through frames plays it. */
export default function AnimateSoundPanel() {
  const track = useStudio((state) => state.project.audio);
  const scrub = useStudio((state) => state.settings.scrubSound);
  useStudio((state) => state.soundReady);
  const file = useRef<HTMLInputElement>(null);
  const buffer = soundBuffer(track);

  return (
    <AnimatePanelFrame title="SOUND">
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className={PLATE_MEDIUM} onClick={() => file.current?.click()}>
            [ {track === null ? 'ADD A SOUND' : 'CHANGE THE SOUND'} ]
          </button>
          {track !== null && (
            <button type="button" className={PLATE_MEDIUM} onClick={removeSound}>
              [ REMOVE ]
            </button>
          )}
          <input
            ref={file}
            id="animate-sound-file"
            type="file"
            accept="audio/*"
            className="sr-only"
            tabIndex={-1}
            aria-label="Sound file"
            onChange={(event) => {
              const chosen = event.target.files?.[0];
              event.target.value = '';
              if (chosen !== undefined) void loadSound(chosen);
            }}
          />
        </div>
        {track !== null && (
          <>
            <p className="truncate" title={track.name}>
              {track.name}
              {buffer !== null ? ` (${Math.round(buffer.duration * 10) / 10} S)` : ''}
            </p>
            <label className="flex items-center gap-2">
              STARTS ON FRAME
              <input
                type="number"
                min={1}
                value={track.frame + 1}
                aria-label="The frame the sound starts on"
                onChange={(event) => changeSound({ frame: Math.max(0, (Math.round(Number(event.target.value)) || 1) - 1) })}
                className="frame w-20 bg-paper px-1 py-0.5 font-mono text-key text-ink outline-none focus:outline-2 focus:outline-dotted focus:outline-bubble"
              />
            </label>
            <AnimateSlider label="VOLUME" min={0} max={1} step={0.05} value={track.volume} percent onChange={(volume) => changeSound({ volume })} />
          </>
        )}
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={scrub} onChange={(event) => updateSettings({ scrubSound: event.target.checked })} />
          STEPPING THROUGH FRAMES PLAYS THE SOUND
        </label>
      </div>
    </AnimatePanelFrame>
  );
}
