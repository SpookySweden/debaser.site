/**
 * The character workbench's state: the figure, the tool in hand, what is selected, and the undo history.
 *
 * **The store holds authoring data - never Three.js objects.** A `Vector3` or `Quaternion` in here would be a mutable
 * object held across renders: a drag would mutate a value React has already compared, and the canvas would not
 * redraw. Plain triples go in (`figure.ts`); Three's types are built from them at the edge, once per render.
 *
 * Zustand rather than React context because dragging is *frame-rate* state: a shape being dragged writes on every
 * pointer move, and selectors let the views redraw while the shapes list and the panels do not.
 *
 * **Undo is a list of whole figures.** A figure is a few kilobytes of plain data, so keeping the last hundred is
 * cheap, and "put back exactly what was there" cannot be subtly wrong the way replaying inverse operations can.
 * Every edit goes through `commit`, which files the figure it replaces. A drag is one edit however many frames it
 * lasts: `beginGesture` remembers the starting figure, each frame recomputes from it, and `endGesture` files the
 * start once - and only if something actually changed, so a click is not an undo step.
 */
import { create } from 'zustand';
import {
  addShape,
  duplicateShape,
  fingerprint,
  nearestJoint,
  readFigure,
  pinShape,
  removeShape,
  renameShape,
  reorderShape,
  setShapeColour,
  setShapeHidden,
  setShapeKind,
  setShapeNumbers,
  type Figure,
} from './figure';
import {
  moveGesture,
  poseGesture,
  sizeGesture,
  turnGesture,
  type ViewportKind,
} from './drag';
import {
  DEFAULT_LAYERS,
  DEFAULT_LIGHT,
  stepLight,
  type LayerId,
  type LightAngles,
  type LightStep,
} from './pixel-render';
import { buildDefaultFigure, type RigPresetId } from './rig';
import type { MassShapeId } from './shapes';
import type { Vec3 } from './skeleton';

/**
 * The tool strip, in its on-screen order.
 *
 *   select  click a shape to pick it; the picked one shows a transform box (drag it to move, edge squares to size,
 *           the knob above to turn) - the all-in-one tool most people will stay on
 *   add     click in a view to put a new shape there
 *   move    drag any shape to slide it
 *   turn    drag any shape to spin it round its centre
 *   size    drag any shape: sideways for width, up and down for height
 *   pose    drag a joint to bend the skeleton; pinned shapes follow and turn
 *   delete  click a shape to remove it
 */
export type ToolId = 'select' | 'add' | 'move' | 'turn' | 'size' | 'pose' | 'delete';

export const TOOL_IDS: readonly ToolId[] = ['select', 'add', 'move', 'turn', 'size', 'pose', 'delete'];

export { DEFAULT_LIGHT, type LightAngles } from './pixel-render';

/** The folding sections of a picked shape's properties. NUMBERS starts folded: most edits are made by dragging. */
export type SectionId = 'shape' | 'colour' | 'pin' | 'numbers';

const DEFAULT_SECTIONS: Readonly<Record<SectionId, boolean>> = { shape: true, colour: true, pin: true, numbers: false };

/** How many edits UNDO can walk back. */
export const HISTORY_LIMIT = 100;

/** A drag in progress. `base` is the figure it started from; every frame is computed from it. */
export type Gesture =
  | { kind: 'move'; shapeId: string; view: ViewportKind; upp: number; base: Figure }
  | { kind: 'turn'; shapeId: string; view: ViewportKind; upp: number; base: Figure; grab: { right: number; up: number } }
  | { kind: 'size'; shapeId: string; view: ViewportKind; upp: number; base: Figure; handle: { h: -1 | 0 | 1; v: -1 | 0 | 1 } }
  | { kind: 'pose'; jointId: string; view: ViewportKind; upp: number; base: Figure };

