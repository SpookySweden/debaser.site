'use client';

/**
 * The live pixel render, every frame, in each view - the Dead Cells pipeline (see `pixel-render.ts` for the source).
 *
 *   1. COLOUR PASS   the figure's flat, unlit shape colours, drawn into a tiny target with no anti-aliasing
 *   2. NORMAL PASS   the same figure into a second tiny target, each pixel the way its surface faces (view space,
 *                    encoded as colour: x to red, y to green, z to blue)
 *   3. LIGHT PASS    a full-screen cel shader reads both: colour x one of three hard bands of `dot(normal, light)`,
 *                    and scales the result up to the view with every low-res pixel a hard-edged square
 *
 * There is no outline and no post-processing filter: the pixel look is the tiny size and nothing else. With PIXELATE
 * off the same passes run at full size into multisampled targets, so the edges come out smooth rather than stepped.
 *
 * **The building aids are drawn after, at full resolution.** A frame is put on screen in this order:
 *
 *   the grid (behind) -> the light pass (the pixel figure) -> the figure's depth, unseen -> the overlays
 *
 * so the grid shows round the pixel silhouette rather than through it, the picked-shape wire is hidden where the
 * figure is in front of it, and the transform box, handles and skeleton sit crisp on top. Each part is a group in
 * the scene (`groups`), shown only for its own pass; all three are visible again before the frame ends, so picking -
 * which raycasts the real shapes, never the pixels - always sees the whole scene.
 *
 * **Colours are worked in the dye values themselves**, not in linear light: the colour pass writes each shape's hex
 * as it is, and the light pass multiplies it by its band and writes that straight out. A lit pixel is therefore
 * exactly the dye from the swatch row, and a shaded one is that dye times 0.78 or 0.55 - a darker shade of the same
 * hue, never a colour from outside the palette's family.
 *
 * This takes over drawing the view (`useFrame` with a priority above zero, which stops R3F's own render).
 */
import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef, type RefObject } from 'react';
import * as THREE from 'three';
import { MODEL_VOID } from '../lib/character/palette';
import {
  CEL_BANDS,
  LIT_FROM,
  MID_FROM,
  lightDirection,
  lowResFrustum,
  pixelGrid,
  shadeMode,
  type PixelGrid,
} from '../lib/character/pixel-render';
import { useCharacterStore } from '../lib/character/store';

/** The three groups the scene is drawn in, so each pass can show only its own. */
export type RenderGroups = {
  under: RefObject<THREE.Group | null>;
  figure: RefObject<THREE.Group | null>;
  over: RefObject<THREE.Group | null>;
};

const COLOUR_VERTEX = /* glsl */ `
void main() {
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const COLOUR_FRAGMENT = /* glsl */ `
uniform vec3 colour;
void main() {
  gl_FragColor = vec4(colour, 1.0);
}
`;

/** Pass 1's material: one per dye, shared by every shape wearing it. The dye goes in as its hex, unconverted. */
const FLAT_MATERIALS = new Map<string, THREE.ShaderMaterial>();

export function flatMaterial(hex: string): THREE.ShaderMaterial {
  const cached = FLAT_MATERIALS.get(hex);
  if (cached !== undefined) return cached;
  const value = parseInt(hex.slice(1), 16);
  const material = new THREE.ShaderMaterial({
    uniforms: { colour: { value: new THREE.Vector3(((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255) } },
    vertexShader: COLOUR_VERTEX,
    fragmentShader: COLOUR_FRAGMENT,
  });
  FLAT_MATERIALS.set(hex, material);
  return material;
}

/** Pass 2: the surface direction in view space, packed into 0..1 so it fits a colour. */
export const NORMAL_PASS = new THREE.ShaderMaterial({
  vertexShader: /* glsl */ `
