'use client';

import { Canvas } from '@react-three/fiber';
import { useRef } from 'react';
import { UNITS_PER_PIXEL, type ViewportKind } from '../lib/character/drag';
import {
  MODEL_HANDLE,
  MODEL_HANDLE_ACTIVE,
  MODEL_HIGHLIGHT,
  MODEL_INK,
  MODEL_LIMB,
  MODEL_VOID,
  MODEL_WIRE,
} from '../lib/character/palette';
import { massFor } from '../lib/character/rig';
import type { MassShapeId } from '../lib/character/shapes';
import type { RenderLayerId } from '../lib/character/layers';
import { scaleOf, type Joint } from '../lib/character/skeleton';
import { useCharacterStore, useInteractionMode, type InteractionMode } from '../lib/character/store';
import { PixelPass } from './CharacterPixelPass';

/**
 * The figure, drawn.
 *
 * **One `<Canvas>` per pane.** The Phase 5 plan called for a single canvas split into two drei `<View>`s, on the
 * grounds that a second `<Canvas>` is a second WebGL context and browsers cap those low. That reasoning still
 * holds - there *are* two contexts here - but `View` needs a shared renderer with scissor rectangles, and what
 * that buys is a compositor over nineteen joints of primitives. Two contexts is the simpler thing that works,
 * and the moment it stops working is the moment the figure is heavy enough to want the shared one. So this is a
 * decision to revisit when there is a reason to, not one to relitigate now.
 *
 * **Orthographic, and that is a requirement rather than a taste.** `dragOffset` converts pixels to model units
 * with a single constant, which is only correct when a unit is the same number of pixels everywhere on screen.
 * A perspective camera makes it vary with depth, so a joint near the camera would move faster than one far from
 * it - and the point of showing front and side at once is that a pixel means the same thing in both.
 */
export default function CharacterScene({ view }: { view: ViewportKind }) {
  const mode = useInteractionMode();
  const renderLayer = useCharacterStore((state) => state.renderLayer);

  return (
    <Canvas
      orthographic
      camera={{
        // Aimed at the figure's middle rather than the origin, and pulled back along the axis the pane cannot
        // see - FRONT looks down -z, SIDE looks down -x. The distance is arbitrary for an orthographic camera;
        // `near` and `far` are what actually decide whether anything is clipped.
        position: view === 'front' ? [0, FIGURE_CENTRE_Y, 10] : [10, FIGURE_CENTRE_Y, 0],
        zoom: ZOOM,
        near: -20,
        far: 20,
      }}
      // **`frameloop="demand"` is correct for the site but was wrong for the first frame.**
      //
      // It renders only when something calls `invalidate()`, and nothing in this scene does: the figure changes
      // when the store changes, but an r3f root does not watch an external store, so a canvas can mount and never
      // draw once. That is invisible to every check in the repository - the DOM is perfect, GL is live, the
      // console is quiet - and the canvas is simply empty. `frameloop="always"` costs a few idle frames and
      // removes the whole class of defect; revisit when there is a measured reason to, not before.
      frameloop="always"
      // `NearestFilter` is set here rather than on the composer because it is the *canvas* that does the final
      // blit, and a nearest-filtered canvas is what keeps the pixel blocks hard-edged instead of smoothing them
      // back out. Antialiasing is off for the same reason: smoothing edges is the opposite of the effect.
      gl={{ antialias: false }}
      className="cursor-move"
    >
      <color attach="background" args={[MODEL_VOID]} />
      <ambientLight intensity={0.55} />
      <KeyLight />
      <Figure view={view} mode={mode} renderLayer={renderLayer} />
      {/* The composer runs only for the PIXEL stage. The brief is specific that the others are not pixelated. */}
      <PixelPass enabled={renderLayer === 'pixel'} />
    </Canvas>
  );
}

