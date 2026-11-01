/**
 * Sag: shapes that stick out from what holds them up tip downwards, more the further they are from a node.
 *
 * **Drawn only.** The tilt is worked out from the figure every time it is drawn and is never written into a shape's
 * numbers, so a figure saves, loads and undoes exactly as it was built - and it follows the pose live: swing an arm
 * out sideways and what hangs off it sags more.
 *
 * The rules (levels come from `structure.ts`):
 *   - levels 0 and 1 do not sag
 *   - a level-2 shape (the first "sagger") tips about the point where it meets the shape it hangs from
 *   - each level further down doubles that
 *   - every other sagger at the same level on the same support adds a quarter more
 *   - a shape's weight is its pixel count in the FRONT view, and only the sideways part of it pulls: a shape hanging
 *     straight down from where it touches barely sags, one sticking straight out sags the most
 *   - a sagger drags the shape it hangs from down a little too (and anything hanging off a tipped shape tips with it)
 *   - nothing tips past hanging straight down
 *
 * **SAG %** is how far the most-tipped shape has turned from where it was built, where 100% is a quarter turn: a shape
 * that stuck straight out, now hanging straight down. Measured against a quarter turn rather than against each shape's
 * own way to hanging, because a shape built *almost* hanging has almost no way to go: against its own, a one-degree
 * droop would read 20%, and swinging an arm out (which makes the droop bigger) would make the number smaller.
 */
import type { Figure, Placement } from './figure';
import { structureOf } from './structure';
import type { Vec3 } from './skeleton';
import { contactPoint, outlinePixels } from './touch';
import { IDENTITY, quatFromAxisAngle, quatMultiply, rotateVec, type Quat } from './turns';

/**
 * Every number sag uses, in one place, for tuning by eye.
 *
 *   baseDegrees    how far a level-2 shape of `weightPixels` pixels, sticking straight out sideways, tips
 *   weightPixels   the pixel count that tips by exactly `baseDegrees`; twice the pixels, twice the tip
 *   perLevel       each level further down the chain multiplies the tip by this
 *   perSibling     each other sagger at the same level on the same support adds this share (0.25: 125%, 150%...)
 *   supportDrag    the share of a sagger's tip passed on to the shape it hangs from
 *   firstLevel     the first level that sags
 */
export const SAG = {
  baseDegrees: 20,
  weightPixels: 10,
  perLevel: 2,
  perSibling: 0.25,
  supportDrag: 0.25,
  firstLevel: 2,
} as const;

export type Sag = {
  /** Where each shown shape is drawn: its built placement, tipped by its own sag and its supports'. */
  placements: Record<string, Placement>;
  /** For each shape that has one: the shape it hangs from. */
  support: Record<string, string>;
  /** Each sagger's own tip, in radians, before anything hanging off it adds to it and before the clamp. */
  own: Record<string, number>;
  /**
   * How far each shape tips about where it meets its support, in radians: its own sag plus the drag of what hangs off
   * it, after it has been carried by its support's tip - and never past hanging straight down.
   */
  tip: Record<string, number>;
  /** How far the most-tipped shape has turned, as a share of a quarter turn (straight out to straight down), 0 to 1. */
  share: number;
};

type Turn = { rotation: Quat; offset: Vec3 };

const NONE: Turn = { rotation: IDENTITY, offset: { x: 0, y: 0, z: 0 } };

const add = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
const sub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });

/** `outer` after `inner`: the point moved by `inner`, then by `outer`. */
function compose(outer: Turn, inner: Turn): Turn {
  return {
    rotation: quatMultiply(outer.rotation, inner.rotation),
    offset: add(rotateVec(outer.rotation, inner.offset), outer.offset),
  };
}

/** A point moved by a turn. */
function moved(turn: Turn, point: Vec3): Vec3 {
  return add(rotateVec(turn.rotation, point), turn.offset);
}

/** How far a rotation turns, in radians (0 to pi). */
function turnAngle(rotation: Quat): number {
  return 2 * Math.acos(Math.min(1, Math.abs(rotation.w)));
}

/** A turn of `angle` about `axis`, through `pivot`. */
function turnAbout(pivot: Vec3, axis: Vec3, angle: number): Turn {
  const rotation = quatFromAxisAngle(axis, angle);
  return { rotation, offset: sub(pivot, rotateVec(rotation, pivot)) };
}

const MEASURED = new WeakMap<Figure, Sag>();

