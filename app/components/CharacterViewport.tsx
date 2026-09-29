'use client';

import { MAX_SCALE, MIN_SCALE } from '../lib/character/drag';
import type { ViewportKind } from '../lib/character/drag';
import { MASS_DYES, MODEL_INK, MODEL_LIMB } from '../lib/character/palette';
import { RIG_PRESET_IDS, RIG_PRESETS } from '../lib/character/rig';
import { MASS_SHAPE_IDS, MASS_SHAPES } from '../lib/character/shapes';
import { RENDER_LAYER_IDS, type RenderLayerId } from '../lib/character/layers';
import { scaleOf } from '../lib/character/skeleton';
import { MASS_SHAPE_GLYPHS, MASS_TOOL_GLYPHS } from '../lib/ui/icons';
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
/**
 * The workbench: the two viewports, and a docked column of tools beside them.
 *
 * **Everything used to be stacked below the viewports, and that is what this replaces.** The panel was a column -
 * two panes, then the presets, then the layer list, then the render stages, then the shape controls, then a status
 * line - so a reader choosing a shape and a reader looking at the figure could not see both at once, and the
 * shape tools sat four sections down the page from the thing they act on. Measured before the change: the bench
 * was about 1,900px of scrolling at 1440x900, and the shape palette alone started roughly 1,100px below the fold.
 *
 * **The dock is a column of sections, in the order a figure is built**, which is the one thing a vertical strip
 * buys that a toolbar of icons does not: the sections are *named*, so the arrangement teaches the model rather
 * than requiring it to be known. It is deliberately not a floating palette - a window inside a window would have to
 * be dismissed, dragged and re-found, and every one of those is work the reader did not ask for.
 *
 * The figure is drawn at a fixed proportion of the pane, so the two viewports stay in step whatever else changes.
 */
export default function CharacterViewport() {
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-2 lg:flex-row lg:items-start">
      {/* The bench itself: the two panes, side by side, taking the room the dock does not. */}
      <div className="flex min-w-0 flex-[3] flex-col gap-2 sm:flex-row">
        <Viewport kind="front" label="FRONT" hint="X / Y" />
        <Viewport kind="side" label="SIDE" hint="Z / Y" />
      </div>

      {/*
       * The dock. Its max height is the pane's own `26rem` plus the label bar above it, so the two columns end
       * together and the sections below the fold are reached *inside the dock* rather than by scrolling the page -
       * which is what keeps the figure on screen while a reader works down the options.
       *
       * Measured before this: at 1440x900 the shape strip landed at y=654 against panes ending at y=683, so the
       * palette sat below the bench and moving to it moved the bench off-screen.
       */}
      <div className="flex min-w-0 flex-[2] flex-col gap-2 lg:max-h-[27.4rem] lg:overflow-y-auto lg:pr-1">
        <FigureStatus />
        <ToolDock />
      </div>
    </div>
  );
}

/**
 * What the pointer will do, and what is held - **the status line, moved to the top of the dock.**
 *
 * It used to sit at the *foot* of a long column, which made it a report on work already done rather than a
 * statement of what a drag is about to do. At the head of the dock it reads as part of the tool: the reader picks
 * a tool below and this says what that tool does before they use it.
 *
 * The counts are read from the figure rather than from `PART_OF_JOINT`. The table is only the *seed*, so counting
 * it would report how many shapes the preset started with and not how many the reader has - a joint whose shape
 * they removed, or a shoulder they added one to, would leave those numbers lying.
 */
