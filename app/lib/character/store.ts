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
import { dragOffset, lightForDrag, scaleForDrag, type ViewportKind } from './drag';
import { buildDefaultRig } from './rig';
import { scaleOf, setPosition, setScale, type Skeleton, type Vec3 } from './skeleton';

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
 * `none` is not an error state - it is what the BASE layer gives you. The base render is the solid figure
 * with no pixelation, so it is the one layer that is purely something to *look* at; there is nothing to drag,
 * and the viewports must not swallow a pointer to do nothing with it.
 */
export type InteractionMode = 'joints' | 'mass' | 'light' | 'none';

/**
 * The mode for a layer. The single place the mapping is written.
 *
 * SKELETON edits joints, MASS and BASE both edit the mass, and the difference between them is the *render*
 * rather than the interaction - which is why they share a mode. LIVE PIXEL SHADER moves the light, because
 * the shader is what the light is for: dragging a joint there would move the light's frame of reference while
 * looking like it did nothing.
 */
export function interactionModeFor(layer: LayerId): InteractionMode {
  switch (layer) {
    case 'skeleton':
      return 'joints';
    case 'mass':
    case 'base':
      return 'mass';
    case 'pixel':
      return 'light';
  }
}

/** Where the key light sits, in radians. Its distance is fixed - only the angle is authorable. */
export type LightAngles = { azimuth: number; elevation: number };

type CharacterState = {
  skeleton: Skeleton;
  activeLayer: LayerId;
  /** Per-layer visibility. Every layer hidden is a valid state; the figure just is not drawn. */
  visible: Record<LayerId, boolean>;
  /** The joint a drag or the rescaler is pointed at, or null when nothing is selected. */
  selectedJointId: string | null;
  light: LightAngles;

  selectLayer: (layer: LayerId) => void;
  toggleLayer: (layer: LayerId) => void;
  selectJoint: (id: string | null) => void;
  moveJoint: (id: string, offset: Vec3) => void;
  scaleJoint: (id: string, factor: number) => void;
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

/**
 * The light the editor opens on: from the front-left and slightly above.
 *
 * Straight-on lighting flattens a low-poly figure into a silhouette, and the whole point of the pixel pass is
 * that a reader can tell a cone from a box after it has been reduced to blocks. An angle gives every facet a
 * different shade, which is what survives the downsample.
 */
export const DEFAULT_LIGHT: LightAngles = { azimuth: -0.6, elevation: 0.9 };

function initialVisible(): Record<LayerId, boolean> {
  // The mass layer starts hidden: the editor opens on the skeleton, and a wireframe *through* a solid figure
  // is unreadable. Which layer is drawn is the reader's first decision, and this is the one they want first.
  return { skeleton: true, mass: false, base: true, pixel: true };
}

export const useCharacterStore = create<CharacterState>((set) => ({
  skeleton: buildDefaultRig(),
  activeLayer: 'skeleton',
  visible: initialVisible(),
  selectedJointId: null,
  light: { ...DEFAULT_LIGHT },

  selectLayer: (layer) => set({ activeLayer: layer }),
  toggleLayer: (layer) => set((state) => ({ visible: { ...state.visible, [layer]: !state.visible[layer] } })),
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
      const mode = interactionModeFor(state.activeLayer);

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

      // 'mass': scale the joint the drag is on. The viewport is irrelevant here - a scale has no direction -
      // which is why the same gesture works in both panes.
      return { skeleton: setScale(state.skeleton, jointId, scaleForDrag(scaleOf(joint), dyPixels)) };
    }),

  setLight: (angles) => set({ light: { ...angles } }),

  /**
   * Back to the figure it opened on.
   *
   * Rebuilds the skeleton rather than keeping a copy of the first one: `buildDefaultRig` returns fresh
   * objects, so a reset can never hand back a skeleton that a previous edit had already mutated.
   */
  reset: () =>
    set({
      skeleton: buildDefaultRig(),
      activeLayer: 'skeleton',
      visible: initialVisible(),
      selectedJointId: null,
      light: { ...DEFAULT_LIGHT },
    }),
}));

/** The selected layer's interaction mode. Derive it; do not store it. */
export function useInteractionMode(): InteractionMode {
  return useCharacterStore((state) => interactionModeFor(state.activeLayer));
}
