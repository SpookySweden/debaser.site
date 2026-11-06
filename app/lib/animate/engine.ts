/**
 * The animator's engine: the sheet on screen, the live stroke, undo, saving. One per page visit's worth of browser tab, kept when the
 * person goes to another page and comes back, so their work and undo are still there.
 *
 * The screen is four canvases stacked. `below` holds the frame up to the plane being drawn on, `live` the stroke in progress, `above` the
 * rest of the frame, `ui` the marks over the drawing. A stroke only ever redraws `live`, however many layers there are, and it sits in its
 * true place in the stack (a colour stroke shows under the lines while it's being drawn).
 */
import { BRUSH_SHAPES, MAX_BRUSH_SIZE, MIN_BRUSH_SIZE, Stabiliser, applyCurve, tiltPressure, type Rect } from './brushes';
import { SAFE_AREA } from './colours';
import { composite } from './composite';
import { copyRect, History, restoreRect, type HistoryStep, type PlanePatch } from './history';
import { fillStroke, paintStroke, strokeBounds, type PaintMask } from './paint';
import { planeFile, planeKey, PlaneStore } from './planes';
import { addDrawing, addOp, celAt, createProject, findNode, firstLayer, neighbourFrame } from './project';
import { assetIdsOf, buildProjectFile, FILE_EXTENSION, readProjectFile, safeFileName, saveBlobAs } from './project-file';
import { askToKeepStorage, deleteProjectData, getMeta, listProjects, listFiles, loadProjectData, readFile, saveProjectData, setMeta, writeFile, deleteFile, type ProjectListing } from './storage';
import { saveSettings, useStudio, type ToolId } from './store';
import { isFigure, liveBehaviours, smartsForStroke, tagBehaviours } from './tags';
import type { BrushId, Cel, LayerNode, PlaneName, PlaneOp, Project, Stroke, StrokePoint } from './types';

export type StageCanvases = { root: HTMLElement; below: HTMLCanvasElement; live: HTMLCanvasElement; above: HTMLCanvasElement; ui: HTMLCanvasElement };

export type View = { zoom: number; x: number; y: number; rot: number; flip: boolean };

const MIN_ZOOM = 0.05;
const MAX_ZOOM = 32;
const VERSION_EVERY_MS = 5 * 60 * 1000;

