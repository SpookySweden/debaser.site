'use client';

/**
 * The character workbench, laid out like a paint program's canvas window.
 *
 *   left    the tool strip in three blocks - EDIT tools, POSE (and +NODE), and HISTORY (undo, redo, new)
 *   middle  the tool's options in a bar with the LAYERS switches and the ☀ light at its right, then the FRONT and
 *           SIDE views of the same figure, both showing the live pixel render, and under them PIXELS and SAG
 *   right   the shapes list (like a layers panel, folded to its header until opened) and the properties of whatever
 *           is picked, in folding sections
 *
 * On a phone the strip becomes rows across the top (wrapped, so no tool hides off the edge), the views stack, and
 * the two panels fold under them.
 *
 * **Short labels on screen, the explanations in tooltips.** Each tool says what to do in a few words in the bar; the
 * full sentence is its `title`.
 *
 * **The options bar is always there, the same height, whatever the tool.** Its contents change when the tool does,
 * but the views below it never jump - the same rule every reveal on this site follows. The light d-pad, the ADD menu
 * and the ✓ / ✗ of a placement all pop out over what is there (absolutely positioned), so opening them moves nothing.
 *
 * **Placing (ADD or +NODE) is modal**: pick a node, drag, ✓ or ✗. While it runs the side panels are inert, ESC is ✗,
 * and any other tool abandons it. Leaving the workbench abandons it too, so it is never found half done.
 *
 * Loaded with `ssr: false` (see `CharacterEditorPanel`): Three.js needs a browser.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import { VIEW_BASIS, screenBox, type ViewportKind } from '../lib/character/drag';
import {
  findShape,
  MAX_NAME_LENGTH,
  MAX_NODES,
  MAX_SHAPES,
  nodesRemovedWith,
  shapesLosingNode,
  type Shape,
} from '../lib/character/figure';
import { MASS_DYES, MODEL_INK } from '../lib/character/palette';
import { LAYER_IDS, LIGHT_HIGHEST, layerRests, lightDirection, type LayerId } from '../lib/character/pixel-render';
import { jointLabel, nodeName, RIG_PRESETS } from '../lib/character/rig';
import { sagOf } from '../lib/character/sag';
import { MASS_SHAPE_IDS, MASS_SHAPES, type MassShapeId } from '../lib/character/shapes';
import { jointFrames, type Vec3 } from '../lib/character/skeleton';
import { placingBlock, TOOL_IDS, useCharacterStore, type SectionId, type ToolId } from '../lib/character/store';
import { brokenShapes } from '../lib/character/structure';
import { TITLE_BAR_INACTIVE } from '../lib/ui/controls';
import { MASS_SHAPE_GLYPHS, TOOL_GLYPHS } from '../lib/ui/icons';
import CharacterPresetPicker from './CharacterPresetPicker';
import CharacterScene, { toPane } from './CharacterScene';

/** Each tool's name, the few words the options bar shows, and the full sentence for its tooltip. */
const TOOLS: Record<ToolId, { label: string; status: string; hint: string }> = {
  select: {
    label: 'SELECT',
    status: 'CLICK A SHAPE',
    hint: 'CLICK A SHAPE TO PICK IT. DRAG IT TO MOVE, DRAG A YELLOW SQUARE TO SIZE IT, DRAG THE GREEN KNOB TO TURN IT.',
  },
  add: {
    label: 'ADD',
    status: 'PICK A SHAPE',
    hint: 'PICK A SHAPE, CLICK THE NODE IT HANGS FROM, DRAG IT INTO PLACE, THEN ✓.',
  },
  move: {
    label: 'MOVE',
    status: 'DRAG A SHAPE',
    hint: 'DRAG ANY SHAPE TO SLIDE IT. FRONT MOVES ACROSS AND UP; SIDE MOVES FORWARD AND UP.',
  },
  turn: { label: 'TURN', status: 'DRAG TO SPIN', hint: 'DRAG ANY SHAPE ROUND ITS MIDDLE TO SPIN IT, LIKE A DIAL.' },
  size: {
    label: 'SIZE',
    status: 'DRAG TO RESIZE',
    hint: 'DRAG ANY SHAPE: RIGHT TO WIDEN, UP TO MAKE IT TALLER. IT GROWS FROM ITS MIDDLE.',
  },
  pose: { label: 'POSE', status: 'DRAG A NODE', hint: 'DRAG A GREEN NODE. PINNED SHAPES FOLLOW AND TURN WITH THEIR BONE.' },
  delete: { label: 'DELETE', status: 'CLICK TO REMOVE', hint: 'CLICK A SHAPE TO REMOVE IT. UNDO BRINGS IT BACK.' },
};

/** The LAYERS switches: what the live pixel render draws (see `pixel-render.ts`), and the skeleton drawn over it. */
const LAYERS: Record<LayerId, { label: string; hint: string }> = {
  pixelate: { label: 'PIXELATE', hint: 'BIG PIXELS, AS THE FIGURE WILL LOOK. OFF: FULL RESOLUTION.' },
  // A no-break space: `w-min` would otherwise stack "12" over "PX".
  fine: { label: '12 PX', hint: 'BIGGER PIXELS: EACH VIEW IS ABOUT 12 PIXELS ON ITS LONGER SIDE. WORKS WITH PIXELATE ON.' },
  normalLight: { label: 'NORMAL LIGHT', hint: 'SHADE THE FIGURE IN THREE HARD BANDS. OFF: FLAT COLOURS.' },
  normalMap: { label: 'NORMAL MAP', hint: 'SHOW WHAT THE LIGHT READS: EACH PIXEL COLOURED BY THE WAY IT FACES.' },
};

const FULL_SHAPES = `${MAX_SHAPES} SHAPES IS THE MOST A FIGURE CAN HAVE. DELETE ONE TO ADD ANOTHER.`;
const FULL_NODES = `${MAX_NODES} NODES IS THE MOST A FIGURE CAN HAVE. DELETE ONE TO ADD ANOTHER.`;

/** POSE works on the skeleton rather than the shapes, so it gets a block of its own; every other tool is EDIT. */
const EDIT_TOOLS = TOOL_IDS.filter((id) => id !== 'pose');

/** A pressable square on this workbench: flat, inked, and inverted when on. No bevels - see `docs/design.md`. */
function pressable(on: boolean): string {
  return `cursor-pointer rounded-none border-2 border-ink font-bold max-sm:min-h-11 disabled:cursor-not-allowed disabled:opacity-40 aria-disabled:cursor-not-allowed aria-disabled:opacity-40 ${
    on ? 'bg-ena text-ink-bar' : 'bg-sun-pale text-ink hover:bg-ice'
  }`;
}

