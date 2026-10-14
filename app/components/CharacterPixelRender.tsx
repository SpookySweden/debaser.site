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
 * There is no outline and no post-processing filter: the pixel look is the tiny size and nothing else.
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
import { useEffect, useMemo, type RefObject } from 'react';
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
const NORMAL_PASS = new THREE.ShaderMaterial({
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
const DEPTH_ONLY = new THREE.MeshBasicMaterial({ colorWrite: false });

/** What the light pass draws: 0 the normal map, 1 flat colours, 2 cel-lit colours. */
const MODE_NUMBER = { normals: 0, flat: 1, lit: 2 } as const;

/**
 * Pass 3, the light pass. Each screen pixel finds its low-res pixel from `gl_FragCoord` and the block size, so a
 * block is exactly `block` device pixels wide however the target overhangs the view - nearest-neighbour by
 * construction, with no texture filtering involved. Empty pixels are discarded, and the grid drawn before shows
 * through them.
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
  if (base.a < 0.5) discard;
  vec3 encoded = texture2D(normalPass, uv).rgb;
  if (mode < 0.5) {
    gl_FragColor = vec4(encoded, 1.0);
    return;
  }
  if (mode < 1.5) {
    gl_FragColor = vec4(base.rgb, 1.0);
    return;
  }
  float amount = lightOn * max(dot(normalize(encoded * 2.0 - 1.0), lightDir), 0.0);
  float band = amount >= ${LIT_FROM.toFixed(3)} ? ${CEL_BANDS.lit.toFixed(3)}
    : amount >= ${MID_FROM.toFixed(3)} ? ${CEL_BANDS.mid.toFixed(3)}
    : ${CEL_BANDS.shadow.toFixed(3)};
  gl_FragColor = vec4(base.rgb * band, 1.0);
}
`,
    depthTest: false,
    depthWrite: false,
  });
}

/** A low-res target: nearest filtering, no mipmaps, a depth buffer so nearer shapes hide farther ones. */
function passTarget(): THREE.WebGLRenderTarget {
  return new THREE.WebGLRenderTarget(1, 1, {
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
    generateMipmaps: false,
    depthBuffer: true,
  });
}

type Passes = {
  colour: THREE.WebGLRenderTarget;
  normal: THREE.WebGLRenderTarget;
  material: THREE.ShaderMaterial;
  screen: THREE.Scene;
  screenCamera: THREE.OrthographicCamera;
  lowCamera: THREE.OrthographicCamera;
  buffer: THREE.Vector2;
  light: THREE.Vector3;
  turn: THREE.Quaternion;
};

function createPasses(): Passes {
  const material = lightPassMaterial();
  const screen = new THREE.Scene();
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
  // It is placed by its own vertex shader, straight onto the screen, so there is no frustum to cull it against.
  quad.frustumCulled = false;
  screen.add(quad);
  return {
    colour: passTarget(),
    normal: passTarget(),
    material,
    screen,
    screenCamera: new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1),
    lowCamera: new THREE.OrthographicCamera(),
    buffer: new THREE.Vector2(),
    light: new THREE.Vector3(),
    turn: new THREE.Quaternion(),
  };
}

export function PixelRender({ groups }: { groups: RenderGroups }) {
  const passes = useMemo(() => createPasses(), []);

  useEffect(
    () => () => {
      passes.colour.dispose();
      passes.normal.dispose();
      passes.material.dispose();
    },
    [passes],
  );

  useFrame(({ gl, scene, camera }) => drawFrame(gl, scene, camera, passes, groups), 1);

  return null;
}

/** One frame of one view: the three passes, then the overlays. Plain three.js, outside React on purpose. */
function drawFrame(gl: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, passes: Passes, groups: RenderGroups) {
  const under = groups.under.current;
  const figure = groups.figure.current;
  const over = groups.over.current;
  if (under === null || figure === null || over === null || !(camera instanceof THREE.OrthographicCamera)) return;

  const { layers, light, lightOn } = useCharacterStore.getState();
  const buffer = gl.getDrawingBufferSize(passes.buffer);
  if (buffer.x === 0 || buffer.y === 0) return;
  const ratio = gl.getPixelRatio();
  const grid = pixelGrid(buffer.x, buffer.y, camera.zoom, ratio, layers.pixelate);

  if (passes.colour.width !== grid.width || passes.colour.height !== grid.height) {
    passes.colour.setSize(grid.width, grid.height);
    passes.normal.setSize(grid.width, grid.height);
  }

  // The low-res camera is the view's own, widened to whole blocks (see `lowResFrustum`).
  const low = passes.lowCamera;
  const frustum = lowResFrustum(camera, grid, ratio);
  low.copy(camera);
  low.zoom = 1;
  low.left = frustum.left;
  low.right = frustum.right;
  low.bottom = frustum.bottom;
  low.top = frustum.top;
  low.updateProjectionMatrix();
  low.updateMatrixWorld();

  // The light is fixed in the world; each view sees it from its own side, so it is turned into the view's space.
  const world = lightDirection(light);
  passes.turn.copy(camera.quaternion).invert();
  passes.light.set(world.x, world.y, world.z).applyQuaternion(passes.turn).normalize();

  const uniforms = passes.material.uniforms;
  uniforms.colourPass.value = passes.colour.texture;
  uniforms.normalPass.value = passes.normal.texture;
  uniforms.grid.value.set(grid.width, grid.height);
  uniforms.block.value = grid.block;
  uniforms.lightDir.value.copy(passes.light);
  uniforms.lightOn.value = lightOn ? 1 : 0;
  uniforms.mode.value = MODE_NUMBER[shadeMode(layers)];

  const autoClear = gl.autoClear;
  gl.autoClear = false;

  // 1. Colour pass and 2. normal pass: the figure alone, tiny.
  under.visible = false;
  over.visible = false;
  figure.visible = true;
  gl.setClearColor(0x000000, 0);
  gl.setRenderTarget(passes.colour);
  gl.clear();
  gl.render(scene, low);
  scene.overrideMaterial = NORMAL_PASS;
  gl.setRenderTarget(passes.normal);
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
