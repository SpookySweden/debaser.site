'use client';

import { MAX_SCALE, MIN_SCALE } from '../lib/character/drag';
import type { ViewportKind } from '../lib/character/drag';
import { massFor, PART_OF_JOINT } from '../lib/character/rig';
import { scaleOf } from '../lib/character/skeleton';
import { useCharacterStore, useInteractionMode, type InteractionMode, type LayerId } from '../lib/character/store';
import { PLATE, TITLE_BAR_INACTIVE } from '../lib/ui/controls';
import CharacterScene from './CharacterScene';

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
  const interactionMode = useInteractionMode();
  // Read from the rig rather than hardcoded, so the pane cannot claim a mapping the table does not have.
  const parts = Object.keys(PART_OF_JOINT).length;

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-2">
      <div className="flex flex-col gap-2 sm:flex-row">
        <Viewport kind="front" label="FRONT" hint="X / Y" />
        <Viewport kind="side" label="SIDE" hint="Z / Y" />
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

      <LayerControls mode={interactionMode} />

      <p className="text-[10px] text-ink-plate">
        SELECTED: <span className="font-bold text-ink">{LAYERS.find((layer) => layer.id === activeLayer)?.label}</span>{' '}
        -{' '}
        {interactionMode === 'joints'
          ? 'DRAG A JOINT HANDLE IN EITHER VIEWPORT TO MOVE IT. ' + jointCount + ' JOINTS.'
          : interactionMode === 'mass'
            ? 'CLICK A SHAPE IN THE VIEWPORT TO OPEN ITS CONTROLS. ' + parts + ' PRIMITIVES MAPPED.'
            : interactionMode === 'light'
              ? 'DRAG IN EITHER VIEWPORT TO TURN THE LIGHT.'
              : 'NOTHING HERE IS EDITABLE. THIS LAYER IS TO LOOK AT.'}
      </p>
    </div>
  );
}

/**
 * The stack of controls the selected layer needs, and nothing when it needs none.
 *
 * **The panel follows the layer, because that is what the layer *means*.** SKELETON has nothing to configure -
 * its interaction is entirely the handles in the viewport - so it gets no panel at all, which is the honest
 * answer rather than an empty box. MASS gets the rescaler, because a mass is something you size. LIGHT gets the
 * readout, because it has no controls beyond the drag. BASE gets nothing, because it is a render to look at.
 *
 * This is where the `JointPicker` used to be, and its absence is the point: the owner's interaction is *click
 * the shape, then open its tab*, so the tab is something the click opens rather than a list you consult first.
 */
function LayerControls({ mode }: { mode: InteractionMode }) {
  const selectedJointId = useCharacterStore((state) => state.selectedJointId);

  if (mode === 'joints') {
    return (
      <p className="rounded-none border-2 border-t-white border-l-white border-r-black border-b-black bg-sun-pale p-2 text-[10px] text-ink-plate">
        {selectedJointId === null
          ? 'NOTHING IS SELECTED. THE HANDLES ARE THE GREEN DOTS - DRAG ONE IN EITHER VIEWPORT.'
          : `HOLDING ${selectedJointId.toUpperCase()} - DRAG IT IN EITHER VIEWPORT. THE FRONT PANE MOVES IT ` +
            'LEFT AND RIGHT, THE SIDE PANE MOVES IT FORWARD AND BACK.'}
      </p>
    );
  }

  if (mode === 'mass') {
    return <MassRescaler jointId={selectedJointId} />;
  }

  if (mode === 'light') {
    return (
      <p className="rounded-none border-2 border-t-white border-l-white border-r-black border-b-black bg-sun-pale p-2 text-[10px] text-ink-plate">
        THE LIGHT HAS NO CONTROLS OF ITS OWN. DRAG IN EITHER VIEWPORT - LEFT AND RIGHT TURNS IT AROUND THE
        FIGURE, UP AND DOWN RAISES AND LOWERS IT.
      </p>
    );
  }

  return null;
}

/**
 * The mass tab: opened by clicking a shape, and it acts on what was clicked.
 *
 * **Nothing to show until something is clicked**, and it says so rather than showing a disabled slider - a
 * greyed-out control invites a reader to work out why it is grey, when the answer is just "click a limb".
 *
 * The slider and the viewport drag write the same store field (`scale`), so they can never disagree: dragging a
 * limb changes the number here, and moving the slider changes the limb. Two independent controls over one value
 * is the arrangement that goes wrong when each keeps its own copy; this cannot, because there is only one copy.
 */
