/**
 * Laying an operation on a plane's picture. The same code draws the live stroke and the finished one, so what you see while drawing is
 * what lands.
 */
import { BRUSH_SHAPES, boundsOf, outlineOf, pathFromOutline, type Rect } from './brushes';
import type { Stroke } from './types';

export type Ctx = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;

/** A mask: colour lands only where this picture has pixels. `x`, `y` place it on the sheet. */
export type PaintMask = { canvas: OffscreenCanvas; x: number; y: number };

const GRAIN_TILE = 128;
const grainCache = new Map<string, OffscreenCanvas>();

/** The pencil's grain, a repeating tile. A seeded pattern, so a stroke replayed from its data comes out the same. */
function grainTile(colour: string): OffscreenCanvas {
  const cached = grainCache.get(colour);
  if (cached !== undefined) return cached;
  const tile = new OffscreenCanvas(GRAIN_TILE, GRAIN_TILE);
  const ctx = tile.getContext('2d');
  if (ctx === null) return tile;
  const n = parseInt(colour.replace('#', ''), 16);
  const image = ctx.createImageData(GRAIN_TILE, GRAIN_TILE);
  let seed = 90210;
  for (let i = 0; i < image.data.length; i += 4) {
    seed = (seed * 16807) % 2147483647;
    const noise = (seed & 255) / 255;
    image.data[i] = (n >> 16) & 255;
    image.data[i + 1] = (n >> 8) & 255;
    image.data[i + 2] = n & 255;
    image.data[i + 3] = Math.round(255 * (0.45 + 0.55 * noise));
  }
  ctx.putImageData(image, 0, 0);
  grainCache.set(colour, tile);
  return tile;
}

/** How far a stroke's mark can reach past its outline. */
export function strokePad(stroke: Pick<Stroke, 'brush' | 'size'>): number {
  return 2 + Math.ceil(stroke.size * BRUSH_SHAPES[stroke.brush].soft * 2);
}

export function strokeBounds(stroke: Stroke, width: number, height: number): Rect | null {
  return boundsOf(outlineOf(stroke), strokePad(stroke), width, height);
}

type StrokeShape = Pick<Stroke, 'brush' | 'size' | 'colour' | 'opacity' | 'points' | 'simulated'>;

/**
 * Fill a stroke's shape, in the context's own coordinates. The erasing brushes cut, unless `solid` asks for the shape itself, which is
 * how an eraser is kept inside a mask: its shape is built solid, masked, and only then cut.
 */
export function fillStroke(ctx: Ctx, stroke: StrokeShape, options: { last?: boolean; solid?: boolean } = {}): void {
  const outline = outlineOf(stroke, options.last ?? true);
  if (outline.length < 3) return;
  const path = pathFromOutline(outline);
  const shape = BRUSH_SHAPES[stroke.brush];
  const cuts = shape.erases && options.solid !== true;
  ctx.save();
  ctx.globalAlpha = stroke.opacity;
  ctx.globalCompositeOperation = cuts ? 'destination-out' : 'source-over';
  if (shape.soft > 0) ctx.filter = `blur(${Math.max(0.5, stroke.size * shape.soft)}px)`;
  if (shape.grain) {
    ctx.fillStyle = ctx.createPattern(grainTile(stroke.colour), 'repeat') ?? stroke.colour;
  } else {
    ctx.fillStyle = shape.erases ? '#000000' : stroke.colour;
  }
  ctx.fill(path);
  ctx.restore();
}

let scratch: OffscreenCanvas | null = null;

function scratchFor(w: number, h: number): OffscreenCanvasRenderingContext2D | null {
  if (scratch === null || scratch.width < w || scratch.height < h) {
    scratch = new OffscreenCanvas(Math.max(w, scratch?.width ?? 0), Math.max(h, scratch?.height ?? 0));
  }
  const ctx = scratch.getContext('2d');
  if (ctx === null) return null;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
  ctx.clearRect(0, 0, w, h);
  return ctx;
}

/** A stroke onto a plane, through a mask if it has one. */
export function paintStroke(ctx: OffscreenCanvasRenderingContext2D, stroke: Stroke, bounds: Rect, mask: PaintMask | null): void {
  if (mask === null) {
    fillStroke(ctx, stroke);
    return;
  }
  const temp = scratchFor(bounds.w, bounds.h);
  if (temp === null || scratch === null) return;
  temp.translate(-bounds.x, -bounds.y);
  fillStroke(temp, { ...stroke, opacity: 1 }, { solid: true });
  temp.globalCompositeOperation = 'destination-in';
  temp.drawImage(mask.canvas, mask.x, mask.y);
  temp.setTransform(1, 0, 0, 1, 0, 0);
  ctx.save();
  ctx.globalAlpha = stroke.opacity;
  ctx.globalCompositeOperation = BRUSH_SHAPES[stroke.brush].erases ? 'destination-out' : 'source-over';
  ctx.drawImage(scratch, 0, 0, bounds.w, bounds.h, bounds.x, bounds.y, bounds.w, bounds.h);
  ctx.restore();
}

/** A region's picture laid down (a fill), or taken away (`clear`). */
export function paintMaskFill(ctx: OffscreenCanvasRenderingContext2D, colour: string, mask: PaintMask, clear: boolean): void {
  const temp = scratchFor(mask.canvas.width, mask.canvas.height);
  if (temp === null || scratch === null) return;
  temp.drawImage(mask.canvas, 0, 0);
  temp.globalCompositeOperation = 'source-in';
  temp.fillStyle = colour;
  temp.fillRect(0, 0, mask.canvas.width, mask.canvas.height);
  ctx.save();
  ctx.globalCompositeOperation = clear ? 'destination-out' : 'source-over';
  ctx.drawImage(scratch, 0, 0, mask.canvas.width, mask.canvas.height, mask.x, mask.y, mask.canvas.width, mask.canvas.height);
  ctx.restore();
}
