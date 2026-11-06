/**
 * The brushes, the pen's pressure curve and the stabiliser. Pure apart from `pathFromOutline`, so `Temp/check-animate-brushes.cjs` can
 * prove the numbers.
 */
import { getStroke } from 'perfect-freehand';
import type { BrushId, StrokePoint } from './types';

export type BrushSettings = { size: number; opacity: number; stabiliser: number };

type BrushShape = {
  thinning: number;
  smoothing: number;
  streamline: number;
  /** A paper grain cut into the stroke. */
  grain: boolean;
  /** How far the edge is blurred, as a share of the size. */
  soft: number;
  erases: boolean;
  /** Draws on a Figure's Colour plane when picked. */
  colourPlane: boolean;
  /** A press rather than a line: the bucket. */
  press: boolean;
  /** Fills every area the stroke crosses, rather than laying a line. */
  areas: boolean;
};

const BASE: BrushShape = { thinning: 0.5, smoothing: 0.5, streamline: 0.4, grain: false, soft: 0, erases: false, colourPlane: false, press: false, areas: false };

export const BRUSH_SHAPES: Record<BrushId, BrushShape> = {
  pencil: { ...BASE, thinning: 0.65, smoothing: 0.45, streamline: 0.25, grain: true },
  ink: { ...BASE, thinning: 0.8, smoothing: 0.6, streamline: 0.45 },
  flat: { ...BASE, thinning: 0.15, smoothing: 0.5, streamline: 0.35, colourPlane: true },
  eraser: { ...BASE, thinning: 0.25, smoothing: 0.5, streamline: 0.3, soft: 0.12, erases: true },
  fill: { ...BASE, colourPlane: true, press: true },
  fillbrush: { ...BASE, thinning: 0, colourPlane: true, areas: true },
  filleraser: { ...BASE, thinning: 0, colourPlane: true, areas: true, erases: true },
};

export const BRUSH_LABELS: Record<BrushId, string> = {
  pencil: 'PENCIL',
  ink: 'INK',
  flat: 'FLAT',
  eraser: 'ERASER',
  fill: 'BUCKET',
  fillbrush: 'FILL BRUSH',
  filleraser: 'FILL ERASER',
};

export const DEFAULT_BRUSHES: Record<BrushId, BrushSettings> = {
  pencil: { size: 5, opacity: 0.95, stabiliser: 0.1 },
  ink: { size: 7, opacity: 1, stabiliser: 0.3 },
  flat: { size: 40, opacity: 1, stabiliser: 0.1 },
  eraser: { size: 30, opacity: 1, stabiliser: 0 },
  fill: { size: 1, opacity: 1, stabiliser: 0 },
  fillbrush: { size: 24, opacity: 1, stabiliser: 0 },
  filleraser: { size: 24, opacity: 1, stabiliser: 0 },
};

export const MAX_BRUSH_SIZE = 400;
export const MIN_BRUSH_SIZE = 1;

type OutlineInput = { brush: BrushId; size: number; points: StrokePoint[]; simulated?: boolean };

/** The filled shape of a stroke, as polygon points. `last` is false while the stroke is still being drawn. */
export function outlineOf(stroke: OutlineInput, last = true): number[][] {
  const shape = BRUSH_SHAPES[stroke.brush];
  return getStroke(stroke.points, {
    size: stroke.size,
    thinning: shape.thinning,
    smoothing: shape.smoothing,
    streamline: shape.streamline,
    simulatePressure: stroke.simulated === true,
    last,
  });
}

/** Smooth curves through the outline's points. */
export function pathFromOutline(outline: number[][]): Path2D {
  const path = new Path2D();
  if (outline.length < 3) return path;
  path.moveTo(outline[0][0], outline[0][1]);
  for (let i = 1; i < outline.length - 1; i += 1) {
    const [x, y] = outline[i];
    const [nx, ny] = outline[i + 1];
    path.quadraticCurveTo(x, y, (x + nx) / 2, (y + ny) / 2);
  }
  const [lx, ly] = outline[outline.length - 1];
  path.quadraticCurveTo(lx, ly, (lx + outline[0][0]) / 2, (ly + outline[0][1]) / 2);
  path.closePath();
  return path;
}

export type Rect = { x: number; y: number; w: number; h: number };

/** The whole-pixel box round these points, padded and kept on the sheet. Null when none of it is on the sheet. */
export function boundsOf(points: number[][], pad: number, width: number, height: number): Rect | null {
  if (points.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of points) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  const x = Math.max(0, Math.floor(minX - pad));
  const y = Math.max(0, Math.floor(minY - pad));
  const right = Math.min(width, Math.ceil(maxX + pad));
  const bottom = Math.min(height, Math.ceil(maxY + pad));
  if (right <= x || bottom <= y) return null;
  return { x, y, w: right - x, h: bottom - y };
}

export function unionRect(a: Rect | null, b: Rect | null): Rect | null {
  if (a === null) return b;
  if (b === null) return a;
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
}

// ── pressure ─────────────────────────────────────────────────────────────────────────────

/** A curve from (0,0) to (1,1) with two handles: x1, y1, x2, y2. The straight line is no change. */
export type PressureCurve = [number, number, number, number];
export const LINEAR_CURVE: PressureCurve = [0.25, 0.25, 0.75, 0.75];

/** What the pen's pressure becomes on this curve. */
export function applyCurve(pressure: number, curve: PressureCurve): number {
  const [x1, y1, x2, y2] = curve;
  const x = Math.min(1, Math.max(0, pressure));
  // Find the curve's t for this x by bisection: the handles are held to 0..1, so x(t) never turns back.
  let low = 0;
  let high = 1;
  for (let i = 0; i < 18; i += 1) {
    const t = (low + high) / 2;
    const u = 1 - t;
    const at = 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t;
    if (at < x) low = t;
    else high = t;
  }
  const t = (low + high) / 2;
  const u = 1 - t;
  return Math.min(1, Math.max(0, 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t));
}

/** A pen leaned over lays a wider line, as a pencil's side does. `tilt` is degrees off upright. */
export function tiltPressure(pressure: number, tilt: number): number {
  const lean = Math.min(1, Math.abs(tilt) / 60);
  return Math.min(1, pressure * (1 + lean * 0.6));
}

// ── stabiliser ───────────────────────────────────────────────────────────────────────────

/**
 * The line trails the pen and catches up, by a time constant rather than per point, so it feels the same at any pen rate. 0 is off; 1 is
 * about a fifth of a second of trail. The stroke ends where the pen did.
 */
export class Stabiliser {
  private x = 0;
  private y = 0;
  private p = 0;
  private t = 0;
  private started = false;
  private readonly tau: number;

  constructor(amount: number) {
    this.tau = Math.max(0, amount) * 200;
  }

  push(x: number, y: number, p: number, time: number): StrokePoint {
    if (!this.started || this.tau === 0) {
      this.started = true;
      this.x = x;
      this.y = y;
      this.p = p;
      this.t = time;
      return [x, y, p];
    }
    const dt = Math.max(0, time - this.t);
    this.t = time;
    const k = 1 - Math.exp(-dt / this.tau);
    this.x += (x - this.x) * k;
    this.y += (y - this.y) * k;
    this.p += (p - this.p) * k;
    return [this.x, this.y, this.p];
  }
}
