/**
 * Smart Figure: colour under line art, without leaks (the plan's pipeline). The region worker reads the lines whenever they change; a colour
 * stroke is held to the area its first point lands in, tucked under the line, and remembers that it was. Change the lines later and smart strokes
 * are laid down again to the new areas; raw strokes stay exactly as drawn.
 */
import { addActions, type Action } from './actions';
import { boundsOf, unionRect, type Rect } from './brushes';
import { CLOSURE_COLOUR, FILL_PREVIEW } from './colours';
import { getEngine } from './engine';
import { copyRect, restoreRect, type PlanePatch } from './history';
import { paintMaskFill, type PaintMask } from './paint';
import { planeKey } from './planes';
import { toolHandlers } from './pointer';
import { addDrawing, addOp, celAt, findNode, isShown, setOps } from './project';
import { regionMaskPixels, type RegionMap } from './regions-core';
import { selectedStrokeIds } from './selection';
import { useStudio } from './store';
import { isFigure, liveBehaviours, smartsForStroke, tagBehaviours } from './tags';
import type { FillOp, LayerNode, PlaneName, PlaneOp, Project, Stroke } from './types';
import { startWorker } from './workers';

const MAPS_KEPT = 8;
const MASKS_KEPT = 16;

type MapEntry = { key: string; map: RegionMap };

const maps: MapEntry[] = [];
const masks = new Map<string, PaintMask>();
const waiting = new Map<string, ((map: RegionMap | null) => void)[]>();
type MapJob = {
  key: string;
  /** Which lines were read, whatever the gap: this is what says the lines have changed. */
  linesKey: string;
  drawingId: string | null;
  projectId: string;
  gap: number;
  /** The gap this layer has with its smarts on. Only a reading at this gap may move colour: tapping Q reads at no gap, and moves nothing. */
  smartGap: number;
  plane: PlaneName;
};
const pendingJobs = new Map<number, MapJob>();
let worker: Worker | null = null;
let nextJob = 1;
/** What a re-laying pass reads from. */
let replayMap: { key: string; map: RegionMap } | null = null;
let replayBelow: OffscreenCanvas | null = null;
/** The drawing each region map was last laid to, so a change of lines is noticed. */
const laidWith = new Map<string, string>();
/** Drawings re-laid since their undo patches were made: an undo there has to re-lay too. */
const relaid = new Set<string>();
/** Re-lays that came while a stroke or an undo was under way, to run as soon as it's done. */
const relaysWaiting = new Map<string, { plane: PlaneName; entry: MapEntry }>();

function regionWorker(): Worker | null {
  if (worker !== null) return worker;
  worker = startWorker('regions');
  if (worker !== null) {
    worker.onmessage = (event: MessageEvent<{ id: number; map?: RegionMap; error?: string }>) => {
      const job = pendingJobs.get(event.data.id);
      pendingJobs.delete(event.data.id);
      if (job === undefined) return;
      const map = event.data.map ?? null;
      if (map !== null) remember(job.key, map);
      for (const told of waiting.get(job.key) ?? []) told(map);
      waiting.delete(job.key);
      if (map !== null) afterMap(job, map);
    };
    worker.onerror = () => {
      for (const list of waiting.values()) for (const told of list) told(null);
      waiting.clear();
      pendingJobs.clear();
      worker?.terminate();
      worker = null;
    };
  }
  return worker;
}

function remember(key: string, map: RegionMap): void {
  maps.push({ key, map });
  while (maps.length > MAPS_KEPT) {
    const gone = maps.shift();
    if (gone === undefined) break;
    for (const mask of masks.keys()) if (mask.startsWith(`${gone.key}#`)) masks.delete(mask);
  }
}

function celFor(project: Project, node: LayerNode, frame: number) {
  return tagBehaviours(project, node)?.holdWholeShot === true ? (node.cels[0] ?? null) : celAt(node, frame);
}

/**
 * Which planes' pixels bound this layer's fills on this frame. A Figure's own lines; another layer's own pixels; a Shade reads the Figure
 * under it. Any layer marked as a fill reference adds its lines to all of those, and one marked Ignored never does.
 */
