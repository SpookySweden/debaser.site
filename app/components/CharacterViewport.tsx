'use client';

/**
 * The character workbench, laid out like a paint program's canvas window.
 *
 *   left    the tool strip - one tool in hand at a time, UNDO and REDO at the foot
 *   middle  the tool's options in a bar, then the FRONT and SIDE views of the same figure
 *   right   the shapes list (like a layers panel) and the properties of whatever is picked
 *
 * On a phone the strip becomes rows across the top (wrapped, so no tool hides off the edge), the views stack, and
 * the two panels fold under them.
 *
 * **The options bar is always there, the same height, whatever the tool.** Its contents change when the tool does,
 * but the views below it never jump - the same rule every reveal on this site follows.
 *
 * Loaded with `ssr: false` (see `CharacterEditorPanel`): Three.js needs a browser.
 */
import { useEffect, useState, type ReactNode } from 'react';
import { findShape, MAX_NAME_LENGTH, type Shape } from '../lib/character/figure';
import { MASS_DYES, MODEL_INK } from '../lib/character/palette';
import { jointLabel, RIG_PRESETS } from '../lib/character/rig';
import { MASS_SHAPE_IDS, MASS_SHAPES, type MassShapeId } from '../lib/character/shapes';
import type { Vec3 } from '../lib/character/skeleton';
import { TOOL_IDS, useCharacterStore, type ToolId } from '../lib/character/store';
import { TITLE_BAR_INACTIVE } from '../lib/ui/controls';
import { MASS_SHAPE_GLYPHS, TOOL_GLYPHS } from '../lib/ui/icons';
import CharacterPresetPicker from './CharacterPresetPicker';
import CharacterScene from './CharacterScene';

const TOOLS: Record<ToolId, { label: string; hint: string }> = {
  select: {
    label: 'SELECT',
    hint: 'CLICK A SHAPE TO PICK IT. DRAG IT TO MOVE, DRAG A YELLOW SQUARE TO SIZE IT, DRAG THE GREEN KNOB TO TURN IT.',
  },
  add: { label: 'ADD', hint: 'PICK A SHAPE, THEN CLICK IN EITHER VIEW TO PUT IT THERE.' },
  move: { label: 'MOVE', hint: 'DRAG ANY SHAPE TO SLIDE IT. FRONT MOVES ACROSS AND UP; SIDE MOVES FORWARD AND UP.' },
  turn: { label: 'TURN', hint: 'DRAG ANY SHAPE ROUND ITS MIDDLE TO SPIN IT, LIKE A DIAL.' },
  size: { label: 'SIZE', hint: 'DRAG ANY SHAPE: RIGHT TO WIDEN, UP TO MAKE IT TALLER. IT GROWS FROM ITS MIDDLE.' },
  pose: { label: 'POSE', hint: 'DRAG A GREEN JOINT. PINNED SHAPES FOLLOW AND TURN WITH THEIR BONE.' },
  delete: { label: 'DELETE', hint: 'CLICK A SHAPE TO REMOVE IT. UNDO BRINGS IT BACK.' },
};

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

function ToolStrip() {
  const tool = useCharacterStore((state) => state.tool);
  const setTool = useCharacterStore((state) => state.setTool);
  const canUndo = useCharacterStore((state) => state.past.length > 0);
  const canRedo = useCharacterStore((state) => state.future.length > 0);
  const undo = useCharacterStore((state) => state.undo);
  const redo = useCharacterStore((state) => state.redo);
  const setPresetPicker = useCharacterStore((state) => state.setPresetPicker);

  const button = 'flex h-12 w-14 shrink-0 flex-col items-center justify-center gap-[2px] text-[10px]';

  return (
    <nav
      aria-label="Workbench tools"
      className={`${PANEL} flex shrink-0 flex-wrap gap-1 p-1 lg:flex-col lg:flex-nowrap`}
    >
      {TOOL_IDS.map((id) => (
        <button
          key={id}
          type="button"
          onClick={() => setTool(id)}
          aria-pressed={tool === id}
          title={TOOLS[id].hint}
          className={`${button} ${pressable(tool === id)}`}
        >
          <span aria-hidden className="text-[16px] leading-none">
            {TOOL_GLYPHS[id]}
          </span>
          {TOOLS[id].label}
        </button>
      ))}

      <span aria-hidden className="hidden shrink-0 bg-ink lg:my-1 lg:block lg:h-[2px]" />

      <button type="button" onClick={undo} disabled={!canUndo} title="UNDO (CTRL+Z)" className={`${button} ${pressable(false)}`}>
        <span aria-hidden className="text-[16px] leading-none">
          {TOOL_GLYPHS.undo}
        </span>
        UNDO
      </button>
      <button type="button" onClick={redo} disabled={!canRedo} title="REDO (CTRL+Y)" className={`${button} ${pressable(false)}`}>
        <span aria-hidden className="text-[16px] leading-none">
          {TOOL_GLYPHS.redo}
        </span>
        REDO
      </button>
      <button
        type="button"
        onClick={() => setPresetPicker(true)}
        title="START A NEW FIGURE FROM ONE OF THE PRESETS"
        className={`${button} ${pressable(false)}`}
      >
        <span aria-hidden className="text-[16px] leading-none">
          {TOOL_GLYPHS.new}
        </span>
        NEW
      </button>
    </nav>
  );
}