function MassRescaler({ jointId }: { jointId: string | null }) {
  const joints = useCharacterStore((state) => state.skeleton.joints);
  const scaleJoint = useCharacterStore((state) => state.scaleJoint);
  const joint = jointId === null ? undefined : joints[jointId];
  const part = jointId === null ? undefined : massFor(jointId);

  if (jointId === null || joint === undefined || part === undefined) {
    return (
      <p className="rounded-none border-2 border-t-white border-l-white border-r-black border-b-black bg-sun-pale p-2 text-[10px] text-ink-plate">
        CLICK A SHAPE IN EITHER VIEWPORT. THE ONE YOU PICK OPENS HERE, WITH A SIZE TO SET.
      </p>
    );
  }

  const scale = scaleOf(joint);
  // Read into a local before the handlers: the early return above narrows `jointId`, but a closure does not keep
  // that narrowing, so `scaleJoint(jointId, ...)` inside the callbacks is a string-or-null. Binding it once is
  // the fix the compiler is actually asking for - and a cast would have silenced it while keeping the hole.
  const id = jointId;

  return (
    <div className="rounded-none border-2 border-t-white border-l-white border-r-black border-b-black bg-sun-pale p-2">
      <p className="text-[10px] font-bold text-ink">
        {id} :: {part.shape.toUpperCase()}
      </p>

      <label className="mt-1 block text-[10px] text-ink-plate" htmlFor="character-mass-scale">
        SIZE {scale.toFixed(2)} - THE SAME DRAG IN EITHER PANE, AND THIS SLIDER, DRIVE ONE NUMBER
      </label>
      <input
        id="character-mass-scale"
        type="range"
        min={MIN_SCALE}
        max={MAX_SCALE}
        step={0.05}
        value={scale}
        onChange={(event) => scaleJoint(id, Number(event.target.value))}
        className="mt-1 w-48 max-sm:min-h-11"
      />

      <button type="button" onClick={() => scaleJoint(id, 1)} className={`${PLATE} ml-2`}>
        RESET SIZE
      </button>
    </div>
  );
}

/**
 * One orthographic pane, with a real WebGL surface in it.
 *
 * **This is the pane that stopped being an empty box.** Everything above it - the rig, the store, the drag
 * arithmetic - was built to be driven by something, and this is that something: a `<Canvas>` rendering the
 * figure from one fixed direction, with the joints drawn as grabbable handles in the SKELETON layer and the
 * mass as clickable primitives in the MASS layer.
 *
 * **Orthographic, not perspective, and that is a requirement rather than a preference.** The drag arithmetic in
 * `app/lib/character/drag.ts` converts pixels to model units with one constant, which is only correct when a
 * unit is the same number of pixels everywhere on screen. A perspective camera makes it vary with depth, so a
 * joint dragged near the camera would move faster than one dragged far away - and the whole point of having the
 * front and side views at once is that a pixel means the same thing in both. `zoom` is set so the figure's
 * ~2 units fill the pane, which is what makes `UNITS_PER_PIXEL` true rather than approximately true.
 *
 * **The label sits inside the frame**, because a drag is constrained by which pane it started in and a reader
 * has to be able to tell at a glance which one their pointer is over.
 */
function Viewport({ kind, label, hint }: { kind: ViewportKind; label: string; hint: string }) {
  return (
    <div className="min-w-0 flex-1 rounded-none border-2 border-t-black border-l-black border-r-white border-b-white bg-ink">
      <p className="flex items-center justify-between bg-ena-deep px-2 py-[2px] text-[10px] font-bold text-paper">
        <span>{label}</span>
        <span className="text-sun">{hint}</span>
      </p>

      {/*
       * `touch-none` on the wrapper stops a phone scrolling the page instead of dragging a joint, and the canvas
       * fills the box rather than sizing itself - a canvas that sized to its content would have no height at all
       * inside this fixed 26rem frame.
       */}
      <div className="h-[26rem] touch-none">
        <CharacterScene view={kind} />
      </div>
    </div>
  );
}