/** What `beginGesture` is handed: a gesture without its `base`, which the store supplies. */
export type GestureStart =
  | { kind: 'move'; shapeId: string; view: ViewportKind; upp: number }
  | { kind: 'turn'; shapeId: string; view: ViewportKind; upp: number; grab: { right: number; up: number } }
  | { kind: 'size'; shapeId: string; view: ViewportKind; upp: number; handle: { h: -1 | 0 | 1; v: -1 | 0 | 1 } }
  | { kind: 'pose'; jointId: string; view: ViewportKind; upp: number };

type CharacterState = {
  figure: Figure;
  presetId: RigPresetId;
  past: Figure[];
  future: Figure[];
  tool: ToolId;
  /** Which primitive ADD puts down. */
  addKind: MassShapeId;
  selectedShapeId: string | null;
  selectedJointId: string | null;
  /** The LAYERS switches: what the live pixel render draws. See `pixel-render.ts`. */
  layers: Record<LayerId, boolean>;
  /** The light source itself. Off, the figure is evenly lit by the ambient level alone. */
  lightOn: boolean;
  /** The light d-pad beside the ☀ button. */
  lightPadOpen: boolean;
  /** Which property sections are unfolded. Kept here so picking another shape does not fold them again. */
  sections: Record<SectionId, boolean>;
  showSkeleton: boolean;
  /** POSE moves joints freely (changing bone length) instead of bending them. */
  stretch: boolean;
  /** The NEW FIGURE picker, drawn over the workbench. */
  presetPickerOpen: boolean;
  light: LightAngles;
  gesture: Gesture | null;
  /** The figure as last saved or loaded, serialised; compared against the bench for the unsaved prompt. */
  keptFigure: string;

  setTool: (tool: ToolId) => void;
  setAddKind: (kind: MassShapeId) => void;
  selectShape: (id: string | null) => void;
  selectJoint: (id: string | null) => void;
  toggleLayer: (id: LayerId) => void;
  toggleLightOn: () => void;
  setLightPad: (open: boolean) => void;
  /** One d-pad press: 45 degrees round, or 30 up or down (clamped). */
  stepLight: (step: LightStep) => void;
  resetLight: () => void;
  toggleSection: (id: SectionId) => void;
  toggleSkeleton: () => void;
  toggleStretch: () => void;
  setPresetPicker: (open: boolean) => void;

  undo: () => void;
  redo: () => void;

  /** Put a new shape at a world point in a view. It pins to `pinTo`, or to the joint nearest the point. */
  addShapeAt: (view: ViewportKind, at: Vec3, pinTo?: string | null) => void;
  deleteShape: (id: string) => void;
  duplicate: (id: string) => void;
  rename: (id: string, name: string) => void;
  setKind: (id: string, kind: MassShapeId) => void;
  setColour: (id: string, colour: string | null) => void;
  setHidden: (id: string, hidden: boolean) => void;
  setPin: (id: string, pin: string | null) => void;
  setNumbers: (id: string, numbers: { position?: Vec3; rotation?: Vec3; size?: Vec3 }) => void;
  reorder: (id: string, step: -1 | 1) => void;

  beginGesture: (start: GestureStart) => void;
  /** The pointer's total travel since the gesture began, in pixels. */
  updateGesture: (dx: number, dy: number) => void;
  endGesture: () => void;

  applyPreset: (presetId: RigPresetId) => void;
  loadFigure: (figure: Figure, presetId: RigPresetId) => void;
  markKept: () => void;
  /** Throw away everything since the last save or load: the bench goes back to exactly the kept figure. */
  revert: () => void;
  reset: () => void;
};

const OPENING_FIGURE = buildDefaultFigure('blob');

/** File `previous` in the history and clear the redo list - the bookkeeping every edit shares. */
function filed(state: CharacterState, previous: Figure): Pick<CharacterState, 'past' | 'future'> {
  return { past: [...state.past, previous].slice(-HISTORY_LIMIT), future: [] };
}

