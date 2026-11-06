/**
 * Building a frame from its layers: the stage, the playback cache, thumbnails and exports all call this, so they can't disagree. `part`
 * lets the stage split a frame around the plane being drawn on, so a live stroke can sit between the two pictures in its true place.
 */
import { celAt, findNode, isShown, onionNeighbours } from './project';
import { tagBehaviours } from './tags';
import { planeKey } from './planes';
import type { BlendMode, LayerNode, OnionMode, PlaneName, Project } from './types';
import type { Ctx } from './paint';

export type PlaneLookup = (key: string) => OffscreenCanvas | null;

export type CompositeOptions = {
  project: Project;
  frame: number;
  planes: PlaneLookup;
  /** The layer being worked on: what the dim and the light table leave alone. */
  activeLayerId?: string | null;
  /** For a render: leave out Skip-on-export layers, onion and dims. */
  exporting?: boolean;
  showOnion?: boolean;
  lightTable?: boolean;
  /** `below` is everything up to and including the split plane, `above` the rest. */
  part?: 'all' | 'below' | 'above';
  split?: { layerId: string; plane: PlaneName };
  /** A stand-in for one plane while it is being erased live. */
  override?: { key: string; canvas: OffscreenCanvas } | null;
  /** The onion drawing's nudge, in Shift and Trace. */
  onionShift?: ((celId: string) => DOMMatrixReadOnly | null) | null;
};

const BLEND: Record<BlendMode, GlobalCompositeOperation> = {
  normal: 'source-over',
  multiply: 'multiply',
  screen: 'screen',
  overlay: 'overlay',
  add: 'lighter',
};

const LIGHT_TABLE_OPACITY = 0.22;
const DIM_OPACITY = 0.35;

/** Scratch sheets, reused stack-wise (a folder inside a folder takes the next one). */
class Sheets {
  private sheets: OffscreenCanvas[] = [];
  private used = 0;

  take(w: number, h: number): OffscreenCanvasRenderingContext2D {
    let sheet = this.sheets[this.used];
    if (sheet === undefined || sheet.width !== w || sheet.height !== h) {
      sheet = new OffscreenCanvas(w, h);
      this.sheets[this.used] = sheet;
    }
    this.used += 1;
    const ctx = sheet.getContext('2d');
    if (ctx === null) throw new Error('no 2d context');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.clearRect(0, 0, w, h);
    return ctx;
  }

  give(): void {
    this.used -= 1;
  }
}

const sheets = new Sheets();

function drawTinted(ctx: Ctx, source: OffscreenCanvas, colour: string, alpha: number, mode: OnionMode, shift: DOMMatrixReadOnly | null): void {
  const w = source.width;
  const h = source.height;
  const temp = sheets.take(w, h);
  if (mode === 'outline') {
    // An outline: the drawing nudged outwards, with the drawing itself cut out of the middle.
    for (const [dx, dy] of [[-2, 0], [2, 0], [0, -2], [0, 2]]) temp.drawImage(source, dx, dy);
    temp.globalCompositeOperation = 'destination-out';
    temp.drawImage(source, 0, 0);
  } else {
    temp.drawImage(source, 0, 0);
  }
  temp.globalCompositeOperation = 'source-in';
  temp.fillStyle = colour;
  temp.fillRect(0, 0, w, h);
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.globalCompositeOperation = 'source-over';
  if (shift !== null) ctx.transform(shift.a, shift.b, shift.c, shift.d, shift.e, shift.f);
  ctx.drawImage(temp.canvas as OffscreenCanvas, 0, 0);
  ctx.restore();
  sheets.give();
}

function childrenOf(project: Project, parent: string | null): LayerNode[] {
  return project.nodes.filter((node) => node.parent === parent);
}

