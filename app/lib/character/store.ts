/**
 * The character editor's state, and the one derived fact everything hangs off.
 *
 * **The store holds authoring data - never Three.js objects.** A `THREE.Vector3`, `Object3D` or `Material`
 * in here would be a mutable object held across renders: React compares by reference, the write mutates the
 * value it has already compared, the canvas does not redraw, and the joint appears stuck to the pointer while
 * the data underneath has actually moved. It is also the difference between a store a Node check can drive
 * and one that needs a GPU context. Plain triples go in (`app/lib/character/skeleton.ts`); Three's types are
 * built from them at the edge, once per render.
 *
 * **The interaction mode is derived, never stored.** There is one fact - which layer is selected - and the
 * mode is a function of it. Storing both means an app where `mode` and `activeLayer` can disagree, which is a
 * class of bug with no wrong answer: a drag that scales a joint while the sidebar says SKELETON. Two stored
 * facts can drift; one derived fact cannot.
 *
 * Zustand rather than React context because dragging is *frame-rate* state: a joint being moved writes on
 * every pointer move, and a context provider re-renders its whole subtree on every write. Zustand's selectors
 * let the viewport being dragged re-render while the sidebar, the layer list and the other viewport do not.
 * This is the first store of this shape on the site - the audio player keeps its state in a provider because
 * its writes are per-track, not per-pixel.
 */
import { create } from 'zustand';
import { dragOffset, lightForDrag, resizeForDrag, type ViewportKind } from './drag';
import type { RenderLayerId } from './layers';
import { buildDefaultRig, type RigPresetId } from './rig';
import type { MassShapeId } from './shapes';
import {
  clearMass,
  offsetMass,
  resizeMass,
  setMassColour,
  setMassShape,
  setPosition,
  setScale,
  type Skeleton,
  type Vec3,
} from './skeleton';

/**
 * The four layers, in the brief's order.
 *
 * Declared here rather than in the component because the *store* needs to name them: `activeLayer` is typed
 * by this union, so a layer added to the UI without being added here is a type error rather than a layer that
 * silently cannot be selected.
 */
export type LayerId = 'skeleton' | 'mass' | 'base' | 'pixel';

export const LAYER_IDS: readonly LayerId[] = ['skeleton', 'mass', 'base', 'pixel'];

/**
 * What a drag in the viewport does, given the selected layer.
 *
 * **`mass` split into three, because a shape has three things worth editing and a drag can only be one at a time.**
 * Dragging a primitive with the pointer can plausibly mean "make it bigger", "slide it off the joint" or "give it a
 * different colour", and a single gesture cannot be all three. So the tool carries which one, and the sidebar says
 * which - a reader who wants another presses one plate rather than learning a modifier key they cannot discover.
 *
 *   `mass`      drag resizes the shape
 *   `massMove`  drag slides the shape within the joint's frame, leaving the joint alone
 *   `massPaint` drag ... nothing. See below.
 *
 * **COLOUR is a tool with no drag, and that is deliberate rather than an omission.** A colour is not a quantity, so
 * there is nothing for a pointer drag to interpolate - a drag that swept through the palette would change a shape's
 * colour a hundred times while the reader was trying to move past it. It maps to `none` so a drag in that tool does
 * nothing at all, which is honest: the swatch row is the control, and the tool exists so the *other* two gestures
 * are not competing with it. The alternative - leaving the last drag tool active while the colour row is open -
 * means a reader who goes to press a swatch and misses moves the limb instead.
 *
 * `none` is not an error state - it is also what the BASE layer gives you. The base render is the solid figure with
 * no pixelation, so it is the one layer that is purely something to *look* at.
 */
export type InteractionMode = 'joints' | 'mass' | 'massMove' | 'light' | 'none';

/**
 * How the MASS layer is being used. A single enum rather than a boolean, so a fourth gesture is a member here and a
 * case in one switch rather than a second flag that can disagree with the first.
 */
export type MassTool = 'resize' | 'move' | 'colour';

/**
 * The mode for a layer. The single place the mapping is written.
 *
 * SKELETON edits joints, MASS and BASE both edit the mass, and the difference between them is the *render*
 * rather than the interaction - which is why they share a mode. LIVE PIXEL SHADER moves the light, because
 * the shader is what the light is for: dragging a joint there would move the light's frame of reference while
 * looking like it did nothing.
 */
export function interactionModeFor(layer: LayerId, tool: MassTool): InteractionMode {
  switch (layer) {
    case 'skeleton':
      return 'joints';
    case 'mass':
    case 'base':
      // COLOUR has no drag, so the two drag tools are the only ones that reach a mode - see `MassTool`.
      if (tool === 'colour') return 'none';
      return tool === 'move' ? 'massMove' : 'mass';
    case 'pixel':
      return 'light';
  }
}