varying vec3 vNormal;
void main() {
  vNormal = normalize(normalMatrix * normal);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`,
  fragmentShader: /* glsl */ `
varying vec3 vNormal;
void main() {
  gl_FragColor = vec4(normalize(vNormal) * 0.5 + 0.5, 1.0);
}
`,
});

/** The figure's depth at full resolution, with no colour, so the picked-shape wire hides behind it. */
export const DEPTH_ONLY = new THREE.MeshBasicMaterial({ colorWrite: false });

/** What the light pass draws: 0 the normal map, 1 flat colours, 2 cel-lit colours. */
const MODE_NUMBER = { normals: 0, flat: 1, lit: 2 } as const;

/**
 * Pass 3, the light pass. Each screen pixel finds its low-res pixel from `gl_FragCoord` and the block size, so a
 * block is exactly `block` device pixels wide however the target overhangs the view - nearest-neighbour by
 * construction, with no texture filtering involved. Empty pixels are discarded, and the grid drawn before shows
 * through them.
 *
 * Pixelated, a pixel is wholly figure or wholly empty (alpha 1 or 0). Smooth, an edge pixel is partly covered, and
 * both passes hold "value x coverage" there - so dividing by the coverage gets the surface back, and the coverage
 * blends the pixel onto the grid behind it.
 */
function lightPassMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      colourPass: { value: null },
      normalPass: { value: null },
      grid: { value: new THREE.Vector2(1, 1) },
      block: { value: 1 },
      lightDir: { value: new THREE.Vector3(0, 0, 1) },
      lightOn: { value: 1 },
      mode: { value: MODE_NUMBER.lit },
    },
    vertexShader: /* glsl */ `
void main() {
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`,
    fragmentShader: /* glsl */ `
uniform sampler2D colourPass;
uniform sampler2D normalPass;
uniform vec2 grid;
uniform float block;
uniform vec3 lightDir;
uniform float lightOn;
uniform float mode;
void main() {
  vec2 uv = (floor(gl_FragCoord.xy / block) + 0.5) / grid;
  vec4 base = texture2D(colourPass, uv);
  if (base.a < 0.004) discard;
  vec3 colour = base.rgb / base.a;
  vec4 facing = texture2D(normalPass, uv);
  vec3 encoded = facing.rgb / max(facing.a, 0.004);
  if (mode < 0.5) {
    gl_FragColor = vec4(encoded, base.a);
    return;
  }
  if (mode < 1.5) {
    gl_FragColor = vec4(colour, base.a);
    return;
  }
  float amount = lightOn * max(dot(normalize(encoded * 2.0 - 1.0), lightDir), 0.0);
  float band = amount >= ${LIT_FROM.toFixed(3)} ? ${CEL_BANDS.lit.toFixed(3)}
    : amount >= ${MID_FROM.toFixed(3)} ? ${CEL_BANDS.mid.toFixed(3)}
    : ${CEL_BANDS.shadow.toFixed(3)};
  gl_FragColor = vec4(colour * band, base.a);
}
`,
    // Blended, for the part-covered edge pixels of the smooth render; a pixelated pixel is opaque or discarded.
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });
}

/**
 * A pass target: nearest filtering, no mipmaps, a depth buffer so nearer shapes hide farther ones. `samples` is the
 * multisampling - none for the pixel render, where hard edges are the point, four for PIXELATE off.
 */
function passTarget(samples: number): THREE.WebGLRenderTarget {
  return new THREE.WebGLRenderTarget(1, 1, {
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
    generateMipmaps: false,
    depthBuffer: true,
    samples,
  });
}

/** One colour target and one normal target, the same size. */
type PassPair = { colour: THREE.WebGLRenderTarget; normal: THREE.WebGLRenderTarget };

export type Passes = {
  /** The tiny, hard-edged pair (PIXELATE on). */
  pixel: PassPair;
  /** The full-size, multisampled pair (PIXELATE off). */
  smooth: PassPair;
  material: THREE.ShaderMaterial;
  screen: THREE.Scene;
  screenCamera: THREE.OrthographicCamera;
  lowCamera: THREE.OrthographicCamera;
  buffer: THREE.Vector2;
  light: THREE.Vector3;
  turn: THREE.Quaternion;
};

export function createPasses(): Passes {
  const material = lightPassMaterial();
  const screen = new THREE.Scene();
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
  // It is placed by its own vertex shader, straight onto the screen, so there is no frustum to cull it against.
  quad.frustumCulled = false;
  screen.add(quad);
  return {
    pixel: { colour: passTarget(0), normal: passTarget(0) },
    smooth: { colour: passTarget(4), normal: passTarget(4) },
    material,
    screen,
    screenCamera: new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1),
    lowCamera: new THREE.OrthographicCamera(),
    buffer: new THREE.Vector2(),
    light: new THREE.Vector3(),
    turn: new THREE.Quaternion(),
  };
}

/** How often the FRONT view counts its pixels for the PIXELS stat: often enough to follow a drag, rarely enough that
 * reading the tiny target back never shows. */
const COUNT_EVERY_MS = 200;

export function PixelRender({ groups, countPixels = false }: { groups: RenderGroups; countPixels?: boolean }) {
  const passes = useMemo(() => createPasses(), []);
  const counted = useRef({ at: -Infinity, buffer: new Uint8Array(0) });

  useEffect(
    () => () => {
      for (const pair of [passes.pixel, passes.smooth]) {
        pair.colour.dispose();
        pair.normal.dispose();
      }
      passes.material.dispose();
    },
    [passes],
  );

  useFrame(({ gl, scene, camera, clock }) => {
    drawFrame(gl, scene, camera, passes, groups);
    const now = clock.elapsedTime * 1000;
    if (!countPixels || now - counted.current.at < COUNT_EVERY_MS) return;
    counted.current.at = now;
    const count = countFigurePixels(gl, scene, camera, passes, groups, counted.current);
    if (count !== null) useCharacterStore.getState().setPixels(count);
  }, 1);

  return null;
}

/** The low-res camera is the view's own, widened to whole blocks (see `lowResFrustum`). */
function aimLowCamera(low: THREE.OrthographicCamera, camera: THREE.OrthographicCamera, grid: PixelGrid, ratio: number) {
  const frustum = lowResFrustum(camera, grid, ratio);
  low.copy(camera);
  low.zoom = 1;
  low.left = frustum.left;
  low.right = frustum.right;
  low.bottom = frustum.bottom;
  low.top = frustum.top;
  low.updateProjectionMatrix();
  low.updateMatrixWorld();
  return low;
}

/**
 * One frame of one view: the three passes, then the overlays. Plain three.js, outside React on purpose - and exported
 * so `Temp/check-character-frame.cjs` can run it against a recording renderer and see what each pass draws.
 */
export function drawFrame(gl: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, passes: Passes, groups: RenderGroups) {
  const under = groups.under.current;
  const figure = groups.figure.current;
  const over = groups.over.current;
  if (under === null || figure === null || over === null || !(camera instanceof THREE.OrthographicCamera)) return;

  const { layers, light, lightOn } = useCharacterStore.getState();
  const buffer = gl.getDrawingBufferSize(passes.buffer);
  if (buffer.x === 0 || buffer.y === 0) return;
  const ratio = gl.getPixelRatio();
  const grid = pixelGrid(buffer.x, buffer.y, camera.zoom, ratio, layers.pixelate);

  const pair = layers.pixelate ? passes.pixel : passes.smooth;
  if (pair.colour.width !== grid.width || pair.colour.height !== grid.height) {
    pair.colour.setSize(grid.width, grid.height);
    pair.normal.setSize(grid.width, grid.height);
  }

  const low = aimLowCamera(passes.lowCamera, camera, grid, ratio);

  // The light is fixed in the world; each view sees it from its own side, so it is turned into the view's space.
  const world = lightDirection(light);
  passes.turn.copy(camera.quaternion).invert();
  passes.light.set(world.x, world.y, world.z).applyQuaternion(passes.turn).normalize();

  const uniforms = passes.material.uniforms;
  uniforms.colourPass.value = pair.colour.texture;
  uniforms.normalPass.value = pair.normal.texture;
  uniforms.grid.value.set(grid.width, grid.height);
  uniforms.block.value = grid.block;
  uniforms.lightDir.value.copy(passes.light);
  uniforms.lightOn.value = lightOn ? 1 : 0;
  uniforms.mode.value = MODE_NUMBER[shadeMode(layers)];

  const autoClear = gl.autoClear;
  gl.autoClear = false;

  // 1. Colour pass and 2. normal pass: the figure alone, tiny (or full size and multisampled, with PIXELATE off).
  under.visible = false;
  over.visible = false;
  figure.visible = true;
  gl.setClearColor(0x000000, 0);
  gl.setRenderTarget(pair.colour);
  gl.clear();
  gl.render(scene, low);
  scene.overrideMaterial = NORMAL_PASS;
  gl.setRenderTarget(pair.normal);
  gl.clear();
  gl.render(scene, low);
  scene.overrideMaterial = null;

  // On screen: the grid behind, then 3. the light pass.
  gl.setRenderTarget(null);
  gl.setClearColor(MODEL_VOID, 1);
  gl.clear();
  figure.visible = false;
  under.visible = true;
  gl.render(scene, camera);
  gl.render(passes.screen, passes.screenCamera);

  // The figure's depth, unseen, then the overlays on top at full resolution.
  under.visible = false;
  figure.visible = true;
  scene.overrideMaterial = DEPTH_ONLY;
  gl.render(scene, camera);
  scene.overrideMaterial = null;
  figure.visible = false;
  over.visible = true;
  gl.render(scene, camera);

  under.visible = true;
  figure.visible = true;
  gl.autoClear = autoClear;
}

/**
 * The PIXELS stat: how many blocks of the FRONT view's pixel render the figure fills, read back from the render target.
 * With PIXELATE on that is the colour pass this frame already drew; with it off (the view drew at full size) the
 * figure's colour pass is drawn at block size once more, just to be counted. Hidden shapes are never drawn, so they
 * are never counted.
 */
export function countFigurePixels(
  gl: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
  passes: Passes,
  groups: RenderGroups,
  memo: { buffer: Uint8Array },
): number | null {
  const under = groups.under.current;
  const figure = groups.figure.current;
  const over = groups.over.current;
  if (under === null || figure === null || over === null || !(camera instanceof THREE.OrthographicCamera)) return null;

  const buffer = gl.getDrawingBufferSize(passes.buffer);
  if (buffer.x === 0 || buffer.y === 0) return null;
  const ratio = gl.getPixelRatio();
  const grid = pixelGrid(buffer.x, buffer.y, camera.zoom, ratio, true);
  const target = passes.pixel.colour;

  if (!useCharacterStore.getState().layers.pixelate) {
    if (target.width !== grid.width || target.height !== grid.height) {
      target.setSize(grid.width, grid.height);
      passes.pixel.normal.setSize(grid.width, grid.height);
    }
    const low = aimLowCamera(passes.lowCamera, camera, grid, ratio);
    const autoClear = gl.autoClear;
    gl.autoClear = false;
    under.visible = false;
    over.visible = false;
    figure.visible = true;
    gl.setClearColor(0x000000, 0);
    gl.setRenderTarget(target);
    gl.clear();
    gl.render(scene, low);
    gl.setRenderTarget(null);
    under.visible = true;
    over.visible = true;
    gl.autoClear = autoClear;
  }

  const size = target.width * target.height * 4;
  if (memo.buffer.length !== size) memo.buffer = new Uint8Array(size);
  gl.readRenderTargetPixels(target, 0, 0, target.width, target.height, memo.buffer);
  return countFilled(memo.buffer);
}

/** Filled pixels in an RGBA read-back: the colour pass is cleared to transparent, and every shape writes opaque. */
export function countFilled(rgba: Uint8Array): number {
  let filled = 0;
  for (let index = 3; index < rgba.length; index += 4) if (rgba[index] > 0) filled += 1;
  return filled;
}