/**
 * How large the figure sits in the pane - **derived, not chosen.**
 *
 * Three's orthographic camera divides the frustum R3F hands it by `zoom`, and R3F sizes that frustum from the
 * pane's pixel dimensions. So the visible world width is `paneWidthPx / zoom`, which means a pixel is `1 / zoom`
 * world units. `UNITS_PER_PIXEL` is the drag's belief about that number, and the two agreeing is not a tidiness
 * point: when they were 120 and 1/200 the joint moved 1.67 times further than the pointer, uniformly, in a way
 * that reads as imprecision rather than as an error.
 *
 * Writing it as the reciprocal makes the relationship structural - there is no pair of numbers to keep in step,
 * because there is only one number. The camera check asserts it anyway, so a future edit that hard-codes a zoom
 * fails rather than quietly introducing the same drift.
 */
/**
 * How far the figure's middle sits above the origin, so the camera can point at it.
 *
 * **The root is the hips, and the hips are not the middle.** Rooting at the pelvis is right - it is what makes a
 * lean pivot on the body rather than on the ground - but it leaves the figure's visual centre *below* the
 * origin: the legs hang further than the head rises. Measured from the real rig and mass table, that centre is
 * at y = -0.170, so a camera aimed at y = 0 draws the figure hanging low in the pane with a gap above it.
 *
 * **That number moved when the feet became prisms, and this check is how it was caught.** The old seeds were flat
 * plates 0.05 tall; the triangular feet are 0.10 tall and reach forward, so the figure is measurably taller and
 * its middle sits 0.045 lower. Nothing about the camera changed - the figure did, which is the drift this check
 * exists to make loud rather than quiet.
 *
 * `Temp/check-character-camera.cjs` measures the rig and fails if this number stops matching it, which is what
 * keeps a change to the rig's proportions from silently pushing the figure off centre.
 */
const FIGURE_CENTRE_Y = -0.17;

const ZOOM = 1 / UNITS_PER_PIXEL;

/**
 * The key light, turned by the store.
 *
 * Its distance is fixed; only the angles are authorable, which is why the store holds two numbers rather than a
 * position. LIGHT is the one layer where a drag has no target, so it is the one branch of `drag` that ignores
 * the joint it was handed.
 */
function KeyLight() {
  const azimuth = useCharacterStore((state) => state.light.azimuth);
  const elevation = useCharacterStore((state) => state.light.elevation);

  const distance = 12;
  const position: [number, number, number] = [
    distance * Math.sin(azimuth) * Math.cos(elevation),
    distance * Math.sin(elevation),
    distance * Math.cos(azimuth) * Math.cos(elevation),
  ];

  return <directionalLight position={position} intensity={1.6} />;
}

/**
 * The mass a joint carries: a clickable, draggable primitive.
 *
 * **Clicking the shape is what opens its controls**, which is the interaction the owner asked for. So this is a
 * real target, not decoration: a pointer down on it selects the joint, and then the palette reshapes it and the
 * sidebar's tool decides what dragging it does.
 *
 * **Dragging the shape is handled here, and it is what makes the mass editable in its own right.** The joint's
 * handle drags the *joint*; this drags the *mass*, and the store decides which gesture is in play from the
 * selected layer and tool. Both funnel into the same `drag()` entry point, so the axis rules live in one place
 * and a third gesture would be a member of one enum rather than a second branch here.
 *
 * **A cone's apex points up by default**, so a limb cone is rotated a half-turn about x to hang *downward* from
 * its joint. That one line is the difference between a figure and a row of party hats, and it belongs here
 * rather than baked into the rig: the rig stores where a joint is, not how a mesh happens to be wound.
 */