function newProjectId(): string {
  return `p_${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
}

/** A stroke in the hand: what `live` is drawing. */
export type LiveStroke = {
  layerId: string;
  plane: PlaneName;
  stroke: Stroke;
  /** Points the browser predicts the pen will reach, drawn but never kept. */
  predicted: StrokePoint[];
  stabiliser: Stabiliser;
  /** Where the pen really is: the line trails it and catches up here when the pen lifts. */
  lastRaw: StrokePoint;
  /** This stroke, an eraser on a Figure with Protect Lines off, cuts the lines as well. */
  reachesLines: boolean;
  mask: PaintMask | null;
  /** The plane being cut live, for an eraser. */
  working: OffscreenCanvas | null;
  workingKey: string | null;
};

export class AnimateEngine {
  planes: PlaneStore;
  history = new History();
  view: View = { zoom: 1, x: 0, y: 0, rot: 0, flip: false };
  stage: StageCanvases | null = null;
  live: LiveStroke | null = null;
  hover: { x: number; y: number } | null = null;

  private needsPaint = false;
  private rafId = 0;
  private dpr = 1;
  private resizeObserver: ResizeObserver | null = null;
  private lastSaved: Project | null = null;
  private autosaveTimer: ReturnType<typeof setInterval> | null = null;
  private lastCommit = 0;
  /** Undo and anything else that has to wait for storage run one at a time. */
  private queue: Promise<void> = Promise.resolve();
  private queuedJobs = 0;
  /** Goes up with every project swap: work that was waiting on storage checks it, so it can't land in the wrong project. */
  private generation = 0;
  private saveJob: Promise<void> | null = null;
  private started: Promise<void> | null = null;
  /** Marks over the drawing that other modules add (selection, closures, fill preview). */
  uiPainters: ((ctx: CanvasRenderingContext2D) => void)[] = [];
  /** Told when a project is swapped in. */
  onProjectSwap: (() => void)[] = [];

  constructor() {
    const project = useStudio.getState().project;
    this.planes = this.storeFor(project);
  }

  // ── small helpers ──────────────────────────────────────────────────────────────────────

  get project(): Project {
    return useStudio.getState().project;
  }

  get frame(): number {
    return useStudio.getState().frame;
  }

  get activeLayer(): LayerNode | null {
    const state = useStudio.getState();
    return findNode(state.project, state.layerId);
  }

  notify(text: string, fault = false): void {
    useStudio.setState({ notice: { text, fault } });
  }

  private storeFor(project: Project): PlaneStore {
    return new PlaneStore(
      project.id,
      project.width,
      project.height,
      () => this.invalidate(),
      (key) => this.isPlaneStored(key),
      (key, canvas) => this.rebuildPlane(key, canvas),
    );
  }

  private isPlaneStored(key: string): boolean {
    const [drawingId, plane] = key.split('.') as [string, PlaneName];
    return (this.project.drawings[drawingId]?.planes[plane]?.length ?? 0) > 0;
  }

  /** A plane's picture is missing from storage: draw it again from what it remembers. */
  private async rebuildPlane(key: string, canvas: OffscreenCanvas): Promise<boolean> {
    const [drawingId, plane] = key.split('.') as [string, PlaneName];
    const ops = this.project.drawings[drawingId]?.planes[plane];
    if (ops === undefined || ops.length === 0) return false;
    const done = (await this.beforeRebuild?.(drawingId, plane)) ?? null;
    this.replayOps(canvas, ops);
    done?.();
    return true;
  }

  /** Set by the smart module: gets ready to replay a plane, and says how to finish. */
  beforeRebuild: ((drawingId: string, plane: PlaneName) => Promise<(() => void) | null>) | null = null;
  /** Told when nothing is waiting in the undo queue any more. */
  onIdle: (() => void) | null = null;

  /** A stroke is in the hand, or an undo is waiting on a picture: not a moment to change a plane behind them. */
  isBusy(): boolean {
    return this.live !== null || this.queuedJobs > 0 || useStudio.getState().exportProgress !== null;
  }

  get swapCount(): number {
    return this.generation;
  }

  /** Lay a list of operations onto a blank plane. Smart operations go through `maskForOp` (set by the smart module). */
  maskForOp: (op: PlaneOp) => PaintMask | null = () => null;
  /** Operations other than strokes are drawn by whoever knows how (fills: smart module; moves: selection module). */
  opPainters: Partial<Record<PlaneOp['kind'], (ctx: OffscreenCanvasRenderingContext2D, op: PlaneOp) => void>> = {};

  replayOps(canvas: OffscreenCanvas, ops: PlaneOp[]): void {
    const ctx = canvas.getContext('2d');
    if (ctx === null) return;
    for (const op of ops) {
      if (op.kind === 'stroke') {
        const bounds = strokeBounds(op, canvas.width, canvas.height);
        if (bounds !== null) paintStroke(ctx, op, bounds, this.maskForOp(op));
      } else if (op.kind === 'clear') {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
      } else {
        this.opPainters[op.kind]?.(ctx, op);
      }
    }
  }

  /** A project's next state. Every change the person makes goes through `edit` or a stroke's commit, so every change can be undone. */
  setProject(project: Project): void {
    useStudio.setState({ project, fileDirty: true, saveState: 'waiting', canUndo: this.history.canUndo, canRedo: this.history.canRedo });
    this.invalidate();
  }

  /** A change to the project's data with no pictures involved. */
  edit(label: string, change: (project: Project) => Project): void {
    if (this.queuedJobs > 0) {
      this.inQueue(async () => this.edit(label, change));
      return;
    }
    const before = this.project;
    const after = change(before);
    if (after === before) return;
    this.history.push({ label, before, after, patches: [], frame: this.frame, layerId: useStudio.getState().layerId });
    this.setProject(after);
  }

  /** A setting on the project that undo shouldn't step through (a slider's every value), still saved. */
  tweak(change: (project: Project) => Project): void {
    const after = change(this.project);
    if (after !== this.project) this.setProject(after);
  }

  /** A change the caller has already painted: its patches and new project make one undo step. */
  pushStep(label: string, before: Project, after: Project, patches: PlanePatch[]): void {
    this.history.push({ label, before, after, patches, frame: this.frame, layerId: useStudio.getState().layerId });
    this.setProject(after);
  }

  // ── starting up ────────────────────────────────────────────────────────────────────────

  start(): Promise<void> {
    if (this.started !== null) return this.started;
    this.started = (async () => {
      void askToKeepStorage();
      let project: Project | null = null;
      try {
        const id = await getMeta<string>('current');
        if (id !== null) project = await loadProjectData(id);
      } catch {
        this.notify('THIS BROWSER WILL NOT KEEP YOUR WORK. SAVE TO A FILE.', true);
      }
      this.swapProject(project ?? createProject(newProjectId()));
      useStudio.setState({ ready: true, fileDirty: false });
      this.startAutosave();
    })();
    return this.started;
  }

  swapProject(project: Project, keepFrame = false): void {
    this.cancelStroke();
    this.generation += 1;
    this.history.clear();
    // The old store is simply let go: a save still running on it finishes on it.
    this.planes = this.storeFor(project);
    const layer = firstLayer(project);
    useStudio.setState({
      project,
      frame: keepFrame ? this.frame : 0,
      layerId: layer?.id ?? '',
      plane: 'line',
      canUndo: false,
      canRedo: false,
      saveState: 'saved',
      fileDirty: false,
      notice: null,
      hasSelection: false,
      selectedStrokes: 0,
    });
    this.lastSaved = project;
    for (const told of this.onProjectSwap) told();
    this.fitView();
    this.invalidate();
  }

  // ── the stage ──────────────────────────────────────────────────────────────────────────

  attach(stage: StageCanvases): void {
    this.stage = stage;
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(stage.root);
    this.resize();
    this.fitView();
  }

  detach(): void {
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.stage = null;
    cancelAnimationFrame(this.rafId);
    this.needsPaint = false;
  }

  private contexts = new Map<HTMLCanvasElement, CanvasRenderingContext2D>();

  private ctxOf(canvas: HTMLCanvasElement, desynchronized = false): CanvasRenderingContext2D | null {
    let ctx = this.contexts.get(canvas) ?? null;
    if (ctx === null) {
      ctx = canvas.getContext('2d', { desynchronized });
      if (ctx !== null) this.contexts.set(canvas, ctx);
    }
    return ctx;
  }

  private resize(): void {
    const stage = this.stage;
    if (stage === null) return;
    const box = stage.root.getBoundingClientRect();
    this.dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.round(box.width * this.dpr));
    const h = Math.max(1, Math.round(box.height * this.dpr));
    for (const canvas of [stage.below, stage.live, stage.above, stage.ui]) {
      if (canvas.width !== w) canvas.width = w;
      if (canvas.height !== h) canvas.height = h;
    }
    this.paintNow();
  }

  stageSize(): { w: number; h: number } {
    const box = this.stage?.root.getBoundingClientRect();
    return { w: box?.width ?? 1, h: box?.height ?? 1 };
  }

  fitView(): void {
    const { w, h } = this.stageSize();
    const { width, height } = this.project;
    const zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, Math.min((w - 16) / width, (h - 16) / height)));
    this.view = { zoom, rot: 0, flip: false, x: 0, y: 0 };
    this.centreSheet();
    this.afterViewChange();
  }

  /** Put the sheet's middle in the stage's middle, whatever the turn. */
  private centreSheet(): void {
    const { w, h } = this.stageSize();
    const m = this.viewMatrix(false);
    const p = m.transformPoint(new DOMPoint(this.project.width / 2, this.project.height / 2));
    this.view.x += w / 2 - p.x;
    this.view.y += h / 2 - p.y;
  }

  viewMatrix(withDpr = true): DOMMatrix {
    const { zoom, x, y, rot, flip } = this.view;
    const m = new DOMMatrix();
    if (withDpr) m.scaleSelf(this.dpr, this.dpr);
    m.translateSelf(x, y);
    m.rotateSelf(rot);
    m.scaleSelf(flip ? -zoom : zoom, zoom);
    return m;
  }

  /** A point on screen (relative to the stage), in sheet pixels. */
  toSheet(px: number, py: number): { x: number; y: number } {
    const p = this.viewMatrix(false).inverse().transformPoint(new DOMPoint(px, py));
    return { x: p.x, y: p.y };
  }

  private afterViewChange(): void {
    useStudio.setState({ zoomPercent: Math.round(this.view.zoom * 100) });
    this.invalidate();
  }

  panBy(dx: number, dy: number): void {
    this.view.x += dx;
    this.view.y += dy;
    this.afterViewChange();
  }

  zoomAt(factor: number, px?: number, py?: number): void {
    const { w, h } = this.stageSize();
    const sx = px ?? w / 2;
    const sy = py ?? h / 2;
    const held = this.toSheet(sx, sy);
    this.view.zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, this.view.zoom * factor));
    const moved = this.viewMatrix(false).transformPoint(new DOMPoint(held.x, held.y));
    this.view.x += sx - moved.x;
    this.view.y += sy - moved.y;
    this.afterViewChange();
  }

  /** Turn or mirror the view (never the drawing) about the stage's middle. */
  private aroundCentre(change: () => void): void {
    const { w, h } = this.stageSize();
    const held = this.toSheet(w / 2, h / 2);
    change();
    const moved = this.viewMatrix(false).transformPoint(new DOMPoint(held.x, held.y));
    this.view.x += w / 2 - moved.x;
    this.view.y += h / 2 - moved.y;
    this.afterViewChange();
  }

  rotateBy(degrees: number): void {
    this.aroundCentre(() => {
      this.view.rot = (this.view.rot + degrees) % 360;
    });
  }

  flipView(): void {
    this.aroundCentre(() => {
      this.view.flip = !this.view.flip;
    });
  }

  invalidate(): void {
    if (this.stage === null || this.needsPaint) return;
    this.needsPaint = true;
    this.rafId = requestAnimationFrame(() => this.paintNow());
  }

  /** Hand this a playback picture and the stage shows it instead of building the frame. */
  playbackPicture: ImageBitmap | null = null;
  /** Working copies shown in place of planes while a selection is dragged. */
  previewOverrides: Map<string, OffscreenCanvas> | null = null;
  /** Told after a selection's move lands (the smart module re-reads the lines). */
  afterMove: (() => void) | null = null;
  onionShift: ((celId: string) => DOMMatrixReadOnly | null) | null = null;

  private prepare(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement): void {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const m = this.viewMatrix();
    ctx.setTransform(m.a, m.b, m.c, m.d, m.e, m.f);
    ctx.imageSmoothingEnabled = this.view.zoom < 2;
    ctx.beginPath();
    ctx.rect(0, 0, this.project.width, this.project.height);
    ctx.clip();
  }

  paintNow(): void {
    this.needsPaint = false;
    const stage = this.stage;
    if (stage === null) return;
    this.paintBelow();
    this.paintAbove();
    this.paintUi();
  }

  private compositeOptions(part: 'all' | 'below' | 'above') {
    const state = useStudio.getState();
    return {
      project: state.project,
      frame: state.frame,
      planes: (key: string) => this.previewOverrides?.get(key) ?? this.planes.peek(key),
      activeLayerId: state.layerId,
      showOnion: !state.playing,
      lightTable: state.lightTable,
      part,
      split: part === 'all' || this.live === null ? undefined : { layerId: this.live.layerId, plane: this.live.plane },
      override: this.live?.working != null && this.live.workingKey !== null ? { key: this.live.workingKey, canvas: this.live.working } : null,
      onionShift: this.onionShift,
    };
  }

  paintBelow(): void {
    const stage = this.stage;
    if (stage === null) return;
    const ctx = this.ctxOf(stage.below);
    if (ctx === null) return;
    ctx.save();
    this.prepare(ctx, stage.below);
    ctx.fillStyle = this.project.background;
    ctx.fillRect(0, 0, this.project.width, this.project.height);
    if (this.playbackPicture !== null) {
      ctx.drawImage(this.playbackPicture, 0, 0, this.project.width, this.project.height);
    } else {
      composite(ctx, this.compositeOptions(this.live === null ? 'all' : 'below'));
    }
    ctx.restore();
  }

  private aboveHasPaint = false;

  paintAbove(): void {
    const stage = this.stage;
    if (stage === null) return;
    const ctx = this.ctxOf(stage.above);
    if (ctx === null) return;
    if (this.live === null) {
      if (this.aboveHasPaint) {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, stage.above.width, stage.above.height);
        this.aboveHasPaint = false;
      }
      stage.above.style.visibility = 'hidden';
      return;
    }
    ctx.save();
    this.prepare(ctx, stage.above);
    composite(ctx, this.compositeOptions('above'));
    ctx.restore();
    this.aboveHasPaint = true;
    stage.above.style.visibility = 'visible';
  }

  paintUi(): void {
    const stage = this.stage;
    if (stage === null) return;
    const ctx = this.ctxOf(stage.ui);
    if (ctx === null) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, stage.ui.width, stage.ui.height);
    // Hidden during a stroke, so the browser can put `live` on the screen with nothing on top of it.
    stage.ui.style.visibility = this.live === null ? 'visible' : 'hidden';
    if (this.live !== null) return;
    const m = this.viewMatrix();
    ctx.setTransform(m.a, m.b, m.c, m.d, m.e, m.f);
    if (this.project.safeArea) this.paintSafeArea(ctx);
    for (const painter of this.uiPainters) {
      ctx.save();
      painter(ctx);
      ctx.restore();
    }
    this.paintRing(ctx);
  }

  /** The safe-area guide: 90% and 80% of the sheet. */
  private paintSafeArea(ctx: CanvasRenderingContext2D): void {
    const { width, height } = this.project;
    ctx.save();
    ctx.strokeStyle = SAFE_AREA;
    ctx.lineWidth = 1.5 / this.view.zoom;
    for (const share of [0.9, 0.8]) ctx.strokeRect((width * (1 - share)) / 2, (height * (1 - share)) / 2, width * share, height * share);
    ctx.restore();
  }

  private paintRing(ctx: CanvasRenderingContext2D): void {
    if (this.hover === null) return;
    const state = useStudio.getState();
    const brush = this.brushForTool(state.tool);
    const m = this.viewMatrix();
    ctx.setTransform(m.a, m.b, m.c, m.d, m.e, m.f);
    const thick = (state.settings.cursorScale * 1.5) / this.view.zoom;
    const radius = brush !== null && !BRUSH_SHAPES[brush].press ? Math.max(2 / this.view.zoom, state.brushes[brush].size / 2) : 6 / this.view.zoom;
    ctx.beginPath();
    ctx.arc(this.hover.x, this.hover.y, radius + thick, 0, Math.PI * 2);
    ctx.lineWidth = thick;
    ctx.strokeStyle = '#ffffff';
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(this.hover.x, this.hover.y, radius, 0, Math.PI * 2);
    ctx.strokeStyle = '#000000';
    ctx.stroke();
  }

  brushForTool(tool: ToolId): BrushId | null {
    return tool === 'lasso' || tool === 'rect' || tool === 'pick' || tool === 'hand' || tool === 'shift' ? null : tool;
  }

  /** Told where the pen is on the stage, so the badge can sit beside it. */
  onHoverMove: ((screen: { x: number; y: number } | null) => void) | null = null;

  setHover(point: { x: number; y: number } | null): void {
    this.hover = point;
    if (this.onHoverMove !== null) {
      if (point === null) {
        this.onHoverMove(null);
      } else {
        const p = this.viewMatrix(false).transformPoint(new DOMPoint(point.x, point.y));
        this.onHoverMove({ x: p.x, y: p.y });
      }
    }
    if (this.stage !== null && this.live === null) this.paintUi();
  }

  // ── strokes ────────────────────────────────────────────────────────────────────────────

  /** Why this layer can't be drawn on right now, in a few words, or null if it can. */
  refusal(node: LayerNode | null, plane: PlaneName): string | null {
    if (node === null || node.kind !== 'layer') return 'PICK A LAYER';
    let at: LayerNode | null = node;
    while (at !== null) {
      if (at.locked) return 'LAYER LOCKED';
      at = at.parent === null ? null : findNode(this.project, at.parent);
    }
    if (node.planeLocked[plane]) return `${plane.toUpperCase()} LOCKED`;
    return null;
  }

  /** The cel a stroke on this frame lands in. */
  celForDrawing(node: LayerNode): Cel | null {
    if (tagBehaviours(this.project, node)?.holdWholeShot === true) return node.cels[0] ?? null;
    return celAt(node, this.frame);
  }

  /** Can a new drawing be started here by simply drawing? */
  private mayStartDrawing(node: LayerNode): boolean {
    return tagBehaviours(this.project, node)?.autoNewDrawing !== false;
  }

  beginStroke(x: number, y: number, pressure: number, tilt: number, time: number, simulated: boolean, brushOverride: BrushId | null): boolean {
    const state = useStudio.getState();
    if (this.live !== null || state.playing) return false;
    if (this.queuedJobs > 0) {
      // An undo is waiting on a picture from storage; a stroke now would be made against what the undo is about to replace.
      this.notify('ONE MOMENT');
      return false;
    }
    if (state.exportProgress !== null) {
      // An export is reading these same pictures.
      this.notify('EXPORTING. STOP IT TO DRAW.');
      return false;
    }
    const node = findNode(state.project, state.layerId);
    const brush = brushOverride ?? this.brushForTool(state.tool);
    if (brush === null) return false;
    const figure = node !== null && isFigure(state.project, node);
    const plane: PlaneName = figure ? state.plane : 'line';
    const refused = this.refusal(node, plane);
    if (refused !== null || node === null) {
      this.notify(refused ?? 'PICK A LAYER', true);
      return false;
    }
    if (this.celForDrawing(node) === null && !this.mayStartDrawing(node)) {
      this.notify('NO DRAWING ON THIS FRAME', true);
      return false;
    }
    const settings = state.brushes[brush];
    const live = liveBehaviours(state.project, node, state.smartOn);
    const first = this.pressurePoint(x, y, pressure, tilt, simulated);
    // A tag can ask for its own steadiness (Ink's is higher), unless the person has steadied this brush more themselves.
    const tagSteady = tagBehaviours(state.project, node)?.layerDefaults.stabiliser ?? 0;
    const stabiliser = new Stabiliser(Math.max(settings.stabiliser, tagSteady));
    const stroke: Stroke = {
      kind: 'stroke',
      id: `s_${Date.now().toString(36)}${Math.floor(Math.random() * 46656).toString(36)}`,
      plane,
      brush,
      colour: state.colour,
      size: settings.size,
      opacity: settings.opacity,
      points: [stabiliser.push(first[0], first[1], first[2], time)],
      simulated: simulated || undefined,
      smartAtDrawTime: smartsForStroke(live),
    };

    const liveStroke: LiveStroke = { layerId: node.id, plane, stroke, predicted: [], stabiliser, lastRaw: first, reachesLines: figure && live !== null && !live.protectLines, mask: null, working: null, workingKey: null };
    if (BRUSH_SHAPES[brush].erases) {
      const cel = this.celForDrawing(node);
      if (cel === null) {
        this.notify('NOTHING TO ERASE HERE');
        return false;
      }
      const key = planeKey(cel.drawingId, plane);
      const canvas = this.planes.openNow(key);
      if (canvas === null) return false;
      liveStroke.workingKey = key;
      liveStroke.working = new OffscreenCanvas(canvas.width, canvas.height);
    }
    this.live = liveStroke;
    this.prepareLiveMask();
    this.paintBelow();
    this.paintAbove();
    this.paintUi();
    this.drawLive();
    return true;
  }

  /** Set by the smart module: what mask, if any, the stroke just begun is held to. */
  liveMaskFor: ((live: LiveStroke, x: number, y: number) => PaintMask | null) | null = null;
  /** Set by the smart module: a mask the stroke has to wait for as it lands, when the lines aren't read yet. */
  commitMask: ((live: LiveStroke) => Promise<PaintMask | null> | null) | null = null;

  private prepareLiveMask(): void {
    const live = this.live;
    if (live === null || this.liveMaskFor === null) return;
    const [x, y] = live.stroke.points[0];
    live.mask = this.liveMaskFor(live, x, y);
  }

  private pressurePoint(x: number, y: number, pressure: number, tilt: number, simulated: boolean): StrokePoint {
    const { settings } = useStudio.getState();
    if (simulated) return [x, y, 0.5];
    const curved = applyCurve(pressure, settings.pressure);
    const shaped = settings.tilt ? tiltPressure(curved, tilt) : curved;
    return [x, y, Math.max(0.02, shaped)];
  }

  extendStroke(points: { x: number; y: number; pressure: number; tilt: number; time: number }[], predicted: { x: number; y: number; pressure: number; tilt: number; time: number }[]): void {
    const live = this.live;
    if (live === null) return;
    const simulated = live.stroke.simulated === true;
    for (const point of points) {
      const raw = this.pressurePoint(point.x, point.y, point.pressure, point.tilt, simulated);
      live.lastRaw = raw;
      live.stroke.points.push(live.stabiliser.push(raw[0], raw[1], raw[2], point.time));
    }
    live.predicted = predicted.map((point) => this.pressurePoint(point.x, point.y, point.pressure, point.tilt, simulated));
    this.drawLive();
  }

  private drawLive(): void {
    const live = this.live;
    const stage = this.stage;
    if (live === null || stage === null) return;
    const shape = { ...live.stroke, points: live.predicted.length > 0 ? [...live.stroke.points, ...live.predicted] : live.stroke.points };

    if (live.working !== null && live.workingKey !== null) {
      // An eraser shows by cutting a working copy of the plane, so what it uncovers is really there.
      const source = this.planes.peek(live.workingKey);
      const ctx = live.working.getContext('2d');
      if (ctx === null) return;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, live.working.width, live.working.height);
      if (source !== null) ctx.drawImage(source, 0, 0);
      const bounds = strokeBounds(shape, live.working.width, live.working.height);
      if (bounds !== null) paintStroke(ctx, shape, bounds, live.mask);
      this.paintBelow();
      return;
    }

    const ctx = this.ctxOf(stage.live, useStudio.getState().settings.lowLatency);
    if (ctx === null) return;
    ctx.save();
    this.prepare(ctx, stage.live);
    fillStroke(ctx, shape, { last: false });
    if (live.mask !== null) {
      ctx.globalCompositeOperation = 'destination-in';
      ctx.globalAlpha = 1;
      ctx.drawImage(live.mask.canvas, live.mask.x, live.mask.y);
    }
    ctx.restore();
  }

  private clearLiveCanvas(): void {
    const stage = this.stage;
    if (stage === null) return;
    const ctx = this.ctxOf(stage.live, useStudio.getState().settings.lowLatency);
    if (ctx === null) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, stage.live.width, stage.live.height);
  }

  /** Right-click, Esc or a lost pen: the stroke is dropped as if it never happened. */
  cancelStroke(): void {
    if (this.live === null) return;
    this.live = null;
    this.paintNow();
    this.clearLiveCanvas();
  }

  endStroke(): void {
    const live = this.live;
    if (live === null) return;
    const { stroke } = live;
    // The line ends where the pen did, however far a stabiliser had it trailing.
    const end = stroke.points[stroke.points.length - 1];
    if (stroke.points.length > 1 && (end[0] !== live.lastRaw[0] || end[1] !== live.lastRaw[1])) stroke.points.push(live.lastRaw);
    this.lastCommit = performance.now();
    const before = this.project;
    const node = findNode(before, live.layerId);
    if (node === null) {
      this.cancelStroke();
      return;
    }

    let after = before;
    let cel = this.celForDrawing(node);
    if (cel === null) {
      const made = addDrawing(after, node.id, this.frame, useStudio.getState().settings.defaultHold);
      after = made.project;
      cel = made.cel;
    }
    const bounds = strokeBounds(stroke, before.width, before.height);
    const key = planeKey(cel.drawingId, live.plane);
    const generation = this.generation;
    const finish = (canvas: OffscreenCanvas) => {
      const mask = live.mask;
      const ctx = canvas.getContext('2d');
      const patches: PlanePatch[] = [];
      if (ctx !== null && bounds !== null) {
        const copyBefore = copyRect(canvas, bounds);
        paintStroke(ctx, stroke, bounds, mask);
        patches.push({ key, rect: bounds, before: copyBefore, after: copyRect(canvas, bounds) });
        this.planes.markDirty(key);
      }
      let landed = addOp(after, cel.drawingId, live.plane, stroke);
      // Protect Lines off: an eraser used on the colour goes through to the lines as well.
      const lineKey = planeKey(cel.drawingId, 'line');
      const lines = BRUSH_SHAPES[stroke.brush].erases && live.plane === 'colour' && live.reachesLines ? this.planes.peek(lineKey) : null;
      if (lines !== null && bounds !== null) {
        const lineCtx = lines.getContext('2d');
        if (lineCtx !== null) {
          const copyLines = copyRect(lines, bounds);
          const lineStroke: Stroke = { ...stroke, id: `${stroke.id}l`, plane: 'line' };
          paintStroke(lineCtx, lineStroke, bounds, null);
          patches.push({ key: lineKey, rect: bounds, before: copyLines, after: copyRect(lines, bounds) });
          this.planes.markDirty(lineKey);
          landed = addOp(landed, cel.drawingId, 'line', lineStroke);
        }
      }
      this.live = null;
      this.pushStep(stroke.brush === 'eraser' ? 'ERASE' : 'STROKE', before, landed, patches);
      // The whole frame goes back on `below` before the live stroke is wiped, so nothing flickers off between the two.
      this.paintNow();
      this.clearLiveCanvas();
      this.afterStroke(live.layerId, cel.drawingId, live.plane);
    };
    const land = () => {
      const canvas = this.planes.openNow(key);
      if (canvas !== null) {
        finish(canvas);
        return;
      }
      // The picture is still coming from storage: the stroke lands the moment it arrives, unless the person has since dropped
      // it or moved to another project.
      void this.planes.open(key).then((opened) => {
        if (generation === this.generation && this.live === live) finish(opened);
      });
    };
    const waitFor = this.commitMask?.(live) ?? null;
    if (waitFor === null) {
      land();
      return;
    }
    void waitFor.then((mask) => {
      if (generation !== this.generation || this.live !== live) return;
      live.mask = mask;
      land();
    });
  }

  /** Told after every stroke lands (the smart module re-reads the lines). */
  afterStroke: (layerId: string, drawingId: string, plane: PlaneName) => void = () => undefined;

  /** Sample the visible colour under a point of the sheet. */
  pickColour(x: number, y: number): string | null {
    const { project } = this;
    if (x < 0 || y < 0 || x >= project.width || y >= project.height) return null;
    const sample = new OffscreenCanvas(1, 1);
    const ctx = sample.getContext('2d', { willReadFrequently: true });
    if (ctx === null) return null;
    ctx.translate(-Math.floor(x), -Math.floor(y));
    ctx.fillStyle = project.background;
    ctx.fillRect(0, 0, project.width, project.height);
    composite(ctx, { ...this.compositeOptions('all'), showOnion: false, lightTable: false });
    const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
    return `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
  }

  // ── undo ───────────────────────────────────────────────────────────────────────────────

  private inQueue(job: () => Promise<void>): void {
    this.queuedJobs += 1;
    const run = () => job().finally(() => {
      this.queuedJobs -= 1;
      if (this.queuedJobs === 0) this.onIdle?.();
    });
    this.queue = this.queue.then(run, run);
  }

  private async applyStep(step: HistoryStep, direction: 'undo' | 'redo', generation: number): Promise<void> {
    const target = direction === 'undo' ? step.before : step.after;
    for (const patch of step.patches) {
      const canvas = await this.planes.open(patch.key);
      // A slow load can outlast the project it was for.
      if (generation !== this.generation) return;
      restoreRect(canvas, patch.rect, direction === 'undo' ? patch.before : patch.after);
      this.planes.markDirty(patch.key);
    }
    useStudio.setState({ frame: step.frame, layerId: findNode(target, step.layerId) !== null ? step.layerId : (firstLayer(target)?.id ?? '') });
    this.setProject(target);
    this.notify(`${direction === 'undo' ? 'UNDID' : 'REDID'} ${step.label}`);
    this.afterHistory();
  }

  afterHistory: () => void = () => undefined;

  undo(): void {
    this.stepHistory('undo');
  }

  redo(): void {
    this.stepHistory('redo');
  }

  private stepHistory(direction: 'undo' | 'redo'): void {
    if (this.live !== null) return;
    const generation = this.generation;
    this.inQueue(async () => {
      if (generation !== this.generation) return;
      const step = direction === 'undo' ? this.history.takeUndo() : this.history.takeRedo();
      if (step !== null) await this.applyStep(step, direction, generation);
    });
  }

  // ── the timeline ───────────────────────────────────────────────────────────────────────

  goToFrame(frame: number): void {
    // A stroke belongs to the frame it started on.
    if (this.live !== null) return;
    const { project } = this;
    const next = Math.max(0, Math.round(frame));
    if (next === this.frame) return;
    if (next >= project.frames) this.tweak((p) => ({ ...p, frames: next + 1 }));
    useStudio.setState({ frame: next });
    this.invalidate();
  }

  stepDrawing(direction: -1 | 1): void {
    const node = this.activeLayer;
    if (node === null) return;
    const at = neighbourFrame(node, this.frame, direction);
    if (at !== null) this.goToFrame(at);
  }

  // ── saving ─────────────────────────────────────────────────────────────────────────────

  private startAutosave(): void {
    if (this.autosaveTimer !== null) clearInterval(this.autosaveTimer);
    this.autosaveTimer = setInterval(() => {
      const seconds = useStudio.getState().settings.autosaveSeconds;
      // Only once the pen has been quiet a moment, however often the timer fires.
      if (performance.now() - this.lastCommit >= Math.min(1000, seconds * 1000)) void this.autosave();
    }, Math.max(2, useStudio.getState().settings.autosaveSeconds) * 1000);
  }

  restartAutosave(): void {
    this.startAutosave();
  }

  needsSaving(): boolean {
    return this.project !== this.lastSaved || this.planes.hasDirty();
  }

  /** Everything changed since the last autosave, into browser storage. One save at a time: asking during a save waits for it, then saves what's left. */
  autosave(): Promise<void> {
    if (this.saveJob !== null) return this.saveJob.then(() => this.autosave());
    if (this.live !== null || !this.needsSaving()) return Promise.resolve();
    this.saveJob = this.runSave().finally(() => {
      this.saveJob = null;
    });
    return this.saveJob;
  }

  private async runSave(): Promise<void> {
    const project = this.project;
    const planes = this.planes;
    const generation = this.generation;
    const previous = this.lastSaved;
    useStudio.setState({ saveState: 'saving' });
    let ok = false;
    try {
      // Pictures first, and the data only if they all landed: data with no matching picture would load as an older drawing.
      ok = await planes.flush();
      if (ok) {
        const changed = Object.values(project.drawings).filter((drawing) => previous === null || previous.drawings[drawing.id] !== drawing);
        await saveProjectData(project, changed, Date.now());
        if (generation === this.generation) {
          await setMeta('current', project.id);
          this.lastSaved = project;
          void this.keepVersion(project);
        }
      }
    } catch {
      ok = false;
    }
    if (generation !== this.generation) return;
    useStudio.setState({ saveState: ok ? (this.needsSaving() ? 'waiting' : 'saved') : 'failed' });
    if (!ok) this.notify('COULD NOT SAVE IN THIS BROWSER. SAVE TO A FILE.', true);
  }

  private lastVersion = 0;

  /** Every five minutes of work, an older version of the project, kept as a whole project file. */
  private async keepVersion(project: Project): Promise<void> {
    const keep = useStudio.getState().settings.keepVersions;
    const now = Date.now();
    if (keep <= 0 || now - this.lastVersion < VERSION_EVERY_MS) return;
    if (this.lastVersion === 0) {
      // A fresh visit starts its clock: nothing has changed yet that's worth a copy.
      this.lastVersion = now;
      return;
    }
    this.lastVersion = now;
    try {
      const blob = await buildProjectFile(project, (key) => readFile(project.id, planeFile(key)));
      await writeFile(project.id, `versions/${now}.zip`, blob);
      const names = (await listFiles(project.id, 'versions')).sort();
      for (const old of names.slice(0, Math.max(0, names.length - keep))) await deleteFile(project.id, `versions/${old}`);
    } catch {
      // A version is a nicety: the save itself already landed.
    }
  }

  /** The older versions of this project, newest first. */
  async versions(): Promise<{ name: string; time: number }[]> {
    const names = await listFiles(this.project.id, 'versions');
    return names.map((name) => ({ name, time: Number(name.replace('.zip', '')) })).sort((a, b) => b.time - a.time);
  }

  /** An older version opens as a project of its own; the current one stays as it is. */
  async openVersion(name: string): Promise<void> {
    const blob = await readFile(this.project.id, `versions/${name}`);
    if (blob === null) {
      this.notify('THAT VERSION IS GONE', true);
      return;
    }
    await this.openFile(blob);
  }

  /** Before leaving a project: true once it's safe. Refused, in words, if it isn't, so a swap never drops unsaved pictures. */
  private async readyToLeave(): Promise<boolean> {
    if (this.live !== null) return false;
    await this.autosave();
    if (!this.needsSaving()) return true;
    this.notify('NOT SAVED YET, SO STAYING HERE. TRY AGAIN OR SAVE TO A FILE.', true);
    return false;
  }

  /** A plane's picture for a project file: the live one if it's newer than storage. */
  private async pictureFor(key: string): Promise<Blob | null> {
    const live = this.planes.isDirty(key) ? this.planes.peek(key) : null;
    if (live !== null) return live.convertToBlob({ type: 'image/png' });
    const stored = await readFile(this.project.id, planeFile(key));
    if (stored !== null) return stored;
    return (await this.planes.open(key)).convertToBlob({ type: 'image/png' });
  }

  /** The whole project as a file. It holds every picture, even if browser storage has been failing. */
  async saveToFile(): Promise<void> {
    await this.autosave();
    const project = this.project;
    this.notify('BUILDING THE FILE...');
    try {
      const blob = await buildProjectFile(project, (key) => this.pictureFor(key));
      const saved = await saveBlobAs(blob, `${safeFileName(project.name)}${FILE_EXTENSION}`, 'ANIMATE project', ['.zip']);
      if (saved) {
        useStudio.setState({ fileDirty: this.project !== project });
        this.notify('FILE SAVED');
      } else {
        this.notify('NOT SAVED');
      }
    } catch {
      this.notify('COULD NOT WRITE THE FILE', true);
    }
  }

  /** A project file opened: it becomes a new project in this browser, so nothing here is overwritten. */
  async openFile(file: Blob): Promise<void> {
    if (!(await this.readyToLeave())) return;
    this.notify('OPENING...');
    const project = await readProjectFile(file, newProjectId());
    if (project === null) {
      this.notify('THAT IS NOT AN ANIMATE PROJECT FILE', true);
      return;
    }
    this.swapProject(project);
    await this.saveWhole(project);
    this.notify('OPENED');
  }

  /** Save a freshly swapped-in project's data in full. */
  private async saveWhole(project: Project): Promise<void> {
    await saveProjectData(project, Object.values(project.drawings), Date.now());
    await setMeta('current', project.id);
    this.lastSaved = project;
  }

  async newProject(name?: string, width?: number, height?: number, fps?: number): Promise<void> {
    if (!(await this.readyToLeave())) return;
    const project = createProject(newProjectId(), name, width, height, fps);
    this.swapProject(project);
    await this.saveWhole(project);
    this.notify('NEW PROJECT');
  }

  async switchProject(id: string): Promise<void> {
    if (id === this.project.id) return;
    if (!(await this.readyToLeave())) return;
    const project = await loadProjectData(id);
    if (project === null) {
      this.notify('THAT PROJECT IS GONE', true);
      return;
    }
    this.swapProject(project);
    await setMeta('current', id);
    this.notify(`OPENED ${project.name}`);
  }

  listProjects(): Promise<ProjectListing[]> {
    return listProjects();
  }

  /** Delete a project from this browser. If it's the open one, a new blank takes its place. */
  async deleteProject(id: string): Promise<void> {
    const wasOpen = id === this.project.id;
    await this.saveJob;
    await deleteProjectData(id);
    if (wasOpen) {
      const rest = await listProjects();
      if (rest.length > 0) {
        const next = await loadProjectData(rest[0].id);
        if (next !== null) {
          this.swapProject(next);
          await setMeta('current', next.id);
          return;
        }
      }
      const blank = createProject(newProjectId());
      this.swapProject(blank);
      await this.saveWhole(blank);
    }
  }

  // ── tools ──────────────────────────────────────────────────────────────────────────────

  setTool(tool: ToolId): void {
    const state = useStudio.getState();
    const brush = this.brushForTool(tool);
    const next: Partial<typeof state> = { tool };
    if (brush !== null) {
      const node = findNode(state.project, state.layerId);
      // On a Figure the brush says which plane: ink on the lines, colour under them.
      if (node !== null && isFigure(state.project, node) && brush !== 'eraser') next.plane = BRUSH_SHAPES[brush].colourPlane ? 'colour' : 'line';
    }
    useStudio.setState(next);
    this.paintUi();
  }

  setBrushSize(brush: BrushId, size: number): void {
    const state = useStudio.getState();
    const clamped = Math.max(MIN_BRUSH_SIZE, Math.min(MAX_BRUSH_SIZE, Math.round(size)));
    useStudio.setState({ brushes: { ...state.brushes, [brush]: { ...state.brushes[brush], size: clamped } } });
    this.paintUi();
  }

  setBrushValue(brush: BrushId, change: Partial<{ opacity: number; stabiliser: number }>): void {
    const state = useStudio.getState();
    useStudio.setState({ brushes: { ...state.brushes, [brush]: { ...state.brushes[brush], ...change } } });
  }

  persistSettings(): void {
    saveSettings(useStudio.getState().settings);
  }

  /** Names everything a file holds, for a credits-free check that a project file round-trips. */
  assetIds(): string[] {
    return assetIdsOf(this.project);
  }

  rect(a: { x: number; y: number }, b: { x: number; y: number }): Rect {
    return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) };
  }
}

let engine: AnimateEngine | null = null;

/** The one engine. It lives as long as the tab, so going to another page and back keeps the work and its undo. */
export function getEngine(): AnimateEngine {
  if (engine === null) {
    engine = new AnimateEngine();
    if (typeof window !== 'undefined') (window as unknown as { __animate?: AnimateEngine }).__animate = engine;
  }
  return engine;
}