function FigureStatus() {
  const activeLayer = useCharacterStore((state) => state.activeLayer);
  const massTool = useCharacterStore((state) => state.massTool);
  const selectedJointId = useCharacterStore((state) => state.selectedJointId);
  const jointCount = useCharacterStore((state) => Object.keys(state.skeleton.joints).length);
  const parts = useCharacterStore(
    (state) => Object.values(state.skeleton.joints).filter((joint) => joint.mass !== null).length,
  );
  const interactionMode = useInteractionMode();

  const held = selectedJointId === null ? 'NOTHING HELD' : selectedJointId.toUpperCase();

  return (
    <div className="rounded-none border-2 border-t-white border-l-white border-r-black border-b-black bg-sun-pale p-2">
      <div className={TITLE_BAR_INACTIVE}>
        <span>TOOL</span>
        <span>[ {LAYERS.find((layer) => layer.id === activeLayer)?.label} ]</span>
      </div>

      <p className="mt-1 text-[10px] font-bold text-ink">{held}</p>

      <p className="text-[9px] text-ink-plate">
        {interactionMode === 'joints'
          ? 'DRAG A JOINT HANDLE IN EITHER PANE TO MOVE IT. ' + jointCount + ' JOINTS.'
          : interactionMode === 'mass'
            ? 'DRAG A SHAPE TO RESIZE IT. ' + parts + ' SHAPES ON THE FIGURE.'
            : interactionMode === 'massMove'
              ? 'DRAG A SHAPE TO SLIDE IT. THE JOINT STAYS PUT. ' + parts + ' SHAPES.'
              : interactionMode === 'light'
                ? 'DRAG EITHER PANE TO TURN THE LIGHT.'
                : massTool === 'colour'
                  ? 'PICK A DYE BELOW. THE COLOUR TOOL HAS NO DRAG. ' + parts + ' SHAPES.'
                  : 'THIS LAYER IS TO LOOK AT.'}
      </p>
    </div>
  );
}

/**
 * The dock: the layer strip, the render stages, the shape strip, the tool strip, and the options.
 *
 * **This is the merge.** The layer list, the render stages, the shape palette, the tool row and the dye row were
 * five separate full-width sections stacked under the viewports. They are one column here, in the order a figure is
 * built, and each is a *strip* rather than a form: pick what you are editing, pick what is drawn, pick a shape,
 * pick a verb, then the options for that verb.
 *
 * **The options area is the only part that changes with the selection**, which is what makes it a palette rather
 * than a form - the strips above stay put and only the panel swaps, so the reader's target never moves under them.
 */
function ToolDock() {
  const selectedJointId = useCharacterStore((state) => state.selectedJointId);
  const massTool = useCharacterStore((state) => state.massTool);
  const interactionMode = useInteractionMode();

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <EditLayerStrip />
      <RenderStage />
      <ShapeStrip jointId={selectedJointId} />
      <MassToolSwitch />
      <ToolOptions jointId={selectedJointId} tool={massTool} mode={interactionMode} />
      <PresetPicker />
    </div>
  );
}

/**
 * What a drag edits, as a strip of four plates.
 *
 * Each carries its one-line note as a `title` rather than as visible text: four sentences of prose printed under
 * four plates was the layout this replaces, and the note explains a control whose name is already the answer.
 */
