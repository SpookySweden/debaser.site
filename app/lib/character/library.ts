'use client';

import { isMassDye } from './palette';
import { isMassShapeId } from './shapes';
import type { Skeleton } from './skeleton';

/**
 * Saved characters: a reader's figures, kept between sessions.
 *
 * **The workbench had no store at all, and that was a real gap rather than a missing feature.** The save prompt had
 * to say `NOT SAVED ANYWHERE` out loud, because a figure built over ten minutes disappeared on reload and nothing
 * could keep it. This is the thing that fixes it, and it is deliberately the *narrowest* thing that does: a list of
 * whole skeletons in `localStorage`, keyed per account.
 *
 * **A saved character is a snapshot, not a reference.** It stores the joints outright rather than pointing at a
 * preset id, so a preset whose numbers are tuned later cannot silently rewrite a figure somebody saved - the same
 * reason `AvatarVersion` is append-only. That costs a few kilobytes a figure and buys a saved thing that stays
 * what it was.
 *
 * **`localStorage`, not Supabase, and the reason is the same one the profile repository started with.** The mock
 * profile store is `localStorage`-backed and the whole site works against it, so this follows the established
 * shape: a plain module with `read`/`write` over one key, validating everything that comes back out of storage
 * because a value in `localStorage` is a value a user can edit. Swapping in a table later means reimplementing
 * five functions against the same signatures, and nothing in the UI changes.
 *
 * **Everything read back is validated, and an invalid figure is dropped rather than repaired.** A hand-edited
 * `localStorage` entry is the one input this module cannot trust: a shape id that is not in the vocabulary, a
 * joint with no position, a colour that is not one of the dyes. Repairing one would need a rule for every field
 * and would put half a figure on screen; dropping it puts the reader back where they started, which is recoverable.
 */

const STORAGE_KEY = 'debaser.character.library.v1';
const MAX_NAME_LENGTH = 24;
/** Enough for a shelf of figures without letting a runaway loop fill the browser's quota. */
const MAX_SAVED = 40;

export type SavedCharacter = {
  id: string;
  /** What the reader called it. Free text, trimmed, and never empty - see `saveCharacter`. */
  name: string;
  /** Preset it was built from, kept only so the browser can say where it came from. */
  presetId: string;
  skeleton: Skeleton;
  /** Newest first in the browser: an ISO timestamp. */
  savedAt: string;
};

/** True for the shape of storage this module can use. */
function hasStorage(): boolean {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

/** A number that is a real number, so a `NaN` in a hand-edited file cannot reach the camera as a position. */
function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * Read one joint back, or `null` when it is not a joint.
 *
 * **Field by field, and the mass separately**, because a joint that survives while its mass does not is a joint
 * that carries no shape - which is a perfectly valid figure. Being strict about the whole record instead would
 * throw away a reader's posed skeleton because one number was corrupt.
 */
function readJoint(value: unknown): { joint: Skeleton['joints'][string] } | null {
  if (typeof value !== 'object' || value === null) return null;

  const raw = value as Record<string, unknown>;
  if (typeof raw.id !== 'string') return null;
  if (raw.parentId !== null && typeof raw.parentId !== 'string') return null;

  const vector = (candidate: unknown) => {
    if (typeof candidate !== 'object' || candidate === null) return null;
    const v = candidate as Record<string, unknown>;
    if (!isFiniteNumber(v.x) || !isFiniteNumber(v.y) || !isFiniteNumber(v.z)) return null;
    return { x: v.x, y: v.y, z: v.z };
  };

  const position = vector(raw.position);
  const rotation = vector(raw.rotation);
  const scale = vector(raw.scale);
  if (position === null || rotation === null || scale === null) return null;

  let mass: Skeleton['joints'][string]['mass'] = null;

  if (typeof raw.mass === 'object' && raw.mass !== null) {
    const candidate = raw.mass as Record<string, unknown>;
    const size = vector(candidate.size);
    const offset = vector(candidate.offset);

    // A shape id outside the vocabulary is dropped, not defaulted: defaulting would put geometry on the figure
    // that the reader never chose, which reads as a bug rather than as a missing shape.
    if (size !== null && offset !== null && typeof candidate.shape === 'string' && isMassShapeId(candidate.shape)) {
      mass = {
        shape: candidate.shape,
        size,
        offset,
        colour: typeof candidate.colour === 'string' && isMassDye(candidate.colour) ? candidate.colour : null,
      };
    }
  }

  return { joint: { id: raw.id, parentId: raw.parentId as string | null, position, rotation, scale, mass } };
}

/**
 * Read a skeleton back, or `null` when it is not one.
 *
 * The root is checked against the joints rather than trusted, because every walk of the figure starts there - a
 * skeleton whose `rootId` names nothing renders as an empty pane and gives a reader no clue why.
 */
function readSkeleton(value: unknown): Skeleton | null {
  if (typeof value !== 'object' || value === null) return null;

  const raw = value as Record<string, unknown>;
  if (typeof raw.rootId !== 'string') return null;
  if (typeof raw.joints !== 'object' || raw.joints === null) return null;

  const joints: Skeleton['joints'] = {};
  for (const [id, entry] of Object.entries(raw.joints as Record<string, unknown>)) {
    const read = readJoint(entry);
    if (read === null) continue;
    joints[id] = read.joint;
  }

  if (joints[raw.rootId] === undefined) return null;

  return { joints, rootId: raw.rootId };
}

/** Every saved figure, newest first. Never throws: a corrupt store reads as an empty one. */
export function readLibrary(): SavedCharacter[] {
  if (!hasStorage()) return [];

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === null || raw.length === 0) return [];

    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    const clean: SavedCharacter[] = [];

    for (const entry of parsed) {
      if (typeof entry !== 'object' || entry === null) continue;

      const record = entry as Record<string, unknown>;
      const skeleton = readSkeleton(record.skeleton);

      if (
        skeleton === null ||
        typeof record.id !== 'string' ||
        typeof record.name !== 'string' ||
        record.name.trim().length === 0
      ) {
        continue;
      }

      clean.push({
        id: record.id,
        name: record.name.trim().slice(0, MAX_NAME_LENGTH),
        presetId: typeof record.presetId === 'string' ? record.presetId : 'blob',
        skeleton,
        savedAt: typeof record.savedAt === 'string' ? record.savedAt : new Date(0).toISOString(),
      });
    }

    return clean;
  } catch {
    return [];
  }
}

