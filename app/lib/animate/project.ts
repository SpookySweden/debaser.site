/**
 * Everything that changes a project's timeline and layers, as pure functions: a project goes in, a new one comes out, and the old one
 * is untouched, so undo can keep it. `Temp/check-animate-project.cjs` drives these without a browser.
 */
import { DEFAULT_BACKGROUND, DEFAULT_PALETTE, ONION_NEXT, ONION_PREV } from './colours';
import { builtinTags } from './tags';
import type { Cel, CelMark, Drawing, LayerNode, OnionSide, PlaneName, PlaneOp, Project } from './types';

export const DEFAULT_WIDTH = 1920;
export const DEFAULT_HEIGHT = 1080;
export const DEFAULT_FPS = 24;
export const DEFAULT_FRAMES = 48;
export const MAX_ONION = 8;

/** Opacity falling off with distance: the nearest neighbour strongest. */
export function falloff(nearest = 0.5, step = 0.7): number[] {
  return Array.from({ length: MAX_ONION }, (_, i) => Math.round(nearest * step ** i * 100) / 100);
}

function onionSide(count: number, colour: string): OnionSide {
  return { count, colour, opacities: falloff() };
}

export function newId(project: Project, prefix: string): [Project, string] {
  return [{ ...project, nextId: project.nextId + 1 }, `${prefix}_${project.nextId}`];
}

export function blankNode(id: string, kind: 'layer' | 'folder', name: string, parent: string | null = null): LayerNode {
  return {
    id,
    kind,
    parent,
    name,
    visible: true,
    locked: false,
    solo: false,
    opacity: 1,
    blend: 'normal',
    label: null,
    tagId: null,
    collapsed: false,
    cels: [],
    planeHidden: { line: false, colour: false },
    planeLocked: { line: false, colour: false },
  };
}

export function createProject(id: string, name = 'UNTITLED', width = DEFAULT_WIDTH, height = DEFAULT_HEIGHT, fps = DEFAULT_FPS): Project {
  return {
    format: 1,
    id,
    name,
    width,
    height,
    fps,
    background: DEFAULT_BACKGROUND,
    safeArea: false,
    frames: DEFAULT_FRAMES,
    range: null,
    playMode: 'loop',
    nodes: [blankNode('n_1', 'layer', 'LAYER 1')],
    drawings: {},
    tags: builtinTags(),
    palette: DEFAULT_PALETTE,
    onion: {
      on: false,
      prev: onionSide(2, ONION_PREV),
      next: onionSide(2, ONION_NEXT),
      mode: 'tint',
      keysOnly: false,
      includeCurrent: false,
    },
    audio: null,
    nextId: 2,
  };
}

// ── finding ──────────────────────────────────────────────────────────────────────────────

export function findNode(project: Project, id: string): LayerNode | null {
  return project.nodes.find((node) => node.id === id) ?? null;
}

/** The cel exposed on this frame, or null when the frame is empty on this layer. */
export function celAt(node: LayerNode, frame: number): Cel | null {
  for (const cel of node.cels) {
    if (cel.frame <= frame && frame < cel.frame + cel.length) return cel;
    if (cel.frame > frame) return null;
  }
  return null;
}

export function lastFrameOf(project: Project): number {
  let last = 0;
  for (const node of project.nodes) {
    const cel = node.cels[node.cels.length - 1];
    if (cel !== undefined) last = Math.max(last, cel.frame + cel.length);
  }
  return last;
}

function withNode(project: Project, id: string, change: (node: LayerNode) => LayerNode): Project {
  return { ...project, nodes: project.nodes.map((node) => (node.id === id ? change(node) : node)) };
}

/** A project's length grows to hold what is on it, and never shrinks by itself. */
function fit(project: Project): Project {
  const last = lastFrameOf(project);
  return last > project.frames ? { ...project, frames: last } : project;
}

function sorted(cels: Cel[]): Cel[] {
  return [...cels].sort((a, b) => a.frame - b.frame);
}

// ── drawings and cels ────────────────────────────────────────────────────────────────────

export function blankDrawing(id: string): Drawing {
  return { id, planes: { line: [], colour: [] } };
}

/**
 * A new drawing on this frame. Inside a held cel it cuts the hold there, which is how a drawing is added between two others; on an empty
 * frame it runs for `length` frames, or up to the next cel if that is sooner.
 */
