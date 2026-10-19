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
 * camera agree on how big a pixel is. `fitZoom` is that fact, shared with the ✓ / ✗ placed over the view.
 *
 * Handles and joints are drawn on top of everything (`depthTest` off), at a constant size in pixels, so they can
 * always be seen and grabbed however the figure is posed.
 *
 * **The figure itself is drawn by the live pixel render** (`CharacterPixelRender.tsx`): the scene is three groups -
 * the grid behind, the figure, the overlays in front - and the render draws each in its own pass. The shapes are
 * still real meshes in the scene, so a press picks the real shape under the pointer, never a pixel. Each shape is
 * drawn where sag tips it (`sag.ts`); what it is built as is never changed by that.
 *
 * **While placing** (ADD or +NODE) a sheet in front of everything takes every press: first to pick the node nearest
 * the pointer, then to drag the new shape or node from anywhere in the view. Nothing else can be grabbed meanwhile.
 */
import { OrthographicCamera } from '@react-three/drei';
import { Canvas, useThree, type ThreeEvent } from '@react-three/fiber';
import { createContext, useContext, useEffect, useMemo, useRef, type ReactNode } from 'react';
import * as THREE from 'three';
import { VIEW_BASIS, screenBox, type ViewportKind } from '../lib/character/drag';
import type { Placement, Shape } from '../lib/character/figure';
import {
  MODEL_BROKEN,
  MODEL_GRID,
  MODEL_HANDLE,
  MODEL_HANDLE_ACTIVE,
  MODEL_HIGHLIGHT,
  MODEL_INK,
  MODEL_WIRE,
} from '../lib/character/palette';
import { unitGeometry } from '../lib/character/geometry';
import { sagOf } from '../lib/character/sag';
import { childrenOf, jointFrames, lengthOf, type Vec3 } from '../lib/character/skeleton';
import { useCharacterStore, type GestureStart, type ToolId } from '../lib/character/store';
import { bareNodes, brokenShapes } from '../lib/character/structure';
import { flatMaterial, PixelRender } from './CharacterPixelRender';

/** How much of the world a view shows, in model units: every preset (2.08 tall at most, GUY) with room above and
 * around it for shapes a reader adds. */
export const VIEW_HEIGHT = 2.8;
export const VIEW_WIDTH = 1.9;
/**
 * Where the views are centred vertically: halfway between the floor every preset stands on (-1.36, `FLOOR_Y`) and the
 * tallest crown (GUY, 0.72), so all of them fit without the view moving when a preset is picked.
 */
export const FIGURE_CENTRE_Y = -0.32;
/** Screen-sized things, in pixels. Larger on a touch screen, where a fingertip is the pointer. */
const HANDLE_PX = { fine: 10, coarse: 28 };
const JOINT_PX = { fine: 6, coarse: 15 };
const KNOB_GAP_PX = 26;
/** How far from a node a press may land and still pick it, while placing: a thumb's width across on a phone. */
const PICK_PX = { fine: 14, coarse: 24 };

/** The camera's zoom (pixels per model unit) for a pane, so the whole frame fits. */
export function fitZoom(width: number, height: number): number {
  return Math.max(20, Math.min(height / VIEW_HEIGHT, width / VIEW_WIDTH));
}

/** A world point's position in a pane of this size, in CSS pixels from the pane's top-left corner. */
export function toPane(view: ViewportKind, width: number, height: number, point: Vec3): { x: number; y: number } {
  const zoom = fitZoom(width, height);
  const { right, up } = VIEW_BASIS[view];
  const across = point.x * right.x + point.y * right.y + point.z * right.z;
  const upward = point.x * up.x + point.y * up.y + point.z * up.z - FIGURE_CENTRE_Y;
  return { x: width / 2 + across * zoom, y: height / 2 - upward * zoom };
}

type ViewContext = { view: ViewportKind; upp: number; coarse: boolean };

const ViewInfo = createContext<ViewContext>({ view: 'front', upp: 1 / 150, coarse: false });

export default function CharacterScene({ view }: { view: ViewportKind }) {
  const tool = useCharacterStore((state) => state.tool);
  const stage = useCharacterStore((state) => state.placing?.stage ?? null);

  return (
    <Canvas
      frameloop="always"
      gl={{ antialias: false }}
      // No tone mapping, so the overlays drawn with three's own materials (skeleton, wires, transform box, marks)
      // land on their palette values exactly. The pixel figure's passes are shaders that were never tone-mapped.
      flat
      className={stage === 'node' ? 'cursor-pointer' : stage === 'place' ? 'cursor-move' : CURSOR_FOR_TOOL[tool]}
    >
      <Fitted view={view}>
        <Layered />
      </Fitted>
    </Canvas>
  );
}