function writeLibrary(characters: readonly SavedCharacter[]): void {
  if (!hasStorage()) return;

  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(characters));
  } catch {
    // Storage disabled or full: the shelf still works for this session, it just will not survive a reload.
  }
}

/**
 * A name for a figure that has not been named.
 *
 * Numbered from the shelf rather than from the clock, so a reader saving three figures gets `FIGURE 1`, `FIGURE 2`,
 * `FIGURE 3` rather than three timestamps they have to read. The number is the first that is free, so deleting
 * FIGURE 2 and saving again reuses the name - which is what makes the numbers a sequence rather than a log.
 */
export function nextCharacterName(existing: readonly SavedCharacter[]): string {
  const taken = new Set(existing.map((character) => character.name.toUpperCase()));

  for (let index = 1; index <= MAX_SAVED + 1; index += 1) {
    const candidate = `FIGURE ${index}`;
    if (!taken.has(candidate)) return candidate;
  }

  return 'FIGURE';
}

/**
 * Save a figure, returning the new shelf.
 *
 * **The id is derived from the name and the moment, not from a counter.** A counter in `localStorage` is a second
 * value that can go missing independently of the list, and an id that collides silently overwrites a figure - so
 * the id carries both facts that make it unique and nothing has to be kept in step.
 *
 * A full shelf drops its **oldest** figure rather than refusing the save: refusing would lose the figure the
 * reader is looking at in order to keep one they saved first, which is backwards.
 */
export function saveCharacter(
  existing: readonly SavedCharacter[],
  input: { name: string; presetId: string; skeleton: Skeleton },
): SavedCharacter[] {
  const name = input.name.trim().slice(0, MAX_NAME_LENGTH);

  const saved: SavedCharacter = {
    id: `${Date.now().toString(36)}-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 16) || 'figure'}`,
    name: name.length === 0 ? nextCharacterName(existing) : name,
    presetId: input.presetId,
    // Deep-copied, because the store hands out live objects: saving a reference would mean the saved figure
    // changed as the reader kept editing it, which is the opposite of what saving a snapshot means.
    skeleton: JSON.parse(JSON.stringify(input.skeleton)) as Skeleton,
    savedAt: new Date().toISOString(),
  };

  const next = [saved, ...existing];
  if (next.length <= MAX_SAVED) return next;

  const byAge = [...next].sort((a, b) => a.savedAt.localeCompare(b.savedAt));
  const doomed = new Set(byAge.slice(0, next.length - MAX_SAVED).map((character) => character.id));

  return next.filter((character) => !doomed.has(character.id));
}

/** Forget one figure. */
export function removeCharacter(existing: readonly SavedCharacter[], id: string): SavedCharacter[] {
  return existing.filter((character) => character.id !== id);
}

/** Persist a shelf that `saveCharacter` / `removeCharacter` have already computed. */
export function persistLibrary(characters: readonly SavedCharacter[]): void {
  writeLibrary(characters);
}