const PANEL = 'rounded-none border-2 border-ink bg-sun-pale';

export default function CharacterViewport() {
  useUndoKeys();
  const bench = useRef<HTMLDivElement>(null);
  usePlacingKeys(bench);
  const placing = useCharacterStore((state) => state.placing !== null);

  return (
    <div ref={bench} className="relative flex min-w-0 flex-col gap-2 lg:flex-row lg:items-start">
      <CharacterPresetPicker />
      <ToolStrip />

      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <OptionsBar />
        <div className="grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-2">
          <View kind="front" label="FRONT" hint="ACROSS / UP" />
          <View kind="side" label="SIDE" hint="FORWARD / UP" />
        </div>
        <Stats />
      </div>

      {/* Inert while placing: the views are the only place to act until ✓ or ✗. */}
      <div inert={placing} className={`flex min-w-0 flex-col gap-2 lg:w-64 lg:shrink-0 ${placing ? 'opacity-60' : ''}`}>
        <ShapesList />
        <Properties />
      </div>
    </div>
  );
}

/** Ctrl+Z, Ctrl+Y and Ctrl+Shift+Z, while the workbench is open - but not while typing in one of its boxes. */
function useUndoKeys() {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey)) return;
      const target = event.target as HTMLElement | null;
      if (target !== null && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
      const key = event.key.toLowerCase();
      if (key === 'z' && !event.shiftKey) {
        event.preventDefault();
        useCharacterStore.getState().undo();
      } else if (key === 'y' || (key === 'z' && event.shiftKey)) {
        event.preventDefault();
        useCharacterStore.getState().redo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

/**
 * ESC is ✗ while placing - caught on the way down, before the customiser hears it, so it cancels the placement and
 * not the whole window. Leaving the workbench (another tab, the window closing) abandons a placement too.
 *
 * One ESC does one thing: when the ADD menu or the light pad is open, ESC is theirs (they close first); in a text box
 * it is the box's own; and a key pressed in another window (the shelf) is that window's.
 */
function usePlacingKeys(bench: RefObject<HTMLDivElement | null>) {
  const placing = useCharacterStore((state) => state.placing !== null);

  useEffect(() => () => useCharacterStore.getState().cancelPlacing(), []);

  useEffect(() => {
    if (!placing) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      const target = event.target as HTMLElement | null;
      const root = bench.current;
      if (target !== null && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
      // Another window: neither inside the workbench nor around it. (A press in a view leaves focus on the customiser
      // window itself, which is around it - that ESC is the placement's.)
      if (target !== null && root !== null && !root.contains(target) && !target.contains(root)) return;
      if (useCharacterStore.getState().lightPadOpen || root?.querySelector('[aria-label="Shape to add"]')) return;
      event.stopPropagation();
      useCharacterStore.getState().cancelPlacing();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [placing, bench]);
}

const STRIP_BUTTON =
  'flex h-12 w-14 shrink-0 flex-col items-center justify-center gap-[2px] text-[13px] max-sm:w-[3.25rem]';

function ToolStrip() {
  const tool = useCharacterStore((state) => state.tool);
  const setTool = useCharacterStore((state) => state.setTool);
  const canUndo = useCharacterStore((state) => state.past.length > 0 && state.placing === null);
  const canRedo = useCharacterStore((state) => state.future.length > 0 && state.placing === null);
  const undo = useCharacterStore((state) => state.undo);
  const redo = useCharacterStore((state) => state.redo);
  const setPresetPicker = useCharacterStore((state) => state.setPresetPicker);

  const toolButton = (id: ToolId) => id === 'add' ? <AddToolButton key={id} /> : (
    <button
      key={id}
      type="button"
      onClick={() => setTool(id)}
      aria-pressed={tool === id}
      title={TOOLS[id].hint}
      className={`${STRIP_BUTTON} ${pressable(tool === id)}`}
    >
      <span aria-hidden className="text-[16px] leading-none">
        {TOOL_GLYPHS[id]}
      </span>
      {TOOLS[id].label}
    </button>
  );

  return (
    <nav
      aria-label="Workbench tools"
      className={`${PANEL} flex shrink-0 flex-wrap gap-x-3 gap-y-2 p-1 lg:flex-col lg:flex-nowrap lg:gap-0`}
    >
      <StripBlock label="Edit" grid>
        {EDIT_TOOLS.map(toolButton)}
      </StripBlock>
      <StripBlock label="Pose">
        {toolButton('pose')}
        <AddNodeButton />
      </StripBlock>
      <StripBlock label="History">
        <button type="button" onClick={undo} disabled={!canUndo} title="UNDO (CTRL+Z)" className={`${STRIP_BUTTON} ${pressable(false)}`}>
          <span aria-hidden className="text-[16px] leading-none">
            {TOOL_GLYPHS.undo}
          </span>
          UNDO
        </button>
        <button type="button" onClick={redo} disabled={!canRedo} title="REDO (CTRL+Y)" className={`${STRIP_BUTTON} ${pressable(false)}`}>
          <span aria-hidden className="text-[16px] leading-none">
            {TOOL_GLYPHS.redo}
          </span>
          REDO
        </button>
        <button
          type="button"
          onClick={() => setPresetPicker(true)}
          title="START A NEW FIGURE FROM ONE OF THE PRESETS"
          className={`${STRIP_BUTTON} ${pressable(false)}`}
        >
          <span aria-hidden className="text-[16px] leading-none">
            {TOOL_GLYPHS.new}
          </span>
          NEW
        </button>
      </StripBlock>
    </nav>
  );
}

/**
 * ADD, and the menu of shapes it pops out: beside the button on a wide screen, under it on a phone, over whatever is
 * there (absolutely positioned), so opening it moves nothing. Picking a shape closes it and starts placing that shape.
 * Like the light pad, it also closes on ADD again, a press elsewhere, ESC (caught before the customiser hears it), or
 * tabbing out. At `MAX_SHAPES` it rests, and its tooltip says why - `aria-disabled` rather than `disabled`, so the
 * tooltip still shows.
 */
function AddToolButton() {
  const tool = useCharacterStore((state) => state.tool);
  const addKind = useCharacterStore((state) => state.addKind);
  const full = useCharacterStore((state) => state.figure.shapes.length >= MAX_SHAPES);
  const startPlacing = useCharacterStore((state) => state.startPlacing);
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      const target = event.target as HTMLElement | null;
      if (target !== null && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
      event.stopPropagation();
      setOpen(false);
      if (box.current?.contains(document.activeElement)) opener.current?.focus();
    };
    const onPointer = (event: PointerEvent) => {
      if (box.current !== null && !box.current.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('pointerdown', onPointer, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('pointerdown', onPointer, true);
    };
  }, [open]);

  return (
    <div
      ref={box}
      className="relative shrink-0"
      onBlur={(event) => {
        const next = event.relatedTarget;
        if (next instanceof Node && !event.currentTarget.contains(next)) setOpen(false);
      }}
    >
      <button
        ref={opener}
        type="button"
        onClick={() => {
          if (!full) setOpen(!open);
        }}
        aria-pressed={tool === 'add'}
        aria-expanded={open}
        aria-disabled={full}
        title={full ? FULL_SHAPES : TOOLS.add.hint}
        className={`${STRIP_BUTTON} ${pressable(tool === 'add')}`}
      >
        <span aria-hidden className="text-[16px] leading-none">
          {TOOL_GLYPHS.add}
        </span>
        {TOOLS.add.label}
      </button>
      {open ? (
        <div
          role="group"
          aria-label="Shape to add"
          className={`${PANEL} absolute left-0 top-full z-30 mt-1 flex w-max flex-col gap-[2px] p-1 max-sm:grid max-sm:grid-cols-2 lg:left-full lg:top-0 lg:ml-2 lg:mt-0`}
        >
          {MASS_SHAPE_IDS.map((kind) => (
            <button
              key={kind}
              type="button"
              onClick={() => {
                setOpen(false);
                startPlacing({ what: 'shape', kind });
                opener.current?.focus();
              }}
              aria-pressed={addKind === kind}
              title={MASS_SHAPES[kind].note}
              className={`flex h-8 items-center gap-2 px-2 text-left text-[13px] ${pressable(addKind === kind)}`}
            >
              <span aria-hidden className="w-4 shrink-0 text-center text-[14px] leading-none">
                {MASS_SHAPE_GLYPHS[kind]}
              </span>
              {MASS_SHAPES[kind].label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** +NODE: the same flow as ADD - pick the parent node, drag the new one, ✓. Pressed again, it cancels. */
function AddNodeButton() {
  const placingNode = useCharacterStore((state) => state.placing?.what === 'node');
  const joints = useCharacterStore((state) => state.figure.skeleton.joints);
  const full = Object.keys(joints).length >= MAX_NODES;
  const startPlacing = useCharacterStore((state) => state.startPlacing);
  const cancelPlacing = useCharacterStore((state) => state.cancelPlacing);

  return (
    <button
      type="button"
      onClick={() => {
        if (placingNode) cancelPlacing();
        else if (!full) startPlacing({ what: 'node' });
      }}
      aria-pressed={placingNode}
      aria-disabled={full && !placingNode}
      title={full && !placingNode ? FULL_NODES : 'ADD A NODE: CLICK ITS PARENT NODE, DRAG IT INTO PLACE, THEN ✓.'}
      className={`${STRIP_BUTTON} ${pressable(placingNode)}`}
    >
      <span aria-hidden className="text-[16px] leading-none">
        {TOOL_GLYPHS.node}
      </span>
      +NODE
    </button>
  );
}

/**
 * One block of the strip. On a wide screen the blocks are a column split by ink rules; on a phone, spaced rows - and
 * EDIT, the six-button block, is two even rows of three rather than a row that leaves one tool hanging below it.
 */
function StripBlock({ label, grid = false, children }: { label: string; grid?: boolean; children: ReactNode }) {
  return (
    <div
      role="group"
      aria-label={label}
      className={`flex flex-wrap gap-1 lg:flex-col lg:border-ink lg:py-2 lg:first:pt-0 lg:last:pb-0 lg:[&+&]:border-t-2 ${
        grid ? 'max-sm:grid max-sm:grid-cols-3' : ''
      }`}
    >
      {children}
    </div>
  );
}

/**
 * The bar above the views: the tool's own choices or a few words on how to use it (or, while placing, what to do
 * next and a way out), then the LAYERS switches and the light. Always the same height; on a phone it is always two
 * rows (the tool row keeps a finger's height even when it holds only words), so changing tool never moves the views.
 */
function OptionsBar() {
  const tool = useCharacterStore((state) => state.tool);
  const placing = useCharacterStore((state) => state.placing !== null);

  return (
    <div className={`${PANEL} flex min-h-[3.25rem] min-w-0 flex-wrap items-center gap-2 p-1 sm:flex-nowrap`}>
      <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto max-sm:min-h-11 max-sm:basis-full">
        {placing ? <PlacingOptions /> : tool === 'pose' ? <PoseOptions /> : (
          <p className="px-1 text-[13px] font-bold leading-snug text-ink" title={TOOLS[tool].hint}>
            {TOOLS[tool].status}
          </p>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-1 max-sm:basis-full">
        <LayerSwitches />
        <LightControl />
      </div>
    </div>
  );
}

/** A ✗ first (it works before the new thing is out, when there is no ✗ beside it yet), what is being placed, and the one thing to do next. */
function PlacingOptions() {
  const placing = useCharacterStore((state) => state.placing);
  const cancelPlacing = useCharacterStore((state) => state.cancelPlacing);
  if (placing === null) return null;

  const what = placing.what === 'shape' ? MASS_SHAPES[placing.kind].label : 'NODE';
  // A few words on the bar, the sentence in the tooltip - the bar shares its row with the LAYERS switches.
  const [next, hint] =
    placing.stage === 'node'
      ? placing.what === 'shape'
        ? ['CLICK A NODE', 'CLICK THE NODE THE NEW SHAPE HANGS FROM. IT APPEARS THERE, PINNED TO IT.']
        : ['CLICK A NODE', 'CLICK THE NODE THE NEW NODE HANGS FROM: ITS PARENT.']
      : ['DRAG, THEN ✓', 'DRAG ANYWHERE IN EITHER VIEW TO MOVE IT, THEN ✓ TO KEEP IT OR ✗ TO CANCEL.'];

  return (
    <>
      <button
        type="button"
        onClick={cancelPlacing}
        aria-label={`Cancel the new ${placing.what}`}
        title="CANCEL: THE FIGURE GOES BACK EXACTLY AS IT WAS (ESC)"
        className={`h-8 w-8 shrink-0 text-[14px] leading-none max-sm:w-11 ${pressable(false)}`}
      >
        ✗
      </button>
      <span className="flex shrink-0 items-center gap-1 border-2 border-ink bg-ena px-1 py-[2px] text-[13px] font-bold text-ink-bar">
        {placing.what === 'shape' ? (
          <span aria-hidden className="text-[14px] leading-none">
            {MASS_SHAPE_GLYPHS[placing.kind]}
          </span>
        ) : null}
        {what}
      </span>
      <p className="shrink-0 px-1 text-[13px] font-bold text-ink" title={hint}>
        {next}
      </p>
    </>
  );
}

function PoseOptions() {
  const stretch = useCharacterStore((state) => state.stretch);
  const toggleStretch = useCharacterStore((state) => state.toggleStretch);

  return (
    <>
      {[false, true].map((on) => (
        <button
          key={String(on)}
          type="button"
          onClick={() => {
            if (stretch !== on) toggleStretch();
          }}
          aria-pressed={stretch === on}
          title={on ? 'A DRAG STRETCHES: BONES GET LONGER OR SHORTER.' : 'A DRAG BENDS: LIMBS SWING, BONES KEEP THEIR LENGTH.'}
          className={`shrink-0 px-2 py-1 text-[13px] ${pressable(stretch === on)}`}
        >
          {on ? 'STRETCHES' : 'BENDS'}
        </button>
      ))}
      <span className="shrink-0 px-1 text-[13px] font-bold text-ink" title={TOOLS.pose.hint}>
        {TOOLS.pose.status}
      </span>
    </>
  );
}

/**
 * PIXELATE, 12 PX, NORMAL LIGHT, NORMAL MAP, then SKELETON. NORMAL LIGHT rests while the normal map is shown (there is
 * nothing to shade) and 12 PX while PIXELATE is off (there are no pixels to size); see `layerRests`. The skeleton
 * always shows while posing or placing, whatever this switch says.
 */
function LayerSwitches() {
  const layers = useCharacterStore((state) => state.layers);
  const toggleLayer = useCharacterStore((state) => state.toggleLayer);
  const showSkeleton = useCharacterStore((state) => state.showSkeleton);
  const toggleSkeleton = useCharacterStore((state) => state.toggleSkeleton);
  // `w-min` wraps the two-word labels (NORMAL / LIGHT) onto two lines on a wide screen, so the five switches leave the
  // tool's own words room in the bar; on a phone they are a two-column grid, where no label is cut.
  const switchClass = (on: boolean) => `shrink-0 px-2 py-1 text-[13px] leading-tight max-sm:px-1 sm:w-min ${pressable(on)}`;

  return (
    <div role="group" aria-label="Layers" className="flex items-center gap-1 max-sm:grid max-sm:flex-1 max-sm:grid-cols-2">
      <span className="text-[13px] font-bold text-ink max-sm:hidden">LAYERS</span>
      {LAYER_IDS.map((id) => (
        <button
          key={id}
          type="button"
          onClick={() => toggleLayer(id)}
          aria-pressed={layers[id]}
          disabled={layerRests(id, layers)}
          title={LAYERS[id].hint}
          className={switchClass(layers[id])}
        >
          {LAYERS[id].label}
        </button>
      ))}
      <button
        type="button"
        onClick={toggleSkeleton}
        aria-pressed={showSkeleton}
        title="DRAW THE SKELETON OVER THE FIGURE. IT ALWAYS SHOWS WHILE POSING OR PLACING."
        className={switchClass(showSkeleton)}
      >
        SKELETON
      </button>
    </div>
  );
}

/**
 * The one ☀ for both views, and the d-pad it opens. The pad closes on a press anywhere else, on ☀ again, on ESC, or
 * when the keyboard tabs out of it. ESC is caught on the way down, before the customiser hears it, so it closes the
 * pad and not the whole window (the NEW FIGURE picker does the same) - except in a text box, where ESC is the box's
 * own "put it back".
 */
function LightControl() {
  const open = useCharacterStore((state) => state.lightPadOpen);
  const lightOn = useCharacterStore((state) => state.lightOn);
  const setLightPad = useCharacterStore((state) => state.setLightPad);
  const box = useRef<HTMLDivElement>(null);

  // Shut when the workbench goes, so it is not found open on the way back to the CHAR tab.
  useEffect(() => () => useCharacterStore.getState().setLightPad(false), []);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      const target = event.target as HTMLElement | null;
      if (target !== null && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
      event.stopPropagation();
      useCharacterStore.getState().setLightPad(false);
    };
    const onPointer = (event: PointerEvent) => {
      if (box.current !== null && !box.current.contains(event.target as Node)) {
        useCharacterStore.getState().setLightPad(false);
      }
    };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('pointerdown', onPointer, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('pointerdown', onPointer, true);
    };
  }, [open]);

  return (
    <div
      ref={box}
      className="relative shrink-0"
      // Tabbing out closes it. A focus that just went nowhere (a pad key that disabled itself at the top step) does not.
      onBlur={(event) => {
        const next = event.relatedTarget;
        if (next instanceof Node && !event.currentTarget.contains(next)) setLightPad(false);
      }}
    >
      <button
        type="button"
        onClick={() => setLightPad(!open)}
        aria-expanded={open}
        aria-label="Light"
        title={lightOn ? 'THE LIGHT: TURN IT, RAISE IT, SWITCH IT OFF' : 'THE LIGHT IS OFF'}
        className={`h-8 w-8 text-[16px] leading-none max-sm:w-11 ${pressable(open)}`}
      >
        <span aria-hidden>{lightOn ? '☀' : '☼'}</span>
      </button>
      {open ? <LightPad /> : null}
    </div>
  );
}

function LightPad() {
  const elevation = useCharacterStore((state) => state.light.elevation);
  const lightOn = useCharacterStore((state) => state.lightOn);
  const stepLight = useCharacterStore((state) => state.stepLight);
  const resetLight = useCharacterStore((state) => state.resetLight);
  const toggleLightOn = useCharacterStore((state) => state.toggleLightOn);
  const key = `h-9 w-9 text-[13px] leading-none max-sm:h-11 max-sm:w-11 ${pressable(false)}`;

  return (
    <div role="group" aria-label="Light controls" className={`${PANEL} absolute right-0 top-full z-30 mt-1 flex w-max flex-col gap-1 p-1`}>
      <div className="grid grid-cols-3 gap-1">
        <span />
        <button
          type="button"
          onClick={() => stepLight('up')}
          disabled={elevation >= LIGHT_HIGHEST - 1e-6}
          aria-label="Raise the light"
          title="RAISE THE LIGHT 30°"
          className={key}
        >
          ▲
        </button>
        <span />
        <button type="button" onClick={() => stepLight('left')} aria-label="Turn the light left" title="TURN THE LIGHT 45° LEFT" className={key}>
          ◀
        </button>
        <button type="button" onClick={resetLight} aria-label="Reset the light" title="BACK TO THE STARTING LIGHT" className={key}>
          ◎
        </button>
        <button type="button" onClick={() => stepLight('right')} aria-label="Turn the light right" title="TURN THE LIGHT 45° RIGHT" className={key}>
          ▶
        </button>
        <span />
        <button
          type="button"
          onClick={() => stepLight('down')}
          disabled={elevation <= -LIGHT_HIGHEST + 1e-6}
          aria-label="Lower the light"
          title="LOWER THE LIGHT 30°"
          className={key}
        >
          ▼
        </button>
        <span />
      </div>
      <button
        type="button"
        onClick={toggleLightOn}
        aria-pressed={lightOn}
        title={lightOn ? 'SWITCH THE LIGHT OFF: THE FIGURE IS EVENLY LIT' : 'SWITCH THE LIGHT BACK ON'}
        className={`px-2 py-1 text-[13px] ${pressable(lightOn)}`}
      >
        {lightOn ? 'LIGHT ON' : 'LIGHT OFF'}
      </button>
    </div>
  );
}

function View({ kind, label, hint }: { kind: ViewportKind; label: string; hint: string }) {
  return (
    <section aria-label={`${label} view`} className="min-w-0 rounded-none border-2 border-ink bg-hardware">
      <p className="flex items-center justify-between bg-ena-deep px-2 py-[2px] text-[13px] font-bold text-ink-bar">
        <span>{label}</span>
        <span className="text-sun">{hint}</span>
      </p>
      <div className="h-[20rem] touch-none relative sm:h-[28rem]">
        <CharacterScene view={kind} />
        <SunMarker view={kind} />
        <PlacingButtons view={kind} />
      </div>
    </section>
  );
}

/**
 * The ✓ and ✗ of a placement, beside the new shape (at its top-right corner) or the new node, in each view - so they
 * are in reach whichever view the drag happens in. Absolutely positioned over the view and kept inside it, so they
 * move nothing and never fall off its edge. ✓ rests, with the reason in its tooltip, while the new shape touches
 * nothing valid. Thumb-sized on a phone.
 */
function PlacingButtons({ view }: { view: ViewportKind }) {
  const placing = useCharacterStore((state) => state.placing);
  const figure = useCharacterStore((state) => state.figure);
  const confirmPlacing = useCharacterStore((state) => state.confirmPlacing);
  const cancelPlacing = useCharacterStore((state) => state.cancelPlacing);
  const layer = useRef<HTMLDivElement>(null);
  const [pane, setPane] = useState<{ width: number; height: number } | null>(null);

  useEffect(() => {
    const element = layer.current;
    if (element === null) return;
    const measure = () => setPane({ width: element.clientWidth, height: element.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  let anchor: Vec3 | null = null;
  if (placing !== null && placing.stage === 'place') {
    if (placing.what === 'shape') {
      const box = screenBox(figure, placing.id, view, sagOf(figure).placements[placing.id]);
      if (box !== null) {
        const { right, up } = VIEW_BASIS[view];
        anchor = {
          x: box.centre.x + right.x * box.halfRight + up.x * box.halfUp,
          y: box.centre.y + right.y * box.halfRight + up.y * box.halfUp,
          z: box.centre.z + right.z * box.halfRight + up.z * box.halfUp,
        };
      }
    } else {
      anchor = jointFrames(figure.skeleton)[placing.id]?.position ?? null;
    }
  }

  const block = placingBlock(figure, placing);
  const at = anchor === null || pane === null ? null : toPane(view, pane.width, pane.height, anchor);
  const thing = placing?.what === 'node' ? 'node' : 'shape';
  const key = 'flex h-8 w-8 items-center justify-center rounded-none border-2 border-ink text-[16px] font-bold leading-none max-sm:h-11 max-sm:w-11';

  return (
    <div ref={layer} className="pointer-events-none absolute inset-0 overflow-hidden">
      {at === null ? null : (
        <div
          className="pointer-events-auto absolute flex gap-1 [--ph:2rem] [--pw:4.25rem] max-sm:[--ph:2.75rem] max-sm:[--pw:5.75rem]"
          style={{
            left: `clamp(4px, ${Math.round(at.x + 8)}px, calc(100% - var(--pw) - 4px))`,
            top: `clamp(4px, ${Math.round(at.y - 8)}px - var(--ph), calc(100% - var(--ph) - 4px))`,
          }}
        >
          <button
            type="button"
            onClick={() => {
              if (block === null) confirmPlacing();
            }}
            aria-label={`Keep the new ${thing}`}
            aria-disabled={block !== null}
            title={block === null ? 'KEEP IT. ONE PRESS OF UNDO TAKES IT AWAY AGAIN.' : `NOT YET: ${block}`}
            className={`${key} cursor-pointer bg-acid text-ink-plate aria-disabled:cursor-not-allowed aria-disabled:opacity-40`}
          >
            ✓
          </button>
          <button
            type="button"
            onClick={cancelPlacing}
            aria-label={`Cancel the new ${thing}`}
            title="CANCEL: THE FIGURE GOES BACK EXACTLY AS IT WAS (ESC)"
            className={`${key} cursor-pointer bg-bubble-pale text-ink-bar`}
          >
            ✗
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * A small sun at the view's edge, on the side the light comes from: ☀ when it is on this side of the figure, ☼ when
 * it is behind. Nothing when the light shines straight along the view (there is no edge to point from) or is off.
 */
function SunMarker({ view }: { view: ViewportKind }) {
  const azimuth = useCharacterStore((state) => state.light.azimuth);
  const elevation = useCharacterStore((state) => state.light.elevation);
  const lightOn = useCharacterStore((state) => state.lightOn);
  if (!lightOn) return null;

  const from = lightDirection({ azimuth, elevation });
  const { right, up, toward } = VIEW_BASIS[view];
  const along = (axis: Vec3) => from.x * axis.x + from.y * axis.y + from.z * axis.z;
  const across = along(right);
  const upward = along(up);
  const reach = Math.max(Math.abs(across), Math.abs(upward));
  if (reach < 0.2) return null;

  return (
    <span
      aria-hidden
      className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 text-[14px] leading-none text-sun"
      style={{ left: `${50 + (across / reach) * 45}%`, top: `${50 - (upward / reach) * 45}%` }}
    >
      {along(toward) >= 0 ? '☀' : '☼'}
    </span>
  );
}

/**
 * Under the views, live: how many blocks the FRONT view's pixel render fills (counted from the render itself), and
 * how far the most-tipped shape has sagged towards hanging straight down.
 */
function Stats() {
  const pixels = useCharacterStore((state) => state.pixels);
  const share = useCharacterStore((state) => sagOf(state.figure).share);

  return (
    <p className={`${PANEL} flex items-center gap-2 px-2 py-1 text-[14px] font-bold text-ink`}>
      <span title="FILLED BLOCKS IN THE FRONT VIEW'S PIXEL RENDER. HIDDEN SHAPES DON'T COUNT.">
        PIXELS <span data-stat="pixels">{pixels ?? '-'}</span>
      </span>
      <span aria-hidden>·</span>
      <span title="HOW FAR THE MOST-TIPPED SHAPE HAS SAGGED. 100%: A SHAPE THAT STUCK STRAIGHT OUT NOW HANGS STRAIGHT DOWN.">
        SAG <span data-stat="sag">{Math.round(share * 100)}</span>%
      </span>
    </p>
  );
}

function PanelTitle({ children }: { children: ReactNode }) {
  return <div className={`${TITLE_BAR_INACTIVE} w-full`}>{children}</div>;
}

/**
 * Every shape, top of the list first, folded to its header (`SHAPES 5/7`) until opened. The header stays where it is
 * and the rows open below it, so opening never moves what the pointer is on. A row picks its shape - the same as
 * clicking it in a view; the eye hides it; the arrows reorder. A broken shape's row is marked, with what is wrong in
 * its tooltip.
 */
function ShapesList() {
  const figure = useCharacterStore((state) => state.figure);
  const selectedShapeId = useCharacterStore((state) => state.selectedShapeId);
  const listOpen = useCharacterStore((state) => state.listOpen);
  const toggleList = useCharacterStore((state) => state.toggleList);
  const selectShape = useCharacterStore((state) => state.selectShape);
  const setHidden = useCharacterStore((state) => state.setHidden);
  const reorder = useCharacterStore((state) => state.reorder);
  const shapes = figure.shapes;
  const broken = useMemo(() => brokenShapes(figure), [figure]);
  const brokenCount = Object.keys(broken).length;

  const small = 'h-7 w-7 shrink-0 text-[14px] leading-none max-sm:h-11 max-sm:w-11';

  return (
    <section aria-label="Shapes" className={PANEL}>
      <button
        type="button"
        onClick={toggleList}
        aria-expanded={listOpen}
        title={brokenCount > 0 ? `${brokenCount} MARKED: NOT CONNECTED TO A NODE. THE FIGURE CAN'T BE SAVED UNTIL THEY ARE.` : undefined}
        className={`${TITLE_BAR_INACTIVE} w-full cursor-pointer hover:bg-ice max-sm:min-h-11`}
      >
        <span>
          SHAPES {shapes.length}/{MAX_SHAPES}
          {brokenCount > 0 ? <span className="ml-2 bg-bubble-pale px-1 text-ink-bar">{brokenCount} !</span> : null}
        </span>
        <span aria-hidden>{listOpen ? '▾' : '▸'}</span>
      </button>

      {!listOpen ? null : shapes.length === 0 ? (
        <p className="p-2 text-[13px] text-ink">NO SHAPES. USE ADD.</p>
      ) : (
        <ul className="max-h-64 overflow-y-auto p-1 lg:max-h-56">
          {shapes.map((shape, index) => {
            const picked = shape.id === selectedShapeId;
            const problem = broken[shape.id];
            return (
              <li key={shape.id} className="flex items-center gap-[2px] pb-[2px]">
                <button
                  type="button"
                  onClick={() => setHidden(shape.id, !shape.hidden)}
                  aria-pressed={!shape.hidden}
                  aria-label={`${shape.hidden ? 'Show' : 'Hide'} ${shape.name}`}
                  title={shape.hidden ? 'HIDDEN - CLICK TO SHOW' : 'SHOWN - CLICK TO HIDE'}
                  className={`${small} ${pressable(false)}`}
                >
                  {shape.hidden ? '◌' : '◉'}
                </button>
                <button
                  type="button"
                  onClick={() => selectShape(shape.id)}
                  aria-pressed={picked}
                  title={
                    shape.hidden
                      ? "HIDDEN: IT DOESN'T COUNT FOR TOUCHING, PIXELS OR SAG."
                      : problem !== undefined
                        ? `${problem}. THE FIGURE CAN'T BE SAVED LIKE THIS.`
                        : undefined
                  }
                  className={`flex h-7 min-w-0 flex-1 items-center gap-1 px-1 text-left text-[13px] ${pressable(picked)} ${shape.hidden ? 'line-through' : ''}`}
                >
                  <span aria-hidden className="w-4 shrink-0 text-center text-[14px] leading-none">
                    {MASS_SHAPE_GLYPHS[shape.kind]}
                  </span>
                  <span className="truncate">{shape.name}</span>
                  {problem !== undefined ? (
                    <span aria-hidden className="ml-auto shrink-0 bg-bubble-pale px-1 text-ink-bar">
                      !
                    </span>
                  ) : null}
                </button>
                <button
                  type="button"
                  onClick={() => reorder(shape.id, -1)}
                  disabled={index === 0}
                  aria-label={`Move ${shape.name} up the list`}
                  className={`${small} ${pressable(false)}`}
                >
                  ▲
                </button>
                <button
                  type="button"
                  onClick={() => reorder(shape.id, 1)}
                  disabled={index === shapes.length - 1}
                  aria-label={`Move ${shape.name} down the list`}
                  className={`${small} ${pressable(false)}`}
                >
                  ▼
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}


function Properties() {
  const shape = useCharacterStore((state) => findShape(state.figure, state.selectedShapeId));
  return shape === undefined ? <FigureSettings /> : <ShapeProperties shape={shape} />;
}

/**
 * A picked shape: its name, then SHAPE, COLOUR and PIN, then DUPLICATE and DELETE, then NUMBERS - folded until asked
 * for, and last, so unfolding it only lengthens the panel and never pushes a control out from under the pointer.
 */
function ShapeProperties({ shape }: { shape: Shape }) {
  const joints = useCharacterStore((state) => state.figure.skeleton.joints);
  const full = useCharacterStore((state) => state.figure.shapes.length >= MAX_SHAPES);
  const rename = useCharacterStore((state) => state.rename);
  const setKind = useCharacterStore((state) => state.setKind);
  const setColour = useCharacterStore((state) => state.setColour);
  const setPin = useCharacterStore((state) => state.setPin);
  const setNumbers = useCharacterStore((state) => state.setNumbers);
  const duplicate = useCharacterStore((state) => state.duplicate);
  const deleteShape = useCharacterStore((state) => state.deleteShape);
  const selectShape = useCharacterStore((state) => state.selectShape);

  const degrees = { x: (shape.rotation.x * 180) / Math.PI, y: (shape.rotation.y * 180) / Math.PI, z: (shape.rotation.z * 180) / Math.PI };

  return (
    <section aria-label="Shape properties" className={PANEL}>
      <PanelTitle>
        <span>PROPERTIES</span>
        <button type="button" onClick={() => selectShape(null)} className="px-1 text-[13px] font-bold underline max-sm:min-h-11">
          [ DONE ]
        </button>
      </PanelTitle>

      <div className="p-2">
        <TextField label="NAME" value={shape.name} onCommit={(name) => rename(shape.id, name)} />
      </div>

      <Section id="shape" label="SHAPE">
        <div className="flex flex-wrap gap-[2px]">
          {MASS_SHAPE_IDS.map((kind: MassShapeId) => (
            <button
              key={kind}
              type="button"
              onClick={() => setKind(shape.id, kind)}
              aria-pressed={shape.kind === kind}
              aria-label={MASS_SHAPES[kind].label}
              title={`${MASS_SHAPES[kind].label} - ${MASS_SHAPES[kind].note}`}
              className={`h-8 w-8 text-[14px] leading-none max-sm:h-11 max-sm:w-11 ${pressable(shape.kind === kind)}`}
            >
              {MASS_SHAPE_GLYPHS[kind]}
            </button>
          ))}
        </div>
      </Section>

      <Section id="colour" label="COLOUR">
        <div className="flex flex-wrap gap-[2px]">
          {MASS_DYES.map((dye) => {
            const on = shape.colour === dye.value;
            return (
              <button
                key={dye.id}
                type="button"
                onClick={() => setColour(shape.id, dye.value)}
                aria-pressed={on}
                aria-label={dye.label}
                title={dye.label}
                className={`h-7 w-7 cursor-pointer rounded-none border-2 max-sm:h-11 max-sm:w-11 ${on ? 'border-ink outline outline-2 outline-bubble' : 'border-ink'}`}
                style={{ background: dye.value ?? MODEL_INK }}
              />
            );
          })}
        </div>
      </Section>

      <Section id="pin" label="PIN">
        <select
          id="shape-pin"
          aria-label="Pinned to"
          value={shape.pin ?? ''}
          onChange={(event) => setPin(shape.id, event.target.value === '' ? null : event.target.value)}
          title={shape.pin === null ? "PINNED TO NOTHING: THE FIGURE CAN'T BE SAVED UNTIL IT IS PINNED TO A NODE." : 'FOLLOWS AND TURNS WITH THIS NODE WHEN YOU POSE.'}
          className="w-full rounded-none border-2 border-ink bg-paper px-1 py-1 text-[14px] text-ink max-sm:min-h-11"
        >
          <option value="">NOTHING - CAN&apos;T SAVE</option>
          {Object.keys(joints).map((id) => (
            <option key={id} value={id}>
              {jointLabel(id)}
            </option>
          ))}
        </select>
      </Section>

      <div className="flex gap-1 border-t-2 border-ink p-2">
        <button
          type="button"
          onClick={() => {
            if (!full) duplicate(shape.id);
          }}
          aria-disabled={full}
          title={full ? FULL_SHAPES : 'A COPY, BESIDE IT, PINNED TO THE SAME NODE.'}
          className={`flex-1 px-2 py-1 text-[13px] ${pressable(false)}`}
        >
          [ DUPLICATE ]
        </button>
        <button type="button" onClick={() => deleteShape(shape.id)} className={`flex-1 px-2 py-1 text-[13px] ${pressable(false)} hover:bg-bubble-pale`}>
          [ DELETE ]
        </button>
      </div>

      <Section id="numbers" label="NUMBERS">
        <TripleField
          label={shape.pin === null ? 'POSITION' : 'POSITION FROM NODE'}
          names={['ACROSS', 'UP', 'FORWARD']}
          value={shape.position}
          step={0.01}
          onCommit={(position) => setNumbers(shape.id, { position })}
        />
        <TripleField
          label="TURN (DEGREES)"
          names={['TILT', 'SPIN', 'ROLL']}
          value={degrees}
          step={1}
          onCommit={(turn) =>
            setNumbers(shape.id, {
              rotation: { x: (turn.x * Math.PI) / 180, y: (turn.y * Math.PI) / 180, z: (turn.z * Math.PI) / 180 },
            })
          }
        />
        <TripleField
          label="SIZE"
          names={['WIDE', 'TALL', 'DEEP']}
          value={shape.size}
          step={0.01}
          onCommit={(size) => setNumbers(shape.id, { size })}
        />
      </Section>
    </section>
  );
}

/**
 * A folding section of the properties: its heading is the switch. Which sections are open is kept in the store, so
 * picking another shape leaves them as the reader set them.
 */
function Section({ id, label, children }: { id: SectionId; label: string; children: ReactNode }) {
  const open = useCharacterStore((state) => state.sections[id]);
  const toggleSection = useCharacterStore((state) => state.toggleSection);

  return (
    <div className="border-t-2 border-ink">
      <button
        type="button"
        onClick={() => toggleSection(id)}
        aria-expanded={open}
        className="flex w-full cursor-pointer items-center justify-between px-2 py-1 text-[13px] font-bold text-ink hover:bg-ice max-sm:min-h-11"
      >
        <span>{label}</span>
        <span aria-hidden>{open ? '▾' : '▸'}</span>
      </button>
      {open ? <div className="flex flex-col gap-2 px-2 pb-2">{children}</div> : null}
    </div>
  );
}

/**
 * With nothing picked: the whole figure. NEW FIGURE, and - while posing, with a node picked - that node, with DELETE
 * NODE. The title says which preset the bench started from, or which node is picked, in the same place so nothing
 * below it moves.
 */
function FigureSettings() {
  const presetId = useCharacterStore((state) => state.presetId);
  const setPresetPicker = useCharacterStore((state) => state.setPresetPicker);
  const selectedJointId = useCharacterStore((state) => state.selectedJointId);
  const tool = useCharacterStore((state) => state.tool);
  const nodeId = tool === 'pose' ? selectedJointId : null;

  return (
    <section aria-label="Figure settings" className={PANEL}>
      <PanelTitle>
        <span>FIGURE</span>
        <span>{nodeId !== null ? nodeName(nodeId) : `FROM ${RIG_PRESETS[presetId].label}`}</span>
      </PanelTitle>

      <div className="flex flex-col gap-2 p-2">
        <button
          type="button"
          onClick={() => setPresetPicker(true)}
          title="START AGAIN FROM ONE OF THE PRESETS. UNDO BRINGS THIS ONE BACK."
          className={`px-2 py-2 text-[14px] ${pressable(false)}`}
        >
          [ NEW FIGURE... ]
        </button>
        {nodeId !== null ? <NodeDelete key={nodeId} nodeId={nodeId} /> : null}
      </div>
    </section>
  );
}

/**
 * DELETE NODE: the node and every node below it. One press when no shape is pinned to any of them; when some are, it
 * asks first, naming them - they stay where they are, unpinned, and marked until they are re-pinned. The root holds
 * the figure up and cannot go. Keyed by the node, so picking another node drops a half-asked question.
 */
function NodeDelete({ nodeId }: { nodeId: string }) {
  const figure = useCharacterStore((state) => state.figure);
  const deleteNode = useCharacterStore((state) => state.deleteNode);
  const [asking, setAsking] = useState(false);
  const removed = nodesRemovedWith(figure, nodeId);
  const losing = shapesLosingNode(figure, nodeId);
  const root = removed.length === 0;

  if (asking && losing.length > 0) {
    return (
      <div role="group" aria-label="Confirm deleting the node" className="flex flex-col gap-1 border-2 border-ink p-1 text-[13px] text-ink">
        <p className="font-bold">
          DELETES {removed.length === 1 ? 'THIS NODE' : `${removed.length} NODES`}. UNPINS {losing.map((shape) => shape.name).join(', ')}
          {' '}- MARKED UNTIL RE-PINNED.
        </p>
        <div className="flex gap-1">
          <button type="button" onClick={() => deleteNode(nodeId)} className={`flex-1 px-2 py-1 text-[13px] ${pressable(false)} hover:bg-bubble-pale`}>
            [ YES, DELETE ]
          </button>
          <button type="button" onClick={() => setAsking(false)} className={`flex-1 px-2 py-1 text-[13px] ${pressable(false)}`}>
            [ NO ]
          </button>
        </div>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => {
        if (root) return;
        if (losing.length > 0) setAsking(true);
        else deleteNode(nodeId);
      }}
      aria-disabled={root}
      title={
        root
          ? "THE ROOT NODE HOLDS THE FIGURE UP: IT CAN'T GO."
          : `DELETES ${jointLabel(nodeId)}${removed.length > 1 ? ' AND THE NODES BELOW IT' : ''}. UNDO BRINGS IT BACK.`
      }
      className={`px-2 py-1 text-[13px] ${pressable(false)} hover:bg-bubble-pale`}
    >
      [ DELETE NODE ]
    </button>
  );
}

function Field({ label, htmlFor, children }: { label: string; htmlFor?: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      {htmlFor === undefined ? (
        <span className="text-[13px] font-bold text-ink">{label}</span>
      ) : (
        <label htmlFor={htmlFor} className="text-[13px] font-bold text-ink">
          {label}
        </label>
      )}
      {children}
    </div>
  );
}

/**
 * A name box: edits are kept locally and committed on Enter or on leaving the box - one undo step, not one a key.
 * Keyed by its value, so when the name changes from outside (undo, another shape picked) the box starts afresh.
 */
function TextField(props: { label: string; value: string; onCommit: (value: string) => void }) {
  return <TextFieldBox key={props.value} {...props} />;
}

function TextFieldBox({ label, value, onCommit }: { label: string; value: string; onCommit: (value: string) => void }) {
  const [draft, setDraft] = useState(value);

  const commit = () => {
    if (draft.trim().toUpperCase() !== value) onCommit(draft);
    else setDraft(value);
  };

  return (
    <Field label={label} htmlFor="shape-name">
      <input
        id="shape-name"
        value={draft}
        maxLength={MAX_NAME_LENGTH}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') commit();
          if (event.key === 'Escape') setDraft(value);
        }}
        className="w-full rounded-none border-2 border-ink bg-paper px-1 py-1 text-[14px] uppercase text-ink max-sm:min-h-11"
      />
    </Field>
  );
}

type TripleProps = {
  label: string;
  names: [string, string, string];
  value: Vec3;
  step: number;
  onCommit: (value: Vec3) => void;
};

const shownAs = (step: number) => (n: number) => (step >= 1 ? String(Math.round(n)) : n.toFixed(2));

/**
 * Three number boxes. Like the name box, a change is committed on Enter or on leaving a box, and the boxes start
 * afresh whenever the numbers change from outside - a drag, an undo.
 */
function TripleField(props: TripleProps) {
  const shown = shownAs(props.step);
  return <TripleFieldBoxes key={`${shown(props.value.x)}|${shown(props.value.y)}|${shown(props.value.z)}`} {...props} />;
}

function TripleFieldBoxes({
  label,
  names,
  value,
  step,
  onCommit,
}: TripleProps) {
  const axes = ['x', 'y', 'z'] as const;
  const shown = shownAs(step);
  const [drafts, setDrafts] = useState(() => axes.map((axis) => shown(value[axis])));
  const key = axes.map((axis) => shown(value[axis])).join('|');

  const commit = () => {
    const numbers = drafts.map(Number);
    if (numbers.some((n) => !Number.isFinite(n))) {
      setDrafts(key.split('|'));
      return;
    }
    if (numbers.map(shown).join('|') === key) return;
    onCommit({ x: numbers[0], y: numbers[1], z: numbers[2] });
  };

  return (
    <fieldset
      className="flex flex-col gap-1"
      // Committed when focus leaves the three boxes, not each box: committing re-keys the boxes, so committing on a
      // Tab from ACROSS to UP would rebuild UP under the cursor and drop the reader's place.
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) commit();
      }}
    >
      <legend className="pb-1 text-[13px] font-bold text-ink">{label}</legend>
      <div className="grid grid-cols-3 gap-1">
        {axes.map((axis, index) => (
          <label key={axis} className="flex flex-col text-[13px] text-ink">
            {names[index]}
            <input
              type="number"
              inputMode="decimal"
              step={step}
              value={drafts[index]}
              onChange={(event) => setDrafts(drafts.map((d, i) => (i === index ? event.target.value : d)))}
              onKeyDown={(event) => {
                if (event.key === 'Enter') commit();
              }}
              className="w-full min-w-0 rounded-none border-2 border-ink bg-paper px-1 py-[2px] text-[14px] text-ink max-sm:min-h-11"
            />
          </label>
        ))}
      </div>
    </fieldset>
  );
}
