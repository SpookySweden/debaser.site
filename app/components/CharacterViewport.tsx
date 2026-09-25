'use client';

import { PART_OF_JOINT } from '../lib/character/rig';
import { useCharacterStore, type LayerId } from '../lib/character/store';
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
] as const satisfies readonly { id: LayerId; label: string; note: string }[];

/**
 * The workbench's two viewports and its sidebar.
 *
 * **The sidebar reads and writes the store as of Phase 2**, rather than holding its own `useState`. That is
 * what makes the selection the *store's* fact instead of the sidebar's: a drag in a viewport (Phase 3) has to
 * know which layer is selected, and two components each holding their own copy of that is the drift this
 * feature's store exists to prevent. The state moved here the moment there was something to share it with,
 * rather than being written early and left unread - `Temp/check-structure.cjs` refuses a module nothing
 * imports, and it was right to.
 *
 * What is *not* here yet: the canvas, the rig and the drag handling. Phase 1 drew this frame; Phase 2 gave it
 * a real skeleton to point at; Phase 3 puts the figure in it.
 */
export default function CharacterViewport() {
  const activeLayer = useCharacterStore((state) => state.activeLayer);
  const visible = useCharacterStore((state) => state.visible);
  const selectLayer = useCharacterStore((state) => state.selectLayer);
  const toggleLayer = useCharacterStore((state) => state.toggleLayer);
  const jointCount = useCharacterStore((state) => Object.keys(state.skeleton.joints).length);
  // Read from the rig rather than hardcoded, so the pane cannot claim a mapping the table does not have.
  const partCount = Object.keys(PART_OF_JOINT).length;

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-2">
      <div className="flex flex-col gap-2 sm:flex-row">
        <Viewport label="FRONT" hint="X / Y" joints={jointCount} parts={partCount} />
        <Viewport label="SIDE" hint="Z / Y" joints={jointCount} parts={partCount} />
      </div>

      <div className="rounded-none border-2 border-t-white border-l-white border-r-black border-b-black bg-sun-pale">
        <div className={TITLE_BAR_INACTIVE}>
          <span>LAYERS</span>
          <span>[ {LAYERS.length} ]</span>
        </div>

        <ul className="divide-y divide-ink">
          {LAYERS.map((layer) => {
            const isHidden = !visible[layer.id];

            return (
              <li key={layer.id} className="flex items-center gap-2 p-1">
                {/* The eye. It goes dark rather than disappearing when a layer is off, because a control that
                    vanishes is one you cannot use to turn the thing back on. */}
                <button
                  type="button"
                  onClick={() => toggleLayer(layer.id)}
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
                  onClick={() => selectLayer(layer.id)}
                  aria-pressed={activeLayer === layer.id}
                  className={`min-w-0 flex-1 cursor-pointer rounded-none border-t border-l border-r-2 border-b-2 px-2 py-[2px] text-left text-[10px] font-bold ${
                    activeLayer === layer.id
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
        SELECTED: <span className="font-bold text-ink">{LAYERS.find((layer) => layer.id === activeLayer)?.label}</span>{' '}
        - DRAGGING IN EITHER VIEWPORT DRIVES THIS LAYER. THE RIG HAS {jointCount} JOINTS.
      </p>
    </div>
  );
}

/** One orthographic pane. The label sits inside the frame, because a drag is constrained per pane. */
function Viewport({ label, hint, joints, parts }: { label: string; hint: string; joints: number; parts: number }) {
  return (
    <div className="min-w-0 flex-1 rounded-none border-2 border-t-black border-l-black border-r-white border-b-white bg-ink">
      <p className="flex items-center justify-between bg-ena-deep px-2 py-[2px] text-[10px] font-bold text-paper">
        <span>{label}</span>
        <span className="text-sun">{hint}</span>
      </p>

      {/*
       * **There is no canvas yet, and that is why this reads as empty.**
       *
       * Phases 1 and 2 built the frame and the figure's arithmetic; the renderer is Phase 5, so nothing draws
       * inside these panes and an owner looking at the live site sees two black boxes. That is a *true* state
       * rather than a fault, but a black box does not say so - it reads as a broken feature.
       *
       * So the placeholder names the joint count the store actually holds, which is real data read from the
       * figure that exists: it is the one thing here that can be shown without a GPU, and it is also the check
       * that the tab is wired to the rig rather than to a mock. A dashed rule is used because a repeating
       * dither or a dotted rule is explicitly allowed under the artwork rule; nothing here draws a character.
       */}
      <div className="flex h-[26rem] flex-col items-center justify-center gap-2 border border-dashed border-ink p-2 text-center">
        <p className="text-[10px] font-bold text-sun-pale">NO RENDERER YET</p>
        <p className="text-[10px] text-ice">
          THE SKELETON IS BUILT AND EDITABLE - {joints} JOINTS, {parts} PRIMITIVES MAPPED - BUT NOTHING DRAWS THEM
          UNTIL THE SHADER PASS LANDS.
        </p>
        <p className="text-[10px] text-sun">THIS PANE WILL HOLD THE {label} VIEW.</p>
      </div>
    </div>
  );
}