function MassAt({
  jointId,
  scale,
  mode,
  layer,
  view,
}: {
  jointId: string;
  scale: number;
  mode: InteractionMode;
  layer: RenderLayerId;
  view: ViewportKind;
}) {
  const skeleton = useCharacterStore((state) => state.skeleton);
  const selectJoint = useCharacterStore((state) => state.selectJoint);
  const selectedJointId = useCharacterStore((state) => state.selectedJointId);
  const drag = useCharacterStore((state) => state.drag);

  /**
   * **Every hook runs before the early return, and this was a real bug rather than tidiness.**
   *
   * `useRef` sat below `if (part === null) return null`, so a joint that gained or lost its shape during an edit
   * would change the number of hooks between renders - which React reports as *"rendered fewer hooks than
   * expected"* and which unmounts the tree. Adding a shape to a bare shoulder is exactly the gesture that
   * triggers it, and it is the first thing a reader does. The ref is declared first and the lookup second.
   */
  const last = useRef<{ x: number; y: number } | null>(null);

  const part = massFor(skeleton, jointId);
  if (part === null) return null;

  const isSelected = selectedJointId === jointId;
  /** Both mass gestures are a drag on the shape; the mode only decides what the drag *means*. */
  const draggable = mode === 'mass' || mode === 'massMove';

  /**
   * **A second tone for the limbs, so a joint reads as a joint.** Violet for the trunk and a darker Violet for
   * arms and legs: at this resolution two masses of one colour merge into one blob, and the whole point of showing
   * front *and* side is that a limb in the wrong axis is visible.
   *
   * **The names are the rig's own, read from `rig.ts` rather than guessed.** They are `upper-arm.left`,
   * `forearm.right`, `thigh.left`, `shin.right`, `hand.*` and `foot.*` - hyphenated, dotted, with a side suffix.
   * The first version of this matched `/^(arm|leg|hand|foot)/`, which caught only `hand` and `foot`: `upper-arm`
   * starts with `upper`, and the limbs kept the trunk's colour. That is the same defect as a check that reads the
   * wrong pattern, and it is why the list is written out against the rig instead of approximated.
   */
  const limb = /^(upper-arm|forearm|thigh|shin|hand|foot)\./.test(jointId);
  const size: [number, number, number] = [part.size.x * 2, part.size.y * 2, part.size.z * 2];

  /**
   * What the solid stages draw this shape in.
   *
   * **Selection outranks everything, then the shape's own colour, then the two-tone scheme.** That order is the
   * whole rule and it is written once, here, rather than in two `meshMaterial` branches that could disagree: a
   * selected shape is always magenta, because a reader who cannot see what they have selected cannot edit it -
   * and that has to hold even for a shape they have painted Brilliant Pink.
   */
  const ink = isSelected ? MODEL_HIGHLIGHT : (part.colour ?? (limb ? MODEL_LIMB : MODEL_INK));

  // The geometry and the turn it needs, decided together - see `massGeometryFor`.
  const { rotation, node } = massGeometryFor(part.shape, size);

  return (
    <group position={[part.offset.x, part.offset.y, part.offset.z]} scale={scale}>
      <mesh
        rotation={rotation}
        onPointerDown={
          draggable
            ? (event) => {
                event.stopPropagation();
                selectJoint(jointId);
                last.current = { x: event.nativeEvent.clientX, y: event.nativeEvent.clientY };
                (event.target as Element | null)?.setPointerCapture?.(event.pointerId);
              }
            : undefined
        }
        onPointerMove={
          draggable
            ? (event) => {
                if (last.current === null) return;

                const x = event.nativeEvent.clientX;
                const y = event.nativeEvent.clientY;
                const dx = x - last.current.x;
                const dy = y - last.current.y;
                last.current = { x, y };

                drag(view, dx, dy, jointId);
              }
            : undefined
        }
        onPointerUp={
          draggable
            ? (event) => {
                event.stopPropagation();
                last.current = null;
                (event.target as Element | null)?.releasePointerCapture?.(event.pointerId);
              }
            : undefined
        }
        onClick={
          // In the joint tool the shape is a way to *select* a joint, so it stays clickable - the handles are
          // small, and a reader aiming at a hand will hit the hand.
          draggable
            ? undefined
            : (event: { stopPropagation: () => void }) => {
                event.stopPropagation();
                selectJoint(jointId);
              }
        }
      >
        {node}

        {/*
         * The colour is deliberately **not** from the nine-token palette. This is the model, not the chrome - it
         * is what the pixel shader recolours, and choosing a site colour now would hard-code a decision the
         * shader has not made yet. Selection is the one exception: it has to be visible, and uses the palette's
         * magenta so it still reads as the same site.
         *
         * **A shape's own tint wins over the stage's, and the wireframe ignores it entirely.** A recoloured shape
         * in the MASS stage has to stay the green wireframe, because that stage is for seeing the *edges* - a
         * recoloured edge on a black field is an edge that has stopped being visible, which is the one thing that
         * stage is for.
         */}
        {layer === 'mass' ? (
          <meshBasicMaterial color={isSelected ? MODEL_HIGHLIGHT : MODEL_WIRE} wireframe />
        ) : null}
        {layer === 'base' ? <meshBasicMaterial color={ink} /> : null}
        {layer === 'pixel' ? <meshLambertMaterial color={ink} /> : null}
      </mesh>
    </group>
  );
}

