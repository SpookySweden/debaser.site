'use client';

/**
 * One view of the figure: a flat (orthographic) camera, the grid, the shapes, their handles and the skeleton.
 *
 * **Every drag goes through `startDrag`, which listens on the window, not on the mesh.** A pointer that leaves the
 * view mid-drag - off the edge, over the side panel - still moves the shape and still ends the gesture when it is
 * released, so a drag is always exactly one undo step and never a half-finished one stuck to the pointer.
 *
 * **The camera zoom is fitted to the pane**, and the same number is what turns pixels into model units for every
 * drag (`upp`, units per pixel). They are one fact: a shape follows the pointer exactly only when the drag and the
 * camera agree on how big a pixel is.
 *
 * Handles and joints are drawn on top of everything (`depthTest` off), at a constant size in pixels, so they can
 * always be seen and grabbed however the figure is posed.
 */
import { OrthographicCamera } from '@react-three/drei';
import { Canvas, useThree, type ThreeEvent } from '@react-three/fiber';
import { createContext, useContext, useEffect, useMemo, type ReactNode } from 'react';
import * as THREE from 'three';
import { VIEW_BASIS, screenBox, type ViewportKind } from '../lib/character/drag';
import { placementOf, type Figure, type Shape } from '../lib/character/figure';
import {
  MODEL_GRID,
  MODEL_HANDLE,
  MODEL_HANDLE_ACTIVE,
  MODEL_HIGHLIGHT,
  MODEL_INK,
  MODEL_VOID,
  MODEL_WIRE,
} from '../lib/character/palette';
import { unitGeometry } from '../lib/character/geometry';
import { childrenOf, jointFrames, lengthOf, type JointFrame, type Vec3 } from '../lib/character/skeleton';
import { useCharacterStore, type GestureStart, type ToolId } from '../lib/character/store';
import { PixelPass } from './CharacterPixelPass';

/** How much of the world a view shows, in model units: every preset (2.41 tall at most, NOODLE) with a margin. */
const VIEW_HEIGHT = 2.8;
const VIEW_WIDTH = 1.9;
/**
 * Where the views are centred vertically: halfway between the floor every preset stands on (-1.36, `FLOOR_Y`) and the
 * tallest crown (NOODLE, 1.05), so all of them fit without the view moving when a preset is picked.
 */
const FIGURE_CENTRE_Y = -0.16;
/** Screen-sized things, in pixels. Larger on a touch screen, where a fingertip is the pointer. */
const HANDLE_PX = { fine: 10, coarse: 28 };
const JOINT_PX = { fine: 6, coarse: 15 };
const KNOB_GAP_PX = 26;

type ViewContext = { view: ViewportKind; upp: number; coarse: boolean };

const ViewInfo = createContext<ViewContext>({ view: 'front', upp: 1 / 150, coarse: false });

export default function CharacterScene({ view }: { view: ViewportKind }) {
  const tool = useCharacterStore((state) => state.tool);
  const look = useCharacterStore((state) => state.look);

  return (
    <Canvas
      frameloop="always"
      gl={{ antialias: false }}
      className={CURSOR_FOR_TOOL[tool]}
    >
      <color attach="background" args={[MODEL_VOID]} />
      <Fitted view={view}>
        <ambientLight intensity={0.55} />
        <KeyLight />
        {look === 'shapes' ? <Grid view={view} /> : null}
        <Backdrop />
        <Shapes />
        {look === 'shapes' ? <SelectionBox /> : null}
        {look === 'shapes' ? <Bones /> : null}
      </Fitted>
      <PixelPass enabled={look === 'final'} />
    </Canvas>
  );
}

const CURSOR_FOR_TOOL: Record<ToolId, string> = {
  select: 'cursor-default',
  add: 'cursor-crosshair',
  move: 'cursor-move',
  turn: 'cursor-grab',
  size: 'cursor-nwse-resize',
  pose: 'cursor-pointer',
  delete: 'cursor-crosshair',
};

/**
 * The view's camera, fitted to the pane, and the matching units-per-pixel handed to everything inside.
 *
 * The rotation is explicit: left unset, a camera is aimed at the origin, which tilts one raised to the figure's
 * centre - and a tilted camera is no longer a flat view.
 */
function Fitted({ view, children }: { view: ViewportKind; children: ReactNode }) {
  const size = useThree((state) => state.size);
  const zoom = Math.max(20, Math.min(size.height / VIEW_HEIGHT, size.width / VIEW_WIDTH));
  const coarse = useCoarsePointer();
  const value = useMemo(() => ({ view, upp: 1 / zoom, coarse }), [view, zoom, coarse]);

  return (
    <ViewInfo.Provider value={value}>
      <OrthographicCamera
        makeDefault
        position={view === 'front' ? [0, FIGURE_CENTRE_Y, 10] : [-10, FIGURE_CENTRE_Y, 0]}
        rotation={view === 'front' ? [0, 0, 0] : [0, -Math.PI / 2, 0]}
        zoom={zoom}
        near={-20}
        far={20}
      />
      {children}
    </ViewInfo.Provider>
  );
}

