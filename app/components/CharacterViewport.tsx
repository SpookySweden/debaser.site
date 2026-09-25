'use client';

import { useRef } from 'react';
import { PART_OF_JOINT } from '../lib/character/rig';
import { useCharacterStore, type LayerId } from '../lib/character/store';
import { scaleOf } from '../lib/character/skeleton';
import type { ViewportKind } from '../lib/character/drag';
import { FIELD, PLATE, TITLE_BAR_INACTIVE } from '../lib/ui/controls';

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
        <Viewport kind="front" label="FRONT" hint="X / Y" joints={jointCount} parts={partCount} />
        <Viewport kind="side" label="SIDE" hint="Z / Y" joints={jointCount} parts={partCount} />
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

      <JointPicker />

      <p className="text-[10px] text-ink-plate">
        SELECTED: <span className="font-bold text-ink">{LAYERS.find((layer) => layer.id === activeLayer)?.label}</span>{' '}
        - DRAGGING IN EITHER VIEWPORT DRIVES THIS LAYER. THE RIG HAS {jointCount} JOINTS.
      </p>
    </div>
  );
}

/**
 * Which joint a drag acts on, as a list.
 *
 * **A stand-in for picking a joint in the canvas, and it has to exist before the canvas does.** The natural way
 * to choose a joint is to click it, which needs the renderer; the renderer is Phase 5, and a drag with no
 * selectable target is a layer that cannot be exercised at all. So this is a real control over the real
 * skeleton - it lists the joints the store actually holds, with the selected one's scale read back - and it
 * stays useful afterwards, because a joint hidden behind another cannot be clicked and a list can name it.
 *
 * A `<select>` rather than a row of plates: nineteen joints is past what fits across a sidebar, and the element
 * brings its own keyboard handling, which is the one part of a custom control that is easy to get wrong.
 */
function JointPicker() {
  /**
   * **The joint list is stored, not derived in the selector.**
   *
   * This started as `useCharacterStore((state) => Object.keys(state.skeleton.joints))`, which is a new array
   * on every call. Zustand v5 compares with `Object.is`, so it saw a change on every render, re-rendered, got
   * another new array, and looped until React threw *"Maximum update depth exceeded"* - the error an owner
   * hit simply by opening the CHAR tab. A selector must return a value that is stable between renders, and a
   * fresh array never is.
   *
   * The fix is to select the object and derive the list in the component's own body. `state.skeleton.joints`
   * is a stable reference that only changes when the rig does, so the comparison works, and the `Object.keys`
   * costs nothing where it is.
   *
   * The count on the sidebar (a number) was always safe: numbers compare by value. It is specifically a
   * *new object* per call that loops - which is why the bug hid behind a very similar-looking line.
   */
  const joints = useCharacterStore((state) => state.skeleton.joints);
  const jointIds = Object.keys(joints);
  const selectedJointId = useCharacterStore((state) => state.selectedJointId);
  const selectedJoint = selectedJointId === null ? undefined : joints[selectedJointId];
  const scale = selectedJoint === undefined ? null : scaleOf(selectedJoint);
  const selectJoint = useCharacterStore((state) => state.selectJoint);
  const scaleJoint = useCharacterStore((state) => state.scaleJoint);

  return (
    <div className="rounded-none border-2 border-t-white border-l-white border-r-black border-b-black bg-sun-pale p-2">
      <label className="text-[10px] font-bold text-ink" htmlFor="character-joint">
        JOINT A DRAG ACTS ON
      </label>
      <select
        id="character-joint"
        value={selectedJointId ?? ''}
        onChange={(event) => selectJoint(event.target.value === '' ? null : event.target.value)}
        className={FIELD}
      >
        <option value="">(NONE SELECTED - A DRAG DOES NOTHING)</option>
        {jointIds.map((id) => (
          <option key={id} value={id}>
            {id}
          </option>
        ))}
      </select>

      {selectedJointId === null ? (
        <p className="mt-1 text-[10px] text-ink-plate">PICK A JOINT, THEN DRAG IN A VIEWPORT TO MOVE OR RESCALE IT.</p>
      ) : (
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <input
            id="character-scale"
            type="range"
            min={0.2}
            max={4}
            step={0.05}
            value={scale ?? 1}
            onChange={(event) => scaleJoint(selectedJointId, Number(event.target.value))}
            className="w-40"
            aria-label="scale of the selected joint"
          />
          <span className="text-[10px] font-bold text-ink">
            SCALE {scale?.toFixed(2) ?? '1.00'} - DRAG UP IN EITHER PANE TO GROW, DOWN TO SHRINK
          </span>
          <button type="button" onClick={() => scaleJoint(selectedJointId, 1)} className={PLATE}>
            RESET MASS
          </button>
        </div>
      )}
    </div>
  );
}

/** One orthographic pane. The label sits inside the frame, because a drag is constrained per pane. */
function Viewport({
  kind,
  label,
  hint,
  joints,
  parts,
}: {
  kind: ViewportKind;
  label: string;
  hint: string;
  joints: number;
  parts: number;
}) {
  const drag = useCharacterStore((state) => state.drag);
  const selectedJointId = useCharacterStore((state) => state.selectedJointId);
  // Where the last move event was. A ref rather than state: it changes on every pointer move, and re-rendering
  // to store a coordinate that only the next event reads would make every drag a render per pixel.
  const last = useRef<{ x: number; y: number } | null>(null);

  function handlePointerDown(event: React.PointerEvent<HTMLDivElement>) {
    // Capture is what makes a fast drag survive leaving the pane - see the pane's own note below.
    event.currentTarget.setPointerCapture(event.pointerId);
    last.current = { x: event.clientX, y: event.clientY };
  }

  function handlePointerMove(event: React.PointerEvent<HTMLDivElement>) {
    if (last.current === null) return;

    const dx = event.clientX - last.current.x;
    const dy = event.clientY - last.current.y;
    last.current = { x: event.clientX, y: event.clientY };

    // A delta per event rather than from the gesture's start: that is what lets the store stay a simple
    // `position += offset`, and it means the store never has to remember where the drag began.
    drag(kind, dx, dy, selectedJointId);
  }

  function handlePointerUp(event: React.PointerEvent<HTMLDivElement>) {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    last.current = null;
  }

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
       *
       * It is also the drag surface. `touch-none` stops a phone scrolling the page instead of dragging it, and
       * the handlers above keep the moves coming once the gesture has started.
       */}
      <div
        role="presentation"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        className="flex h-[26rem] cursor-move touch-none flex-col items-center justify-center gap-2 border border-dashed border-ink p-2 text-center"
      >
        <p className="text-[10px] font-bold text-sun-pale">NO RENDERER YET</p>
        <p className="text-[10px] text-ice">
          THE SKELETON IS BUILT AND EDITABLE - {joints} JOINTS, {parts} PRIMITIVES MAPPED - BUT NOTHING DRAWS THEM
          UNTIL THE SHADER PASS LANDS.
        </p>
        <p className="text-[10px] text-sun">
          DRAG HERE TO DRIVE THE SELECTED LAYER. THIS PANE WILL HOLD THE {label} VIEW.
        </p>
      </div>
    </div>
  );
}