export function addDrawing(project: Project, layerId: string, frame: number, length = 1, mark: CelMark = 'key'): { project: Project; cel: Cel } {
  const node = findNode(project, layerId);
  if (node === null || node.kind !== 'layer') throw new Error('not a layer');
  const [p1, celId] = newId(project, 'c');
  const [p2, drawingId] = newId(p1, 'd');

  const holding = celAt(node, frame);
  let cels = node.cels;
  let runs = length;
  if (holding !== null && holding.frame === frame) {
    // Already a cel starting here: the new one takes its place in the row, and the old drawing is dropped from it.
    runs = holding.length;
    cels = cels.filter((cel) => cel.id !== holding.id);
  } else if (holding !== null) {
    runs = holding.frame + holding.length - frame;
    cels = cels.map((cel) => (cel.id === holding.id ? { ...cel, length: frame - cel.frame } : cel));
  } else {
    const next = cels.find((cel) => cel.frame > frame);
    if (next !== undefined) runs = Math.min(length, next.frame - frame);
  }

  const cel: Cel = { id: celId, frame, length: runs, drawingId, mark };
  const updated = withNode(p2, layerId, (n) => ({ ...n, cels: sorted([...cels, cel]) }));
  return { project: fit({ ...updated, drawings: { ...updated.drawings, [drawingId]: blankDrawing(drawingId) } }), cel };
}

/**
 * Drag a drawing's end: `length` is held at 1 or more and stops at the next cel, unless `push` moves everything after it along, as
 * extending an exposure on a real sheet does.
 */
export function setExposure(project: Project, layerId: string, celId: string, length: number, push = false): Project {
  const node = findNode(project, layerId);
  const cel = node?.cels.find((c) => c.id === celId);
  if (node == null || cel === undefined) return project;
  const wanted = Math.max(1, Math.round(length));
  const delta = wanted - cel.length;
  if (delta === 0) return project;

  const next = node.cels.find((c) => c.frame > cel.frame);
  if (push) {
    return fit(
      withNode(project, layerId, (n) => ({
        ...n,
        cels: n.cels.map((c) => {
          if (c.id === celId) return { ...c, length: wanted };
          return c.frame > cel.frame ? { ...c, frame: c.frame + delta } : c;
        }),
      })),
    );
  }

  const room = next !== undefined ? next.frame - cel.frame : Number.POSITIVE_INFINITY;
  const capped = Math.min(wanted, room);
  return fit(withNode(project, layerId, (n) => ({ ...n, cels: n.cels.map((c) => (c.id === celId ? { ...c, length: capped } : c)) })));
}

/** Every cel on the layer on 1s, 2s or 3s: each drawing exposed that many frames, one after the other. */
export function setHolds(project: Project, layerId: string, hold: number): Project {
  const node = findNode(project, layerId);
  if (node === null || node.cels.length === 0) return project;
  const step = Math.max(1, Math.round(hold));
  let frame = node.cels[0].frame;
  const cels = node.cels.map((cel) => {
    const moved = { ...cel, frame, length: step };
    frame += step;
    return moved;
  });
  return fit(withNode(project, layerId, (n) => ({ ...n, cels })));
}

export function setCelMark(project: Project, layerId: string, celId: string, mark: CelMark): Project {
  return withNode(project, layerId, (n) => ({ ...n, cels: n.cels.map((c) => (c.id === celId ? { ...c, mark } : c)) }));
}

/** Empty frames pushed in at `frame`: everything from there on moves along; a hold across the spot gets longer. */
export function insertFrames(project: Project, layerId: string, frame: number, count = 1): Project {
  return fit(
    withNode(project, layerId, (n) => ({
      ...n,
      cels: n.cels.map((c) => {
        if (c.frame >= frame) return { ...c, frame: c.frame + count };
        return c.frame + c.length > frame ? { ...c, length: c.length + count } : c;
      }),
    })),
  );
}

/** Frames taken out at `frame`: what is after moves back; a hold across the spot gets shorter, and a cel left with none is gone. */
export function removeFrames(project: Project, layerId: string, frame: number, count = 1): Project {
  return withNode(project, layerId, (n) => {
    const cels: Cel[] = [];
    for (const c of n.cels) {
      const end = c.frame + c.length;
      const gone = Math.max(0, Math.min(end, frame + count) - Math.max(c.frame, frame));
      const length = c.length - gone;
      if (length <= 0) continue;
      cels.push({ ...c, length, frame: c.frame >= frame + count ? c.frame - count : Math.min(c.frame, frame) });
    }
    return { ...n, cels };
  });
}

