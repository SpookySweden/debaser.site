/**
 * Baking a character's motions into a picture strip, once, in the owner's browser (SPEC-profile-characters.md).
 *
 * **The workbench's own render, frame by frame.** Each frame is posed (`motion.ts`), and then drawn exactly the way the
 * workbench's live pixel render draws a view (`CharacterPixelRender.tsx`): the colour pass into a tiny target, the normal
 * pass into another, and the very same light-pass shader with its three bands, here written into a third tiny target at
 * one block per pixel instead of being scaled up to a screen. The dye colours come out exact and the light-band look is
 * kept, because it is the same code doing it. `scripts/drive-profile-character.cjs` proves it: a baked frame against the
 * workbench's FRONT view, pixel for pixel.
 *
 * **What comes out:** one PNG, every unique frame in a grid of equal cells, and a small sheet that says which cells each
 * motion plays, tick by tick, at `MOTION_FPS`, with no smoothing between them. Left-facing frames aren't drawn: the page
 * mirrors the right-facing ones.
 *
 * Browser only (it needs WebGL). Loaded with `import()` when the owner presses SHOW, so three never reaches a page that
 * only plays the strip.
 */
import * as THREE from 'three';
import { createPasses, flatMaterial, NORMAL_PASS } from '../../components/CharacterPixelRender';
import type { Figure, Placement, Shape } from './figure';
import { unitGeometry } from './geometry';
import { frameYaw, MOTION_FPS, MOTION_IDS, motionsFor, motionTicks, posedPlacements, type Facing, type MotionId } from './motion';
import { MODEL_INK } from './palette';
import { DEFAULT_LIGHT, FIGURE_ROWS, lightDirection, TALLEST_PRESET } from './pixel-render';
import { rotateVec } from './turns';
import type { CharacterSheet } from './sheet';

/** One block of the strip, in model units: the workbench's own figure size, the tallest preset at most 30 blocks high. */
export const BAKE_UNIT = TALLEST_PRESET / FIGURE_ROWS;
/** A cell is never bigger than this many blocks across or up; a figure built wider is cut at the edges. */
export const MAX_CELL = 96;
/** Cells per row of the strip. */
const COLUMNS = 8;

type Drawn = { shape: Shape; placement: Placement }[];

/** A frustum in model units, as an orthographic camera looking at the figure's front. */
export type Frame = { left: number; right: number; bottom: number; top: number };

/** The screen box of one drawn figure, front view: x across, y up. Conservative (a box round each turned shape). */
function boundsOf(drawn: Drawn): { minX: number; maxX: number; minY: number; maxY: number } {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const { shape, placement } of drawn) {
    const half = { x: shape.size.x / 2, y: shape.size.y / 2, z: shape.size.z / 2 };
    const ax = rotateVec(placement.rotation, { x: half.x, y: 0, z: 0 });
    const ay = rotateVec(placement.rotation, { x: 0, y: half.y, z: 0 });
    const az = rotateVec(placement.rotation, { x: 0, y: 0, z: half.z });
    const ex = Math.abs(ax.x) + Math.abs(ay.x) + Math.abs(az.x);
    const ey = Math.abs(ax.y) + Math.abs(ay.y) + Math.abs(az.y);
    minX = Math.min(minX, placement.position.x - ex);
    maxX = Math.max(maxX, placement.position.x + ex);
    minY = Math.min(minY, placement.position.y - ey);
    maxY = Math.max(maxY, placement.position.y + ey);
  }
  return { minX, maxX, minY, maxY };
}

/** The renderer, the workbench's passes, and a scene of meshes reused for every frame. */
type Bench = {
  gl: THREE.WebGLRenderer;
  passes: ReturnType<typeof createPasses>;
  lit: THREE.WebGLRenderTarget;
  scene: THREE.Scene;
  camera: THREE.OrthographicCamera;
  meshes: THREE.Mesh[];
};

