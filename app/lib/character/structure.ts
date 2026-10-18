/**
 * How a figure hangs together: which shapes touch, how far each is from a node, and what is broken.
 *
 * **Levels.** A shape touching a node is level 0. A shape touching a level-0 shape is level 1, and so on, by the
 * shortest path. A shape no chain reaches is cut off. Sag (`sag.ts`) is built on these levels.
 *
 * **Broken things block saving.** A node with no shape around it, a shape that touches nothing, a shape cut off from
 * every node, and a shape pinned to no node (the spec: a shape that loses its node is marked) are all reported, in
 * words a reader can act on.
 *
 * **Worked out from the figure, never stored.** Undo, redo and loading a figure bring the right answer back with them
 * because there is nothing else to bring. Each figure object is measured once (`WeakMap`), so the two views, the list
 * and the stats share one answer per edit.
 *
 * Hidden shapes are left out of everything: they touch nothing, hold up nothing and are never reported.
 */
import { placementOf, type Figure } from './figure';
import { nodeName } from './rig';
import { jointFrames, type Vec3 } from './skeleton';
import { pointTouches, solidsTouch, type Solid } from './touch';

export type Problem =
  | { kind: 'bare-node'; id: string }
  | { kind: 'loose-shape'; id: string }
  | { kind: 'cut-off-shape'; id: string }
  | { kind: 'unpinned-shape'; id: string };

export type Structure = {
  /** Every shown shape where it is built (before any sag), by id. */
  solids: Record<string, Solid>;
  /** Shown shape id -> the shown shapes it touches. */
  touching: Record<string, string[]>;
  /** Shown shape id -> the nodes it touches or surrounds. */
  nodes: Record<string, string[]>;
  /** Level by shape id, for shown shapes connected to a node. */
  level: Record<string, number>;
  /** What is wrong, shapes first (in list order), then nodes. */
  problems: Problem[];
};

const MEASURED = new WeakMap<Figure, Structure>();

export function structureOf(figure: Figure): Structure {
  const known = MEASURED.get(figure);
  if (known !== undefined) return known;

  const frames = jointFrames(figure.skeleton);
  const shown = figure.shapes.filter((shape) => !shape.hidden);
  const solids: Record<string, Solid> = {};
  for (const shape of shown) {
    const placement = placementOf(figure, shape, frames);
    solids[shape.id] = { kind: shape.kind, position: placement.position, rotation: placement.rotation, size: shape.size };
  }

  const nodePoints: [string, Vec3][] = Object.keys(figure.skeleton.joints)
    .filter((id) => frames[id] !== undefined)
    .map((id) => [id, frames[id].position]);

  const touching: Record<string, string[]> = {};
  const nodes: Record<string, string[]> = {};
  for (const shape of shown) {
    touching[shape.id] = [];
    nodes[shape.id] = nodePoints.filter(([, point]) => pointTouches(point, solids[shape.id])).map(([id]) => id);
  }
  for (let i = 0; i < shown.length; i += 1) {
    for (let j = i + 1; j < shown.length; j += 1) {
      if (solidsTouch(solids[shown[i].id], solids[shown[j].id])) {
        touching[shown[i].id].push(shown[j].id);
        touching[shown[j].id].push(shown[i].id);
      }
    }
  }

  // Shortest path from any node, breadth first.
  const level: Record<string, number> = {};
  let frontier = shown.filter((shape) => nodes[shape.id].length > 0).map((shape) => shape.id);
  for (const id of frontier) level[id] = 0;
  for (let depth = 1; frontier.length > 0; depth += 1) {
    const next: string[] = [];
    for (const id of frontier) {
      for (const other of touching[id]) {
        if (level[other] !== undefined) continue;
        level[other] = depth;
        next.push(other);
      }
    }
    frontier = next;
  }

  const problems: Problem[] = [];
  for (const shape of shown) {
    if (level[shape.id] === undefined) {
      problems.push({ kind: touching[shape.id].length === 0 ? 'loose-shape' : 'cut-off-shape', id: shape.id });
    } else if (shape.pin === null || figure.skeleton.joints[shape.pin] === undefined) {
      problems.push({ kind: 'unpinned-shape', id: shape.id });
    }
  }
  const covered = new Set(Object.values(nodes).flat());
  for (const [id] of nodePoints) if (!covered.has(id)) problems.push({ kind: 'bare-node', id });

  const measured: Structure = { solids, touching, nodes, level, problems };
  MEASURED.set(figure, measured);
  return measured;
}

/** One problem in words: what the shape list's tooltip and the save refusal say. */
export function problemText(figure: Figure, problem: Problem): string {
  const name = figure.shapes.find((shape) => shape.id === problem.id)?.name ?? problem.id.toUpperCase();
  switch (problem.kind) {
    case 'bare-node':
      return `${nodeName(problem.id)} HAS NO SHAPE AROUND IT`;
    case 'loose-shape':
      return `${name} ISN'T TOUCHING ANYTHING`;
    case 'cut-off-shape':
      return `${name} ISN'T CONNECTED TO A NODE`;
    case 'unpinned-shape':
      return `${name} ISN'T PINNED TO A NODE`;
  }
}

/** Shape id -> what is wrong with it, for the shapes that are broken. */
export function brokenShapes(figure: Figure): Record<string, string> {
  const broken: Record<string, string> = {};
  for (const problem of structureOf(figure).problems) {
    if (problem.kind !== 'bare-node') broken[problem.id] = problemText(figure, problem);
  }
  return broken;
}

export function bareNodes(figure: Figure): string[] {
  return structureOf(figure)
    .problems.filter((problem) => problem.kind === 'bare-node')
    .map((problem) => problem.id);
}

/** Why the figure cannot be saved, or `null` when it can. Names the first problem and counts the rest. */
export function saveRefusal(figure: Figure): string | null {
  const problems = structureOf(figure).problems;
  if (problems.length === 0) return null;
  const more = problems.length - 1;
  return `CAN'T SAVE: ${problemText(figure, problems[0])}${more > 0 ? ` (AND ${more} MORE)` : ''}`;
}
