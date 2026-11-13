/**
 * The little list that goes with a baked picture strip (`bake.ts`): how big a cell is, how many there are, and which cells
 * each motion plays, tick by tick. Pure, so the profile, the companion and the checks all read it the same way.
 *
 * Read back from the database, so everything is checked: a sheet that doesn't hold together is no sheet, and the page
 * shows no character rather than a broken one.
 */
import { MOTION_IDS, type Facing, type MotionId } from './motion';

export type SheetMotion = { facing: Facing; loop: boolean; ticks: number[] };

export type CharacterSheet = {
  v: 1;
  /** One cell, in blocks (one block = one pixel of the strip). */
  cell: { w: number; h: number };
  columns: number;
  cells: number;
  /** Ticks a second. Stepped: a tick shows one cell, whole, with nothing blended. */
  fps: number;
  /** The row (from a cell's top) the figure stands on, so the page can put its feet on a floor. */
  floor: number;
  /** The row its head starts at, standing. */
  head: number;
  motions: Record<MotionId, SheetMotion>;
};

/** The moods (SPEC-profile-characters.md): mostly idle, walks a lot, dances often. */
export const MOODS = ['calm', 'busy', 'party'] as const;
export type Mood = (typeof MOODS)[number];
export const isMood = (value: unknown): value is Mood => typeof value === 'string' && (MOODS as readonly string[]).includes(value);

const wholeIn = (value: unknown, low: number, high: number): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= low && value <= high;

export function readSheet(value: unknown): CharacterSheet | null {
  if (typeof value !== 'object' || value === null) return null;
  const raw = value as Record<string, unknown>;
  const cell = raw.cell as Record<string, unknown> | undefined;
  if (raw.v !== 1 || typeof cell !== 'object' || cell === null) return null;
  if (!wholeIn(cell.w, 1, 96) || !wholeIn(cell.h, 1, 96)) return null;
  if (!wholeIn(raw.cells, 1, 200) || !wholeIn(raw.columns, 1, 64) || !wholeIn(raw.fps, 1, 30)) return null;
  if (!wholeIn(raw.floor, 0, cell.h) || !wholeIn(raw.head, 0, cell.h)) return null;
  const cells = raw.cells;
  const motionsRaw = raw.motions as Record<string, unknown> | undefined;
  if (typeof motionsRaw !== 'object' || motionsRaw === null) return null;
  const motions = {} as Record<MotionId, SheetMotion>;
  for (const id of MOTION_IDS) {
    const motion = motionsRaw[id] as Record<string, unknown> | undefined;
    if (typeof motion !== 'object' || motion === null) return null;
    if (motion.facing !== 'side' && motion.facing !== 'front') return null;
    if (!Array.isArray(motion.ticks) || motion.ticks.length === 0 || motion.ticks.length > 200) return null;
    if (!motion.ticks.every((tick) => wholeIn(tick, 0, cells - 1))) return null;
    motions[id] = { facing: motion.facing, loop: motion.loop === true, ticks: motion.ticks as number[] };
  }
  return {
    v: 1,
    cell: { w: cell.w, h: cell.h },
    columns: raw.columns,
    cells,
    fps: raw.fps,
    floor: raw.floor,
    head: raw.head,
    motions,
  };
}

/** Where cell `index` sits in the strip, in blocks from its top-left corner. */
export function cellAt(sheet: CharacterSheet, index: number): { x: number; y: number } {
  return { x: (index % sheet.columns) * sheet.cell.w, y: Math.floor(index / sheet.columns) * sheet.cell.h };
}