/**
 * The one way an edit reaches the figure. An edit that changed nothing (an unknown id, a refused value) returns the
 * same figure object, and is not filed - so UNDO never has to step through edits that did nothing.
 */
function commit(state: CharacterState, next: Figure): Partial<CharacterState> {
  if (next === state.figure) return {};
  return { figure: next, ...filed(state, state.figure) };
}

/** Selections that point at things the figure no longer has are dropped. */
function tidySelection(figure: Figure, state: CharacterState): Partial<CharacterState> {
  return {
    selectedShapeId: figure.shapes.some((shape) => shape.id === state.selectedShapeId) ? state.selectedShapeId : null,
    selectedJointId:
      state.selectedJointId !== null && figure.skeleton.joints[state.selectedJointId] !== undefined
        ? state.selectedJointId
        : null,
  };
}

function freshState() {
  const figure = buildDefaultFigure('blob');
  return {
    figure,
    presetId: 'blob' as RigPresetId,
    past: [] as Figure[],
    future: [] as Figure[],
    tool: 'select' as ToolId,
    addKind: 'sphere' as MassShapeId,
    selectedShapeId: null,
    selectedJointId: null,
    layers: { ...DEFAULT_LAYERS },
    lightOn: true,
    lightPadOpen: false,
    sections: { ...DEFAULT_SECTIONS },
    showSkeleton: true,
    stretch: false,
    presetPickerOpen: false,
    light: { ...DEFAULT_LIGHT },
    gesture: null,
    keptFigure: fingerprint(figure),
  };
}