/** Where the key light sits, in radians. Its distance is fixed - only the angle is authorable. */
export type LightAngles = { azimuth: number; elevation: number };

type CharacterState = {
  skeleton: Skeleton;
  activeLayer: LayerId;
  /**
   * Which render stage is showing. **One, not three booleans** - see `layers.ts` for why the three flags could
   * not work: they were a priority order with PIXEL first and on by default, so BASE was unreachable.
   */
  renderLayer: RenderLayerId;
  /** The skeleton's own eye, and the only layer where visibility is independent of the render stage. */
  skeletonVisible: boolean;
  /** The joint a drag or the rescaler is pointed at, or null when nothing is selected. */
  selectedJointId: string | null;
  light: LightAngles;
  /** Whether the MASS layer's drag resizes a shape or slides it. See `MassTool`. */
  massTool: MassTool;
  /** Which preset the figure was built from, so the picker can show the current one. */
  presetId: RigPresetId;
  /**
   * The figure as it was last saved or loaded, serialised - or `null` when it has never been kept.
   *
   * **This was `keptAt: number | null`, a timestamp, and the timestamp was not enough.** The unsaved prompt needs
   * to know whether the bench *differs* from what was kept, and a time says only that a save happened - so the two
   * bugs that followed were both about a fact the store could not express. Keeping the figure itself makes
   * "is this the kept one?" a comparison, which is the same question every other draft in the console answers, and
   * it is why throwing changes away now clears the prompt: the bench is put back to exactly this.
   *
   * Serialised rather than held as an object, because the comparison that matters is deep equality and a string is
   * the one form of it that cannot be accidentally mutated by a later drag. `JSON.stringify` of the skeleton is
   * also exactly what the library writes, so a figure that survives a save and reload compares equal.
   */
  keptFigure: string | null;

  selectLayer: (layer: LayerId) => void;
  setRenderLayer: (layer: RenderLayerId) => void;
  toggleSkeleton: () => void;
  setMassTool: (tool: MassTool) => void;
  selectJoint: (id: string | null) => void;
  moveJoint: (id: string, offset: Vec3) => void;
  scaleJoint: (id: string, factor: number) => void;
  /** Give the selected joint one of the primitives, or take its primitive away. */
  setShape: (id: string, shape: MassShapeId) => void;
  clearShape: (id: string) => void;
  /** Recolour one joint's shape. `null` puts it back into the figure's own two-tone scheme. */
  setMassColour: (id: string, colour: string | null) => void;
  /** Put a whole saved figure on the bench, keeping the preset it was built from. */
  loadSkeleton: (skeleton: Skeleton, presetId: RigPresetId) => void;
  /** Record that the figure on the bench is now the same as a saved one, clearing the unsaved prompt. */
  markKept: () => void;
  /** Rebuild the whole figure from a preset, discarding edits. That is what a preset is for. */
  applyPreset: (presetId: RigPresetId) => void;
  /**
   * Apply a pointer drag to whichever joint the current layer is pointed at.
   *
   * **One entry point rather than three**, because the layer decides what a drag *means* - move a joint, scale
   * its mass, or turn the light - and a handler that had to choose between three store methods would be a
   * second place that mapping is written. It reads the mode from the same derived function the UI uses, so a
   * drag cannot do something the sidebar does not say it will.
   *
   * Returns nothing and silently ignores a drag with no target: a drag on empty space is not an error, it is a
   * drag on nothing.
   */
  drag: (viewport: ViewportKind, dxPixels: number, dyPixels: number, jointId: string | null) => void;
  setLight: (angles: LightAngles) => void;
  reset: () => void;
};

/** The light the editor opens on: from the front-left and slightly above. */
export const DEFAULT_LIGHT: LightAngles = { azimuth: -0.6, elevation: 0.9 };

/**
 * The figure the workbench opens on, built once.
 *
 * **Built once and shared, because it is also the baseline the unsaved prompt compares against.** The editor opens
 * on this blob, and a reader who has not touched it has no work to lose - so the prompt must not appear. That was
 * a real bug: `keptFigure` started `null`, "never kept" was reported as unsaved, and switching tabs with nothing
 * altered asked anyway.
 *
 * Module scope rather than inside `create`, so the *same* rig is both the initial state and the recorded baseline.
 * Two calls to `buildDefaultRig` would produce two structurally identical figures, which would stringify the same
 * and hide the mistake - but the sharing makes the intent plain, and `figureFingerprint` copies before storing.
 */
