'use client';

import { MAX_SCALE, MIN_SCALE } from '../lib/character/drag';
import type { ViewportKind } from '../lib/character/drag';
import { RIG_PRESET_IDS, RIG_PRESETS } from '../lib/character/rig';
import { MASS_SHAPE_IDS, MASS_SHAPES, type MassShapeId } from '../lib/character/shapes';
import { RENDER_LAYER_IDS, type RenderLayerId } from '../lib/character/layers';
import { scaleOf } from '../lib/character/skeleton';
import { MASS_SHAPE_GLYPHS } from '../lib/ui/icons';
import {
  useCharacterStore,
  useInteractionMode,
  type InteractionMode,
  type LayerId,
  type MassTool,
} from '../lib/character/store';
import { PLATE, TITLE_BAR_INACTIVE } from '../lib/ui/controls';
import CharacterScene from './CharacterScene';

/**
 * What a drag in a viewport does, per selected layer - the *interaction* half of the layer model.
 *
 * **The edit and render layer lists are different lists and must not be merged.** This one is what the pointer
 * does; the render list below is what is drawn. They are close enough to look like one list, which is the trap:
 * a single list would say that selecting BASE means dragging edits nothing, when in fact BASE is a *render* and
 * the two things a reader edits are the joints and the mass.
 */
const LAYERS = [
  { id: 'skeleton', label: 'SKELETON', note: 'JOINTS AND BONES. DRAGGING MOVES A JOINT.' },
  { id: 'mass', label: 'MASS GEOMETRY', note: 'THE PRIMITIVES, WIREFRAME. DRAGGING SCALES THEM.' },
  { id: 'base', label: 'BASE RENDER', note: 'SOLID, UNSHADED. NO PIXELATION.' },
  { id: 'pixel', label: 'LIVE PIXEL SHADER', note: 'LOW-RES TARGET AND THE OUTLINE. DRAGGING MOVES THE LIGHT.' },
] as const satisfies readonly { id: LayerId; label: string; note: string }[];

/**
 * The three render stages, as a radio group.
 *
 * **A radio group and not three eyes, and that is the fix for a real defect.** The three were independent
 * visibility flags ordered by priority, with PIXEL on by default - so PIXEL always won, BASE was unreachable,
 * and switching PIXEL's eye off replaced the whole render instead of removing the pixelation. They are stages
 * of one pipeline: exactly one is showing.
 *
 * Keyed by `RENDER_LAYER_IDS`, so a stage added to the model without a label here is a **type error** rather
 * than a stage a reader cannot reach - the same reason the edit list is typed against `LayerId`.
 */
const RENDER_LAYER_LABELS: Record<RenderLayerId, { label: string; note: string }> = {
  mass: { label: 'MASS', note: 'THE SHAPE AS EDGES - TO BUILD AGAINST' },
  base: { label: 'BASE', note: 'THE SOLID FIGURE, UNPIXELATED' },
  pixel: { label: 'PIXEL', note: 'THE SOLID FIGURE, THROUGH THE COMPOSER' },
};