export function deleteCel(project: Project, layerId: string, celId: string): Project {
  return withNode(project, layerId, (n) => ({ ...n, cels: n.cels.filter((c) => c.id !== celId) }));
}

/** Move a cel to another start frame, stopped short of its neighbours. */
export function moveCel(project: Project, layerId: string, celId: string, frame: number): Project {
  const node = findNode(project, layerId);
  const cel = node?.cels.find((c) => c.id === celId);
  if (node == null || cel === undefined) return project;
  const before = [...node.cels].reverse().find((c) => c.frame < cel.frame);
  const after = node.cels.find((c) => c.frame > cel.frame);
  let target = Math.max(0, Math.round(frame));
  if (before !== undefined) target = Math.max(target, before.frame + before.length);
  if (after !== undefined) target = Math.min(target, after.frame - cel.length);
  if (target < 0) return project;
  return fit(withNode(project, layerId, (n) => ({ ...n, cels: n.cels.map((c) => (c.id === celId ? { ...c, frame: target } : c)) })));
}

/**
 * The same drawing exposed again on another layer or frame: a paste. A drawing reused like this is one drawing, so a stroke on either
 * shows on both (`copyDrawing` makes a separate one). Whatever already starts in the way is shortened or replaced.
 */
export function placeCel(project: Project, layerId: string, frame: number, drawingId: string, length: number, mark: CelMark = 'key'): Project {
  const node = findNode(project, layerId);
  if (node === null || node.kind !== 'layer') return project;
  const [p1, celId] = newId(project, 'c');
  const end = frame + length;
  const cels: Cel[] = [];
  for (const c of node.cels) {
    const cEnd = c.frame + c.length;
    if (cEnd <= frame || c.frame >= end) {
      cels.push(c);
    } else if (c.frame < frame) {
      cels.push({ ...c, length: frame - c.frame });
      if (cEnd > end) cels.push({ ...c, id: `${c.id}x${p1.nextId}`, frame: end, length: cEnd - end });
    } else if (cEnd > end) {
      cels.push({ ...c, frame: end, length: cEnd - end });
    }
  }
  cels.push({ id: celId, frame, length, drawingId, mark });
  return fit(withNode(p1, layerId, (n) => ({ ...n, cels: sorted(cels) })));
}

/** A separate copy of a drawing's operations under a new id. The caller copies the pictures. */
export function copyDrawing(project: Project, drawingId: string): { project: Project; drawingId: string } {
  const source = project.drawings[drawingId];
  const [p1, id] = newId(project, 'd');
  const copy: Drawing = source === undefined ? blankDrawing(id) : { id, planes: { line: source.planes.line, colour: source.planes.colour } };
  return { project: { ...p1, drawings: { ...p1.drawings, [id]: copy } }, drawingId: id };
}

export function addOp(project: Project, drawingId: string, plane: PlaneName, op: PlaneOp): Project {
  const drawing = project.drawings[drawingId];
  if (drawing === undefined) return project;
  return {
    ...project,
    drawings: { ...project.drawings, [drawingId]: { ...drawing, planes: { ...drawing.planes, [plane]: [...drawing.planes[plane], op] } } },
  };
}

export function setOps(project: Project, drawingId: string, plane: PlaneName, ops: PlaneOp[]): Project {
  const drawing = project.drawings[drawingId];
  if (drawing === undefined) return project;
  return { ...project, drawings: { ...project.drawings, [drawingId]: { ...drawing, planes: { ...drawing.planes, [plane]: ops } } } };
}

/** The drawing ids no cel on any layer exposes any more. Undo may still bring them back, so they go only when a project is saved. */
export function unusedDrawings(project: Project): string[] {
  const used = new Set<string>();
  for (const node of project.nodes) for (const cel of node.cels) used.add(cel.drawingId);
  return Object.keys(project.drawings).filter((id) => !used.has(id));
}

// ── the next and previous drawing ────────────────────────────────────────────────────────