export function regionSources(project: Project, node: LayerNode, frame: number): string[] {
  const keys: string[] = [];
  const add = (other: LayerNode) => {
    const cel = celFor(project, other, frame);
    if (cel !== null) keys.push(planeKey(cel.drawingId, 'line'));
  };
  const behaviours = tagBehaviours(project, node);
  const figure = isFigure(project, node);
  // A layer that keeps inside someone else's lines doesn't read its own pixels: its own strokes aren't walls for it.
  if (figure || (behaviours?.ignoredByFills !== true && behaviours?.stayInsideLines !== true)) add(node);
  if (behaviours?.stayInsideLines === true && !figure) {
    const at = project.nodes.indexOf(node);
    const below = project.nodes.slice(at + 1).find((other) => other.kind === 'layer' && isFigure(project, other));
    if (below !== undefined) add(below);
  }
  for (const other of project.nodes) {
    if (other.id === node.id || other.kind !== 'layer') continue;
    const tag = tagBehaviours(project, other);
    if (tag?.isFillReference === true && tag.ignoredByFills !== true && isShown(project, other)) add(other);
  }
  return [...new Set(keys)];
}

function gapFor(project: Project, node: LayerNode, smartOn: boolean): number {
  const live = liveBehaviours(project, node, smartOn);
  return live?.closeGaps.on === true ? live.closeGaps.maxGapPx : 0;
}

function mapKeyFor(project: Project, node: LayerNode, frame: number, gap: number): { key: string; linesKey: string; sources: string[] } {
  const engine = getEngine();
  const sources = regionSources(project, node, frame);
  const parts = sources.filter((key) => {
    const [drawingId, plane] = key.split('.') as [string, PlaneName];
    return (project.drawings[drawingId]?.planes[plane].length ?? 0) > 0;
  });
  const linesKey = parts.map((key) => `${key}@${engine.planes.version(key)}`).join(',');
  return { key: `${project.id}|${gap}|${linesKey}`, linesKey, sources: parts };
}

/** The map for here and now, if it's ready. */
function readyMap(node: LayerNode): MapEntry | null {
  const state = useStudio.getState();
  const { key } = mapKeyFor(state.project, node, state.frame, gapFor(state.project, node, state.smartOn));
  return maps.find((entry) => entry.key === key) ?? null;
}

/**
 * Read the lines for this layer and frame, unless they've been read already. The answer arrives when it arrives. The key is settled here, before
 * any waiting, so an answer can never be filed under the frame the person has since moved to.
 */
function readMap(node: LayerNode, frame: number, gap: number): Promise<MapEntry | null> {
  const { project } = useStudio.getState();
  const { key, linesKey, sources } = mapKeyFor(project, node, frame, gap);
  const found = maps.find((entry) => entry.key === key);
  if (found !== undefined) return Promise.resolve(found);
  return new Promise<RegionMap | null>((resolve) => {
    const list = waiting.get(key);
    if (list !== undefined) {
      list.push(resolve);
      return;
    }
    waiting.set(key, [resolve]);
    const w = regionWorker();
    if (w === null) {
      waiting.delete(key);
      resolve(null);
      return;
    }
    const engine = getEngine();
    const cel = celFor(project, node, frame);
    const id = nextJob;
    nextJob += 1;
    pendingJobs.set(id, {
      key,
      linesKey,
      drawingId: cel?.drawingId ?? null,
      projectId: project.id,
      gap,
      smartGap: gapFor(project, node, true),
      plane: isFigure(project, node) ? 'colour' : 'line',
    });
    void (async () => {
      const pictures: ImageBitmap[] = [];
      try {
        for (const source of sources) pictures.push(await createImageBitmap(await engine.planes.open(source)));
        w.postMessage({ id, width: project.width, height: project.height, maxGap: gap, pictures }, pictures);
      } catch {
        // Nothing could be read. Whoever was waiting hears so, or a stroke waiting on this would never land.
        for (const picture of pictures) picture.close();
        pendingJobs.delete(id);
        for (const told of waiting.get(key) ?? []) told(null);
        waiting.delete(key);
      }
    })();
  }).then((map) => (map === null ? null : { key, map }));
}

function labelAt(map: RegionMap, x: number, y: number): number {
  const px = Math.max(0, Math.min(map.width - 1, Math.round(x)));
  const py = Math.max(0, Math.min(map.height - 1, Math.round(y)));
  return map.labels[py * map.width + px];
}