/** The scene in its three groups, and the render that draws them. See `CharacterPixelRender.tsx` for the order. */
function Layered() {
  const { view } = useContext(ViewInfo);
  const under = useRef<THREE.Group>(null);
  const figure = useRef<THREE.Group>(null);
  const over = useRef<THREE.Group>(null);
  const groups = useMemo(() => ({ under, figure, over }), []);

  return (
    <>
      <group ref={under}>
        <Grid view={view} />
        <Backdrop />
        <PlacingSheet />
      </group>
      <group ref={figure}>
        <Shapes />
      </group>
      <group ref={over}>
        <PickedWire />
        <SelectionBox />
        <Bones />
        <BrokenMarks />
      </group>
      {/* Only the FRONT view counts its pixels: the PIXELS stat is the front render's. */}
      <PixelRender groups={groups} countPixels={view === 'front'} />
    </>
  );
}

const CURSOR_FOR_TOOL: Record<ToolId, string> = {
  select: 'cursor-default',
  add: 'cursor-default',
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
  const zoom = fitZoom(size.width, size.height);
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
  // Refused (something is being placed): nothing to follow.
  if (useCharacterStore.getState().gesture === null) return;

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

/** A large invisible plane behind the figure, so a press on empty space lets go of the selection. */
function Backdrop() {
  const { view } = useContext(ViewInfo);

  return (
    <mesh
      position={view === 'front' ? [0, 0, -6] : [6, 0, 0]}
      rotation={view === 'front' ? [0, 0, 0] : [0, -Math.PI / 2, 0]}
      onPointerDown={(event) => {
        event.stopPropagation();
        const store = useCharacterStore.getState();
        if (store.tool === 'pose') store.selectJoint(null);
        else store.selectShape(null);
      }}
    >
      <planeGeometry args={[40, 40]} />
      <meshBasicMaterial visible={false} />
    </mesh>
  );
}

/**
 * While placing: an invisible sheet in front of everything, so nothing behind it can be grabbed. Picking a node, it
 * lights the node nearest the pointer (within a thumb's reach) and a press picks it; once the new thing is out, a
 * drag from anywhere in the view moves it - a new shape is small, and a thumb could not find it otherwise.
 */
function PlacingSheet() {
  const { view, upp, coarse } = useContext(ViewInfo);
  const placing = useCharacterStore((state) => state.placing !== null);
  if (!placing) return null;

  const nearestNode = (point: Vec3): string | null => {
    const frames = jointFrames(useCharacterStore.getState().figure.skeleton);
    const reach = (coarse ? PICK_PX.coarse : PICK_PX.fine) * upp;
    let best: string | null = null;
    let bestDistance = Infinity;
    for (const [id, frame] of Object.entries(frames)) {
      const offset = screenOffset(view, frame.position, point);
      const distance = Math.hypot(offset.right, offset.up);
      if (distance <= reach && distance < bestDistance) {
        best = id;
        bestDistance = distance;
      }
    }
    return best;
  };

  return (
    <mesh
      position={view === 'front' ? [0, 0, 6] : [-6, 0, 0]}
      rotation={view === 'front' ? [0, 0, 0] : [0, -Math.PI / 2, 0]}
      onPointerMove={(event) => {
        const store = useCharacterStore.getState();
        if (store.placing?.stage === 'node') store.hoverPlacingNode(nearestNode(event.point));
      }}
      onPointerOut={() => useCharacterStore.getState().hoverPlacingNode(null)}
      onPointerDown={(event) => {
        event.stopPropagation();
        const store = useCharacterStore.getState();
        if (store.placing?.stage === 'node') {
          const id = nearestNode(event.point);
          if (id !== null) store.pickPlacingNode(id);
          return;
        }
        startDrag(event, { kind: 'place', view, upp });
      }}
    >
      <planeGeometry args={[40, 40]} />
      <meshBasicMaterial visible={false} />
    </mesh>
  );
}

function Shapes() {
  const figure = useCharacterStore((state) => state.figure);
  const placements = sagOf(figure).placements;

  return (
    <>
      {figure.shapes.map((shape) =>
        shape.hidden || placements[shape.id] === undefined ? null : (
          <ShapeMesh key={shape.id} shape={shape} placement={placements[shape.id]} />
        ),
      )}
    </>
  );
}

function ShapeMesh({ shape, placement }: { shape: Shape; placement: Placement }) {
  const { view, upp } = useContext(ViewInfo);
  const geometry = unitGeometry(shape.kind);

  const onPointerDown = (event: ThreeEvent<PointerEvent>) => {
    const store = useCharacterStore.getState();
    // POSE reaches through shapes to the joints inside them; ADD does nothing in the views until it is placing.
    if (store.tool === 'pose' || store.tool === 'add') return;
    event.stopPropagation();

    switch (store.tool) {
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
    <mesh
      geometry={geometry}
      material={flatMaterial(shape.colour ?? MODEL_INK)}
      position={[position.x, position.y, position.z]}
      quaternion={[q.x, q.y, q.z, q.w]}
      scale={[shape.size.x, shape.size.y, shape.size.z]}
      onPointerDown={onPointerDown}
    />
  );
}

/** A shape's wireframe in the overlay, where the shape is drawn, a hair larger so it sits just outside the surface. */
function Wire({ shape, placement, colour }: { shape: Shape; placement: Placement; colour: string }) {
  const position = placement.position;
  const q = placement.rotation;

  return (
    <mesh
      geometry={unitGeometry(shape.kind)}
      position={[position.x, position.y, position.z]}
      quaternion={[q.x, q.y, q.z, q.w]}
      scale={[shape.size.x * 1.01, shape.size.y * 1.01, shape.size.z * 1.01]}
      raycast={IGNORE_POINTER}
    >
      <meshBasicMaterial color={colour} wireframe />
    </mesh>
  );
}

/**
 * The picked shape's wireframe, in the overlay: crisp over the pixel figure, and hidden where another shape is in
 * front of it (the render puts the figure's depth down first).
 */
function PickedWire() {
  const figure = useCharacterStore((state) => state.figure);
  const selectedShapeId = useCharacterStore((state) => state.selectedShapeId);
  const shape = figure.shapes.find((candidate) => candidate.id === selectedShapeId);
  const placement = shape === undefined ? undefined : sagOf(figure).placements[shape.id];
  if (shape === undefined || shape.hidden || placement === undefined) return null;

  return <Wire shape={shape} placement={placement} colour={MODEL_HIGHLIGHT} />;
}

/**
 * What blocks saving, marked in rose: a wire round each broken shape, a square on each node with no shape round it.
 * The squares show whether or not the skeleton is shown, so a bare node is never invisible.
 */
function BrokenMarks() {
  const { coarse } = useContext(ViewInfo);
  const figure = useCharacterStore((state) => state.figure);
  const broken = useMemo(() => brokenShapes(figure), [figure]);
  const bare = useMemo(() => bareNodes(figure), [figure]);
  const frames = useMemo(() => jointFrames(figure.skeleton), [figure.skeleton]);
  const placements = sagOf(figure).placements;

  return (
    <>
      {figure.shapes.map((shape) =>
        broken[shape.id] === undefined || placements[shape.id] === undefined ? null : (
          <Wire key={shape.id} shape={shape} placement={placements[shape.id]} colour={MODEL_BROKEN} />
        ),
      )}
      {bare.map((id) =>
        frames[id] === undefined ? null : (
          <Square key={id} at={frames[id].position} px={(coarse ? JOINT_PX.coarse : JOINT_PX.fine) * 2 + 2} colour={MODEL_BROKEN} />
        ),
      )}
    </>
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
 * SELECT's transform box round the picked shape (where it is drawn): drag an edge or corner square to size it, the
 * knob above to turn it. Dragging the shape's body (inside the box) moves it - that is the shape's own handler.
 */
function SelectionBox() {
  const { view, upp, coarse } = useContext(ViewInfo);
  const figure = useCharacterStore((state) => state.figure);
  const tool = useCharacterStore((state) => state.tool);
  const selectedShapeId = useCharacterStore((state) => state.selectedShapeId);
  const hidden = figure.shapes.find((shape) => shape.id === selectedShapeId)?.hidden ?? true;
  const drawn = selectedShapeId === null ? undefined : sagOf(figure).placements[selectedShapeId];
  const box = selectedShapeId === null || hidden ? null : screenBox(figure, selectedShapeId, view, drawn);

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
 * The skeleton: bones as lines, nodes as squares. Grabbable only with POSE; otherwise drawn small, as a guide, and
 * clicks pass straight through to the shapes. While placing it always shows, finger-sized, with the node under the
 * pointer (or the new node) lit. A node sitting exactly on its parent gets no square of its own - there would be two
 * on one spot, and the one underneath could never be reached.
 */
function Bones() {
  const { view, upp, coarse } = useContext(ViewInfo);
  const skeleton = useCharacterStore((state) => state.figure.skeleton);
  const tool = useCharacterStore((state) => state.tool);
  const showSkeleton = useCharacterStore((state) => state.showSkeleton);
  const selectedJointId = useCharacterStore((state) => state.selectedJointId);
  const placing = useCharacterStore((state) => state.placing);
  const hover = useCharacterStore((state) => state.placingHover);
  const frames = useMemo(() => jointFrames(skeleton), [skeleton]);
  const posing = tool === 'pose' && placing === null;

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

  if (!posing && !showSkeleton && placing === null) return null;

  // Finger-sized when they can be grabbed or picked; as a guide (and while dragging a new shape or node, which is
  // dragged from anywhere in the view) they stay small so they do not hide the figure.
  const px = posing || placing?.stage === 'node' ? (coarse ? JOINT_PX.coarse : JOINT_PX.fine) * 2 : JOINT_PX.fine;
  const lit = placing === null ? selectedJointId : placing.stage === 'node' ? hover : placing.what === 'node' ? placing.id : null;

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
            px={lit === id && placing !== null ? px + 6 : px}
            colour={lit === id ? MODEL_HANDLE_ACTIVE : MODEL_HANDLE}
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