function openBench(): Bench {
  const canvas = document.createElement('canvas');
  canvas.width = 1;
  canvas.height = 1;
  const gl = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: true });
  const lit = new THREE.WebGLRenderTarget(1, 1, {
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
    generateMipmaps: false,
    depthBuffer: false,
  });
  // The front view's camera: looking down -z from in front, square to the figure (CharacterScene's `Fitted`).
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -20, 20);
  camera.position.set(0, 0, 10);
  return { gl, passes: createPasses(), lit, scene: new THREE.Scene(), camera, meshes: [] };
}

function closeBench(bench: Bench): void {
  bench.passes.pixel.colour.dispose();
  bench.passes.pixel.normal.dispose();
  bench.passes.smooth.colour.dispose();
  bench.passes.smooth.normal.dispose();
  bench.passes.material.dispose();
  bench.lit.dispose();
  bench.gl.dispose();
}

/**
 * One frame, drawn as the workbench draws its FRONT view with every switch at its default (PIXELATE on, NORMAL LIGHT on,
 * the light front-left and up), at one block per pixel. RGBA, top row first; an empty pixel is fully transparent.
 */
function drawCell(bench: Bench, drawn: Drawn, frame: Frame, width: number, height: number): Uint8Array {
  const { gl, passes, lit, scene, camera } = bench;

  while (bench.meshes.length < drawn.length) {
    const mesh = new THREE.Mesh();
    bench.meshes.push(mesh);
    scene.add(mesh);
  }
  bench.meshes.forEach((mesh, index) => {
    const entry = drawn[index];
    mesh.visible = entry !== undefined;
    if (entry === undefined) return;
    const { shape, placement } = entry;
    mesh.geometry = unitGeometry(shape.kind);
    mesh.material = flatMaterial(shape.colour ?? MODEL_INK);
    mesh.position.set(placement.position.x, placement.position.y, placement.position.z);
    mesh.quaternion.set(placement.rotation.x, placement.rotation.y, placement.rotation.z, placement.rotation.w);
    mesh.scale.set(shape.size.x, shape.size.y, shape.size.z);
  });

  camera.left = frame.left;
  camera.right = frame.right;
  camera.bottom = frame.bottom;
  camera.top = frame.top;
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld();

  const pair = passes.pixel;
  if (pair.colour.width !== width || pair.colour.height !== height) {
    pair.colour.setSize(width, height);
    pair.normal.setSize(width, height);
    lit.setSize(width, height);
  }

  // The light is fixed in the world; the front camera is unturned, so the world's direction is the view's.
  const light = lightDirection(DEFAULT_LIGHT);
  const uniforms = passes.material.uniforms;
  uniforms.colourPass.value = pair.colour.texture;
  uniforms.normalPass.value = pair.normal.texture;
  uniforms.grid.value.set(width, height);
  uniforms.block.value = 1;
  uniforms.lightDir.value.set(light.x, light.y, light.z).normalize();
  uniforms.lightOn.value = 1;
  uniforms.mode.value = 2;

  const autoClear = gl.autoClear;
  gl.autoClear = false;
  gl.setClearColor(0x000000, 0);
  gl.setRenderTarget(pair.colour);
  gl.clear();
  gl.render(scene, camera);
  scene.overrideMaterial = NORMAL_PASS;
  gl.setRenderTarget(pair.normal);
  gl.clear();
  gl.render(scene, camera);
  scene.overrideMaterial = null;
  gl.setRenderTarget(lit);
  gl.clear();
  gl.render(passes.screen, passes.screenCamera);
  gl.setRenderTarget(null);
  gl.autoClear = autoClear;

  const bottomUp = new Uint8Array(width * height * 4);
  gl.readRenderTargetPixels(lit, 0, 0, width, height, bottomUp);
  const topDown = new Uint8Array(bottomUp.length);
  const row = width * 4;
  for (let y = 0; y < height; y += 1) topDown.set(bottomUp.subarray((height - 1 - y) * row, (height - y) * row), y * row);
  return topDown;
}