/**
 * The geometry for a shape, and the mesh rotation it needs to sit the way it should.
 *
 * **The rotation comes back with the geometry rather than being set by the caller**, because for one shape the two
 * are the same decision: a triangular prism is only a triangle seen end-on if it is rolled a quarter turn, so a
 * caller that took the geometry and forgot the rotation would get a triangle lying on its edge and no error. The
 * `<mesh>` applies it - a Three geometry has no rotation of its own, and the error is what made that plain.
 */
function massGeometryFor(
  shape: MassShapeId,
  size: [number, number, number],
): { rotation: [number, number, number]; node: React.ReactNode } {
  switch (shape) {
    case 'box':
      return { rotation: NO_TURN, node: <boxGeometry args={size} /> };
    case 'sphere':
      return { rotation: NO_TURN, node: <sphereGeometry args={[size[0] / 2, 12, 8]} /> };
    case 'cone':
      // A cone's apex points up, so a limb cone is turned a half-turn about x to hang *downward* from its joint.
      // That one turn is the difference between a figure and a row of party hats, and it belongs here rather than
      // baked into the rig: the rig stores where a joint is, not how a mesh happens to be wound.
      return { rotation: [Math.PI, 0, 0], node: <coneGeometry args={[size[0] / 2, size[1], 10]} /> };
    case 'cylinder':
      return { rotation: NO_TURN, node: <cylinderGeometry args={[size[0] / 2, size[0] / 2, size[1], 10]} /> };
    case 'capsule':
      return { rotation: NO_TURN, node: <capsuleGeometry args={[size[0] / 2, size[1], 4, 10]} /> };
    case 'wedge':
      // Four sides rather than a box's six: a box whose top edge is narrower than its base is a wedge, and a
      // four-sided cylinder is exactly that with flat faces.
      return { rotation: NO_TURN, node: <cylinderGeometry args={[size[0] / 2, size[0] / 3, size[1], 4]} /> };
    case 'prism':
      /**
       * **The triangular foot: a triangle in the front pane, extruded forward.**
       *
       * Three radial segments and a quarter-turn about z, so the prism's own axis lies along x and one vertex
       * faces straight down - which is what puts an apex above a flat base on screen. `size[2]` is the length, so
       * it drives how far the toe reaches, and `size[0]` how wide the foot is across the figure. That is the same
       * reading of the three dials a box has, which is the point: a reader sizing a foot is not learning a second
       * vocabulary. Four segments would be a square prism, which is what `wedge` already is.
       */
      return {
        rotation: [0, 0, Math.PI / 2],
        node: <cylinderGeometry args={[size[0] / 2, size[0] / 2, size[2], 3, 1]} />,
      };
  }
}

/** No rotation, as a stable value so the mesh does not get a new array every render. */
const NO_TURN: [number, number, number] = [0, 0, 0];