/** The neighbouring cels the onion shows: up to `count`, nearest first, keys only if asked. */
export function onionNeighbours(node: LayerNode, frame: number, direction: -1 | 1, count: number, keysOnly: boolean): { cel: Cel; distance: number }[] {
  const out: { cel: Cel; distance: number }[] = [];
  const here = celAt(node, frame);
  const list = direction === 1 ? node.cels : [...node.cels].reverse();
  let distance = 0;
  for (const cel of list) {
    if (here !== null && cel.id === here.id) continue;
    const isAhead = direction === 1 ? cel.frame > frame : cel.frame + cel.length <= frame;
    if (!isAhead) continue;
    if (keysOnly && cel.mark !== 'key') continue;
    distance += 1;
    out.push({ cel, distance });
    if (distance >= count) break;
  }
  return out;
}

/** The start of the next or previous cel on a layer, for stepping drawing by drawing. */
export function neighbourFrame(node: LayerNode, frame: number, direction: -1 | 1): number | null {
  if (direction === 1) {
    const next = node.cels.find((c) => c.frame > frame);
    return next === undefined ? null : next.frame;
  }
  const here = celAt(node, frame);
  if (here !== null && here.frame < frame) return here.frame;
  const prev = [...node.cels].reverse().find((c) => c.frame < frame);
  return prev === undefined ? null : prev.frame;
}

// ── playback ─────────────────────────────────────────────────────────────────────────────

/** The range playback runs over, clamped to the shot. */
export function playRange(project: Project): { start: number; end: number } {
  const last = Math.max(0, project.frames - 1);
  if (project.range === null) return { start: 0, end: last };
  const start = Math.min(Math.max(0, project.range.in), last);
  return { start, end: Math.max(start, Math.min(project.range.out, last)) };
}

/**
 * Which frame is on screen after `tick` frames of playing. Pure, so loop and ping-pong can be proved without a clock: `null` when a
 * once-through has finished.
 */
export function frameAtTick(tick: number, start: number, end: number, mode: 'loop' | 'pingpong' | 'once'): number | null {
  const span = end - start + 1;
  if (mode === 'once') return tick < span ? start + tick : null;
  if (mode === 'loop' || span === 1) return start + (tick % span);
  const period = 2 * (span - 1);
  const at = tick % period;
  return start + (at < span ? at : period - at);
}

// ── layers and folders (a flat list, top first; a folder's rows follow it) ────────────────

/** A row and everything under it, as indices from its own position: what moves together. */
export function blockOf(project: Project, id: string): LayerNode[] {
  const start = project.nodes.findIndex((n) => n.id === id);
  if (start < 0) return [];
  const block = [project.nodes[start]];
  const inside = new Set([id]);
  for (let i = start + 1; i < project.nodes.length; i += 1) {
    const node = project.nodes[i];
    if (node.parent === null || !inside.has(node.parent)) break;
    block.push(node);
    inside.add(node.id);
  }
  return block;
}

export function depthOf(project: Project, node: LayerNode): number {
  let depth = 0;
  let at = node.parent;
  while (at !== null) {
    depth += 1;
    at = findNode(project, at)?.parent ?? null;
  }
  return depth;
}

/** The rows to show: a collapsed folder hides what is under it. */
export function visibleRows(project: Project): LayerNode[] {
  const out: LayerNode[] = [];
  const hidden = new Set<string>();
  for (const node of project.nodes) {
    if (node.parent !== null && hidden.has(node.parent)) {
      hidden.add(node.id);
      continue;
    }
    out.push(node);
    if (node.kind === 'folder' && node.collapsed) hidden.add(node.id);
  }
  return out;
}

export function addNode(project: Project, kind: 'layer' | 'folder', aboveId: string | null, name?: string): { project: Project; id: string } {
  const [p1, id] = newId(project, 'n');
  const above = aboveId === null ? null : findNode(p1, aboveId);
  const count = p1.nodes.filter((n) => n.kind === kind).length + 1;
  // Next to the row it was asked for, in the same folder; a folder asked for takes it inside.
  const parent = above === null ? null : above.kind === 'folder' ? above.id : above.parent;
  const node = blankNode(id, kind, name ?? (kind === 'folder' ? `FOLDER ${count}` : `LAYER ${count}`), parent);
  const nodes = [...p1.nodes];
  const at = above === null ? 0 : above.kind === 'folder' ? nodes.indexOf(above) + 1 : nodes.indexOf(above);
  nodes.splice(at, 0, node);
  return { project: { ...p1, nodes }, id };
}

export function updateNode(project: Project, id: string, change: Partial<LayerNode>): Project {
  return withNode(project, id, (n) => ({ ...n, ...change }));
}

