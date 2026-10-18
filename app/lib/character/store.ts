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
 *
 * **Placing is one edit too.** ADD (a shape) and +NODE both run the same flow: pick a node, drag the new thing where
 * it goes, then ✓ or ✗. The figure from before the flow is kept (`placing.base`); drags while placing file nothing;
 * ✓ files the base once, and ✗ (or ESC) puts it back exactly.
 */
import { create } from 'zustand';
import {
  addNode,
  addShape,
  duplicateShape,
  fingerprint,
  MAX_NODES,
  MAX_SHAPES,
  readFigure,
  pinShape,
  removeNode,
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
  dragOffset,
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
import { addVec3, jointFrames, type Vec3 } from './skeleton';
import { problemText, structureOf } from './structure';

/**
 * The tool strip, in its on-screen order.
 *
 *   select  click a shape to pick it; the picked one shows a transform box (drag it to move, edge squares to size,
 *           the knob above to turn) - the all-in-one tool most people will stay on
 *   add     pick a shape from its menu, then a node, then drag it into place and ✓
 *   move    drag any shape to slide it
 *   turn    drag any shape to spin it round its centre
 *   size    drag any shape: sideways for width, up and down for height
 *   pose    drag a node to bend the skeleton; pinned shapes follow and turn
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

/**
 * Where a new node first appears, from the node picked as its parent: up and to the right, so it is clear of its
 * parent in both views and can be grabbed at once.
 */
export const NEW_NODE_OFFSET: Vec3 = { x: 0.15, y: 0.15, z: 0 };

/**
 * A placement in progress. `node` is the first stage (click a node); `place` is the second (drag, then ✓ or ✗).
 * `nodeId` is the node picked: the new shape's pin, or the new node's parent. `base` is the figure before the flow.
 */
export type Placing =
  | { what: 'shape'; kind: MassShapeId; stage: 'node' }
  | { what: 'node'; stage: 'node' }
  | { what: 'shape'; kind: MassShapeId; stage: 'place'; nodeId: string; id: string; base: Figure }
  | { what: 'node'; stage: 'place'; nodeId: string; id: string; base: Figure };

/** A drag in progress. `base` is the figure it started from; every frame is computed from it. */
export type Gesture =
  | { kind: 'move'; shapeId: string; view: ViewportKind; upp: number; base: Figure }
  | { kind: 'turn'; shapeId: string; view: ViewportKind; upp: number; base: Figure; grab: { right: number; up: number } }
  | { kind: 'size'; shapeId: string; view: ViewportKind; upp: number; base: Figure; handle: { h: -1 | 0 | 1; v: -1 | 0 | 1 } }
  | { kind: 'pose'; jointId: string; view: ViewportKind; upp: number; base: Figure }
  /** Dragging the shape or node being placed. Files nothing: ✓ files the whole placement. */
  | { kind: 'place'; view: ViewportKind; upp: number; base: Figure };

/** What `beginGesture` is handed: a gesture without its `base`, which the store supplies. */
export type GestureStart =
  | { kind: 'move'; shapeId: string; view: ViewportKind; upp: number }
  | { kind: 'turn'; shapeId: string; view: ViewportKind; upp: number; grab: { right: number; up: number } }
  | { kind: 'size'; shapeId: string; view: ViewportKind; upp: number; handle: { h: -1 | 0 | 1; v: -1 | 0 | 1 } }
  | { kind: 'pose'; jointId: string; view: ViewportKind; upp: number }
  | { kind: 'place'; view: ViewportKind; upp: number };

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
  /** ADD or +NODE, mid-flow. While it is set nothing else in the views can be grabbed. */
  placing: Placing | null;
  /** The node under the pointer while a node is being picked, lit in both views. */
  placingHover: string | null;
  /** The LAYERS switches: what the live pixel render draws. See `pixel-render.ts`. */
  layers: Record<LayerId, boolean>;
  /** The light source itself. Off, the figure is evenly lit by the ambient level alone. */
  lightOn: boolean;
  /** The light d-pad beside the ☀ button. */
  lightPadOpen: boolean;
  /** Which property sections are unfolded. Kept here so picking another shape does not fold them again. */
  sections: Record<SectionId, boolean>;
  /** The shapes list: folded to its header (`SHAPES 5/7`) until opened. */
  listOpen: boolean;
  showSkeleton: boolean;
  /** POSE moves joints freely (changing bone length) instead of bending them. */
  stretch: boolean;
  /** The NEW FIGURE picker, drawn over the workbench. */
  presetPickerOpen: boolean;
  light: LightAngles;
  gesture: Gesture | null;
  /** Filled blocks in the FRONT view's pixel render, counted from the render itself; `null` until first counted. */
  pixels: number | null;
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
  toggleList: () => void;
  toggleSkeleton: () => void;
  toggleStretch: () => void;
  setPresetPicker: (open: boolean) => void;
  setPixels: (count: number) => void;

  undo: () => void;
  redo: () => void;

  /** Start ADD (with the shape picked from its menu) or +NODE: the next click picks a node. */
  startPlacing: (request: { what: 'shape'; kind: MassShapeId } | { what: 'node' }) => void;
  hoverPlacingNode: (id: string | null) => void;
  /** The node clicked: the new shape appears on it, or the new node beside it. */
  pickPlacingNode: (id: string) => void;
  /** ✓: keep it, as one undo step. Refused while the new shape touches nothing valid. */
  confirmPlacing: () => void;
  /** ✗ or ESC: the figure goes back exactly as it was. */
  cancelPlacing: () => void;

  deleteShape: (id: string) => void;
  /** Remove a node and every node below it; shapes pinned to them stay where they are, unpinned. */
  deleteNode: (id: string) => void;
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

const OPENING_FIGURE = buildDefaultFigure('base');

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

/** A placement abandoned: the figure from before it, the selection tidied, the strip back on SELECT after ADD. */
function abandoned(state: CharacterState): Partial<CharacterState> {
  const placing = state.placing;
  if (placing === null) return {};
  const figure = placing.stage === 'place' ? placing.base : state.figure;
  return {
    figure,
    placing: null,
    placingHover: null,
    gesture: null,
    tool: state.tool === 'add' ? 'select' : state.tool,
    ...tidySelection(figure, state),
  };
}

/**
 * Why ✓ is greyed out, or `null` when it can be pressed. A new shape must touch something valid - a node, or a shape
 * connected to one. A new node can always be kept: it is marked until a shape is put round it.
 */
export function placingBlock(figure: Figure, placing: Placing | null): string | null {
  if (placing === null || placing.stage !== 'place') return 'NOTHING TO PLACE YET';
  if (placing.what === 'node') return null;
  const structure = structureOf(figure);
  if (structure.level[placing.id] !== undefined) return null;
  const kind = structure.touching[placing.id]?.length ? 'cut-off-shape' : 'loose-shape';
  return problemText(figure, { kind, id: placing.id });
}

function freshState() {
  const figure = buildDefaultFigure('base');
  return {
    figure,
    presetId: 'base' as RigPresetId,
    past: [] as Figure[],
    future: [] as Figure[],
    tool: 'select' as ToolId,
    addKind: 'sphere' as MassShapeId,
    selectedShapeId: null,
    selectedJointId: null,
    placing: null,
    placingHover: null,
    layers: { ...DEFAULT_LAYERS },
    lightOn: true,
    lightPadOpen: false,
    sections: { ...DEFAULT_SECTIONS },
    listOpen: false,
    showSkeleton: true,
    stretch: false,
    presetPickerOpen: false,
    light: { ...DEFAULT_LIGHT },
    gesture: null,
    pixels: null,
    keptFigure: fingerprint(figure),
  };
}

export const useCharacterStore = create<CharacterState>((set) => ({
  ...freshState(),
  figure: OPENING_FIGURE,
  keptFigure: fingerprint(OPENING_FIGURE),

  // Another tool abandons a placement in progress, as ✗ would.
  setTool: (tool) => set((state) => ({ ...abandoned(state), tool, gesture: null })),
  setAddKind: (kind) => set({ addKind: kind }),
  selectShape: (id) => set((state) => (state.placing === null ? { selectedShapeId: id } : state)),
  selectJoint: (id) => set({ selectedJointId: id }),
  toggleLayer: (id) => set((state) => ({ layers: { ...state.layers, [id]: !state.layers[id] } })),
  toggleLightOn: () => set((state) => ({ lightOn: !state.lightOn })),
  setLightPad: (open) => set({ lightPadOpen: open }),
  stepLight: (step) => set((state) => ({ light: stepLight(state.light, step) })),
  resetLight: () => set({ light: { ...DEFAULT_LIGHT } }),
  toggleSection: (id) => set((state) => ({ sections: { ...state.sections, [id]: !state.sections[id] } })),
  toggleList: () => set((state) => ({ listOpen: !state.listOpen })),
  toggleSkeleton: () => set((state) => ({ showSkeleton: !state.showSkeleton })),
  toggleStretch: () => set((state) => ({ stretch: !state.stretch })),
  setPresetPicker: (open) =>
    set((state) => ({ ...(open ? abandoned(state) : {}), presetPickerOpen: open, lightPadOpen: false, gesture: null })),
  setPixels: (count) => set((state) => (state.pixels === count ? state : { pixels: count })),

  undo: () =>
    set((state) => {
      const previous = state.past[state.past.length - 1];
      if (previous === undefined || state.gesture !== null || state.placing !== null) return state;
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
      if (next === undefined || state.gesture !== null || state.placing !== null) return state;
      return {
        figure: next,
        past: [...state.past, state.figure].slice(-HISTORY_LIMIT),
        future: state.future.slice(1),
        ...tidySelection(next, state),
      };
    }),

  startPlacing: (request) =>
    set((state) => {
      if (state.gesture !== null) return state;
      const clean = { ...state, ...abandoned(state) } as CharacterState;
      if (request.what === 'shape' && clean.figure.shapes.length >= MAX_SHAPES) return state;
      if (request.what === 'node' && Object.keys(clean.figure.skeleton.joints).length >= MAX_NODES) return state;
      return {
        ...abandoned(state),
        placing: request.what === 'shape' ? { what: 'shape', kind: request.kind, stage: 'node' } : { what: 'node', stage: 'node' },
        placingHover: null,
        tool: request.what === 'shape' ? 'add' : clean.tool,
        addKind: request.what === 'shape' ? request.kind : state.addKind,
        selectedShapeId: null,
        lightPadOpen: false,
      };
    }),

  hoverPlacingNode: (id) => set((state) => (state.placingHover === id ? state : { placingHover: id })),

  pickPlacingNode: (nodeId) =>
    set((state) => {
      const placing = state.placing;
      const frame = jointFrames(state.figure.skeleton)[nodeId];
      if (placing === null || placing.stage !== 'node' || frame === undefined) return state;

      if (placing.what === 'shape') {
        const result = addShape(state.figure, { kind: placing.kind, at: frame.position, pin: nodeId });
        if (result.id === null) return state;
        return {
          figure: result.figure,
          placing: { ...placing, stage: 'place', nodeId, id: result.id, base: state.figure },
          placingHover: null,
          selectedShapeId: result.id,
        };
      }

      const result = addNode(state.figure, nodeId, addVec3(frame.position, NEW_NODE_OFFSET));
      if (result.id === null) return state;
      return {
        figure: result.figure,
        placing: { ...placing, stage: 'place', nodeId, id: result.id, base: state.figure },
        placingHover: null,
        selectedJointId: result.id,
      };
    }),

  confirmPlacing: () =>
    set((state) => {
      const placing = state.placing;
      if (placing === null || placing.stage !== 'place' || state.gesture !== null) return state;
      if (placingBlock(state.figure, placing) !== null) return state;
      return {
        ...filed(state, placing.base),
        placing: null,
        placingHover: null,
        tool: 'select',
        ...(placing.what === 'shape' ? { selectedShapeId: placing.id } : { selectedJointId: placing.id }),
      };
    }),

  cancelPlacing: () => set((state) => abandoned(state)),

  deleteShape: (id) =>
    set((state) => {
      const figure = removeShape(state.figure, id);
      return { ...commit(state, figure), ...tidySelection(figure, state) };
    }),

  deleteNode: (id) =>
    set((state) => {
      const figure = removeNode(state.figure, id);
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
    set((state) => {
      // While placing, the only thing that can be dragged is the thing being placed.
      const placingNow = state.placing !== null && state.placing.stage === 'place';
      if ((start.kind === 'place') !== placingNow || (state.placing !== null && !placingNow)) return state;
      if (start.kind === 'place') return { gesture: { ...start, base: state.figure } };
      return {
        gesture: { ...start, base: state.figure } as Gesture,
        ...(start.kind === 'pose' ? { selectedJointId: start.jointId } : { selectedShapeId: start.shapeId }),
      };
    }),

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
        case 'place': {
          const placing = state.placing;
          if (placing === null || placing.stage !== 'place') return state;
          if (placing.what === 'shape') return { figure: moveGesture(g.base, placing.id, g.view, dx, dy, g.upp) };
          const start = jointFrames(g.base.skeleton)[placing.id];
          if (start === undefined) return state;
          const target = addVec3(start.position, dragOffset(g.view, dx, dy, g.upp));
          const moved = addNode(placing.base, placing.nodeId, target, placing.id);
          return moved.id === null ? state : { figure: moved.figure };
        }
      }
    }),

  endGesture: () =>
    set((state) => {
      const g = state.gesture;
      if (g === null) return state;
      // A drag while placing is part of the placement: ✓ files it, with everything else, as one step.
      if (g.kind === 'place') return { gesture: null };
      // Compared as text: a drag that went out and came back to where it started is no edit at all.
      if (fingerprint(state.figure) === fingerprint(g.base)) return { gesture: null, figure: g.base };
      return { gesture: null, ...filed(state, g.base) };
    }),

  /** A preset is a starting point, so it replaces the figure - as one undoable step. */
  applyPreset: (presetId) =>
    set((state) => {
      const clean = { ...state, ...abandoned(state) } as CharacterState;
      const figure = buildDefaultFigure(presetId);
      return { ...abandoned(state), ...commit(clean, figure), presetId, selectedShapeId: null, selectedJointId: null };
    }),

  /** A figure off the shelf. Its own history starts here: undo does not walk back into the previous figure. */
  loadFigure: (figure, presetId) => {
    const arrived = JSON.parse(JSON.stringify(figure)) as Figure;
    set((state) => ({
      // A placement in progress ends with the figure it was placing into, and ADD lets go, as after ✗.
      tool: state.tool === 'add' ? 'select' : state.tool,
      figure: arrived,
      presetId,
      past: [],
      future: [],
      gesture: null,
      placing: null,
      placingHover: null,
      selectedShapeId: null,
      selectedJointId: null,
      keptFigure: fingerprint(arrived),
    }));
  },

  markKept: () => set((state) => ({ keptFigure: fingerprint(state.figure) })),

  /**
   * The kept figure is stored as text, so this is a fresh copy of it - nothing the bench does afterwards can reach
   * back into the record of what was kept. The history goes too: the prompt that leads here says there is no undo.
   * A placement in progress goes with everything else.
   */
  revert: () =>
    set((state) => {
      const kept = readFigure(JSON.parse(state.keptFigure));
      if (kept === null) return state;
      return {
        figure: kept,
        past: [],
        future: [],
        gesture: null,
        placing: null,
        placingHover: null,
        tool: state.tool === 'add' ? 'select' : state.tool,
        selectedShapeId: null,
        selectedJointId: null,
      };
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