const RENDER_LAYERS = RENDER_LAYER_IDS.map((id) => ({ id, ...RENDER_LAYER_LABELS[id] }));

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
  const selectLayer = useCharacterStore((state) => state.selectLayer);
  const jointCount = useCharacterStore((state) => Object.keys(state.skeleton.joints).length);
  const interactionMode = useInteractionMode();

  /**
   * Counted from the figure itself rather than from `PART_OF_JOINT`.
   *
   * The table is only the *seed* now, so counting it would report how many shapes the preset started with and not
   * how many the reader has. A joint whose shape they took off, or a shoulder they added one to, would leave this
   * line lying.
   */
  const parts = useCharacterStore(
    (state) => Object.values(state.skeleton.joints).filter((joint) => joint.mass !== null).length,
  );

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-2">
      <div className="flex flex-col gap-2 sm:flex-row">
        <Viewport kind="front" label="FRONT" hint="X / Y" />
        <Viewport kind="side" label="SIDE" hint="Z / Y" />
      </div>

      <PresetPicker />

      <div className="rounded-none border-2 border-t-white border-l-white border-r-black border-b-black bg-sun-pale">
        <div className={TITLE_BAR_INACTIVE}>
          <span>WHAT A DRAG EDITS</span>
          <span>[ {LAYERS.length} ]</span>
        </div>

        <ul className="divide-y divide-ink">
          {LAYERS.map((layer) => (
            <li key={layer.id} className="p-1">
              <button
                type="button"
                onClick={() => selectLayer(layer.id)}
                aria-pressed={activeLayer === layer.id}
                className={`w-full cursor-pointer rounded-none border-t border-l border-r-2 border-b-2 px-2 py-[2px] text-left text-[10px] font-bold ${
                  activeLayer === layer.id
                    ? 'border-t-black border-l-black border-r-white border-b-white bg-ena text-paper'
                    : 'border-t-white border-l-white border-black bg-sun-pale text-ink hover:bg-ice'
                }`}
              >
                {layer.label}
                <span className="ml-2 font-normal text-ink-plate">{layer.note}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>

      <RenderStage />

      <LayerControls mode={interactionMode} />

      <p className="text-[10px] text-ink-plate">
        SELECTED: <span className="font-bold text-ink">{LAYERS.find((layer) => layer.id === activeLayer)?.label}</span>{' '}
        -{' '}
        {interactionMode === 'joints'
          ? 'DRAG A JOINT HANDLE IN EITHER VIEWPORT TO MOVE IT. ' + jointCount + ' JOINTS.'
          : interactionMode === 'mass'
            ? 'DRAG A SHAPE TO RESIZE IT, OR PICK ONE FROM THE PALETTE. ' + parts + ' SHAPES ON THE FIGURE.'
            : interactionMode === 'massMove'
              ? 'DRAG A SHAPE TO SLIDE IT. THE JOINT STAYS PUT. ' + parts + ' SHAPES ON THE FIGURE.'
              : interactionMode === 'light'
                ? 'DRAG IN EITHER VIEWPORT TO TURN THE LIGHT.'
                : 'NOTHING HERE IS EDITABLE. THIS LAYER IS TO LOOK AT.'}
      </p>
    </div>
  );
}

/**
 * The preset skeletons, as a row of plates.
 *
 * **Pressing one rebuilds the figure and discards edits, and the note says so.** A preset is a starting point, so
 * applying it has to be able to throw work away - the alternative is a state between the two with no name, where
 * the figure is neither what the reader built nor what the preset describes. The note is on the control rather
 * than in a confirmation dialogue, because this is a workbench and a dialogue for every preset would be worse than
 * the loss it prevents.
 *
 * The current preset is shown as pressed, which is what tells a reader that their edits have taken the figure
 * away from the preset it came from.
 */
function PresetPicker() {
  const presetId = useCharacterStore((state) => state.presetId);
  const applyPreset = useCharacterStore((state) => state.applyPreset);

  return (
    <fieldset className="rounded-none border-2 border-t-white border-l-white border-r-black border-b-black bg-sun-pale">
      <legend className={`${TITLE_BAR_INACTIVE} w-full`}>START FROM - REBUILDS THE FIGURE</legend>
      <div className="flex gap-[2px] p-1">
        {RIG_PRESET_IDS.map((id) => (
          <button
            key={id}
            type="button"
            onClick={() => applyPreset(id)}
            aria-pressed={presetId === id}
            title={RIG_PRESETS[id].note}
            className={`flex-1 cursor-pointer rounded-none border-t border-l border-r-2 border-b-2 px-2 py-[3px] text-[10px] font-bold ${
              presetId === id
                ? 'border-t-black border-l-black border-r-white border-b-white bg-ena text-paper'
                : 'border-t-white border-l-white border-black bg-sun-pale text-ink hover:bg-ice'
            }`}
          >
            {RIG_PRESETS[id].label}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

/**
 * What is drawn: the render stage, plus the skeleton's own eye.
 *
 * **The eye belongs to the skeleton alone, and that asymmetry is the honest model.** The three render stages are
 * a pipeline, so exactly one shows and the control is a radio group. The skeleton is not a stage - it is an
 * overlay you look *through* while working in either of the other two, which is why it is the one layer whose
 * visibility is independent. Giving all four an eye is what produced the defect this replaces: three of them
 * were fighting to be "the" render, and the fourth genuinely is not.
 */
function RenderStage() {
  const renderLayer = useCharacterStore((state) => state.renderLayer);
  const setRenderLayer = useCharacterStore((state) => state.setRenderLayer);
  const skeletonVisible = useCharacterStore((state) => state.skeletonVisible);
  const toggleSkeleton = useCharacterStore((state) => state.toggleSkeleton);

  return (
    <fieldset className="rounded-none border-2 border-t-white border-l-white border-r-black border-b-black bg-sun-pale">
      <legend className={`${TITLE_BAR_INACTIVE} w-full`}>WHAT IS DRAWN</legend>

      <div className="p-1">
        {/* The overlay, with the only eye on the page. */}
        <div className="flex items-center gap-2 pb-1">
          <button
            type="button"
            onClick={toggleSkeleton}
            aria-pressed={skeletonVisible}
            aria-label={`${skeletonVisible ? 'Hide' : 'Show'} the joints and bones`}
            className={`shrink-0 cursor-pointer rounded-none border border-black px-1 text-[11px] leading-none ${
              skeletonVisible ? 'bg-sun text-ink hover:bg-ice' : 'bg-chrome-dark text-ink'
            }`}
          >
            {skeletonVisible ? '●' : '◌'}
          </button>
          <span className="text-[10px] font-bold text-ink">
            JOINTS AND BONES
            <span className="ml-2 font-normal text-ink-plate">AN OVERLAY - DRAWN OVER EITHER STAGE BELOW</span>
          </span>
        </div>

        {RENDER_LAYERS.map((stage) => {
          const chosen = renderLayer === stage.id;

          return (
            <button
              key={stage.id}
              type="button"
              onClick={() => setRenderLayer(stage.id)}
              aria-pressed={chosen}
              className={`mb-1 w-full cursor-pointer rounded-none border-t border-l border-r-2 border-b-2 px-2 py-[2px] text-left text-[10px] font-bold ${
                chosen
                  ? 'border-t-black border-l-black border-r-white border-b-white bg-ena text-paper'
                  : 'border-t-white border-l-white border-black bg-sun-pale text-ink hover:bg-ice'
              }`}
            >
              {stage.label}
              <span className="ml-2 font-normal text-ink-plate">{stage.note}</span>
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

/**
 * The panel follows the selected *edit* layer, and SKELETON gets nothing to configure.
 *
 * MASS gets the rescaler, because a mass is something you size. LIGHT gets the readout, because its interaction
 * is the drag and there is nothing else to set. BASE gets nothing, because it is a render to look at. A panel
 * that showed the same controls for every layer would invite a reader to change something and see nothing move.
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

  if (jointId === null || joint === undefined) {
    return (
      <p className="rounded-none border-2 border-t-white border-l-white border-r-black border-b-black bg-sun-pale p-2 text-[10px] text-ink-plate">
        CLICK A SHAPE IN EITHER VIEWPORT, OR A JOINT HANDLE. THE ONE YOU PICK OPENS HERE.
      </p>
    );
  }

  /**
   * **A joint with no mass is the state the palette is *for*, not an error to hide behind a message.**
   *
   * This used to return a note saying "click a shape" and nothing else - which is the one case where the reader
   * most needs the controls, because they are looking at a bare shoulder and the thing they want is to put
   * something on it. So the palette renders in both states, and only the size readout is conditional.
   */
  const id = jointId;
  const part = joint.mass;

  return (
    <div className="rounded-none border-2 border-t-white border-l-white border-r-black border-b-black bg-sun-pale p-2">
      <p className="text-[10px] font-bold text-ink">
        {id} :: {part === null ? 'NOTHING HANGING HERE' : MASS_SHAPES[part.shape].label}
      </p>

      <ShapePalette jointId={id} current={part?.shape ?? null} />
      <MassToolSwitch />
      <MassSize jointId={id} />

      <label className="mt-1 block text-[10px] text-ink-plate" htmlFor="character-mass-scale">
        JOINT SCALE {scaleOf(joint).toFixed(2)} - SCALES THE JOINT AND EVERYTHING BELOW IT
      </label>
      <input
        id="character-mass-scale"
        type="range"
        min={MIN_SCALE}
        max={MAX_SCALE}
        step={0.05}
        value={scaleOf(joint)}
        onChange={(event) => scaleJoint(id, Number(event.target.value))}
        className={PLATE}
      />
    </div>
  );
}

/**
 * The six primitives, as a row of plates.
 *
 * **A pressed plate is the current shape, and pressing one applies it.** No separate confirm step, because there
 * is nothing to confirm: the figure updates as the shape changes, so the plate *is* the preview. That is also why
 * the control behaves as a radio group - one shape per joint.
 *
 * A joint with nothing gets the shape at a default size, which is `setMassShape`'s job rather than this
 * component's, so the palette does not have to know what a sensible empty size is.
 */
function ShapePalette({ jointId, current }: { jointId: string; current: MassShapeId | null }) {
  const setShape = useCharacterStore((state) => state.setShape);
  const clearShape = useCharacterStore((state) => state.clearShape);

  return (
    <fieldset className="mt-1 rounded-none border border-ink">
      <legend className="px-1 text-[9px] font-bold text-ink-plate">SHAPE - SIX PRIMITIVES</legend>

      {/*
       * **A 2D grid, so the vocabulary can be seen without turning the figure.** The glyph is the shape seen flat,
       * which is what a reader is choosing between; the 3D primitive behind it is what they get. Each plate
       * carries its own one-line note as a title, so the meaning is available without the grid growing to six
       * sentences.
       */}
      <div className="grid grid-cols-3 gap-[2px] p-1">
        {MASS_SHAPE_IDS.map((shape) => (
          <button
            key={shape}
            type="button"
            onClick={() => setShape(jointId, shape)}
            aria-pressed={current === shape}
            aria-label={`${MASS_SHAPES[shape].label} - ${MASS_SHAPES[shape].note}`}
            title={MASS_SHAPES[shape].note}
            className={`flex flex-col items-center gap-[2px] cursor-pointer rounded-none border-t border-l border-r-2 border-b-2 px-1 py-[3px] text-[9px] font-bold ${
              current === shape
                ? 'border-t-black border-l-black border-r-white border-b-white bg-ena text-paper'
                : 'border-t-white border-l-white border-black bg-sun-pale text-ink hover:bg-ice'
            }`}
          >
            <span aria-hidden className="text-[16px] leading-none">
              {MASS_SHAPE_GLYPHS[shape]}
            </span>
            {MASS_SHAPES[shape].label}
          </button>
        ))}
      </div>
      {current === null ? (
        <p className="px-1 pb-1 text-[9px] text-ink-plate">THIS JOINT CARRIES NOTHING. PICK ONE.</p>
      ) : (
        <button
          type="button"
          onClick={() => clearShape(jointId)}
          className="m-1 cursor-pointer rounded-none border-t border-l border-r-2 border-b-2 border-t-white border-l-white border-r-black border-b-black bg-chrome-dark px-1 py-[2px] text-[9px] font-bold text-ink hover:bg-bubble-pale"
        >
          [ TAKE THE SHAPE OFF ]
        </button>
      )}
    </fieldset>
  );
}

/**
 * What a drag on a shape does: resize it, or slide it.
 *
 * **Two tools and not a modifier key.** The alternative is drag-to-resize with shift-drag-to-move, which is
 * invisible: a reader who does not already know the convention never finds it, and the sidebar cannot say so
 * without a paragraph. A visible switch costs one row and is discoverable by looking.
 */
function MassToolSwitch() {
  const massTool = useCharacterStore((state) => state.massTool);
  const setMassTool = useCharacterStore((state) => state.setMassTool);

  const tools: { id: MassTool; label: string; note: string }[] = [
    { id: 'resize', label: 'RESIZE', note: 'A DRAG MAKES THE SHAPE BIGGER OR SMALLER. IT DOES NOT MOVE THE JOINT.' },
    { id: 'move', label: 'MOVE', note: 'A DRAG SLIDES THE SHAPE, LEAVING THE JOINT EXACTLY WHERE IT IS.' },
  ];

  return (
    <fieldset className="mt-1 rounded-none border border-ink">
      <legend className="px-1 text-[9px] font-bold text-ink-plate">DRAGGING A SHAPE</legend>
      <div className="flex gap-[2px] p-1">
        {tools.map((tool) => (
          <button
            key={tool.id}
            type="button"
            onClick={() => setMassTool(tool.id)}
            aria-pressed={massTool === tool.id}
            title={tool.note}
            className={`flex-1 cursor-pointer rounded-none border-t border-l border-r-2 border-b-2 px-1 py-[3px] text-[9px] font-bold ${
              massTool === tool.id
                ? 'border-t-black border-l-black border-r-white border-b-white bg-ena text-paper'
                : 'border-t-white border-l-white border-black bg-sun-pale text-ink hover:bg-ice'
            }`}
          >
            {tool.label}
          </button>
        ))}
      </div>
      <p className="px-1 pb-1 text-[9px] text-ink-plate">{tools.find((tool) => tool.id === massTool)?.note}</p>
    </fieldset>
  );
}

/**
 * The shape's own size in the three axes - **a readout, not a control.**
 *
 * The drag is the control, and it is the one the brief asks for. Printing the numbers matters anyway: without them
 * there is no way to tell a shape that is 0.02 wide from one that is 0.2, and no way to notice a drag reaching its
 * clamp. Read-only by design rather than by omission - a second set of inputs writing the same field would be a
 * second way for the shape and the numbers to disagree.
 */
function MassSize({ jointId }: { jointId: string }) {
  const mass = useCharacterStore((state) => state.skeleton.joints[jointId]?.mass ?? null);

  if (mass === null) {
    return (
      <p className="mt-1 text-[9px] text-ink-plate">
        NO SHAPE HERE YET - PICK ONE ABOVE, THEN DRAG IT IN EITHER VIEWPORT.
      </p>
    );
  }

  const round = (value: number) => value.toFixed(2);

  return (
    <p className="mt-1 text-[9px] text-ink-plate">
      W {round(mass.size.x)} H {round(mass.size.y)} D {round(mass.size.z)} - DRAGGING THE SHAPE CHANGES THESE
    </p>
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