/** The bar above the views: the tool's own choices, or one line saying how to use it. Always the same height. */
function OptionsBar() {
  const tool = useCharacterStore((state) => state.tool);
  const look = useCharacterStore((state) => state.look);
  const setLook = useCharacterStore((state) => state.setLook);

  return (
    <div className={`${PANEL} flex min-h-[3.25rem] min-w-0 items-center gap-2 p-1`}>
      <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
        {tool === 'add' ? <AddOptions /> : tool === 'pose' ? <PoseOptions /> : (
          <p className="px-1 text-[10px] leading-snug text-ink">
            <span className="font-bold">{TOOLS[tool].label}:</span> {TOOLS[tool].hint}
          </p>
        )}
      </div>

      <div role="group" aria-label="Look" className="flex shrink-0 items-center gap-1">
        <span className="text-[10px] font-bold text-ink max-sm:hidden">LOOK</span>
        {(['shapes', 'final'] as const).map((id) => (
          <button
            key={id}
            type="button"
            onClick={() => setLook(id)}
            aria-pressed={look === id}
            title={id === 'shapes' ? 'THE PLAIN SHAPES, TO BUILD AGAINST' : 'THE PIXELATED, OUTLINED FIGURE AS IT WILL LOOK'}
            className={`px-2 py-1 text-[10px] ${pressable(look === id)}`}
          >
            {id === 'shapes' ? 'SHAPES' : 'FINAL'}
          </button>
        ))}
      </div>
    </div>
  );
}

function AddOptions() {
  const addKind = useCharacterStore((state) => state.addKind);
  const setAddKind = useCharacterStore((state) => state.setAddKind);

  return (
    <>
      <span className="shrink-0 px-1 text-[10px] font-bold text-ink">ADD A</span>
      {MASS_SHAPE_IDS.map((kind) => (
        <button
          key={kind}
          type="button"
          onClick={() => setAddKind(kind)}
          aria-pressed={addKind === kind}
          title={MASS_SHAPES[kind].note}
          className={`flex shrink-0 items-center gap-1 px-2 py-1 text-[10px] ${pressable(addKind === kind)}`}
        >
          <span aria-hidden className="text-[13px] leading-none">
            {MASS_SHAPE_GLYPHS[kind]}
          </span>
          {MASS_SHAPES[kind].label}
        </button>
      ))}
      <span className="shrink-0 px-1 text-[10px] text-ink">THEN CLICK A VIEW</span>
    </>
  );
}

function PoseOptions() {
  const stretch = useCharacterStore((state) => state.stretch);
  const toggleStretch = useCharacterStore((state) => state.toggleStretch);

  return (
    <>
      <span className="shrink-0 px-1 text-[10px] font-bold text-ink">A DRAG</span>
      {[false, true].map((on) => (
        <button
          key={String(on)}
          type="button"
          onClick={() => {
            if (stretch !== on) toggleStretch();
          }}
          aria-pressed={stretch === on}
          className={`shrink-0 px-2 py-1 text-[10px] ${pressable(stretch === on)}`}
        >
          {on ? 'STRETCHES' : 'BENDS'}
        </button>
      ))}
      <span className="shrink-0 px-1 text-[10px] text-ink">
        {stretch ? 'BONES GET LONGER OR SHORTER.' : 'LIMBS SWING; BONES KEEP LENGTH.'}
      </span>
    </>
  );
}

