/**
 * The numbers behind the workbench's live pixel render, kept apart from the scene so a check can hold them in Node.
 *
 * The render is the Dead Cells one (Thomas Vasseur, "Art Design Deep Dive: Using a 3D pipeline for 2D animation in
 * Dead Cells", 2018): the figure is drawn **tiny, with anti-aliasing off**, once as flat colours and once as a normal
 * map, and a cel shader lights the colours from the normals in hard bands. The pixel look comes from the tiny size,
 * not from a filter applied afterwards. See `CharacterPixelRender.tsx` for the passes.
 *
 * What lives here: how big a low-res pixel is, how the light steps on the d-pad, the shading bands, and which layers
 * are on when the workbench opens.
 */

/** How many low-res pixels tall the tallest preset is, at most. Chunkier than Dead Cells' 50, on purpose. */
export const FIGURE_ROWS = 30;

/**
 * The tallest preset, crown to sole, in model units (GUY). Measured from the real geometry by
 * `Temp/check-character-pixel.cjs`, which fails if a preset ever grows past it.
 */
export const TALLEST_PRESET = 2.08;

/**
 * How a view's drawing buffer is cut into low-res pixels.
 *
 *   block   one low-res pixel, in device pixels - a whole number, so every block on screen is the same size
 *   width   the low-res target, in low-res pixels; `width * block` covers the buffer (the last column may overhang)
 *   height  likewise
 *
 * The block follows the camera's zoom (pixels per model unit), so the figure is the same number of low-res pixels
 * tall whatever the pane's size: `TALLEST_PRESET` units span at most `FIGURE_ROWS` blocks. Rounded *up*, so the
 * figure is never taller than that. With PIXELATE off a block is one device pixel: the same passes at full size.
 *
 * With 50 PX on (`fine`) the block follows the pane instead: its longer side is about `PANEL_PIXELS` blocks, so the
 * figure gets finer pixels and more of them. Rounded to the nearest whole block, so "about" is a few either way.
 */
export type PixelGrid = { block: number; width: number; height: number };

/** With 50 PX on, how many low-res pixels a view's longer side holds - about; see `pixelGrid`. */
export const PANEL_PIXELS = 50;

export function pixelGrid(
  bufferWidth: number,
  bufferHeight: number,
  zoom: number,
  devicePixelRatio: number,
  pixelate: boolean,
  fine = false,
): PixelGrid {
  const block = !pixelate
    ? 1
    : fine
      ? Math.max(1, Math.round(Math.max(bufferWidth, bufferHeight) / PANEL_PIXELS))
      : Math.max(1, Math.ceil((zoom * devicePixelRatio * TALLEST_PRESET) / FIGURE_ROWS));
  return {
    block,
    width: Math.max(1, Math.ceil(bufferWidth / block)),
    height: Math.max(1, Math.ceil(bufferHeight / block)),
  };
}

/**
 * The low-res camera's edges, for a view camera with edges `view` (in CSS pixels, as R3F sets them) and `zoom`.
 *
 * The same view, widened so the target's whole number of blocks starts at the view's bottom-left corner: low-res pixel
 * (i, j) lands exactly on device pixels [i * block, (i + 1) * block). **Returned in model units, for a zoom of 1**,
 * because three divides an orthographic camera's *width* by its zoom but not its *centre* - an off-centre frustum
 * written in pixels lands units away from the figure, and the passes come out empty. That happened; the check now
 * builds both cameras and measures where each low-res pixel falls.
 */
export function lowResFrustum(
  view: { left: number; bottom: number; zoom: number },
  grid: PixelGrid,
  devicePixelRatio: number,
): { left: number; right: number; bottom: number; top: number } {
  return {
    left: view.left / view.zoom,
    right: (view.left + (grid.width * grid.block) / devicePixelRatio) / view.zoom,
    bottom: view.bottom / view.zoom,
    top: (view.bottom + (grid.height * grid.block) / devicePixelRatio) / view.zoom,
  };
}

/** Where the light sits, in radians: round the figure (0 is straight in front) and up from level. */
export type LightAngles = { azimuth: number; elevation: number };

/** One press of the d-pad's left or right turns the light this far round the figure. */
export const LIGHT_TURN_STEP = Math.PI / 4;
/** One press of up or down raises or lowers it this far. */
export const LIGHT_RAISE_STEP = Math.PI / 6;
/** The light stops this high (and this low): two steps short of straight up, so it always has a side to light. */
export const LIGHT_HIGHEST = Math.PI / 3;

/**
 * Front-left and a little above. On the step grid (one turn left, one raise up), so the d-pad's steps land on the
 * same angles from here as they do after a reset.
 */
