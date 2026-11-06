'use client';

import { getEngine } from '../../lib/animate/engine';
import { MAX_ONION } from '../../lib/animate/project';
import { useStudio } from '../../lib/animate/store';
import { setOnion } from '../../lib/animate/timeline';
import type { OnionSettings, OnionSide } from '../../lib/animate/types';
import { PLATE_MEDIUM, PLATE_PRESSED } from '../../lib/ui/controls';
import { AnimatePanelFrame } from './AnimatePanels';
import AnimateSlider from './AnimateSlider';

function change(patch: Partial<OnionSettings>): void {
  getEngine().tweak((project) => ({ ...project, onion: { ...project.onion, ...patch } }));
}

function Side({ title, which }: { title: string; which: 'prev' | 'next' }) {
  const side = useStudio((state) => state.project.onion[which]);
  const set = (patch: Partial<OnionSide>) => change({ [which]: { ...side, ...patch } });

  return (
    <fieldset className="flex flex-col gap-1">
      <legend className="text-accent-ink">{title}</legend>
      <div className="flex flex-wrap items-center gap-3">
        <AnimateSlider label="HOW MANY" min={0} max={MAX_ONION} step={1} value={side.count} onChange={(count) => set({ count })} />
        <label className="flex items-center gap-2">
          TINT
          <input type="color" aria-label={`${title} tint`} value={side.colour} onChange={(event) => set({ colour: event.target.value })} className="h-8 w-12 cursor-pointer border-line border-ink bg-paper p-0" />
        </label>
      </div>
      {side.opacities.slice(0, side.count).map((opacity, i) => (
        <AnimateSlider
          key={i}
          label={`${i + 1} AWAY`}
          min={0}
          max={1}
          step={0.05}
          value={opacity}
          percent
          onChange={(value) => set({ opacities: side.opacities.map((old, at) => (at === i ? value : old)) })}
        />
      ))}
    </fieldset>
  );
}

/** Onion skin's settings: counts, tints, an opacity for each neighbour, and how it draws. */
export default function AnimateOnionPanel() {
  const onion = useStudio((state) => state.project.onion);
  return (
    <AnimatePanelFrame title="ONION SKIN">
      <div className="flex flex-col gap-3">
        <button type="button" className={onion.on ? PLATE_PRESSED : PLATE_MEDIUM} aria-pressed={onion.on} onClick={() => setOnion(!onion.on)}>
          [ ONION {onion.on ? 'ON' : 'OFF'} ]
        </button>
        <div role="group" aria-label="How it draws" className="flex flex-wrap items-center gap-1">
          <button type="button" className={onion.mode === 'tint' ? PLATE_PRESSED : PLATE_MEDIUM} aria-pressed={onion.mode === 'tint'} onClick={() => change({ mode: 'tint' })}>
            [ TINT ]
          </button>
          <button type="button" className={onion.mode === 'outline' ? PLATE_PRESSED : PLATE_MEDIUM} aria-pressed={onion.mode === 'outline'} onClick={() => change({ mode: 'outline' })}>
            [ OUTLINE ]
          </button>
        </div>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={onion.keysOnly} onChange={(event) => change({ keysOnly: event.target.checked })} />
          KEYS ONLY
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={onion.includeCurrent} onChange={(event) => change({ includeCurrent: event.target.checked })} />
          TINT THE CURRENT FRAME TOO
        </label>
        <Side title="BEFORE" which="prev" />
        <Side title="AFTER" which="next" />
      </div>
    </AnimatePanelFrame>
  );
}