function View({ kind, label, hint }: { kind: 'front' | 'side'; label: string; hint: string }) {
  return (
    <section aria-label={`${label} view`} className="min-w-0 rounded-none border-2 border-ink bg-hardware">
      <p className="flex items-center justify-between bg-ena-deep px-2 py-[2px] text-[10px] font-bold text-ink-bar">
        <span>{label}</span>
        <span className="text-sun">{hint}</span>
      </p>
      <div className="h-[20rem] touch-none sm:h-[28rem]">
        <CharacterScene view={kind} />
      </div>
    </section>
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
        <p className="p-2 text-[10px] text-ink">NO SHAPES YET. PICK ADD IN THE TOOL STRIP.</p>
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

      <div className="flex flex-col gap-2 p-2">
        <TextField label="NAME" value={shape.name} onCommit={(name) => rename(shape.id, name)} />

        <Field label="SHAPE">
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
        </Field>

        <Field label="COLOUR">
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
        </Field>

        <Field label="PINNED TO" htmlFor="shape-pin">
          <select
            id="shape-pin"
            value={shape.pin ?? ''}
            onChange={(event) => setPin(shape.id, event.target.value === '' ? null : event.target.value)}
            className="w-full rounded-none border-2 border-ink bg-paper px-1 py-1 text-[11px] text-ink max-sm:min-h-11"
          >
            <option value="">NOTHING - STAYS PUT</option>
            {Object.keys(joints).map((id) => (
              <option key={id} value={id}>
                {jointLabel(id)}
              </option>
            ))}
          </select>
          <span className="text-[10px] text-ink">
            {shape.pin === null ? 'POSING THE SKELETON LEAVES THIS SHAPE WHERE IT IS.' : 'FOLLOWS AND TURNS WITH THIS JOINT WHEN YOU POSE.'}
          </span>
        </Field>

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

        <div className="flex gap-1">
          <button type="button" onClick={() => duplicate(shape.id)} className={`flex-1 px-2 py-1 text-[10px] ${pressable(false)}`}>
            [ DUPLICATE ]
          </button>
          <button type="button" onClick={() => deleteShape(shape.id)} className={`flex-1 px-2 py-1 text-[10px] ${pressable(false)} hover:bg-bubble-pale`}>
            [ DELETE ]
          </button>
        </div>
      </div>
    </section>
  );
}

/** With nothing picked: settings for the whole figure. */
function FigureSettings() {
  const presetId = useCharacterStore((state) => state.presetId);
  const setPresetPicker = useCharacterStore((state) => state.setPresetPicker);
  const light = useCharacterStore((state) => state.light);
  const setLight = useCharacterStore((state) => state.setLight);
  const showSkeleton = useCharacterStore((state) => state.showSkeleton);
  const toggleSkeleton = useCharacterStore((state) => state.toggleSkeleton);
  const selectedJointId = useCharacterStore((state) => state.selectedJointId);
  const tool = useCharacterStore((state) => state.tool);

  return (
    <section aria-label="Figure settings" className={PANEL}>
      <PanelTitle>
        <span>FIGURE</span>
        <span>NOTHING PICKED</span>
      </PanelTitle>

      <div className="flex flex-col gap-2 p-2">
        {tool === 'pose' && selectedJointId !== null ? (
          <p className="text-[10px] font-bold text-ink">JOINT: {jointLabel(selectedJointId)}</p>
        ) : (
          <p className="text-[10px] text-ink">PICK A SHAPE IN A VIEW OR THE LIST TO EDIT IT.</p>
        )}

        <Field label={`STARTED FROM ${RIG_PRESETS[presetId].label}`}>
          <button type="button" onClick={() => setPresetPicker(true)} className={`px-2 py-2 text-[11px] ${pressable(false)}`}>
            [ NEW FIGURE... ]
          </button>
        </Field>

        <Field label={`LIGHT FROM ${Math.round((light.azimuth * 180) / Math.PI)}°`} htmlFor="light-azimuth">
          <input
            id="light-azimuth"
            type="range"
            min={-Math.PI}
            max={Math.PI}
            step={0.05}
            value={light.azimuth}
            onChange={(event) => setLight({ ...light, azimuth: Number(event.target.value) })}
            className="w-full accent-ena"
          />
        </Field>
        <Field label={`LIGHT HEIGHT ${Math.round((light.elevation * 180) / Math.PI)}°`} htmlFor="light-elevation">
          <input
            id="light-elevation"
            type="range"
            min={-1.4}
            max={1.4}
            step={0.05}
            value={light.elevation}
            onChange={(event) => setLight({ ...light, elevation: Number(event.target.value) })}
            className="w-full accent-ena"
          />
        </Field>

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