export const useCharacterStore = create<CharacterState>((set) => ({
  ...freshState(),
  figure: OPENING_FIGURE,
  keptFigure: fingerprint(OPENING_FIGURE),

  setTool: (tool) => set({ tool, gesture: null }),
  setAddKind: (kind) => set({ addKind: kind, tool: 'add' }),
  selectShape: (id) => set({ selectedShapeId: id }),
  selectJoint: (id) => set({ selectedJointId: id }),
  toggleLayer: (id) => set((state) => ({ layers: { ...state.layers, [id]: !state.layers[id] } })),
  toggleLightOn: () => set((state) => ({ lightOn: !state.lightOn })),
  setLightPad: (open) => set({ lightPadOpen: open }),
  stepLight: (step) => set((state) => ({ light: stepLight(state.light, step) })),
  resetLight: () => set({ light: { ...DEFAULT_LIGHT } }),
  toggleSection: (id) => set((state) => ({ sections: { ...state.sections, [id]: !state.sections[id] } })),
  toggleSkeleton: () => set((state) => ({ showSkeleton: !state.showSkeleton })),
  toggleStretch: () => set((state) => ({ stretch: !state.stretch })),
  setPresetPicker: (open) => set({ presetPickerOpen: open, lightPadOpen: false, gesture: null }),

  undo: () =>
    set((state) => {
      const previous = state.past[state.past.length - 1];
      if (previous === undefined || state.gesture !== null) return state;
      return {
        figure: previous,
        past: state.past.slice(0, -1),
        future: [state.figure, ...state.future].slice(0, HISTORY_LIMIT),
        ...tidySelection(previous, state),
      };
    }),

  redo: () =>
    set((state) => {
      const next = state.future[0];
      if (next === undefined || state.gesture !== null) return state;
      return {
        figure: next,
        past: [...state.past, state.figure].slice(-HISTORY_LIMIT),
        future: state.future.slice(1),
        ...tidySelection(next, state),
      };
    }),

  addShapeAt: (view, at, pinTo) =>
    set((state) => {
      const pin = pinTo !== undefined ? pinTo : nearestJoint(state.figure, at);
      const result = addShape(state.figure, { kind: state.addKind, at, pin });
      if (result.id === null) return state;
      return { ...commit(state, result.figure), selectedShapeId: result.id };
    }),

  deleteShape: (id) =>
    set((state) => {
      const figure = removeShape(state.figure, id);
      return { ...commit(state, figure), ...tidySelection(figure, state) };
    }),

  duplicate: (id) =>
    set((state) => {
      const result = duplicateShape(state.figure, id);
      if (result.id === null) return state;
      return { ...commit(state, result.figure), selectedShapeId: result.id };
    }),

  rename: (id, name) => set((state) => commit(state, renameShape(state.figure, id, name))),
  setKind: (id, kind) => set((state) => commit(state, setShapeKind(state.figure, id, kind))),
  setColour: (id, colour) => set((state) => commit(state, setShapeColour(state.figure, id, colour))),
  setHidden: (id, hidden) => set((state) => commit(state, setShapeHidden(state.figure, id, hidden))),
  setPin: (id, pin) => set((state) => commit(state, pinShape(state.figure, id, pin))),
  setNumbers: (id, numbers) => set((state) => commit(state, setShapeNumbers(state.figure, id, numbers))),
  reorder: (id, step) => set((state) => commit(state, reorderShape(state.figure, id, step))),

  beginGesture: (start) =>
    set((state) => ({
      gesture: { ...start, base: state.figure } as Gesture,
      ...(start.kind === 'pose' ? { selectedJointId: start.jointId } : { selectedShapeId: start.shapeId }),
    })),

  updateGesture: (dx, dy) =>
    set((state) => {
      const g = state.gesture;
      if (g === null) return state;
      switch (g.kind) {
        case 'move':
          return { figure: moveGesture(g.base, g.shapeId, g.view, dx, dy, g.upp) };
        case 'turn':
          return { figure: turnGesture(g.base, g.shapeId, g.view, g.grab, dx, dy, g.upp) };
        case 'size':
          return { figure: sizeGesture(g.base, g.shapeId, g.view, g.handle, dx, dy, g.upp) };
        case 'pose':
          return { figure: poseGesture(g.base, g.jointId, g.view, dx, dy, g.upp, state.stretch) };
      }
    }),

  endGesture: () =>
    set((state) => {
      const g = state.gesture;
      if (g === null) return state;
      // Compared as text: a drag that went out and came back to where it started is no edit at all.
      if (fingerprint(state.figure) === fingerprint(g.base)) return { gesture: null, figure: g.base };
      return { gesture: null, ...filed(state, g.base) };
    }),

  /** A preset is a starting point, so it replaces the figure - as one undoable step. */
  applyPreset: (presetId) =>
    set((state) => {
      const figure = buildDefaultFigure(presetId);
      return { ...commit(state, figure), presetId, selectedShapeId: null, selectedJointId: null };
    }),

  /** A figure off the shelf. Its own history starts here: undo does not walk back into the previous figure. */
  loadFigure: (figure, presetId) => {
    const arrived = JSON.parse(JSON.stringify(figure)) as Figure;
    set({
      figure: arrived,
      presetId,
      past: [],
      future: [],
      gesture: null,
      selectedShapeId: null,
      selectedJointId: null,
      keptFigure: fingerprint(arrived),
    });
  },

  markKept: () => set((state) => ({ keptFigure: fingerprint(state.figure) })),

  /**
   * The kept figure is stored as text, so this is a fresh copy of it - nothing the bench does afterwards can reach
   * back into the record of what was kept. The history goes too: the prompt that leads here says there is no undo.
   */
  revert: () =>
    set((state) => {
      const kept = readFigure(JSON.parse(state.keptFigure));
      if (kept === null) return state;
      return { figure: kept, past: [], future: [], gesture: null, selectedShapeId: null, selectedJointId: null };
    }),

  reset: () => set(freshState()),
}));

/** The kept figure, serialised, so the console can compare the bench against it. */
export function useKeptFigure(): string {
  return useCharacterStore((state) => state.keptFigure);
}

/** The bench figure, serialised the same way. Pair with `useKeptFigure` to ask whether anything is unsaved. */
export function useBenchFigure(): string {
  return useCharacterStore((state) => fingerprint(state.figure));
}