function useCoarsePointer(): boolean {
  return useMemo(
    () => typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches === true,
    [],
  );
}

function KeyLight() {
  const azimuth = useCharacterStore((state) => state.light.azimuth);
  const elevation = useCharacterStore((state) => state.light.elevation);
  const distance = 12;

  return (
    <directionalLight
      position={[
        distance * Math.sin(azimuth) * Math.cos(elevation),
        distance * Math.sin(elevation),
        distance * Math.cos(azimuth) * Math.cos(elevation),
      ]}
      intensity={1.6}
    />
  );
}

/** A tile grid behind the figure, 0.2 units a square, in the plane the view looks at. */
function Grid({ view }: { view: ViewportKind }) {
  return (
    <gridHelper
      args={[8, 40, MODEL_GRID, MODEL_GRID]}
      position={view === 'front' ? [0, 0, -4] : [4, 0, 0]}
      rotation={view === 'front' ? [Math.PI / 2, 0, 0] : [0, 0, Math.PI / 2]}
      raycast={IGNORE_POINTER}
    />
  );
}

/**
 * Start a drag: tell the store, then follow the pointer on the window until it is let go.
 *
 * The store is handed the pointer's *total* travel each time, never a step, so the gesture is recomputed from where
 * it began (see `drag.ts`) and cannot drift.
 */
function startDrag(event: ThreeEvent<PointerEvent>, start: GestureStart) {
  const store = useCharacterStore.getState();
  // One drag at a time: a second finger landing mid-drag would restart the gesture from a half-dragged figure,
  // and UNDO would then stop halfway instead of where the drag began.
  if (store.gesture !== null) return;
  const originX = event.nativeEvent.clientX;
  const originY = event.nativeEvent.clientY;

  store.beginGesture(start);

  const move = (pointer: PointerEvent) => {
    useCharacterStore.getState().updateGesture(pointer.clientX - originX, pointer.clientY - originY);
  };
  const end = () => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', end);
    window.removeEventListener('pointercancel', end);
    useCharacterStore.getState().endGesture();
  };

  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', end);
  window.addEventListener('pointercancel', end);
}

/** A world point's distance from `centre`, in the view's screen directions. */
function screenOffset(view: ViewportKind, point: Vec3, centre: Vec3): { right: number; up: number } {
  const basis = VIEW_BASIS[view];
  const d = { x: point.x - centre.x, y: point.y - centre.y, z: point.z - centre.z };
  return {
    right: d.x * basis.right.x + d.y * basis.right.y + d.z * basis.right.z,
    up: d.x * basis.up.x + d.y * basis.up.y + d.z * basis.up.z,
  };
}

/** A world point with its depth (the axis pointing out of the view) set to zero. */
function flatten(view: ViewportKind, point: Vec3): Vec3 {
  return view === 'front' ? { ...point, z: 0 } : { ...point, x: 0 };
}

/**
 * A large invisible plane behind the figure, so a press on empty space has a position: ADD puts a shape there, and
 * every other tool lets go of the selection.
 */
function Backdrop() {
  const { view } = useContext(ViewInfo);

  return (
    <mesh
      position={view === 'front' ? [0, 0, -6] : [6, 0, 0]}
      rotation={view === 'front' ? [0, 0, 0] : [0, -Math.PI / 2, 0]}
      onPointerDown={(event) => {
        event.stopPropagation();
        const store = useCharacterStore.getState();
        if (store.tool === 'add') {
          store.addShapeAt(view, flatten(view, event.point));
          return;
        }
        if (store.tool === 'pose') store.selectJoint(null);
        else store.selectShape(null);
      }}
    >
      <planeGeometry args={[40, 40]} />
      <meshBasicMaterial visible={false} />
    </mesh>
  );
}

function Shapes() {
  const figure = useCharacterStore((state) => state.figure);
  const frames = useMemo(() => jointFrames(figure.skeleton), [figure.skeleton]);

  return (
    <>
      {figure.shapes.map((shape) =>
        shape.hidden ? null : <ShapeMesh key={shape.id} figure={figure} shape={shape} frames={frames} />,
      )}
    </>
  );
}