function maskOf(mapKey: string, map: RegionMap, region: number, tuck: boolean): PaintMask | null {
  const key = `${mapKey}#${region}#${tuck ? 1 : 0}`;
  const cached = masks.get(key);
  if (cached !== undefined) {
    masks.delete(key);
    masks.set(key, cached);
    return cached;
  }
  const pixels = regionMaskPixels(map, region, tuck);
  if (pixels === null) return null;
  const canvas = new OffscreenCanvas(pixels.w, pixels.h);
  canvas.getContext('2d')?.putImageData(new ImageData(pixels.rgba, pixels.w, pixels.h), 0, 0);
  const mask = { canvas, x: pixels.x, y: pixels.y };
  masks.set(key, mask);
  if (masks.size > MASKS_KEPT) {
    const oldest = masks.keys().next().value;
    if (oldest !== undefined) masks.delete(oldest);
  }
  return mask;
}

// ── what strokes are held to ─────────────────────────────────────────────────────────────

/** A stroke, its smarts and its layer: is it one that keeps inside the lines? */
function clipsStroke(stroke: Pick<Stroke, 'smartAtDrawTime' | 'plane'>, figure: boolean): boolean {
  return stroke.smartAtDrawTime.includes('stayInsideLines') && !(figure && stroke.plane === 'line');
}

function maskForStroke(stroke: Stroke, entry: MapEntry, x: number, y: number): PaintMask | null {
  const region = labelAt(entry.map, x, y);
  stroke.regionId = region;
  return maskOf(entry.key, entry.map, region, stroke.smartAtDrawTime.includes('tuckUnder'));
}

/** The layer this one sits on: the next drawable row down that's showing. */
function layerBelow(project: Project, node: LayerNode): LayerNode | null {
  const at = project.nodes.findIndex((n) => n.id === node.id);
  return project.nodes.slice(at + 1).find((n) => n.kind === 'layer' && isShown(project, n)) ?? null;
}

/** Everything the layer below has on this frame, as a mask. Null when nothing there is drawn yet: nothing can land. */
async function belowMask(project: Project, node: LayerNode, frame: number): Promise<OffscreenCanvas | null> {
  const below = layerBelow(project, node);
  if (below === null) return null;
  const cel = celFor(project, below, frame);
  if (cel === null) return null;
  const engine = getEngine();
  const out = new OffscreenCanvas(project.width, project.height);
  const ctx = out.getContext('2d');
  if (ctx === null) return null;
  for (const plane of ['colour', 'line'] as PlaneName[]) {
    if ((project.drawings[cel.drawingId]?.planes[plane].length ?? 0) > 0) ctx.drawImage(await engine.planes.open(planeKey(cel.drawingId, plane)), 0, 0);
  }
  return out;
}

/** A stroke's mask cut down to the layer below. With no region mask, it's the layer below alone. */
function cutToBelow(mask: PaintMask | null, below: OffscreenCanvas | null): PaintMask {
  const out = new OffscreenCanvas(below?.width ?? 1, below?.height ?? 1);
  const ctx = out.getContext('2d');
  if (ctx !== null && below !== null) {
    if (mask === null) {
      ctx.drawImage(below, 0, 0);
    } else {
      ctx.drawImage(mask.canvas, mask.x, mask.y);
      ctx.globalCompositeOperation = 'destination-in';
      ctx.drawImage(below, 0, 0);
    }
  }
  return { canvas: out, x: 0, y: 0 };
}

/** A re-lay's mask for an operation: where it's seeded, on the map being laid to, and cut to the layer below if it remembers that. */
function replayMask(op: PlaneOp): PaintMask | null {
  if (replayMap === null) return null;
  if (op.kind !== 'stroke' && op.kind !== 'fill') return null;
  const [x, y] = op.kind === 'stroke' ? op.points[0] : op.seed;
  const inside = op.smartAtDrawTime.includes('stayInsideLines') ? maskOf(replayMap.key, replayMap.map, labelAt(replayMap.map, x, y), op.smartAtDrawTime.includes('tuckUnder')) : null;
  if (op.smartAtDrawTime.includes('clipToLayerBelow') && replayBelow !== null) return cutToBelow(inside, replayBelow);
  return inside;
}

