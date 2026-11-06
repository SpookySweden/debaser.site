/**
 * Lasso and rectangle select, with move, scale and rotate. Each drag is one operation (`MoveOp`) on the drawing's planes, so it can be undone and
 * replayed: there is no floating picture to lose. While dragging, a working copy of each plane shows the result in its true place.
 */
import { addActions } from './actions';
import { getEngine } from './engine';
import { copyRect, type PlanePatch } from './history';
import { planeKey } from './planes';
import { toolHandlers } from './pointer';
import { addOp } from './project';
import { useStudio } from './store';
import { SELECTION_INK } from './colours';
import { boundsOf, unionRect, type Rect } from './brushes';
import type { MoveOp, PlaneName, PlaneOp, Stroke } from './types';

type Matrix = MoveOp['matrix'];
type Point = [number, number];

const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];
const HANDLE_PX = 14;

type Gesture =
  | { kind: 'draw'; shape: 'lasso' | 'rect'; points: Point[] }
  | { kind: 'move'; start: Point; centre?: undefined }
  | { kind: 'scale'; anchor: Point; corner: Point }
  | { kind: 'rotate'; centre: Point; start: number };

let outline: Point[] | null = null;
let gesture: Gesture | null = null;
let matrix: Matrix = IDENTITY;
/** Which planes a drag is moving: their keys, the working copies shown instead of them, and the pictures before. */
let moving: { key: string; plane: PlaneName; drawingId: string; working: OffscreenCanvas; source: OffscreenCanvas }[] = [];

export function selectionOutline(): Point[] | null {
  return outline;
}