export function sagOf(figure: Figure): Sag {
  const known = MEASURED.get(figure);
  if (known !== undefined) return known;

  const { solids, touching, level } = structureOf(figure);
  const ids = figure.shapes.map((shape) => shape.id).filter((id) => solids[id] !== undefined);
  const connected = ids.filter((id) => level[id] !== undefined);

  // Each connected shape above level 0 hangs from the nearest touching shape one level up.
  const support: Record<string, string> = {};
  for (const id of connected) {
    if (level[id] === 0) continue;
    const centre = solids[id].position;
    const candidates = touching[id].filter((other) => level[other] === level[id] - 1);
    let best: string | undefined;
    let bestDistance = Infinity;
    for (const other of candidates) {
      const d = sub(solids[other].position, centre);
      const distance = Math.hypot(d.x, d.y, d.z);
      if (distance < bestDistance - 1e-12) {
        best = other;
        bestDistance = distance;
      }
    }
    if (best !== undefined) support[id] = best;
  }

  // Where each hanging shape meets its support (as built), how far it is from hanging, and how sideways it sticks out.
  const pivot: Record<string, Vec3> = {};
  const fromHanging: Record<string, number> = {};
  const sideways: Record<string, number> = {};
  for (const id of Object.keys(support)) {
    const contact = contactPoint(solids[id], solids[support[id]]);
    const out = sub(solids[id].position, contact);
    const length = Math.hypot(out.x, out.y, out.z);
    pivot[id] = contact;
    fromHanging[id] = length < 1e-6 ? 0 : Math.acos(Math.max(-1, Math.min(1, -out.y / length)));
    sideways[id] = length < 1e-6 ? 0 : Math.hypot(out.x, out.z) / length;
  }

  // Each sagger's own tip.
  const saggersOn: Record<string, number> = {};
  for (const id of Object.keys(support)) {
    if (level[id] < SAG.firstLevel) continue;
    const key = `${support[id]}@${level[id]}`;
    saggersOn[key] = (saggersOn[key] ?? 0) + 1;
  }
  const own: Record<string, number> = {};
  for (const id of Object.keys(support)) {
    if (level[id] < SAG.firstLevel) continue;
    const siblings = saggersOn[`${support[id]}@${level[id]}`] - 1;
    own[id] =
      ((SAG.baseDegrees * Math.PI) / 180) *
      (outlinePixels(solids[id]) / SAG.weightPixels) *
      sideways[id] *
      SAG.perLevel ** (level[id] - SAG.firstLevel) *
      (1 + SAG.perSibling * siblings);
  }

  // Deepest first: how far each shape wants to tip - its own sag, plus the drag of everything hanging off it (each
  // one's share capped at its own way to hanging).
  const wanted: Record<string, number> = {};
  const deepestFirst = [...Object.keys(support)].sort((a, b) => level[b] - level[a]);
  for (const id of deepestFirst) {
    const dragged = deepestFirst
      .filter((other) => support[other] === id)
      .reduce((sum, other) => sum + SAG.supportDrag * Math.min(fromHanging[other], wanted[other]), 0);
    wanted[id] = (own[id] ?? 0) + dragged;
  }

  // Shallowest first: a shape is carried by its support's turn, then tips about where it now meets it - never past
  // hanging straight down *as it now points*, so a chain of tips cannot swing a shape back under the figure.
  const tip: Record<string, number> = {};
  const turns: Record<string, Turn> = {};
  const shallowestFirst = [...connected].sort((a, b) => level[a] - level[b]);
  for (const id of shallowestFirst) {
    const carried = support[id] === undefined ? NONE : turns[support[id]] ?? NONE;
    let mine = NONE;
    if (support[id] !== undefined) {
      const contact = moved(carried, pivot[id]);
      const out = sub(moved(carried, solids[id].position), contact);
      const length = Math.hypot(out.x, out.y, out.z);
      const across = Math.hypot(out.x, out.z);
      const left = length < 1e-6 ? 0 : Math.acos(Math.max(-1, Math.min(1, -out.y / length)));
      tip[id] = across < 1e-9 ? 0 : Math.min(left, wanted[id]);
      // The turn that swings `out` towards straight down: about out x down.
      if (tip[id] > 0) mine = turnAbout(contact, { x: out.z, y: 0, z: -out.x }, tip[id]);
    }
    turns[id] = compose(mine, carried);
  }

  const placements: Record<string, Placement> = {};
  for (const id of ids) {
    const solid = solids[id];
    const turn = turns[id] ?? NONE;
    placements[id] = {
      position: add(rotateVec(turn.rotation, solid.position), turn.offset),
      rotation: quatMultiply(turn.rotation, solid.rotation),
    };
  }

  // Each shape's whole turn - its own tip and everything it was carried by - is what the reader sees it turn by.
  let share = 0;
  for (const id of Object.keys(turns)) share = Math.max(share, turnAngle(turns[id].rotation) / (Math.PI / 2));

  const measured: Sag = { placements, support, own, tip, share: Math.min(1, share) };
  MEASURED.set(figure, measured);
  return measured;
}

/** Where a shape is drawn: tipped by sag when it is shown, as built when it is hidden. */
export function drawnPlacement(figure: Figure, shapeId: string): Placement | undefined {
  return sagOf(figure).placements[shapeId];
}