/** A raw fill keeps the exact shape it filled: smarts off means it never moves. */
function runsMask(runs: number[]): PaintMask | null {
  if (runs.length < 3) return null;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < runs.length; i += 3) {
    minY = Math.min(minY, runs[i]);
    maxY = Math.max(maxY, runs[i]);
    minX = Math.min(minX, runs[i + 1]);
    maxX = Math.max(maxX, runs[i + 2]);
  }
  const canvas = new OffscreenCanvas(maxX - minX + 1, maxY - minY + 1);
  const ctx = canvas.getContext('2d');
  if (ctx === null) return null;
  ctx.fillStyle = '#000000';
  for (let i = 0; i < runs.length; i += 3) ctx.fillRect(runs[i + 1] - minX, runs[i] - minY, runs[i + 2] - runs[i + 1] + 1, 1);
  return { canvas, x: minX, y: minY };
}

function runsOfRegion(map: RegionMap, region: number): number[] {
  const runs: number[] = [];
  const pixels = regionMaskPixels(map, region, false);
  if (pixels === null) return runs;
  for (let y = 0; y < pixels.h; y += 1) {
    let start = -1;
    for (let x = 0; x <= pixels.w; x += 1) {
      const on = x < pixels.w && pixels.rgba[(y * pixels.w + x) * 4 + 3] !== 0;
      if (on && start < 0) start = x;
      if (!on && start >= 0) {
        runs.push(pixels.y + y, pixels.x + start, pixels.x + x - 1);
        start = -1;
      }
    }
  }
  return runs;
}

function paintFillOp(ctx: OffscreenCanvasRenderingContext2D, op: FillOp): void {
  const mask = op.runs !== undefined ? runsMask(op.runs) : replayMask(op);
  if (mask !== null) paintMaskFill(ctx, op.colour, mask, op.clear === true);
}

function layerSmartOps(ops: PlaneOp[] | undefined): boolean {
  return ops !== undefined && ops.some((op) => (op.kind === 'stroke' || op.kind === 'fill') && op.smartAtDrawTime.includes('stayInsideLines'));
}

/**
 * Lay a drawing's plane down again from what it remembers, to the current lines. Raw strokes land exactly as they did. While a stroke or an undo
 * is under way it waits: both are about to change this same plane and its data, and the two have to go on agreeing.
 */
async function relay(drawingId: string, plane: PlaneName, entry: MapEntry): Promise<void> {
  const engine = getEngine();
  const swap = engine.swapCount;
  const key = planeKey(drawingId, plane);
  if (!layerSmartOps(engine.project.drawings[drawingId]?.planes[plane])) return;
  const target = await engine.planes.open(key);
  if (swap !== engine.swapCount) return;
  if (engine.isBusy()) {
    relaysWaiting.set(drawingId, { plane, entry });
    return;
  }
  // Read now, after the wait: a stroke may have landed during it.
  const ops = engine.project.drawings[drawingId]?.planes[plane];
  if (ops === undefined) return;
  const fresh = new OffscreenCanvas(target.width, target.height);
  replayMap = entry;
  // Clip to Layer Below is judged against the layer below as it is now.
  const owner = engine.project.nodes.find((node) => node.cels.some((cel) => cel.drawingId === drawingId));
  const ownerCel = owner?.cels.find((cel) => cel.drawingId === drawingId);
  replayBelow = owner !== undefined && ownerCel !== undefined && ops.some((op) => (op.kind === 'stroke' || op.kind === 'fill') && op.smartAtDrawTime.includes('clipToLayerBelow')) ? await belowMask(engine.project, owner, ownerCel.frame) : null;
  if (swap !== engine.swapCount || engine.isBusy()) {
    replayBelow = null;
    return;
  }
  engine.replayOps(fresh, engine.project.drawings[drawingId]?.planes[plane] ?? ops);
  replayMap = null;
  replayBelow = null;
  restoreRect(target, { x: 0, y: 0, w: target.width, h: target.height }, fresh);
  engine.planes.markDirty(key);
  relaid.add(drawingId);
  engine.invalidate();
}