function ShapeMesh({ figure, shape, frames }: { figure: Figure; shape: Shape; frames: Record<string, JointFrame> }) {
  const { view, upp } = useContext(ViewInfo);
  const selected = useCharacterStore((state) => state.selectedShapeId === shape.id);
  const look = useCharacterStore((state) => state.look);
  const placement = placementOf(figure, shape, frames);
  const geometry = unitGeometry(shape.kind);

  const onPointerDown = (event: ThreeEvent<PointerEvent>) => {
    const store = useCharacterStore.getState();
    // POSE reaches through shapes to the joints inside them.
    if (store.tool === 'pose') return;
    event.stopPropagation();

    switch (store.tool) {
      case 'add':
        // Added on the surface that was clicked, following whatever this shape follows: an ear on a head.
        store.addShapeAt(view, event.point, shape.pin);
        return;
      case 'delete':
        store.deleteShape(shape.id);
        return;
      case 'select':
      case 'move':
        startDrag(event, { kind: 'move', shapeId: shape.id, view, upp });
        return;
      case 'size':
        startDrag(event, { kind: 'size', shapeId: shape.id, view, upp, handle: { h: 1, v: 1 } });
        return;
      case 'turn': {
        let grab = screenOffset(view, event.point, placement.position);
        // Pressed near the middle: there is no angle to measure yet, so act as if the knob above were grabbed.
        if (Math.hypot(grab.right, grab.up) < 20 * upp) grab = { right: 0, up: 40 * upp };
        startDrag(event, { kind: 'turn', shapeId: shape.id, view, upp, grab });
      }
    }
  };

  const position = placement.position;
  const q = placement.rotation;

  return (
    <group position={[position.x, position.y, position.z]} quaternion={[q.x, q.y, q.z, q.w]}>
      <mesh geometry={geometry} scale={[shape.size.x, shape.size.y, shape.size.z]} onPointerDown={onPointerDown}>
        <meshLambertMaterial color={shape.colour ?? MODEL_INK} />
      </mesh>
      {selected && look === 'shapes' ? (
        <mesh geometry={geometry} scale={[shape.size.x * 1.01, shape.size.y * 1.01, shape.size.z * 1.01]} raycast={IGNORE_POINTER}>
          <meshBasicMaterial color={MODEL_HIGHLIGHT} wireframe />
        </mesh>
      ) : null}
    </group>
  );
}

/** For things drawn as guides only: pointer rays pass straight through them. */
const IGNORE_POINTER = () => undefined;

/** A flat square facing the camera, drawn over everything. */
function Square({ at, px, colour, onPointerDown }: { at: Vec3; px: number; colour: string; onPointerDown?: (e: ThreeEvent<PointerEvent>) => void }) {
  const { view, upp } = useContext(ViewInfo);
  const side = px * upp;

  return (
    <mesh
      position={[at.x, at.y, at.z]}
      rotation={view === 'front' ? [0, 0, 0] : [0, -Math.PI / 2, 0]}
      renderOrder={30}
      onPointerDown={onPointerDown}
      // Always a function: handing R3F `undefined` after a no-op leaves the no-op in place, so a joint that was
      // only a guide would stay unclickable after switching to POSE.
      raycast={onPointerDown === undefined ? IGNORE_POINTER : THREE.Mesh.prototype.raycast}
    >
      <planeGeometry args={[side, side]} />
      <meshBasicMaterial color={colour} depthTest={false} />
    </mesh>
  );
}

/**
 * Lines between world points (pairs: each two points are one segment), drawn over everything. The geometry is
 * rebuilt only when the points actually change, and the old one is released, so a drag does not leak a buffer a frame.
 */
function Segments({ points, colour }: { points: Vec3[]; colour: string }) {
  const key = points.map((p) => `${p.x},${p.y},${p.z}`).join(';');
  const geometry = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(points.flatMap((p) => [p.x, p.y, p.z]), 3));
    return g;
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps -- `key` is `points`, by value
  useEffect(() => () => geometry.dispose(), [geometry]);

  return (
    <lineSegments geometry={geometry} renderOrder={25} raycast={IGNORE_POINTER}>
      <lineBasicMaterial color={colour} depthTest={false} />
    </lineSegments>
  );
}

/**
 * SELECT's transform box round the picked shape: drag an edge or corner square to size it, the knob above to turn
 * it. Dragging the shape's body (inside the box) moves it - that is the shape's own handler.
 */
