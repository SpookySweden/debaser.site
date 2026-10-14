'use client';

/**
 * The character workbench, laid out like a paint program's canvas window.
 *
 *   left    the tool strip in three blocks - EDIT tools, POSE, and HISTORY (undo, redo, new)
 *   middle  the tool's options in a bar with the LAYERS switches and the ☀ light at its right, then the FRONT and
 *           SIDE views of the same figure, both showing the live pixel render
 *   right   the shapes list (like a layers panel) and the properties of whatever is picked, in folding sections
 *
 * On a phone the strip becomes rows across the top (wrapped, so no tool hides off the edge), the views stack, and
 * the two panels fold under them.
 *
 * **Short labels on screen, the explanations in tooltips.** Each tool says what to do in a few words in the bar; the
 * full sentence is its `title`.
 *
 * **The options bar is always there, the same height, whatever the tool.** Its contents change when the tool does,
 * but the views below it never jump - the same rule every reveal on this site follows. The light d-pad pops out
 * over the views (absolutely positioned), so opening it moves nothing either.
 *
 * Loaded with `ssr: false` (see `CharacterEditorPanel`): Three.js needs a browser.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { VIEW_BASIS, type ViewportKind } from '../lib/character/drag';
import { findShape, MAX_NAME_LENGTH, type Shape } from '../lib/character/figure';
import { MASS_DYES, MODEL_INK } from '../lib/character/palette';
import { LAYER_IDS, LIGHT_HIGHEST, lightDirection, type LayerId } from '../lib/character/pixel-render';
import { jointLabel, RIG_PRESETS } from '../lib/character/rig';
import { MASS_SHAPE_IDS, MASS_SHAPES, type MassShapeId } from '../lib/character/shapes';
import type { Vec3 } from '../lib/character/skeleton';
import { TOOL_IDS, useCharacterStore, type SectionId, type ToolId } from '../lib/character/store';
import { TITLE_BAR_INACTIVE } from '../lib/ui/controls';
import { MASS_SHAPE_GLYPHS, TOOL_GLYPHS } from '../lib/ui/icons';
import CharacterPresetPicker from './CharacterPresetPicker';
import CharacterScene from './CharacterScene';

/** Each tool's name, the few words the options bar shows, and the full sentence for its tooltip. */
const TOOLS: Record<ToolId, { label: string; status: string; hint: string }> = {
  select: {
    label: 'SELECT',
    status: 'CLICK A SHAPE',
    hint: 'CLICK A SHAPE TO PICK IT. DRAG IT TO MOVE, DRAG A YELLOW SQUARE TO SIZE IT, DRAG THE GREEN KNOB TO TURN IT.',
  },
  add: { label: 'ADD', status: 'CLICK A VIEW', hint: 'PICK A SHAPE, THEN CLICK IN EITHER VIEW TO PUT IT THERE.' },
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
  pose: { label: 'POSE', status: 'DRAG A JOINT', hint: 'DRAG A GREEN JOINT. PINNED SHAPES FOLLOW AND TURN WITH THEIR BONE.' },
  delete: { label: 'DELETE', status: 'CLICK TO REMOVE', hint: 'CLICK A SHAPE TO REMOVE IT. UNDO BRINGS IT BACK.' },
};

/** The LAYERS switches: what the live pixel render draws. See `pixel-render.ts`. */
const LAYERS: Record<LayerId, { label: string; hint: string }> = {
  pixelate: { label: 'PIXELATE', hint: 'BIG PIXELS, AS THE FIGURE WILL LOOK. OFF: FULL RESOLUTION.' },
  normalLight: { label: 'NORMAL LIGHT', hint: 'SHADE THE FIGURE IN THREE HARD BANDS. OFF: FLAT COLOURS.' },
  normalMap: { label: 'NORMAL MAP', hint: 'SHOW WHAT THE LIGHT READS: EACH PIXEL COLOURED BY THE WAY IT FACES.' },
};

/** POSE works on the skeleton rather than the shapes, so it gets a block of its own; every other tool is EDIT. */
const EDIT_TOOLS = TOOL_IDS.filter((id) => id !== 'pose');