export const DEFAULT_LIGHT: LightAngles = { azimuth: -LIGHT_TURN_STEP, elevation: LIGHT_RAISE_STEP };

export type LightStep = 'left' | 'right' | 'up' | 'down';

/** Within (-pi, pi], so a light walked all the way round reads the same angle it started at. */
function wrapAngle(angle: number): number {
  let wrapped = angle;
  while (wrapped > Math.PI + 1e-9) wrapped -= 2 * Math.PI;
  while (wrapped <= -Math.PI + 1e-9) wrapped += 2 * Math.PI;
  return wrapped;
}

/**
 * One d-pad press. LEFT moves the light towards the front view's left (the reader's left, looking at the figure);
 * UP raises it. Each step starts from the nearest grid angle, so an angle from an older saved bench snaps onto the
 * grid rather than walking an odd offset round forever.
 */
export function stepLight(light: LightAngles, step: LightStep): LightAngles {
  const turn = Math.round(light.azimuth / LIGHT_TURN_STEP) * LIGHT_TURN_STEP;
  const raise = Math.round(light.elevation / LIGHT_RAISE_STEP) * LIGHT_RAISE_STEP;
  switch (step) {
    case 'left':
      return { azimuth: wrapAngle(turn - LIGHT_TURN_STEP), elevation: light.elevation };
    case 'right':
      return { azimuth: wrapAngle(turn + LIGHT_TURN_STEP), elevation: light.elevation };
    case 'up':
      return { azimuth: light.azimuth, elevation: Math.min(LIGHT_HIGHEST, raise + LIGHT_RAISE_STEP) };
    case 'down':
      return { azimuth: light.azimuth, elevation: Math.max(-LIGHT_HIGHEST, raise - LIGHT_RAISE_STEP) };
  }
}

/** The direction the light comes from, in the world: x across (right), y up, z forward (towards the front view). */
export function lightDirection(light: LightAngles): { x: number; y: number; z: number } {
  return {
    x: Math.sin(light.azimuth) * Math.cos(light.elevation),
    y: Math.sin(light.elevation),
    z: Math.cos(light.azimuth) * Math.cos(light.elevation),
  };
}

/**
 * The cel shader's three bands. `amount` is how squarely a pixel faces the light (`dot(normal, light)`, 0 to 1) and
 * it is snapped, never blended: LIT from `LIT_FROM` up, MID from `MID_FROM` up, SHADOW below. SHADOW is the ambient
 * level, so a pixel facing away is darker but never black - and with the LIGHT off, every pixel is SHADOW.
 */
export const CEL_BANDS = { lit: 1, mid: 0.78, shadow: 0.55 } as const;
export const LIT_FROM = 0.5;
export const MID_FROM = 0.15;

/** The band a pixel lands in - the shader's rule, written once more here so a check can hold it. */
export function celBand(amount: number): number {
  if (amount >= LIT_FROM) return CEL_BANDS.lit;
  if (amount >= MID_FROM) return CEL_BANDS.mid;
  return CEL_BANDS.shadow;
}

/**
 * The LAYERS switches above the views.
 *
 *   pixelate     off: the same passes at full resolution (smooth edges, same banded light)
 *   fine         50 PX, on: finer pixels, about `PANEL_PIXELS` on each view's longer side (only while PIXELATE is on)
 *   normalLight  off: flat colours, no shading at all
 *   normalMap    on: show the normal pass itself, the image the light reads, instead of the lit colours
 */
export type LayerId = 'pixelate' | 'fine' | 'normalLight' | 'normalMap';

export const LAYER_IDS: readonly LayerId[] = ['pixelate', 'fine', 'normalLight', 'normalMap'];

export const DEFAULT_LAYERS: Readonly<Record<LayerId, boolean>> = {
  pixelate: true,
  fine: false,
  normalLight: true,
  normalMap: false,
};

/**
 * A switch with nothing to change rests (greyed out, keeping its value): NORMAL LIGHT while the normal map is shown,
 * 50 PX while PIXELATE is off.
 */
export function layerRests(id: LayerId, layers: Readonly<Record<LayerId, boolean>>): boolean {
  return (id === 'normalLight' && layers.normalMap) || (id === 'fine' && !layers.pixelate);
}

/** What the light pass draws, from the switches: one answer, so the shader never has to weigh two flags. */
export type ShadeMode = 'normals' | 'flat' | 'lit';

export function shadeMode(layers: Readonly<Record<LayerId, boolean>>): ShadeMode {
  if (layers.normalMap) return 'normals';
  return layers.normalLight ? 'lit' : 'flat';
}