function flushRelays(): void {
  if (getEngine().isBusy()) return;
  const list = [...relaysWaiting.entries()];
  relaysWaiting.clear();
  for (const [drawingId, { plane, entry }] of list) void relay(drawingId, plane, entry);
}

function afterMap(job: MapJob, map: RegionMap): void {
  const engine = getEngine();
  // A late answer for a project that has since been left.
  if (job.projectId !== engine.project.id) return;
  if (job.drawingId !== null && job.gap === job.smartGap) {
    const before = laidWith.get(job.drawingId);
    laidWith.set(job.drawingId, job.linesKey);
    // A first reading just learns the lines; the picture already matches them. Only a change of lines moves smart colour.
    if (before !== undefined && before !== job.linesKey) void relay(job.drawingId, job.plane, { key: job.key, map });
  }
  engine.paintUi();
}

/** Keep the current layer's reading fresh whenever what it reads could have changed: at the gap in force, and at its smart gap, which is what moves colour. */
function refresh(): void {
  const engine = getEngine();
  const node = engine.activeLayer;
  if (node === null || node.kind !== 'layer') return;
  const state = useStudio.getState();
  const gap = gapFor(state.project, node, state.smartOn);
  const smartGap = gapFor(state.project, node, true);
  void readMap(node, state.frame, gap);
  if (smartGap !== gap) void readMap(node, state.frame, smartGap);
}

// ── the bucket, the fill brush, the fill eraser ──────────────────────────────────────────

/** Fill these seeds' areas, as one undo step. */
async function commitFills(node: LayerNode, seeds: [number, number][], clear: boolean): Promise<void> {
  const engine = getEngine();
  const state = useStudio.getState();
  const plane: PlaneName = isFigure(state.project, node) ? 'colour' : 'line';
  const refused = engine.refusal(node, plane);
  if (refused !== null) {
    engine.notify(refused, true);
    return;
  }
  const live = liveBehaviours(state.project, node, state.smartOn);
  const smarts = smartsForStroke(live);
  const projectId = state.project.id;
  // The fill belongs to the frame it was pressed on, even if the person has stepped on by the time the lines are read.
  const { frame } = state;
  const entry = await readMap(node, frame, gapFor(state.project, node, state.smartOn));
  if (entry === null || engine.project.id !== projectId) return;
  const { map, key: mapKey } = entry;

  // One operation per area, however many times the brush crossed it.
  const regions = new Map<number, [number, number]>();
  for (const seed of seeds) {
    const region = labelAt(map, seed[0], seed[1]);
    if (region > 0 && !regions.has(region)) regions.set(region, seed);
  }
  if (regions.size === 0) return;

  if (engine.isBusy()) {
    engine.notify('ONE MOMENT');
    return;
  }
  const before = engine.project;
  let after = before;
  const fresh = findNode(before, node.id);
  if (fresh === null) return;
  let cel = celFor(before, fresh, frame);
  if (cel === null) {
    if (clear) return;
    const made = addDrawing(after, node.id, frame, state.settings.defaultHold);
    after = made.project;
    cel = made.cel;
  }
  const key = planeKey(cel.drawingId, plane);
  const canvas = await engine.planes.open(key);
  const ctx = canvas.getContext('2d');
  if (ctx === null) return;

  const tuck = smarts.includes('tuckUnder');
  const smart = smarts.includes('stayInsideLines');
  let bounds: Rect | null = null;
  const ready: { op: FillOp; mask: PaintMask }[] = [];
  for (const [region, seed] of regions) {
    const mask = maskOf(mapKey, map, region, tuck);
    if (mask === null) continue;
    const op: FillOp = {
      kind: 'fill',
      id: `f_${Date.now().toString(36)}${region}`,
      plane,
      colour: state.colour,
      clear: clear || undefined,
      seed,
      smartAtDrawTime: smarts,
      regionId: region,
      maxGapPx: live?.closeGaps.maxGapPx,
      runs: smart ? undefined : runsOfRegion(map, region),
    };
    ready.push({ op, mask });
    bounds = unionRect(bounds, boundsOf([[mask.x, mask.y], [mask.x + mask.canvas.width, mask.y + mask.canvas.height]], 0, before.width, before.height));
  }
  if (bounds === null) return;
  const copy = copyRect(canvas, bounds);
  for (const { op, mask } of ready) {
    paintMaskFill(ctx, op.colour, mask, clear);
    after = addOp(after, cel.drawingId, plane, op);
  }
  const patches: PlanePatch[] = [{ key, rect: bounds, before: copy, after: copyRect(canvas, bounds) }];
  engine.planes.markDirty(key);
  engine.pushStep(clear ? 'CLEAR AREA' : 'FILL', before, after, patches);
  engine.paintNow();
  flushRelays();
}