function EditLayerStrip() {
  const activeLayer = useCharacterStore((state) => state.activeLayer);
  const selectLayer = useCharacterStore((state) => state.selectLayer);

  return (
    <fieldset className="rounded-none border-2 border-t-white border-l-white border-r-black border-b-black bg-sun-pale">
      <legend className={`${TITLE_BAR_INACTIVE} w-full`}>WHAT A DRAG EDITS</legend>

      <div className="flex flex-wrap gap-[2px] p-1">
        {LAYERS.map((layer) => {
          const chosen = activeLayer === layer.id;

          return (
            <button
              key={layer.id}
              type="button"
              onClick={() => selectLayer(layer.id)}
              aria-pressed={chosen}
              title={layer.note}
              className={`flex-1 cursor-pointer rounded-none border-t border-l border-r-2 border-b-2 px-1 py-[3px] text-[9px] font-bold ${
                chosen
                  ? 'border-t-black border-l-black border-r-white border-b-white bg-ena text-ink-bar'
                  : 'border-t-white border-l-white border-black bg-sun-pale text-ink hover:bg-ice'
              }`}
            >
              {layer.label}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

/**
 * The shape strip: the seven primitives, as the row a reader picks from.
 *
 * **Disabled rather than hidden with no joint held**, which was a measured defect: the grid is the *vocabulary*,
 * and a reader who cannot see what shapes exist cannot decide whether to pick a joint to use them on. Chrome
 * reported `shape plates: 0` on arrival when this was hidden behind a selection.
 */
function ShapeStrip({ jointId }: { jointId: string | null }) {
  const setShape = useCharacterStore((state) => state.setShape);
  const clearShape = useCharacterStore((state) => state.clearShape);
  const current = useCharacterStore((state) =>
    jointId === null ? null : (state.skeleton.joints[jointId]?.mass?.shape ?? null),
  );
  const armed = jointId !== null;

  return (
    <fieldset className="rounded-none border-2 border-t-white border-l-white border-r-black border-b-black bg-sun-pale">
      <legend className={`${TITLE_BAR_INACTIVE} w-full`}>SHAPE - SEVEN PRIMITIVES</legend>

      <div className="flex flex-wrap gap-[2px] p-1">
        {MASS_SHAPE_IDS.map((shape) => {
          const chosen = current === shape;

          return (
            <button
              key={shape}
              type="button"
              disabled={!armed}
              onClick={() => {
                if (jointId !== null) setShape(jointId, shape);
              }}
              aria-pressed={chosen}
              aria-label={`${MASS_SHAPES[shape].label} - ${MASS_SHAPES[shape].note}`}
              title={MASS_SHAPES[shape].note}
              className={`flex min-w-12 flex-1 cursor-pointer flex-col items-center gap-[2px] rounded-none border-t border-l border-r-2 border-b-2 px-1 py-[3px] text-[9px] font-bold disabled:cursor-not-allowed disabled:bg-chrome-dark disabled:text-ink ${
                chosen
                  ? 'border-t-black border-l-black border-r-white border-b-white bg-ena text-ink-bar'
                  : 'border-t-white border-l-white border-black bg-sun-pale text-ink hover:bg-ice'
              }`}
            >
              <span aria-hidden className="text-[16px] leading-none">
                {MASS_SHAPE_GLYPHS[shape]}
              </span>
              {MASS_SHAPES[shape].label}
            </button>
          );
        })}
      </div>

      <p className="px-1 pb-1 text-[9px] text-ink-plate">
        {!armed
          ? 'PICK A JOINT IN EITHER PANE FIRST - THEN THESE APPLY TO IT.'
          : current === null
            ? 'THIS JOINT CARRIES NOTHING. PICK ONE.'
            : `THIS JOINT IS CARRYING A ${MASS_SHAPES[current].label}.`}
      </p>

      {/*
       * **Taking a shape off is its own control, and it has to be somewhere.** It was a plate under the palette
       * before the merge; moved into the strip it would be an eighth choice among seven primitives, which is a
       * different kind of thing wearing the same costume - so it lives on its own line, only when there is
       * something to remove.
       */}
      {armed && current !== null ? (
        <button
          type="button"
          onClick={() => clearShape(jointId)}
          className="mx-1 mb-1 cursor-pointer rounded-none border-t border-l border-r-2 border-b-2 border-t-white border-l-white border-r-black border-b-black bg-chrome-dark px-1 py-[2px] text-[9px] font-bold text-ink hover:bg-bubble-pale"
        >
          [ TAKE THE SHAPE OFF ]
        </button>
      ) : null}
    </fieldset>
  );
}

/**
 * The control for the selected tool - the one area of the dock that changes.
 *
 * **The panel follows the strip above it**, so a reader who presses COLOUR sees the dye row without asking where it
 * went. That is the CSP arrangement: the tool marks are fixed and the options swap beneath them.
 *
 * The two read-only branches are here rather than in `MassRescaler` because they are about there being nothing to
 * act on, which is a fact about the *tool*, not about the shape.
 */
function ToolOptions({
  jointId,
  tool,
  mode,
}: {
  jointId: string | null;
  tool: MassTool;
  mode: InteractionMode;
}) {
  if (mode === 'light') {
    return (
      <p className="rounded-none border-2 border-t-white border-l-white border-r-black border-b-black bg-sun-pale p-2 text-[9px] text-ink">
        THE LIGHT HAS NO OPTIONS. DRAG IN EITHER PANE - LEFT AND RIGHT TURNS IT AROUND THE FIGURE, UP AND DOWN
        RAISES AND LOWERS IT.
      </p>
    );
  }

  if (mode === 'none' && tool !== 'colour') {
    return (
      <p className="rounded-none border-2 border-t-white border-l-white border-r-black border-b-black bg-sun-pale p-2 text-[9px] text-ink">
        NOTHING HERE IS EDITABLE. PICK ANOTHER LAYER ABOVE.
      </p>
    );
  }

  if (jointId === null) {
    return (
      <p className="rounded-none border-2 border-t-white border-l-white border-r-black border-b-black bg-sun-pale p-2 text-[9px] text-ink">
        PICK A JOINT IN EITHER PANE AND ITS OPTIONS APPEAR HERE.
      </p>
    );
  }

  return <MassRescaler jointId={jointId} />;
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
                ? 'border-t-black border-l-black border-r-white border-b-white bg-ena text-ink-bar'
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
              skeletonVisible ? 'bg-sun text-ink-plate hover:bg-ice' : 'bg-chrome-dark text-ink'
            }`}
          >
            {skeletonVisible ? 'ÃƒÂ¢Ã¢â‚¬â€Ã‚Â' : 'ÃƒÂ¢Ã¢â‚¬â€Ã…â€™'}
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
                  ? 'border-t-black border-l-black border-r-white border-b-white bg-ena text-ink-bar'
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

function MassToolPanel({ jointId, tool }: { jointId: string; tool: MassTool }) {
  const mass = useCharacterStore((state) => state.skeleton.joints[jointId]?.mass ?? null);

  if (mass === null) return null;

  if (tool === 'colour') return <MassColourRow jointId={jointId} current={mass.colour} />;

  if (tool === 'move') {
    const round = (value: number) => value.toFixed(2);

    return (
      <p className="mt-1 text-[9px] text-ink-plate">
        OFFSET X {round(mass.offset.x)} Y {round(mass.offset.y)} Z {round(mass.offset.z)} - DRAGGING SLIDES THE
        SHAPE FROM HERE. THE JOINT AND THE FIGURE UNDER IT DO NOT MOVE.
      </p>
    );
  }

  return null;
}

/**
 * The dyes a shape may wear, as swatches.
 *
 * **A swatch is a colour, so a swatch has to *be* the colour rather than name it.** The one place on this site
 * where a control cannot be a plate is here: a row reading `[ ROYAL BLUE ] [ EMERALD ] [ ROSE ]` makes a reader
 * translate seven words into seven colours, and the whole job is picking one by eye. So these are small filled
 * boxes, drawn from `MASS_DYES` - which is a *library* constant, so this is still not a component writing a hex.
 *
 * The first swatch is deliberately not a colour: `FIGURE` means "no tint of its own", and it is drawn as a
 * diagonal split so it reads as *absent* rather than as an eighth dye. Without it there would be no way back to
 * the two-tone figure a shape starts in.
 *
 * `aria-label` carries the name, because a coloured box announces nothing to a screen reader.
 */
function MassColourRow({ jointId, current }: { jointId: string; current: string | null }) {
  const setMassColour = useCharacterStore((state) => state.setMassColour);

  return (
    <fieldset className="mt-1 rounded-none border border-ink">
      <legend className="px-1 text-[9px] font-bold text-ink-plate">COLOUR - THIS SHAPE ONLY</legend>

      <div className="flex flex-wrap gap-[2px] p-1">
        {MASS_DYES.map((dye) => {
          const chosen = current === dye.value;

          return (
            <button
              key={dye.id}
              type="button"
              onClick={() => setMassColour(jointId, dye.value)}
              aria-pressed={chosen}
              aria-label={dye.label}
              title={dye.label}
              className={`h-5 w-5 cursor-pointer rounded-none border-t border-l border-r-2 border-b-2 ${
                chosen
                  ? 'border-t-black border-l-black border-r-white border-b-white'
                  : 'border-t-white border-l-white border-r-black border-b-black'
              }`}
              // Inline, because the value is data rather than a class - there is no Tailwind utility for an
              // arbitrary dye that is not in the theme, and the swatch's whole point is to show the real colour.
              style={
                dye.value === null
                  ? { background: `linear-gradient(135deg, ${MODEL_INK} 50%, ${MODEL_LIMB} 50%)` }
                  : { background: dye.value }
              }
            />
          );
        })}
      </div>

      <p className="px-1 pb-1 text-[9px] text-ink-plate">
        {current === null
          ? 'THIS SHAPE WEARS THE FIGUREÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢S OWN TWO TONES.'
          : `THIS SHAPE IS PAINTED ${MASS_DYES.find((dye) => dye.value === current)?.label ?? 'IN A DYE'}.`}
      </p>
    </fieldset>
  );
}

/**
 * The mass tab: opened by clicking a shape, and it acts on what was clicked.
 *
 * **The palette renders whether or not anything is selected, and that was a real defect.** This used to return only
 * a note when no joint was picked - so a reader arriving at the CHAR tab saw the words "CLICK A SHAPE IN EITHER
 * VIEWPORT" and *no shape palette at all*. Chrome measured it: two fieldsets on the page, neither of them the
 * palette, `shape plates: 0`. The one control the brief asked for was behind a selection the reader had no reason
 * to make first, because the palette is how a shape gets added in the first place.
 *
 * What is conditional is what *needs* a target: the size readout, the offset readout and the joint scale slider.
 * Those say which joint they act on, and with none picked there is nothing for them to name.
 */
function MassRescaler({ jointId }: { jointId: string | null }) {
  const joints = useCharacterStore((state) => state.skeleton.joints);
  const scaleJoint = useCharacterStore((state) => state.scaleJoint);
  const massTool = useCharacterStore((state) => state.massTool);
  const joint = jointId === null ? undefined : joints[jointId];

  if (jointId === null || joint === undefined) return null;

  const id = jointId;
  const part = joint.mass;

  return (
    <div className="rounded-none border-2 border-t-white border-l-white border-r-black border-b-black bg-sun-pale p-2">
      <p className="text-[10px] font-bold text-ink">
        {id.toUpperCase()}
        <span className="ml-2 font-normal text-ink-plate">
          {part === null ? 'CARRYING NOTHING' : `CARRYING A ${MASS_SHAPES[part.shape].label}`}
        </span>
      </p>

      {/* The options follow the tool above: size for RESIZE, offset for MOVE, the dye row for COLOUR. */}
      <MassToolPanel jointId={id} tool={massTool} />
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
 * The three verbs a shape has, as a strip of marks with their names under them.
 *
 * **This is the merge, and it replaces a switch that could not hold a third idea.** The shape row, the RESIZE/MOVE
 * pair and the joint slider used to sit in three separate places, which meant a reader looking for "make this foot
 * smaller" had to know the answer was a *layer*, then a *tool*, then a *slider* - three presses through two
 * vocabularies for one intention. The verbs are one strip here, and picking one is one press.
 *
 * **COLOUR is a tool with no gesture**, which is why the strip has three members and only two drives a drag: a
 * colour is not a quantity, so there is nothing for a pointer to interpolate. Its name is still on a plate, because
 * a reader should not have to guess that `◐` opens a swatch row.
 */
function MassToolSwitch() {
  const massTool = useCharacterStore((state) => state.massTool);
  const setMassTool = useCharacterStore((state) => state.setMassTool);

  const tools: { id: MassTool; label: string; note: string }[] = [
    { id: 'resize', label: 'RESIZE', note: 'A DRAG SIZES THE SHAPE. IT DOES NOT MOVE THE JOINT.' },
    { id: 'move', label: 'MOVE', note: 'A DRAG SLIDES THE SHAPE, LEAVING THE JOINT EXACTLY WHERE IT IS.' },
    { id: 'colour', label: 'COLOUR', note: 'PICK A DYE. THIS TOOL HAS NO DRAG, SO NOTHING MOVES BY ACCIDENT.' },
  ];

  return (
    <fieldset className="rounded-none border-2 border-t-white border-l-white border-r-black border-b-black bg-sun-pale">
      <legend className={`${TITLE_BAR_INACTIVE} w-full`}>WHAT A DRAG ON A SHAPE DOES</legend>

      {/*
       * **A mark above its name, where a wide screen has the room for both.** The glyph is what makes the row
       * scannable - three marks are read at a glance where three words are read one at a time - and the name
       * underneath is what keeps it honest, because `Ã¢Â¤Â¡` alone is a guess until it says RESIZE.
       */}
      <div className="flex gap-[2px] p-1">
        {tools.map((tool) => (
          <button
            key={tool.id}
            type="button"
            onClick={() => setMassTool(tool.id)}
            aria-pressed={massTool === tool.id}
            title={tool.note}
            className={`flex flex-1 cursor-pointer flex-col items-center gap-[2px] rounded-none border-t border-l border-r-2 border-b-2 px-1 py-[3px] text-[9px] font-bold ${
              massTool === tool.id
                ? 'border-t-black border-l-black border-r-white border-b-white bg-ena text-ink-bar'
                : 'border-t-white border-l-white border-black bg-sun-pale text-ink hover:bg-ice'
            }`}
          >
            <span aria-hidden className="text-[14px] leading-none">
              {MASS_TOOL_GLYPHS[tool.id]}
            </span>
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
    <div className="min-w-0 flex-1 rounded-none border-2 border-t-black border-l-black border-r-white border-b-white bg-hardware">
      <p className="flex items-center justify-between bg-ena-deep px-2 py-[2px] text-[10px] font-bold text-ink-bar">
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