function SelectionBox() {
  const { view, upp, coarse } = useContext(ViewInfo);
  const figure = useCharacterStore((state) => state.figure);
  const tool = useCharacterStore((state) => state.tool);
  const selectedShapeId = useCharacterStore((state) => state.selectedShapeId);
  const hidden = figure.shapes.find((shape) => shape.id === selectedShapeId)?.hidden ?? true;
  const box = selectedShapeId === null || hidden ? null : screenBox(figure, selectedShapeId, view);

  if (box === null || selectedShapeId === null || tool !== 'select') return null;

  const { right, up, toward } = VIEW_BASIS[view];
  const point = (h: number, v: number, extraUp = 0): Vec3 => ({
    x: box.centre.x + right.x * h * box.halfRight + up.x * (v * box.halfUp + extraUp) + toward.x * 3,
    y: box.centre.y + right.y * h * box.halfRight + up.y * (v * box.halfUp + extraUp) + toward.y * 3,
    z: box.centre.z + right.z * h * box.halfRight + up.z * (v * box.halfUp + extraUp) + toward.z * 3,
  });
  const px = coarse ? HANDLE_PX.coarse : HANDLE_PX.fine;
  const handles: { h: -1 | 0 | 1; v: -1 | 0 | 1 }[] = [
    { h: -1, v: -1 }, { h: 0, v: -1 }, { h: 1, v: -1 },
    { h: -1, v: 0 }, { h: 1, v: 0 },
    { h: -1, v: 1 }, { h: 0, v: 1 }, { h: 1, v: 1 },
  ];
  const knobLift = KNOB_GAP_PX * upp;
  const corners = [point(-1, -1), point(1, -1), point(1, 1), point(-1, 1)];
  const outline = corners.flatMap((corner, index) => [corner, corners[(index + 1) % 4]]);

  return (
    <>
      <Segments points={outline} colour={MODEL_HIGHLIGHT} />
      <Segments points={[point(0, 1), point(0, 1, knobLift)]} colour={MODEL_HIGHLIGHT} />
      {handles.map((handle) => (
        <Square
          key={`${handle.h}${handle.v}`}
          at={point(handle.h, handle.v)}
          px={px}
          colour={MODEL_HANDLE_ACTIVE}
          onPointerDown={(event) => {
            event.stopPropagation();
            startDrag(event, { kind: 'size', shapeId: selectedShapeId, view, upp, handle });
          }}
        />
      ))}
      <Square
        at={point(0, 1, knobLift)}
        px={px + 2}
        colour={MODEL_HANDLE}
        onPointerDown={(event) => {
          event.stopPropagation();
          startDrag(event, {
            kind: 'turn',
            shapeId: selectedShapeId,
            view,
            upp,
            grab: { right: 0, up: box.halfUp + knobLift },
          });
        }}
      />
    </>
  );
}

/**
 * The skeleton: bones as lines, joints as squares. Grabbable only with POSE; otherwise drawn small, as a guide, and
 * clicks pass straight through to the shapes. A joint sitting exactly on its parent (an upper arm on its shoulder)
 * gets no square of its own - there would be two on one spot, and the one underneath could never be reached.
 */
function Bones() {
  const { view, upp, coarse } = useContext(ViewInfo);
  const skeleton = useCharacterStore((state) => state.figure.skeleton);
  const tool = useCharacterStore((state) => state.tool);
  const showSkeleton = useCharacterStore((state) => state.showSkeleton);
  const selectedJointId = useCharacterStore((state) => state.selectedJointId);
  const frames = useMemo(() => jointFrames(skeleton), [skeleton]);
  const posing = tool === 'pose';

  const lines = useMemo(() => {
    const points: Vec3[] = [];
    for (const joint of Object.values(skeleton.joints)) {
      for (const child of childrenOf(skeleton, joint.id)) {
        const a = frames[joint.id];
        const b = frames[child.id];
        if (a !== undefined && b !== undefined) points.push(a.position, b.position);
      }
    }
    return points;
  }, [skeleton, frames]);

  if (!posing && !showSkeleton) return null;

  // Finger-sized only when they can be grabbed; as a guide they stay small so they do not hide the figure.
  const px = posing ? (coarse ? JOINT_PX.coarse : JOINT_PX.fine) * 2 : JOINT_PX.fine;

  return (
    <>
      <Segments points={lines} colour={MODEL_WIRE} />
      {Object.values(skeleton.joints).map((joint) => {
        const frame = frames[joint.id];
        if (frame === undefined || (joint.parentId !== null && lengthOf(joint.position) < 1e-6)) return null;
        const id = joint.id;
        return (
          <Square
            key={id}
            at={frame.position}
            px={px}
            colour={selectedJointId === id ? MODEL_HANDLE_ACTIVE : MODEL_HANDLE}
            onPointerDown={
              posing
                ? (event) => {
                    event.stopPropagation();
                    startDrag(event, { kind: 'pose', jointId: id, view, upp });
                  }
                : undefined
            }
          />
        );
      })}
    </>
  );
}