// ── hover preview and helper lines ───────────────────────────────────────────────────────

let fillTrail: { seeds: [number, number][]; regions: Set<number> } | null = null;

function paintOverlays(ctx: CanvasRenderingContext2D): void {
  const engine = getEngine();
  const state = useStudio.getState();
  const node = engine.activeLayer;
  if (node === null || node.kind !== 'layer' || state.playing) return;
  const entry = readyMap(node);
  if (entry === null) return;

  const brush = engine.brushForTool(state.tool);
  const live = liveBehaviours(state.project, node, state.smartOn);
  if (live?.showClosures === true && entry.map.closures.length > 0 && (brush === null || !['eraser'].includes(brush))) {
    ctx.save();
    ctx.strokeStyle = CLOSURE_COLOUR;
    ctx.lineWidth = Math.max(1, 1.5 / engine.view.zoom);
    ctx.beginPath();
    for (const [x0, y0, x1, y1] of entry.map.closures) {
      ctx.moveTo(x0 + 0.5, y0 + 0.5);
      ctx.lineTo(x1 + 0.5, y1 + 0.5);
    }
    ctx.stroke();
    ctx.restore();
  }

  // What a fill would cover, tinted, before the pen comes down.
  const preview = new Set<number>(fillTrail?.regions ?? []);
  if (engine.hover !== null && (state.tool === 'fill' || state.tool === 'fillbrush' || state.tool === 'filleraser')) {
    const here = labelAt(entry.map, engine.hover.x, engine.hover.y);
    if (here > 0) preview.add(here);
  }
  for (const region of preview) {
    const mask = maskOf(entry.key, entry.map, region, false);
    if (mask === null) continue;
    ctx.save();
    ctx.globalAlpha = 0.35;
    const sheet = new OffscreenCanvas(mask.canvas.width, mask.canvas.height);
    const sheetCtx = sheet.getContext('2d');
    if (sheetCtx !== null) {
      sheetCtx.drawImage(mask.canvas, 0, 0);
      sheetCtx.globalCompositeOperation = 'source-in';
      sheetCtx.fillStyle = state.tool === 'filleraser' ? '#ffffff' : FILL_PREVIEW;
      sheetCtx.fillRect(0, 0, sheet.width, sheet.height);
      ctx.drawImage(sheet, mask.x, mask.y);
    }
    ctx.restore();
  }
}

function fillHandlers(mode: 'bucket' | 'brush', clear: boolean) {
  return {
    penDown: (x: number, y: number) => {
      const engine = getEngine();
      const node = engine.activeLayer;
      if (node === null || node.kind !== 'layer') {
        engine.notify('PICK A LAYER', true);
        return false;
      }
      noteStroke();
      fillTrail = { seeds: [[x, y]], regions: new Set() };
      const entry = readyMap(node);
      if (entry !== null) fillTrail.regions.add(labelAt(entry.map, x, y));
      engine.paintUi();
      return true;
    },
    penMove: (x: number, y: number) => {
      if (fillTrail === null || mode === 'bucket') return;
      const node = getEngine().activeLayer;
      if (node === null) return;
      const entry = readyMap(node);
      if (entry === null) return;
      const region = labelAt(entry.map, x, y);
      if (!fillTrail.regions.has(region)) {
        fillTrail.regions.add(region);
        fillTrail.seeds.push([x, y]);
        getEngine().paintUi();
      }
    },
    penUp: () => {
      const trail = fillTrail;
      fillTrail = null;
      const node = getEngine().activeLayer;
      if (trail !== null && node !== null) void commitFills(node, trail.seeds, clear);
      getEngine().paintUi();
    },
    penCancel: () => {
      fillTrail = null;
      getEngine().paintUi();
    },
  };
}

