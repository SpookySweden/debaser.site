'use client';

import { useState } from 'react';
import { TITLE_BAR_INACTIVE } from '../lib/ui/controls';

/**
 * The four layers, in the order the brief names them.
 *
 * **A layer is a thing you look *through*, so each one carries two controls and they are not the same
 * control.** The *eye* decides whether the layer is drawn; selecting a row decides what a drag in the
 * viewports does. Collapsing the two would mean looking at the wireframe required deselecting the layer you
 * were editing, which is exactly the moment you need both.
 */
const LAYERS = [
  { id: 'skeleton', label: 'SKELETON', note: 'JOINTS AND BONES. DRAGGING MOVES A JOINT.' },
  { id: 'mass', label: 'MASS GEOMETRY', note: 'THE PRIMITIVES, WIREFRAME. DRAGGING SCALES THEM.' },
  { id: 'base', label: 'BASE RENDER', note: 'SOLID, UNSHADED. NO PIXELATION.' },
  { id: 'pixel', label: 'LIVE PIXEL SHADER', note: 'LOW-RES TARGET AND THE OUTLINE. DRAGGING MOVES THE LIGHT.' },
] as const;

type LayerId = (typeof LAYERS)[number]['id'];

/**
 * The workbench's two viewports and its sidebar.
 *
 * Phase 1 draws the frame: two orthographic panes side by side, the layer list, and the light controls. The
 * canvas, the rig and the interaction modes arrive in later phases - what this file establishes is the
 * *shape* they will be dropped into, so the layout is settled before anything is drawn inside it.
 *
 * **The viewports are labelled and the labels matter.** "Front" and "Side" are not decoration: a drag is
 * constrained differently in each (front moves X and Y, side moves Z and Y), so a reader has to be able to
 * tell at a glance which pane their pointer is in. The label is inside the pane's own frame rather than
 * beside it, for that reason.
 */
export default function CharacterViewport() {
  const [active, setActive] = useState<LayerId>('skeleton');
  const [hidden, setHidden] = useState<Record<LayerId, boolean>>({
    skeleton: false,
    mass: false,
    base: false,
    pixel: false,
  });

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-2">
      <div className="flex flex-col gap-2 sm:flex-row">
        <Viewport label="FRONT" hint="X / Y" />
        <Viewport label="SIDE" hint="Z / Y" />
      </div>

      <div className="rounded-none border-2 border-t-white border-l-white border-r-black border-b-black bg-sun-pale">
        <div className={TITLE_BAR_INACTIVE}>
          <span>LAYERS</span>
          <span>[ {LAYERS.length} ]</span>
        </div>

        <ul className="divide-y divide-ink">
          {LAYERS.map((layer) => {
            const isHidden = hidden[layer.id];

            return (
              <li key={layer.id} className="flex items-center gap-2 p-1">
                {/* The eye. It goes dark rather than disappearing when a layer is off, because a control that
                    vanishes is one you cannot use to turn the thing back on. */}
                <button
                  type="button"
                  onClick={() => setHidden((current) => ({ ...current, [layer.id]: !current[layer.id] }))}
                  aria-pressed={!isHidden}
                  aria-label={`${isHidden ? 'Show' : 'Hide'} the ${layer.label} layer`}
                  className={`shrink-0 cursor-pointer rounded-none border border-black px-1 text-[11px] leading-none ${
                    isHidden ? 'bg-chrome-dark text-ink' : 'bg-sun text-ink hover:bg-ice'
                  }`}
                >
                  {isHidden ? '◌' : '●'}
                </button>

                <button
                  type="button"
                  onClick={() => setActive(layer.id)}
                  aria-pressed={active === layer.id}
                  className={`min-w-0 flex-1 cursor-pointer rounded-none border-t border-l border-r-2 border-b-2 px-2 py-[2px] text-left text-[10px] font-bold ${
                    active === layer.id
                      ? 'border-t-black border-l-black border-r-white border-b-white bg-ena text-paper'
                      : 'border-t-white border-l-white border-black bg-sun-pale text-ink hover:bg-ice'
                  }`}
                >
                  {layer.label}
                  <span className="ml-2 font-normal text-ink-plate">{layer.note}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      <p className="text-[10px] text-ink-plate">
        SELECTED: <span className="font-bold text-ink">{LAYERS.find((layer) => layer.id === active)?.label}</span> -
        DRAGGING IN EITHER VIEWPORT DRIVES THIS LAYER.
      </p>
    </div>
  );
}

/** One orthographic pane. The label sits inside the frame, because a drag is constrained per pane. */
function Viewport({ label, hint }: { label: string; hint: string }) {
  return (
    <div className="min-w-0 flex-1 rounded-none border-2 border-t-black border-l-black border-r-white border-b-white bg-ink">
      <p className="flex items-center justify-between bg-ena-deep px-2 py-[2px] text-[10px] font-bold text-paper">
        <span>{label}</span>
        <span className="text-sun">{hint}</span>
      </p>

      {/* The canvas is drawn here in Phase 5. Until then this states what will be in it rather than showing a
          blank rectangle that reads as a fault. */}
      <div className="flex h-[26rem] items-center justify-center">
        <p className="text-[10px] font-bold text-sun-pale">THE RIG IS DRAWN HERE</p>
      </div>
    </div>
  );
}