/** A row, and a folder's rows with it, removed. The last layer always stays. */
export function deleteNode(project: Project, id: string): Project {
  const gone = new Set(blockOf(project, id).map((n) => n.id));
  const nodes = project.nodes.filter((n) => !gone.has(n.id));
  if (!nodes.some((n) => n.kind === 'layer')) return project;
  return { ...project, nodes };
}

/** Is `id` the folder itself, or inside it? A folder cannot be moved into itself. */
export function isInside(project: Project, id: string, folderId: string): boolean {
  let at: string | null = id;
  while (at !== null) {
    if (at === folderId) return true;
    at = findNode(project, at)?.parent ?? null;
  }
  return false;
}

/**
 * Move a row (and what is under it) to just above `beforeId`, or to the bottom of the list when null, into `parent`. Refused when that
 * would put a folder inside itself; the folder-follows-its-rows rule holds afterwards.
 */
export function moveNode(project: Project, id: string, beforeId: string | null, parent: string | null): Project {
  if (parent !== null && isInside(project, parent, id)) return project;
  const block = blockOf(project, id);
  if (block.length === 0) return project;
  const inBlock = new Set(block.map((n) => n.id));
  if (beforeId !== null && inBlock.has(beforeId)) return project;
  const rest = project.nodes.filter((n) => !inBlock.has(n.id));
  const moved = block.map((n) => (n.id === id ? { ...n, parent } : n));
  let at = beforeId === null ? rest.length : rest.findIndex((n) => n.id === beforeId);
  if (at < 0) at = rest.length;
  if (beforeId === null && parent !== null) {
    // The bottom of a folder: after its last row.
    const folderAt = rest.findIndex((n) => n.id === parent);
    if (folderAt >= 0) {
      const folderBlock = blockOf({ ...project, nodes: rest }, parent);
      at = folderAt + folderBlock.length;
    }
  }
  const nodes = [...rest.slice(0, at), ...moved, ...rest.slice(at)];
  return { ...project, nodes };
}

/** One step up or down among the rows beside it, for the keyboard. */
export function nudgeNode(project: Project, id: string, direction: -1 | 1): Project {
  const node = findNode(project, id);
  if (node === null) return project;
  const siblings = project.nodes.filter((n) => n.parent === node.parent);
  const at = siblings.findIndex((n) => n.id === id);
  if (direction === -1) {
    const before = siblings[at - 1];
    return before === undefined ? project : moveNode(project, id, before.id, node.parent);
  }
  const after = siblings[at + 1];
  if (after === undefined) return project;
  const afterBlock = blockOf(project, after.id);
  const beyond = project.nodes[project.nodes.indexOf(afterBlock[afterBlock.length - 1]) + 1];
  const insideSameParent = beyond !== undefined && beyond.parent === node.parent;
  return moveNode(project, id, insideSameParent ? beyond.id : null, node.parent);
}

/** Is this row drawn at all, counting its folders being hidden and anything being soloed? */
export function isShown(project: Project, node: LayerNode): boolean {
  let at: LayerNode | null = node;
  while (at !== null) {
    if (!at.visible) return false;
    at = at.parent === null ? null : findNode(project, at.parent);
  }
  const anySolo = project.nodes.some((n) => n.solo);
  if (!anySolo) return true;
  at = node;
  while (at !== null) {
    if (at.solo) return true;
    at = at.parent === null ? null : findNode(project, at.parent);
  }
  return false;
}

export function isLocked(project: Project, node: LayerNode): boolean {
  let at: LayerNode | null = node;
  while (at !== null) {
    if (at.locked) return true;
    at = at.parent === null ? null : findNode(project, at.parent);
  }
  return false;
}

/** The first drawable layer in the list. */
export function firstLayer(project: Project): LayerNode | null {
  return project.nodes.find((n) => n.kind === 'layer') ?? null;
}

/** A project read from a file or storage: refuse what isn't one, and fill what an older version left out. */
export function readProject(raw: unknown): Project | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const p = raw as Partial<Project>;
  if (p.format !== 1 || typeof p.id !== 'string' || !Array.isArray(p.nodes) || typeof p.width !== 'number' || typeof p.height !== 'number') return null;
  if (!p.nodes.some((n) => n.kind === 'layer')) return null;
  const base = createProject(p.id, p.name, p.width, p.height, p.fps);
  return { ...base, ...p, tags: p.tags ?? base.tags, palette: p.palette ?? base.palette, onion: { ...base.onion, ...p.onion }, drawings: p.drawings ?? {} } as Project;
}