// ── the master toggle ────────────────────────────────────────────────────────────────────

let heldQ = false;
let strokeWhileHeld = false;

/** Told when a stroke or fill begins: a Q held at that moment is a Q held for that stroke, even if it's let go before the pen lifts. */
function noteStroke(): void {
  if (heldQ) strokeWhileHeld = true;
}

export function toggleSmarts(): void {
  const smartOn = !useStudio.getState().smartOn;
  useStudio.setState({ smartOn, notice: { text: smartOn ? 'SMARTS ON' : 'SMARTS OFF', fault: false } });
  refresh();
  getEngine().paintUi();
}

/** "Make smart": what's selected on the colour plane is treated as if it had been drawn with this tag's smarts. */
export async function makeSmart(): Promise<void> {
  const engine = getEngine();
  const state = useStudio.getState();
  const node = engine.activeLayer;
  if (node === null || node.kind !== 'layer') return;
  const cel = engine.celForDrawing(node);
  if (cel === null) return;
  const live = liveBehaviours(state.project, node, true);
  if (live === null) {
    engine.notify('THIS LAYER HAS NO SMART TAG', true);
    return;
  }
  const ids = new Set(selectedStrokeIds());
  const smarts = smartsForStroke(live);
  const entry = await readMap(node, state.frame, gapFor(state.project, node, true));
  if (entry === null || engine.project.id !== state.project.id) return;
  const key = planeKey(cel.drawingId, 'colour');
  const canvas = await engine.planes.open(key);
  const drawing = engine.project.drawings[cel.drawingId];
  if (drawing === undefined || engine.isBusy()) return;
  let changed = 0;
  const ops = drawing.planes.colour.map((op) => {
    if (op.kind !== 'stroke' || !ids.has(op.id) || op.smartAtDrawTime.includes('stayInsideLines')) return op;
    changed += 1;
    return { ...op, smartAtDrawTime: smarts };
  });
  if (changed === 0) {
    engine.notify('NOTHING RAW SELECTED');
    return;
  }
  const full = { x: 0, y: 0, w: canvas.width, h: canvas.height };
  const copy = copyRect(canvas, full);
  const fresh = new OffscreenCanvas(canvas.width, canvas.height);
  replayMap = entry;
  engine.replayOps(fresh, ops);
  replayMap = null;
  restoreRect(canvas, full, fresh);
  engine.planes.markDirty(key);
  engine.pushStep('MAKE SMART', engine.project, setOps(engine.project, cel.drawingId, 'colour', ops), [{ key, rect: full, before: copy, after: copyRect(canvas, full) }]);
  engine.notify(`MADE ${changed} SMART`);
}

const smartActions: Action[] = [
  {
    id: 'smart.toggle',
    label: 'SMARTS ON / OFF (HOLD FOR ONE STROKE)',
    group: 'SMARTS',
    key: 'q',
    run: () => {
      heldQ = true;
      strokeWhileHeld = false;
      toggleSmarts();
    },
    release: () => {
      heldQ = false;
      // Held through a stroke: that was the one stroke, so back they come. A tap just flips.
      if (strokeWhileHeld) toggleSmarts();
      strokeWhileHeld = false;
    },
  },
  { id: 'smart.make', label: 'MAKE WHAT IS SELECTED SMART', group: 'SMARTS', key: 'shift+q', run: () => void makeSmart() },
  { id: 'tool.fill', label: 'BUCKET', group: 'TOOLS', key: 'g', run: () => getEngine().setTool('fill') },
  { id: 'tool.fillbrush', label: 'FILL BRUSH', group: 'TOOLS', key: 'y', run: () => getEngine().setTool('fillbrush') },
  { id: 'tool.filleraser', label: 'FILL ERASER', group: 'TOOLS', key: 'shift+y', run: () => getEngine().setTool('filleraser') },
];
addActions(smartActions);

let installed = false;