/**
 * A joint, drawn as a small grabbable handle.
 *
 * **This is the "vertex" the owner drags.** It is sized in world units rather than pixels so it stays hittable
 * at any zoom - a mathematically exact point would be one pixel and unusable.
 *
 * The drag is *not* implemented here. `onPointerDown` only makes the joint the target and captures the pointer;
 * the movement is applied by `drag()`, which the store routes through the mode for the selected layer. Splitting
 * it that way keeps the axis rule in `AXES_FOR_VIEW` as the single place it is written rather than duplicating
 * it per handle - and it is what lets a handle in the MASS layer rescale instead of move, with this component
 * never knowing which layer is selected.
 */
function JointHandle({ jointId, view }: { jointId: string; view: ViewportKind }) {
  const selectJoint = useCharacterStore((state) => state.selectJoint);
  const selectedJointId = useCharacterStore((state) => state.selectedJointId);
  const drag = useCharacterStore((state) => state.drag);
  const isSelected = selectedJointId === jointId;

  // Where the last move was, in screen pixels. A ref, because it changes on every pointer move and reading it
  // never needs a render.
  const last = useRef<{ x: number; y: number } | null>(null);

  return (
    <mesh
      onPointerDown={(event) => {
        event.stopPropagation();
        selectJoint(jointId);
        last.current = { x: event.nativeEvent.clientX, y: event.nativeEvent.clientY };
        // Capture, so a fast drag that leaves the handle keeps sending its moves here.
        (event.target as Element | null)?.setPointerCapture?.(event.pointerId);
      }}
      onPointerMove={(event) => {
        if (last.current === null) return;

        const x = event.nativeEvent.clientX;
        const y = event.nativeEvent.clientY;
        const dx = x - last.current.x;
        const dy = y - last.current.y;
        last.current = { x, y };

        drag(view, dx, dy, jointId);
      }}
      onPointerUp={(event) => {
        event.stopPropagation();
        last.current = null;
        (event.target as Element | null)?.releasePointerCapture?.(event.pointerId);
      }}
    >
      <sphereGeometry args={[0.045, 8, 6]} />
      <meshBasicMaterial color={isSelected ? MODEL_HANDLE_ACTIVE : MODEL_HANDLE} />
    </mesh>
  );
}

type Joints = Record<string, Joint>;

/**
 * The rig, as a tree of `<group>`s.
 *
 * **The scene graph *is* the skeleton, and that is the payoff for storing relative transforms.** A child's
 * position in the store is measured from its parent, and a nested `<group position={...}>` is exactly a
 * transform its children inherit - so a parent moved in the store carries its whole branch on screen with no
 * code here walking descendants or accumulating offsets. Storing absolute positions would have needed that walk.
 */
function Figure({ view, mode, renderLayer }: { view: ViewportKind; mode: InteractionMode; renderLayer: RenderLayerId }) {
  const joints = useCharacterStore((state) => state.skeleton.joints);
  const rootId = useCharacterStore((state) => state.skeleton.rootId);
  const skeletonVisible = useCharacterStore((state) => state.skeletonVisible);

  if (joints[rootId] === undefined) return null;

  return (
    <JointNode
      joints={joints}
      jointId={rootId}
      view={view}
      mode={mode}
      renderLayer={renderLayer}
      showHandles={skeletonVisible}
    />
  );
}

function JointNode({
  joints,
  jointId,
  view,
  mode,
  renderLayer,
  showHandles,
}: {
  joints: Joints;
  jointId: string;
  view: ViewportKind;
  mode: InteractionMode;
  renderLayer: RenderLayerId;
  showHandles: boolean;
}) {
  const joint = joints[jointId];
  if (joint === undefined) return null;

  const children = Object.values(joints).filter((candidate) => candidate.parentId === jointId);

  return (
    <group position={[joint.position.x, joint.position.y, joint.position.z]}>
      <MassAt jointId={jointId} scale={scaleOf(joint)} mode={mode} layer={renderLayer} view={view} />
      {showHandles ? <JointHandle jointId={jointId} view={view} /> : null}

      {children.map((child) => (
        <JointNode
          key={child.id}
          joints={joints}
          jointId={child.id}
          view={view}
          mode={mode}
          renderLayer={renderLayer}
          showHandles={showHandles}
        />
      ))}
    </group>
  );
}