const OPENING_FIGURE = buildDefaultRig('blob');

/**
 * A figure as one string, for asking "is this the one that was kept?".
 *
 * **Serialised rather than compared field by field**, because the skeleton is a record of nineteen joints each
 * carrying vectors and an optional mass - and a hand-written comparison would be nineteen chances to forget a
 * field, which is the exact failure `unsaved-changes.ts` exists to avoid one level up. `JSON.stringify` is also
 * what the library writes to storage, so a figure that has been saved and loaded back compares *equal* rather than
 * merely equivalent, which is what makes the prompt disappear after a load.
 *
 * Declared above the store rather than beside its exports, because the store's own initial state needs it: the
 * opening figure is recorded as the baseline, and a `const` declared below would be in its temporal dead zone at
 * that point. That is what the compiler said, and it was right.
 */
function fingerprint(skeleton: Skeleton): string {
  return JSON.stringify(skeleton);
}

export const useCharacterStore = create<CharacterState>((set) => ({
  skeleton: OPENING_FIGURE,
  activeLayer: 'skeleton',
  /**
   * BASE opens: it is the figure at full resolution, which is the honest picture of what has been built. PIXEL
   * is one switch away, and starting on it would mean the first thing a reader sees is the effect rather than
   * the shape the effect is applied to.
   */
  renderLayer: 'base',
  // The skeleton's handles start *on*: they are how a joint is selected, so hiding them would make the default
  // SKELETON tab look like a figure with nothing to grab.
  skeletonVisible: true,
  selectedJointId: null,
  light: { ...DEFAULT_LIGHT },
  // RESIZE opens, because it is the gesture a reader reaches for first: a shape that is the wrong size is far more
  // common than one that is in the wrong place, and moving a shape is the correction you make *after* seeing it.
  massTool: 'resize',
  presetId: 'blob',
  /**
   * The figure it opened on, recorded as the baseline - **not `null`.**
   *
   * `null` here meant "never kept", and the prompt treated that as unsaved, so a reader who had touched nothing was
   * asked before switching tabs. The opening blob is not work: nothing has been built on it yet, so it is what the
   * bench is compared against until the first save or load replaces it.
   */
  keptFigure: fingerprint(OPENING_FIGURE),

  selectLayer: (layer) => set({ activeLayer: layer }),
  setRenderLayer: (layer) => set({ renderLayer: layer }),
  toggleSkeleton: () => set((state) => ({ skeletonVisible: !state.skeletonVisible })),
  setMassTool: (tool) => set({ massTool: tool }),
  selectJoint: (id) => set({ selectedJointId: id }),

  /**
   * Move a joint by an offset in its **parent's** space.
   *
   * An offset rather than an absolute position, because that is what a drag produces: a pointer delta. Taking
   * an absolute position would make the handler responsible for converting screen space into the parent's
   * frame, which is the one piece of arithmetic most likely to be wrong and the one hardest to check without
   * a browser. The handler does the projection - it is the only place that knows which viewport was dragged -
   * and this stays arithmetic.
   */
  moveJoint: (id, offset) =>
    set((state) => {
      const joint = state.skeleton.joints[id];
      if (joint === undefined) return state;

      return {
        skeleton: setPosition(state.skeleton, id, {
          x: joint.position.x + offset.x,
          y: joint.position.y + offset.y,
          z: joint.position.z + offset.z,
        }),
      };
    }),

  scaleJoint: (id, factor) => set((state) => ({ skeleton: setScale(state.skeleton, id, factor) })),

  /**
   * The one drag entry point. See the type's comment for why there is one and not three.
   *
   * The LIGHT case ignores `jointId` entirely - turning the light has no target - and the BASE layer reaches
   * no branch at all, which is the `none` mode doing its job rather than a missing case. A reader who selects
   * BASE gets a drag that does nothing, which is correct: there is nothing to edit there, and the alternative
   * would be a drag that silently edited a layer that is not selected.
   */
  drag: (viewport, dxPixels, dyPixels, jointId) =>
    set((state) => {
      const mode = interactionModeFor(state.activeLayer, state.massTool);

      if (mode === 'light') {
        return { light: lightForDrag(state.light, dxPixels, dyPixels) };
      }

      if (mode === 'none' || jointId === null) return state;

      const joint = state.skeleton.joints[jointId];
      if (joint === undefined) return state;

      if (mode === 'joints') {
        const offset = dragOffset(viewport, dxPixels, dyPixels);

        return {
          skeleton: setPosition(state.skeleton, jointId, {
            x: joint.position.x + offset.x,
            y: joint.position.y + offset.y,
            z: joint.position.z + offset.z,
          }),
        };
      }

      /**
       * **Both mass gestures move the shape, and neither moves the joint.** That is the brief's two-way rule seen
       * from the other side: a joint drag carries its mass along for free, so a mass drag must leave the joint
       * exactly where it is or the two operations would be the same one wearing two names.
       *
       * A drag on a joint that carries nothing does nothing, in both tools. Inventing a shape from a resize
       * gesture would hand a reader geometry they never asked for; the palette is how a shape gets added.
       */
      if (mode === 'massMove') {
        return { skeleton: offsetMass(state.skeleton, jointId, dragOffset(viewport, dxPixels, dyPixels)) };
      }

      return { skeleton: resizeMass(state.skeleton, jointId, resizeForDrag(viewport, dxPixels, dyPixels)) };
    }),

  setShape: (id, shape) => set((state) => ({ skeleton: setMassShape(state.skeleton, id, shape) })),

  clearShape: (id) => set((state) => ({ skeleton: clearMass(state.skeleton, id) })),

  setMassColour: (id, colour) => set((state) => ({ skeleton: setMassColour(state.skeleton, id, colour) })),

  /**
   * Put a saved figure on the bench.
   *
   * **Deep-copied in, and `keptAt` set, because loading is the one action that makes the bench match storage.**
   * The copy matters: the browser holds the same object it hands over, so an edit after loading would rewrite the
   * saved figure in memory and the next save would persist the reader's edits under the old entry's identity.
   *
   * The selection is cleared, for the same reason `applyPreset` clears it - the joint that was selected may not
   * exist in the figure just arrived.
   */
  loadSkeleton: (skeleton, presetId) => {
    // The copy is what goes on the bench; the serialised form of that same copy is what "kept" means, so the two
    // cannot disagree about spacing or key order - they are the same object, stringified once.
    const arrived = JSON.parse(JSON.stringify(skeleton)) as Skeleton;

    set({
      skeleton: arrived,
      presetId,
      selectedJointId: null,
      keptFigure: fingerprint(arrived),
    });
  },

  /**
   * Record that the bench now matches a kept figure.
   *
   * The shelf calls this after writing, and the store reads its own skeleton rather than being handed one - so a
   * save can never record a figure other than the one on the bench.
   */
  markKept: () => set((state) => ({ keptFigure: fingerprint(state.skeleton) })),

  /**
   * **Rebuild the figure from a preset, discarding every edit.**
   *
   * A preset is a *starting point*, so applying one has to be able to throw work away - otherwise "start from
   * LANKY" on a figure you have already posed does something in between the two, which is a state with no name.
   * The selection is cleared with it, because the joint a reader had selected may not be where they left it.
   */
  applyPreset: (presetId) => {
    const rebuilt = buildDefaultRig(presetId);

    set({
      skeleton: rebuilt,
      presetId,
      selectedJointId: null,
      // The rebuilt figure becomes the baseline: switching preset is *choosing a starting point*, not editing one -
      // the row says so on its face - so prompting about it would be asking a reader to confirm a labelled button.
      keptFigure: fingerprint(rebuilt),
    });
  },

  setLight: (angles) => set({ light: { ...angles } }),

  /**
   * Back to the figure it opened on.
   *
   * Rebuilds the skeleton rather than keeping a copy of the first one: `buildDefaultRig` returns fresh
   * objects, so a reset can never hand back a skeleton that a previous edit had already mutated.
   */
  reset: () => {
    const blob = buildDefaultRig('blob');

    set({
      skeleton: blob,
      activeLayer: 'skeleton',
      renderLayer: 'base',
      skeletonVisible: true,
      selectedJointId: null,
      light: { ...DEFAULT_LIGHT },
      massTool: 'resize',
      presetId: 'blob',
      // Back to the opening figure, which is the baseline - so a reset is not reported as unsaved work.
      keptFigure: fingerprint(blob),
    });
  },
}));

/** The kept figure, serialised, so the console can compare the bench against it. */
export function useKeptFigure(): string | null {
  return useCharacterStore((state) => state.keptFigure);
}

/** The bench figure, serialised the same way. Pair with `useKeptFigure` to ask whether anything is unsaved. */
export function useBenchFigure(): string {
  return useCharacterStore((state) => fingerprint(state.skeleton));
}

/** The selected layer's interaction mode. Derive it; do not store it. */
export function useInteractionMode(): InteractionMode {
  return useCharacterStore((state) => interactionModeFor(state.activeLayer, state.massTool));
}