/** Tell the engine about smarts: called once when the studio opens. */
export function installSmarts(): void {
  if (installed) return;
  installed = true;
  const engine = getEngine();
  toolHandlers.set('fill', fillHandlers('bucket', false));
  toolHandlers.set('fillbrush', fillHandlers('brush', false));
  toolHandlers.set('filleraser', fillHandlers('brush', true));
  engine.uiPainters.push(paintOverlays);
  engine.maskForOp = replayMask;
  engine.opPainters.fill = (ctx, op) => {
    if (op.kind === 'fill') paintFillOp(ctx, op);
  };

  engine.liveMaskFor = (live, x, y) => {
    noteStroke();
    const { stroke, layerId } = live;
    const { project } = useStudio.getState();
    const node = findNode(project, layerId);
    if (node === null) return null;
    const figure = isFigure(project, node);
    // An eraser and a stroke on the lines themselves go where the pen goes; they have nothing to stay inside.
    if (BRUSH_ERASES.has(stroke.brush) || (figure && stroke.plane === 'line')) stroke.smartAtDrawTime = [];
    if (!clipsStroke(stroke, figure)) return null;
    stroke.maxGapPx = gapFor(project, node, useStudio.getState().smartOn);
    const entry = readyMap(node);
    if (entry === null) return null;
    return maskForStroke(stroke, entry, x, y);
  };
  // Lines changed a moment ago and aren't read yet: the stroke showed free, and is held to its area as it lands.
  engine.commitMask = (live) => {
    const { stroke, layerId } = live;
    const state = useStudio.getState();
    const { project, frame } = state;
    const node = findNode(project, layerId);
    if (node === null) return null;
    const clipsBelow = stroke.smartAtDrawTime.includes('clipToLayerBelow');
    const clips = clipsStroke(stroke, isFigure(project, node));
    if (!clipsBelow && (live.mask !== null || !clips)) return null;
    const [x, y] = stroke.points[0];
    return (async () => {
      let mask = live.mask;
      if (mask === null && clips) {
        const entry = await readMap(node, frame, gapFor(project, node, state.smartOn));
        mask = entry === null ? null : maskForStroke(stroke, entry, x, y);
      }
      return clipsBelow ? cutToBelow(mask, await belowMask(project, node, frame)) : mask;
    })();
  };
  // A plane's picture is gone from storage and has to be drawn from its data: smart operations need the lines first.
  engine.beforeRebuild = async (drawingId, plane) => {
    const { project } = useStudio.getState();
    if (!layerSmartOps(project.drawings[drawingId]?.planes[plane])) return null;
    for (const node of project.nodes) {
      const cel = node.cels.find((c) => c.drawingId === drawingId);
      if (cel === undefined) continue;
      replayMap = await readMap(node, cel.frame, gapFor(project, node, true));
      return () => {
        replayMap = null;
      };
    }
    return null;
  };

  engine.afterStroke = (layerId, drawingId, plane) => {
    flushRelays();
    if (plane !== 'line') return;
    // Everything that reads these lines hears about it, not only the layer being drawn on: an Ink layer's strokes move a Figure's colour.
    const { project, frame } = useStudio.getState();
    const key = planeKey(drawingId, 'line');
    for (const node of project.nodes) {
      if (node.kind === 'layer' && (node.id === layerId || regionSources(project, node, frame).includes(key))) void readMap(node, frame, gapFor(project, node, true));
    }
  };
  engine.afterMove = refresh;
  engine.onIdle = flushRelays;
  engine.afterHistory = () => {
    refresh();
    // An undo patch knows the colour as it was when it was made. If colour has been re-laid since, lay it again to match.
    const node = engine.activeLayer;
    const cel = node !== null && node.kind === 'layer' ? engine.celForDrawing(node) : null;
    if (node !== null && cel !== null && relaid.has(cel.drawingId)) {
      const state = useStudio.getState();
      void readMap(node, state.frame, gapFor(state.project, node, true)).then((entry) => {
        if (entry !== null) void relay(cel.drawingId, isFigure(state.project, node) ? 'colour' : 'line', entry);
      });
    }
  };
  engine.onProjectSwap.push(() => {
    maps.length = 0;
    masks.clear();
    laidWith.clear();
    relaid.clear();
    relaysWaiting.clear();
    fillTrail = null;
  });
  useStudio.subscribe((state, previous) => {
    if (state.frame !== previous.frame || state.layerId !== previous.layerId || state.project !== previous.project) {
      if (!state.playing) refresh();
    }
  });
}

const BRUSH_ERASES = new Set(['eraser', 'filleraser']);