/** Draw a frame into `ctx`, already set up in sheet coordinates. */
export function composite(ctx: Ctx, options: CompositeOptions): void {
  const { project, part = 'all', split } = options;
  let passedSplit = false;
  let drawing = part !== 'above';

  const planeOf = (key: string) => (options.override?.key === key ? options.override.canvas : options.planes(key));

  /** Move past the split plane: from here `below` stops drawing and `above` starts. */
  const arrive = (layerId: string, plane: PlaneName) => {
    if (split !== undefined && !passedSplit && split.layerId === layerId && split.plane === plane) {
      passedSplit = true;
      return true;
    }
    return false;
  };

  const drawPlane = (target: Ctx, node: LayerNode, plane: PlaneName, drawingId: string, alpha: number, blend: GlobalCompositeOperation, tint: string | null) => {
    if (drawing && !node.planeHidden[plane]) {
      const canvas = planeOf(planeKey(drawingId, plane));
      if (canvas !== null) {
        if (tint !== null) {
          drawTinted(target, canvas, tint, alpha, 'tint', null);
        } else {
          target.save();
          target.globalAlpha = alpha;
          target.globalCompositeOperation = blend;
          target.drawImage(canvas, 0, 0);
          target.restore();
        }
      }
    }
    if (arrive(node.id, plane)) drawing = part === 'above';
  };

  const drawLayer = (target: Ctx, node: LayerNode) => {
    const behaviours = tagBehaviours(project, node);
    const exporting = options.exporting === true;
    if (exporting && behaviours?.skipOnExport === true) return;

    const shown = isShown(project, node);
    if (!shown) {
      // A hidden layer can still be the one being split on (nothing to draw, but the order still turns over there).
      if (split?.layerId === node.id) {
        passedSplit = true;
        drawing = part === 'above';
      }
      return;
    }

    const isActive = options.activeLayerId === node.id;
    let alpha = node.opacity;
    let tint: string | null = null;
    if (!exporting) {
      if (options.lightTable === true && !isActive) alpha *= LIGHT_TABLE_OPACITY;
      else if (behaviours?.dimWhenInactive.on === true && !isActive) {
        alpha *= DIM_OPACITY;
        tint = behaviours.dimWhenInactive.tint;
      }
    }

    // The onion sits under the layer's own drawing.
    if (!exporting && options.showOnion === true && project.onion.on && (behaviours === null || behaviours.onionSkin.on) && drawing) {
      drawOnion(target, node, behaviours?.onionSkin.mode ?? project.onion.mode);
    }

    const cel = behaviours?.holdWholeShot === true ? (node.cels[0] ?? null) : celAt(node, options.frame);
    const blend = BLEND[node.blend];

    if (cel === null) {
      if (split?.layerId === node.id) {
        // Nothing on this frame yet: a stroke about to land still has its place in the order.
        arrive(node.id, split.plane);
        drawing = part === 'above' ? passedSplit : !passedSplit;
      }
      return;
    }

    if (node.opacity < 1 && !node.planeHidden.colour && !node.planeHidden.line && planeOf(planeKey(cel.drawingId, 'colour')) !== null && tint === null) {
      // Lines over colour at part opacity: built apart first, or the colour would show through the line.
      if (part === 'all') {
        const temp = sheets.take(project.width, project.height);
        drawPlane(temp, node, 'colour', cel.drawingId, 1, 'source-over', null);
        drawPlane(temp, node, 'line', cel.drawingId, 1, 'source-over', null);
        target.save();
        target.globalAlpha = alpha;
        target.globalCompositeOperation = blend;
        target.drawImage(temp.canvas as OffscreenCanvas, 0, 0);
        target.restore();
        sheets.give();
        return;
      }
    }

    drawPlane(target, node, 'colour', cel.drawingId, alpha, blend, tint);
    drawPlane(target, node, 'line', cel.drawingId, alpha, blend, tint);
  };

  const drawOnion = (target: Ctx, node: LayerNode, mode: OnionMode) => {
    const { onion } = project;
    const sides = [
      { side: onion.prev, list: onionNeighbours(node, options.frame, -1, onion.prev.count, onion.keysOnly) },
      { side: onion.next, list: onionNeighbours(node, options.frame, 1, onion.next.count, onion.keysOnly) },
    ];
    for (const { side, list } of sides) {
      // Furthest first, so the nearest lies on top.
      for (const { cel, distance } of [...list].reverse()) {
        const alpha = side.opacities[distance - 1] ?? 0.1;
        const shift = options.onionShift?.(cel.id) ?? null;
        for (const plane of ['colour', 'line'] as PlaneName[]) {
          const canvas = options.planes(planeKey(cel.drawingId, plane));
          if (canvas !== null) drawTinted(target, canvas, side.colour, alpha, plane === 'colour' ? 'tint' : mode, shift);
        }
      }
    }
    if (onion.includeCurrent) {
      const here = celAt(node, options.frame);
      if (here !== null) {
        const canvas = options.planes(planeKey(here.drawingId, 'line'));
        if (canvas !== null) drawTinted(target, canvas, onion.prev.colour, 0.2, 'tint', null);
      }
    }
  };

  const drawChildren = (target: Ctx, parent: string | null) => {
    // The list reads top first, so it is drawn from its end. Notes float to the top of everything.
    const rows = childrenOf(project, parent);
    const tops = parent === null ? rows.filter(isOnTop) : [];
    const ordered = parent === null ? rows.filter((n) => !isOnTop(n)) : rows;
    for (let i = ordered.length - 1; i >= 0; i -= 1) drawNode(target, ordered[i]);
    for (let i = tops.length - 1; i >= 0; i -= 1) drawNode(target, tops[i]);
  };

  const isOnTop = (node: LayerNode) => tagBehaviours(project, node)?.alwaysOnTop === true;

  const drawNode = (target: Ctx, node: LayerNode) => {
    if (node.kind === 'layer') {
      drawLayer(target, node);
      return;
    }
    if (!node.visible) {
      if (split !== undefined && findNode(project, split.layerId)?.parent === node.id) {
        passedSplit = true;
        drawing = part === 'above';
      }
      return;
    }
    if ((node.opacity < 1 || node.blend !== 'normal') && part === 'all') {
      const temp = sheets.take(project.width, project.height);
      drawChildren(temp, node.id);
      target.save();
      target.globalAlpha = node.opacity;
      target.globalCompositeOperation = BLEND[node.blend];
      target.drawImage(temp.canvas as OffscreenCanvas, 0, 0);
      target.restore();
      sheets.give();
      return;
    }
    drawChildren(target, node.id);
  };

  drawChildren(ctx, null);
}

/** Which drawings a frame shows, as a string: two frames with the same one look the same, so playback can share a picture. */
export function frameSignature(project: Project, frame: number, exporting = false): string {
  const parts: string[] = [];
  for (const node of project.nodes) {
    if (node.kind !== 'layer') continue;
    const behaviours = tagBehaviours(project, node);
    if (!isShown(project, node) || (exporting && behaviours?.skipOnExport === true)) continue;
    const cel = behaviours?.holdWholeShot === true ? (node.cels[0] ?? null) : celAt(node, frame);
    if (cel !== null) parts.push(cel.drawingId);
  }
  return parts.join(',');
}