function bboxOf(points: Point[]): { x: number; y: number; w: number; h: number } {
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

function apply(m: Matrix, [x, y]: Point): Point {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

/** Is this point inside the shape? (Even-odd, as the shape is drawn.) */
export function pointInOutline(points: Point[], x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i, i += 1) {
    const [xi, yi] = points[i];
    const [xj, yj] = points[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function pathOf(points: Point[]): Path2D {
  const path = new Path2D();
  points.forEach(([x, y], i) => (i === 0 ? path.moveTo(x, y) : path.lineTo(x, y)));
  path.closePath();
  return path;
}

/** The move itself: what the shape held is lifted and put down through the matrix. All-zero scale simply removes it (Delete). */
export function paintMove(ctx: OffscreenCanvasRenderingContext2D, op: Pick<MoveOp, 'outline' | 'matrix'>): void {
  const { canvas } = ctx;
  const lifted = new OffscreenCanvas(canvas.width, canvas.height);
  const liftCtx = lifted.getContext('2d');
  if (liftCtx === null) return;
  const path = pathOf(op.outline);
  liftCtx.clip(path, 'evenodd');
  liftCtx.drawImage(canvas as OffscreenCanvas, 0, 0);
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'destination-out';
  ctx.fillStyle = '#000000';
  ctx.fill(path, 'evenodd');
  ctx.globalCompositeOperation = 'source-over';
  const [a, b, c, d, e, f] = op.matrix;
  if (a !== 0 || b !== 0 || c !== 0 || d !== 0) {
    ctx.setTransform(a, b, c, d, e, f);
    ctx.imageSmoothingEnabled = !(a === 1 && d === 1 && b === 0 && c === 0);
    ctx.drawImage(lifted, 0, 0);
  }
  ctx.restore();
}

function moveBounds(points: Point[], m: Matrix, width: number, height: number): Rect | null {
  return unionRect(boundsOf(points, 2, width, height), boundsOf(points.map((p) => apply(m, p)), 3, width, height));
}

/** What a selection would move on this frame: the current drawing, on a Figure both its planes. */
function targetPlanes(): { drawingId: string; planes: PlaneName[]; layerId: string } | null {
  const engine = getEngine();
  const node = engine.activeLayer;
  if (node === null || node.kind !== 'layer') return null;
  const cel = engine.celForDrawing(node);
  if (cel === null) return null;
  const drawing = engine.project.drawings[cel.drawingId];
  const planes = (['line', 'colour'] as PlaneName[]).filter((plane) => (drawing?.planes[plane].length ?? 0) > 0 && !node.planeLocked[plane]);
  return { drawingId: cel.drawingId, planes, layerId: node.id };
}

async function beginMoving(): Promise<boolean> {
  moving = [];
  const engine = getEngine();
  const target = targetPlanes();
  if (target === null || outline === null) return false;
  const refused = engine.refusal(engine.activeLayer, target.planes[0] ?? 'line');
  if (refused !== null) {
    engine.notify(refused, true);
    return false;
  }
  for (const plane of target.planes) {
    const key = planeKey(target.drawingId, plane);
    const source = await engine.planes.open(key);
    moving.push({ key, plane, drawingId: target.drawingId, source, working: new OffscreenCanvas(source.width, source.height) });
  }
  return moving.length > 0;
}

function previewMoving(): void {
  const engine = getEngine();
  if (outline === null) return;
  for (const item of moving) {
    const ctx = item.working.getContext('2d');
    if (ctx === null) continue;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, item.working.width, item.working.height);
    ctx.drawImage(item.source, 0, 0);
    paintMove(ctx, { outline, matrix });
  }
  engine.previewOverrides = new Map(moving.map((item) => [item.key, item.working]));
  engine.paintNow();
}

/** Lay the current drag on the planes as one undo step. */
function commitMove(label: string, m: Matrix): void {
  const engine = getEngine();
  engine.previewOverrides = null;
  if (outline === null || moving.length === 0) return;
  const shape = outline;
  const { project } = engine;
  const bounds = moveBounds(shape, m, project.width, project.height);
  const before = project;
  let after = project;
  const patches: PlanePatch[] = [];
  for (const item of moving) {
    const ctx = item.source.getContext('2d');
    if (ctx === null) continue;
    const op: MoveOp = { kind: 'move', id: `m_${Date.now().toString(36)}${item.plane}`, plane: item.plane, outline: shape, matrix: m };
    if (bounds !== null) {
      const copy = copyRect(item.source, bounds);
      paintMove(ctx, op);
      patches.push({ key: item.key, rect: bounds, before: copy, after: copyRect(item.source, bounds) });
    }
    engine.planes.markDirty(item.key);
    after = addOp(after, item.drawingId, item.plane, op);
  }
  moving = [];
  engine.pushStep(label, before, after, patches);
  engine.afterMove?.();
}

function isIdentity(m: Matrix): boolean {
  return Math.abs(m[0] - 1) < 1e-3 && Math.abs(m[3] - 1) < 1e-3 && Math.abs(m[1]) < 1e-3 && Math.abs(m[2]) < 1e-3 && Math.abs(m[4]) < 0.25 && Math.abs(m[5]) < 0.25;
}

/** Where a press lands on the selection: a corner handle, the turn handle above it, inside it, or nowhere. */
function hitSelection(x: number, y: number): Gesture | null {
  if (outline === null) return null;
  const engine = getEngine();
  const box = bboxOf(outline);
  const reach = HANDLE_PX / engine.view.zoom;
  const corners: Point[] = [
    [box.x, box.y],
    [box.x + box.w, box.y],
    [box.x + box.w, box.y + box.h],
    [box.x, box.y + box.h],
  ];
  for (let i = 0; i < 4; i += 1) {
    if (Math.hypot(corners[i][0] - x, corners[i][1] - y) <= reach) return { kind: 'scale', corner: corners[i], anchor: corners[(i + 2) % 4] };
  }
  const centre: Point = [box.x + box.w / 2, box.y + box.h / 2];
  const turn: Point = [centre[0], box.y - 3 * reach];
  if (Math.hypot(turn[0] - x, turn[1] - y) <= reach) return { kind: 'rotate', centre, start: Math.atan2(y - centre[1], x - centre[0]) };
  if (x >= box.x && x <= box.x + box.w && y >= box.y && y <= box.y + box.h) return { kind: 'move', start: [x, y] };
  return null;
}

function setOutline(next: Point[] | null): void {
  outline = next;
  useStudio.setState({ hasSelection: next !== null, selectedStrokes: next === null ? 0 : selectedStrokeIds().length });
  getEngine().paintUi();
}

export function clearSelection(): void {
  setOutline(null);
}

/** Strokes on this drawing with most of their points inside the selection. */
export function selectedStrokeIds(): string[] {
  if (outline === null) return [];
  const engine = getEngine();
  const node = engine.activeLayer;
  if (node === null || node.kind !== 'layer') return [];
  const cel = engine.celForDrawing(node);
  if (cel === null) return [];
  const drawing = engine.project.drawings[cel.drawingId];
  if (drawing === undefined) return [];
  const out: string[] = [];
  const shape = outline;
  const count = (ops: PlaneOp[]) => {
    for (const op of ops) {
      if (op.kind !== 'stroke') continue;
      const inside = (op as Stroke).points.filter((p) => pointInOutline(shape, p[0], p[1])).length;
      if (inside * 2 > op.points.length) out.push(op.id);
    }
  };
  count(drawing.planes.colour);
  count(drawing.planes.line);
  return out;
}

/** Take what's selected out of the drawing. */
export function deleteSelected(): void {
  if (outline === null) return;
  void beginMoving().then((ready) => {
    if (ready) commitMove('DELETE SELECTION', [0, 0, 0, 0, 0, 0]);
  });
}

function matrixFor(g: Gesture, x: number, y: number): Matrix {
  if (g.kind === 'move') return [1, 0, 0, 1, x - g.start[0], y - g.start[1]];
  if (g.kind === 'scale') {
    const [ax, ay] = g.anchor;
    const fromX = g.corner[0] - ax;
    const fromY = g.corner[1] - ay;
    const sx = fromX === 0 ? 1 : (x - ax) / fromX;
    const sy = fromY === 0 ? 1 : (y - ay) / fromY;
    // Stopped short of nothing: a selection can't be scaled to zero or through itself by accident.
    const safeX = Math.abs(sx) < 0.02 ? 0.02 : sx;
    const safeY = Math.abs(sy) < 0.02 ? 0.02 : sy;
    return [safeX, 0, 0, safeY, ax - safeX * ax, ay - safeY * ay];
  }
  if (g.kind === 'rotate') {
    const angle = Math.atan2(y - g.centre[1], x - g.centre[0]) - g.start;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const [cx, cy] = g.centre;
    return [cos, sin, -sin, cos, cx - cos * cx + sin * cy, cy - sin * cx - cos * cy];
  }
  return IDENTITY;
}

const handlers = (shape: 'lasso' | 'rect') => ({
  penDown: (x: number, y: number) => {
    const hit = hitSelection(x, y);
    if (hit !== null) {
      gesture = hit;
      matrix = IDENTITY;
      void beginMoving().then((ready) => {
        if (!ready) gesture = null;
      });
      return true;
    }
    gesture = { kind: 'draw', shape, points: [[x, y]] };
    setOutline(null);
    return true;
  },
  penMove: (x: number, y: number) => {
    if (gesture === null) return;
    if (gesture.kind === 'draw') {
      if (gesture.shape === 'lasso') gesture.points.push([x, y]);
      else gesture.points = [gesture.points[0], [x, y]];
      getEngine().paintUi();
      return;
    }
    matrix = matrixFor(gesture, x, y);
    if (moving.length > 0) previewMoving();
  },
  penUp: () => {
    const g = gesture;
    gesture = null;
    if (g === null) return;
    if (g.kind === 'draw') {
      let points = g.points;
      if (g.shape === 'rect' && points.length === 2) {
        const [[x0, y0], [x1, y1]] = points;
        points = [
          [x0, y0],
          [x1, y0],
          [x1, y1],
          [x0, y1],
        ];
      }
      const box = bboxOf(points);
      setOutline(points.length >= 3 && box.w > 1 && box.h > 1 ? points : null);
      return;
    }
    const engine = getEngine();
    const m = matrix;
    matrix = IDENTITY;
    if (isIdentity(m) || outline === null) {
      engine.previewOverrides = null;
      moving = [];
      engine.invalidate();
      return;
    }
    if (moving.length === 0) return;
    const moved = outline.map((p) => apply(m, p));
    commitMove(g.kind === 'move' ? 'MOVE' : g.kind === 'scale' ? 'SCALE' : 'TURN', m);
    setOutline(moved);
  },
  penCancel: () => {
    gesture = null;
    matrix = IDENTITY;
    moving = [];
    getEngine().previewOverrides = null;
    getEngine().invalidate();
  },
});

function paintSelection(ctx: CanvasRenderingContext2D): void {
  const engine = getEngine();
  const drawn: Point[] | null = gesture?.kind === 'draw' ? gesture.points : outline;
  if (drawn === null || drawn.length < 2) return;
  const shown = gesture !== null && gesture.kind !== 'draw' ? drawn.map((p) => apply(matrix, p)) : drawn;
  const { zoom } = engine.view;
  const line = 1.5 / zoom;
  const rectPreview = gesture?.kind === 'draw' && gesture.shape === 'rect' && drawn.length === 2;
  const points: Point[] = rectPreview ? [drawn[0], [drawn[1][0], drawn[0][1]], drawn[1], [drawn[0][0], drawn[1][1]]] : shown;
  const path = pathOf(points);
  ctx.lineWidth = line;
  ctx.setLineDash([]);
  ctx.strokeStyle = '#ffffff';
  ctx.stroke(path);
  ctx.setLineDash([6 / zoom, 4 / zoom]);
  ctx.strokeStyle = SELECTION_INK;
  ctx.stroke(path);
  ctx.setLineDash([]);
  if (gesture?.kind === 'draw' || outline === null) return;
  const box = bboxOf(points);
  const size = HANDLE_PX / zoom;
  const turnY = box.y - (3 * HANDLE_PX) / zoom;
  ctx.strokeStyle = SELECTION_INK;
  ctx.beginPath();
  ctx.moveTo(box.x + box.w / 2, box.y);
  ctx.lineTo(box.x + box.w / 2, turnY);
  ctx.stroke();
  const handleAt = (x: number, y: number) => {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(x - size / 2, y - size / 2, size, size);
    ctx.strokeStyle = SELECTION_INK;
    ctx.strokeRect(x - size / 2, y - size / 2, size, size);
  };
  handleAt(box.x, box.y);
  handleAt(box.x + box.w, box.y);
  handleAt(box.x + box.w, box.y + box.h);
  handleAt(box.x, box.y + box.h);
  handleAt(box.x + box.w / 2, turnY);
}

let installed = false;

/** Tell the engine about selections: called once when the studio opens. */
export function installSelection(): void {
  if (installed) return;
  installed = true;
  const engine = getEngine();
  toolHandlers.set('lasso', handlers('lasso'));
  toolHandlers.set('rect', handlers('rect'));
  engine.uiPainters.push(paintSelection);
  engine.opPainters.move = (ctx, op) => {
    if (op.kind === 'move') paintMove(ctx, op);
  };
  // A selection belongs to one drawing: going elsewhere lets it go.
  engine.onProjectSwap.push(() => {
    outline = null;
  });
  useStudio.subscribe((state, previous) => {
    if (outline !== null && (state.frame !== previous.frame || state.layerId !== previous.layerId)) setOutline(null);
  });
}

addActions([
  { id: 'tool.lasso', label: 'LASSO SELECT', group: 'TOOLS', key: 'w', run: () => getEngine().setTool('lasso') },
  { id: 'tool.rect', label: 'BOX SELECT', group: 'TOOLS', key: 'shift+w', run: () => getEngine().setTool('rect') },
  { id: 'select.none', label: 'SELECT NOTHING', group: 'TOOLS', key: 'ctrl+d', run: clearSelection },
  { id: 'select.delete', label: 'DELETE WHAT IS SELECTED', group: 'TOOLS', key: 'backspace', run: deleteSelected },
]);