/** A pressable square on this workbench: flat, inked, and inverted when on. No bevels - see `docs/design.md`. */
function pressable(on: boolean): string {
  return `cursor-pointer rounded-none border-2 border-ink font-bold max-sm:min-h-11 disabled:cursor-not-allowed disabled:opacity-40 ${
    on ? 'bg-ena text-ink-bar' : 'bg-sun-pale text-ink hover:bg-ice'
  }`;
}

const PANEL = 'rounded-none border-2 border-ink bg-sun-pale';

export default function CharacterViewport() {
  useUndoKeys();

  return (
    <div className="relative flex min-w-0 flex-col gap-2 lg:flex-row lg:items-start">
      <CharacterPresetPicker />
      <ToolStrip />

      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <OptionsBar />
        <div className="grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-2">
          <View kind="front" label="FRONT" hint="ACROSS / UP" />
          <View kind="side" label="SIDE" hint="FORWARD / UP" />
        </div>
      </div>

      <div className="flex min-w-0 flex-col gap-2 lg:w-64 lg:shrink-0">
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

const STRIP_BUTTON =
  'flex h-12 w-14 shrink-0 flex-col items-center justify-center gap-[2px] text-[10px] max-sm:w-[3.25rem]';

function ToolStrip() {
  const tool = useCharacterStore((state) => state.tool);
  const setTool = useCharacterStore((state) => state.setTool);
  const canUndo = useCharacterStore((state) => state.past.length > 0);
  const canRedo = useCharacterStore((state) => state.future.length > 0);
  const undo = useCharacterStore((state) => state.undo);
  const redo = useCharacterStore((state) => state.redo);
  const setPresetPicker = useCharacterStore((state) => state.setPresetPicker);

  const toolButton = (id: ToolId) => (
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
      <StripBlock label="Pose">{toolButton('pose')}</StripBlock>
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
 * The bar above the views: the tool's own choices or a few words on how to use it, then the LAYERS switches and the
 * light. Always the same height; on a phone it is always two rows (the tool row keeps a finger's height even when it
 * holds only words), so changing tool never moves the views.
 */
function OptionsBar() {
  const tool = useCharacterStore((state) => state.tool);

  return (
    <div className={`${PANEL} flex min-h-[3.25rem] min-w-0 flex-wrap items-center gap-2 p-1 sm:flex-nowrap`}>
      <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto max-sm:min-h-11 max-sm:basis-full">
        {tool === 'add' ? <AddOptions /> : tool === 'pose' ? <PoseOptions /> : (
          <p className="px-1 text-[10px] font-bold leading-snug text-ink" title={TOOLS[tool].hint}>
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

function AddOptions() {
  const addKind = useCharacterStore((state) => state.addKind);
  const setAddKind = useCharacterStore((state) => state.setAddKind);

  return (
    <>
      {MASS_SHAPE_IDS.map((kind) => (
        <button
          key={kind}
          type="button"
          onClick={() => setAddKind(kind)}
          aria-pressed={addKind === kind}
          aria-label={MASS_SHAPES[kind].label}
          title={`${MASS_SHAPES[kind].label} - ${MASS_SHAPES[kind].note}`}
          className={`h-8 w-8 shrink-0 text-[14px] leading-none max-sm:w-11 ${pressable(addKind === kind)}`}
        >
          <span aria-hidden>{MASS_SHAPE_GLYPHS[kind]}</span>
        </button>
      ))}
      <span className="shrink-0 px-1 text-[10px] font-bold text-ink" title={TOOLS.add.hint}>
        {TOOLS.add.status}
      </span>
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
          className={`shrink-0 px-2 py-1 text-[10px] ${pressable(stretch === on)}`}
        >
          {on ? 'STRETCHES' : 'BENDS'}
        </button>
      ))}
      <span className="shrink-0 px-1 text-[10px] font-bold text-ink" title={TOOLS.pose.hint}>
        {TOOLS.pose.status}
      </span>
    </>
  );
}

/** PIXELATE, NORMAL LIGHT, NORMAL MAP. NORMAL LIGHT rests while the normal map is shown: there is nothing to shade. */
function LayerSwitches() {
  const layers = useCharacterStore((state) => state.layers);
  const toggleLayer = useCharacterStore((state) => state.toggleLayer);

  return (
    <div role="group" aria-label="Layers" className="flex items-center gap-1 max-sm:grid max-sm:flex-1 max-sm:grid-cols-3">
      <span className="text-[10px] font-bold text-ink max-sm:hidden">LAYERS</span>
      {LAYER_IDS.map((id) => (
        <button
          key={id}
          type="button"
          onClick={() => toggleLayer(id)}
          aria-pressed={layers[id]}
          disabled={id === 'normalLight' && layers.normalMap}
          title={LAYERS[id].hint}
          className={`shrink-0 px-2 py-1 text-[10px] leading-tight max-sm:px-1 ${pressable(layers[id])}`}
        >
          {LAYERS[id].label}
        </button>
      ))}
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
        className={`px-2 py-1 text-[10px] ${pressable(lightOn)}`}
      >
        {lightOn ? 'LIGHT ON' : 'LIGHT OFF'}
      </button>
    </div>
  );
}

function View({ kind, label, hint }: { kind: ViewportKind; label: string; hint: string }) {
  return (
    <section aria-label={`${label} view`} className="min-w-0 rounded-none border-2 border-ink bg-hardware">
      <p className="flex items-center justify-between bg-ena-deep px-2 py-[2px] text-[10px] font-bold text-ink-bar">
        <span>{label}</span>
        <span className="text-sun">{hint}</span>
      </p>
      <div className="h-[20rem] touch-none relative sm:h-[28rem]">
        <CharacterScene view={kind} />
        <SunMarker view={kind} />
      </div>
    </section>
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

function PanelTitle({ children }: { children: ReactNode }) {
  return <div className={`${TITLE_BAR_INACTIVE} w-full`}>{children}</div>;
}

/** Every shape, top of the list first. A row picks its shape; the eye hides it; the arrows reorder. */
function ShapesList() {
  const shapes = useCharacterStore((state) => state.figure.shapes);
  const selectedShapeId = useCharacterStore((state) => state.selectedShapeId);
  const selectShape = useCharacterStore((state) => state.selectShape);
  const setHidden = useCharacterStore((state) => state.setHidden);
  const reorder = useCharacterStore((state) => state.reorder);

  const small = 'h-7 w-7 shrink-0 text-[11px] leading-none max-sm:h-11 max-sm:w-11';

  return (
    <section aria-label="Shapes" className={PANEL}>
      <PanelTitle>
        <span>SHAPES</span>
        <span>[ {shapes.length} ]</span>
      </PanelTitle>

      {shapes.length === 0 ? (
        <p className="p-2 text-[10px] text-ink">NO SHAPES. USE ADD.</p>
      ) : (
        <ul className="max-h-64 overflow-y-auto p-1 lg:max-h-56">
          {shapes.map((shape, index) => {
            const picked = shape.id === selectedShapeId;
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
                  onClick={() => selectShape(picked ? null : shape.id)}
                  aria-pressed={picked}
                  className={`flex h-7 min-w-0 flex-1 items-center gap-1 px-1 text-left text-[10px] ${pressable(picked)} ${shape.hidden ? 'line-through' : ''}`}
                >
                  <span aria-hidden className="w-4 shrink-0 text-center text-[12px] leading-none">
                    {MASS_SHAPE_GLYPHS[shape.kind]}
                  </span>
                  <span className="truncate">{shape.name}</span>
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
        <button type="button" onClick={() => selectShape(null)} className="px-1 text-[10px] font-bold underline max-sm:min-h-11">
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
          title={shape.pin === null ? 'POSING THE SKELETON LEAVES THIS SHAPE WHERE IT IS.' : 'FOLLOWS AND TURNS WITH THIS JOINT WHEN YOU POSE.'}
          className="w-full rounded-none border-2 border-ink bg-paper px-1 py-1 text-[11px] text-ink max-sm:min-h-11"
        >
          <option value="">NOTHING - STAYS PUT</option>
          {Object.keys(joints).map((id) => (
            <option key={id} value={id}>
              {jointLabel(id)}
            </option>
          ))}
        </select>
      </Section>

      <div className="flex gap-1 border-t-2 border-ink p-2">
        <button type="button" onClick={() => duplicate(shape.id)} className={`flex-1 px-2 py-1 text-[10px] ${pressable(false)}`}>
          [ DUPLICATE ]
        </button>
        <button type="button" onClick={() => deleteShape(shape.id)} className={`flex-1 px-2 py-1 text-[10px] ${pressable(false)} hover:bg-bubble-pale`}>
          [ DELETE ]
        </button>
      </div>

      <Section id="numbers" label="NUMBERS">
        <TripleField
          label={shape.pin === null ? 'POSITION' : 'POSITION FROM JOINT'}
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
        className="flex w-full cursor-pointer items-center justify-between px-2 py-1 text-[10px] font-bold text-ink hover:bg-ice max-sm:min-h-11"
      >
        <span>{label}</span>
        <span aria-hidden>{open ? '▾' : '▸'}</span>
      </button>
      {open ? <div className="flex flex-col gap-2 px-2 pb-2">{children}</div> : null}
    </div>
  );
}

/**
 * With nothing picked: the whole figure. NEW FIGURE and the skeleton switch; the title says which preset the bench
 * started from, or - while posing - which joint is picked, in the same place so nothing below it moves.
 */
function FigureSettings() {
  const presetId = useCharacterStore((state) => state.presetId);
  const setPresetPicker = useCharacterStore((state) => state.setPresetPicker);
  const showSkeleton = useCharacterStore((state) => state.showSkeleton);
  const toggleSkeleton = useCharacterStore((state) => state.toggleSkeleton);
  const selectedJointId = useCharacterStore((state) => state.selectedJointId);
  const tool = useCharacterStore((state) => state.tool);

  return (
    <section aria-label="Figure settings" className={PANEL}>
      <PanelTitle>
        <span>FIGURE</span>
        <span>{tool === 'pose' && selectedJointId !== null ? `JOINT: ${jointLabel(selectedJointId)}` : `FROM ${RIG_PRESETS[presetId].label}`}</span>
      </PanelTitle>

      <div className="flex flex-col gap-2 p-2">
        <button
          type="button"
          onClick={() => setPresetPicker(true)}
          title="START AGAIN FROM ONE OF THE PRESETS. UNDO BRINGS THIS ONE BACK."
          className={`px-2 py-2 text-[11px] ${pressable(false)}`}
        >
          [ NEW FIGURE... ]
        </button>
        <button type="button" onClick={toggleSkeleton} aria-pressed={showSkeleton} className={`px-2 py-1 text-[10px] ${pressable(showSkeleton)}`}>
          {showSkeleton ? '[ SKELETON SHOWN ]' : '[ SKELETON HIDDEN ]'}
        </button>
      </div>
    </section>
  );
}

function Field({ label, htmlFor, children }: { label: string; htmlFor?: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      {htmlFor === undefined ? (
        <span className="text-[10px] font-bold text-ink">{label}</span>
      ) : (
        <label htmlFor={htmlFor} className="text-[10px] font-bold text-ink">
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
        className="w-full rounded-none border-2 border-ink bg-paper px-1 py-1 text-[11px] uppercase text-ink max-sm:min-h-11"
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
      <legend className="pb-1 text-[10px] font-bold text-ink">{label}</legend>
      <div className="grid grid-cols-3 gap-1">
        {axes.map((axis, index) => (
          <label key={axis} className="flex flex-col text-[10px] text-ink">
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
              className="w-full min-w-0 rounded-none border-2 border-ink bg-paper px-1 py-[2px] text-[11px] text-ink max-sm:min-h-11"
            />
          </label>
        ))}
      </div>
    </fieldset>
  );
}
