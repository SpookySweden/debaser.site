'use client';

import { Canvas } from '@react-three/fiber';
import { useRef } from 'react';
import type { ViewportKind } from '../lib/character/drag';
import { MODEL_HANDLE, MODEL_HANDLE_ACTIVE, MODEL_HIGHLIGHT, MODEL_INK, MODEL_VOID } from '../lib/character/palette';
import { massFor } from '../lib/character/rig';
import { scaleOf, type Joint } from '../lib/character/skeleton';
import { useCharacterStore, useInteractionMode, type InteractionMode } from '../lib/character/store';

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

  return (
    <Canvas
      orthographic
      camera={{ position: view === 'front' ? [0, 0, 10] : [10, 0, 0], zoom: ZOOM, near: -20, far: 20 }}
      // Nothing here animates: the figure changes when the store does, and never on its own. Rendering 60fps of
      // a still life on every visit to the console is a battery cost nobody asked for.
      frameloop="demand"
      gl={{ antialias: false }}
      className="cursor-move"
    >
      <color attach="background" args={[MODEL_VOID]} />
      <ambientLight intensity={0.55} />
      <KeyLight />
      <Figure view={view} mode={mode} />
    </Canvas>
  );
}

/** How large the figure sits in the pane. Tuned so the rig's ~2 units fill the 26rem box. */
const ZOOM = 120;

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
 * The mass a joint carries: a clickable primitive.
 *
 * **Clicking the shape is what opens its controls**, which is the interaction the owner asked for - "when mass
 * layer is selected you can click a shape and then open a tab to manipulate it". So this is a real target, not
 * decoration: a pointer up on it selects the joint, and the sidebar's rescale slider then acts on that
 * selection.
 *
 * **A cone's apex points up by default**, so a limb cone is rotated a half-turn about x to hang *downward* from
 * its joint. That one line is the difference between a figure and a row of party hats, and it belongs here
 * rather than baked into the rig: the rig stores where a joint is, not how a mesh happens to be wound.
 *
 * The material colour is deliberately **not** from the nine-token palette. This is the model, not the chrome -
 * it is what the pixel shader will recolour, and choosing a site colour now would hard-code a decision the
 * shader has not made yet. The one exception is selection, which has to be visible and uses the palette's
 * magenta so it still reads as the same site.
 */
function MassAt({ jointId, scale, mode }: { jointId: string; scale: number; mode: InteractionMode }) {
  const part = massFor(jointId);
  const selectJoint = useCharacterStore((state) => state.selectJoint);
  const selectedJointId = useCharacterStore((state) => state.selectedJointId);

  if (part === undefined) return null;

  const isSelected = selectedJointId === jointId;
  const clickable = mode === 'mass';
  const size: [number, number, number] = [part.size.x * 2, part.size.y * 2, part.size.z * 2];

  return (
    <group position={[part.offset.x, part.offset.y, part.offset.z]} scale={scale}>
      <mesh
        rotation={part.shape === 'cone' ? [Math.PI, 0, 0] : [0, 0, 0]}
        onPointerUp={
          clickable
            ? (event) => {
                // Stopping propagation matters: without this the click also reaches whatever is behind, and in
                // a scene of nested parts that means the *parent* wins and the reader selects the wrong joint.
                event.stopPropagation();
                selectJoint(jointId);
              }
            : undefined
        }
      >
        {part.shape === 'box' ? <boxGeometry args={size} /> : null}
        {part.shape === 'sphere' ? <sphereGeometry args={[size[0] / 2, 12, 8]} /> : null}
        {part.shape === 'cone' ? <coneGeometry args={[size[0] / 2, size[1], 10]} /> : null}
        <meshLambertMaterial color={isSelected ? MODEL_HIGHLIGHT : MODEL_INK} />
      </mesh>
    </group>
  );
}

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
function Figure({ view, mode }: { view: ViewportKind; mode: InteractionMode }) {
  const joints = useCharacterStore((state) => state.skeleton.joints);
  const rootId = useCharacterStore((state) => state.skeleton.rootId);
  const visible = useCharacterStore((state) => state.visible);

  if (joints[rootId] === undefined) return null;

  return (
    <JointNode
      joints={joints}
      jointId={rootId}
      view={view}
      mode={mode}
      showHandles={visible.skeleton}
      showMass={visible.mass || visible.base || visible.pixel}
    />
  );
}

function JointNode({
  joints,
  jointId,
  view,
  mode,
  showHandles,
  showMass,
}: {
  joints: Joints;
  jointId: string;
  view: ViewportKind;
  mode: InteractionMode;
  showHandles: boolean;
  showMass: boolean;
}) {
  const joint = joints[jointId];
  if (joint === undefined) return null;

  const children = Object.values(joints).filter((candidate) => candidate.parentId === jointId);

  return (
    <group position={[joint.position.x, joint.position.y, joint.position.z]}>
      {showMass ? <MassAt jointId={jointId} scale={scaleOf(joint)} mode={mode} /> : null}
      {showHandles ? <JointHandle jointId={jointId} view={view} /> : null}

      {children.map((child) => (
        <JointNode
          key={child.id}
          joints={joints}
          jointId={child.id}
          view={view}
          mode={mode}
          showHandles={showHandles}
          showMass={showMass}
        />
      ))}
    </group>
  );
}