/**
 * The figure as built, square to the front, drawn into exactly `frame` at `width` x `height`: what the workbench's FRONT
 * view shows in that same low-res grid. For the bake's proof (`scripts/drive-profile-character.cjs`).
 */
export function bakeStill(figure: Figure, frame: Frame, width: number, height: number): Uint8Array {
  const bench = openBench();
  try {
    return drawCell(bench, posedPlacements(figure, {}, 0), frame, width, height);
  } finally {
    closeBench(bench);
  }
}

export type Baked = { strip: Blob; sheet: CharacterSheet };

/** Every motion of a figure, baked. */
export async function bakeCharacter(figure: Figure, presetId: string): Promise<Baked> {
  const motions = motionsFor(presetId);

  // Every unique keyframe gets a cell.
  const cells: Drawn[] = [];
  const sheetMotions = {} as CharacterSheet['motions'];
  for (const id of MOTION_IDS) {
    const motion = motions[id];
    const first = cells.length;
    for (const frame of motion.frames) cells.push(posedPlacements(figure, frame, frameYaw(motion, frame)));
    sheetMotions[id as MotionId] = {
      facing: motion.facing as Facing,
      loop: motion.loop,
      ticks: motionTicks(motion).map((index) => first + index),
    };
  }

  // One box for every cell, so the feet stay on the same row through every motion. In whole blocks, with a block spare.
  const boxes = cells.filter((drawn) => drawn.length > 0).map(boundsOf);
  const minX = Math.min(...boxes.map((b) => b.minX));
  const maxX = Math.max(...boxes.map((b) => b.maxX));
  const minY = Math.min(...boxes.map((b) => b.minY));
  const maxY = Math.max(...boxes.map((b) => b.maxY));
  const rootX = figure.skeleton.joints[figure.skeleton.rootId]?.position.x ?? 0;
  // Centred on the root, so a mirrored frame turns about the same line.
  const halfAcross = Math.min(MAX_CELL / 2, Math.ceil(Math.max(rootX - minX, maxX - rootX) / BAKE_UNIT) + 1);
  let bottom = Math.floor(minY / BAKE_UNIT) - 1;
  const top = Math.ceil(maxY / BAKE_UNIT) + 1;
  if (top - bottom > MAX_CELL) bottom = top - MAX_CELL;
  const width = halfAcross * 2;
  const height = top - bottom;
  const frame: Frame = {
    left: rootX - halfAcross * BAKE_UNIT,
    right: rootX + halfAcross * BAKE_UNIT,
    bottom: bottom * BAKE_UNIT,
    top: top * BAKE_UNIT,
  };

  // The floor: the lowest block the figure fills standing still, counted from the cell's top.
  const stand = boundsOf(cells[sheetMotions.stand.ticks[0]]);
  const floor = Math.min(height, Math.max(1, top - Math.floor(stand.minY / BAKE_UNIT + 1e-6)));

  const columns = Math.min(COLUMNS, cells.length);
  const rows = Math.ceil(cells.length / columns);
  const canvas = document.createElement('canvas');
  canvas.width = columns * width;
  canvas.height = rows * height;
  const context = canvas.getContext('2d');
  if (context === null) throw new Error('no 2d canvas');

  const bench = openBench();
  try {
    cells.forEach((drawn, index) => {
      const pixels = drawCell(bench, drawn, frame, width, height);
      const image = new ImageData(width, height);
      image.data.set(pixels);
      context.putImageData(image, (index % columns) * width, Math.floor(index / columns) * height);
    });
  } finally {
    closeBench(bench);
  }

  const strip = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((blob) => (blob === null ? reject(new Error('no picture')) : resolve(blob)), 'image/png'),
  );
  // Pixels are pixels: (top - stand top) gives the row the head is on, for anything that wants to sit a mark over it.
  const head = Math.max(0, top - Math.ceil(stand.maxY / BAKE_UNIT));

  return {
    strip,
    sheet: { v: 1, cell: { w: width, h: height }, columns, cells: cells.length, fps: MOTION_FPS, floor, head, motions: sheetMotions },
  };
}
