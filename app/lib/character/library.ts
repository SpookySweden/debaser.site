'use client';

import { readFigure, type Figure } from './figure';

/**
 * Saved characters: a reader's figures, kept between sessions.
 *
 * **The workbench had no store at all, and that was a real gap rather than a missing feature.** The save prompt had
 * to say `NOT SAVED ANYWHERE` out loud, because a figure built over ten minutes disappeared on reload and nothing
 * could keep it. This is the thing that fixes it, and it is deliberately the *narrowest* thing that does: a list of
 * whole figures in `localStorage`, keyed per account.
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
 * **The account as well, since 2026-11-06 (`library-sync.ts`, `user_characters`).** One browser turned out to be the only copy of somebody's
 * work. The browser still draws the shelf at once and is all a signed-out reader has; signing in brings the two together. Each kept figure
 * says whose it is, so two people on one browser don't see or take each other's; one with no owner joins whoever signs in next.
 *
 * **Everything read back is validated, and an invalid figure is dropped rather than repaired.** A hand-edited
 * `localStorage` entry is the one input this module cannot trust: a shape id that is not in the vocabulary, a
 * joint with no position, a colour that is not one of the dyes. Repairing one would need a rule for every field
 * and would put half a figure on screen; dropping it puts the reader back where they started, which is recoverable.
 */

/**
 * **v2: figures are a skeleton plus free shapes, and v1 entries are ignored rather than converted.** v1 stored one
 * primitive per joint. The owner chose to start the shelf fresh with the new workbench rather than convert, so the
 * key changed: old entries stay in the browser untouched, but nothing reads them, and none can be misread as a v2
 * figure.
 *
 * **v3: simple figures (SPEC-simple-figures.md).** At most seven shapes on at most seven nodes, every shape placed in
 * relation to a node. v2 figures had up to eighty shapes on a nineteen-joint rig; the owner chose to start fresh again
 * rather than convert, for the same reason.
 */
const STORAGE_KEY = 'debaser.character.library.v3';
const MAX_NAME_LENGTH = 24;
/** Enough for a shelf of figures without letting a runaway loop fill the browser's quota. */
const MAX_SAVED = 40;

export type SavedCharacter = {
  id: string;
  /** What the reader called it. Free text, trimmed, and never empty - see `saveCharacter`. */
  name: string;
  /** Preset it was built from, kept only so the browser can say where it came from. */
  presetId: string;
  figure: Figure;
  /** Newest first in the browser: an ISO timestamp. */
  savedAt: string;
  /** Whose it is, once somebody signed in has held it. */
  owner?: string;
};

/** A character as the account holds it. A removed one stays, marked, so another browser's copy doesn't come back. */
export type ShelfRow = Omit<SavedCharacter, 'owner'> & { deletedAt: string | null };

/** Who the shelf is being drawn for. */
let viewer: string | null = null;
let afterPersist: ((next: readonly SavedCharacter[]) => void) | null = null;
const listeners = new Set<() => void>();

const mine = (character: SavedCharacter): boolean => character.owner === undefined || character.owner === viewer;

export function setLibraryHook(hook: (next: readonly SavedCharacter[]) => void): void {
  afterPersist = hook;
}

export function subscribeToLibrary(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function setLibraryViewer(person: string | null): void {
  if (viewer === person) return;
  viewer = person;
  listeners.forEach((listener) => listener());
}

/** True for the shape of storage this module can use. */
function hasStorage(): boolean {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

/** Every saved figure this reader may see, newest first. Never throws: a corrupt store reads as an empty one. */
export function readLibrary(): SavedCharacter[] {
  return readStored().filter(mine);
}

/**
 * One saved figure of `person`'s that this browser holds, whoever the shelf is being drawn for just now: theirs, or one
 * nobody has claimed yet. For baking a shown character again (`rebake.ts`) without opening the shelf.
 */
export function findSavedCharacter(id: string, person: string): SavedCharacter | null {
  return readStored().find((character) => character.id === id && (character.owner === undefined || character.owner === person)) ?? null;
}

function readStored(): SavedCharacter[] {
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
      const figure = readFigure(record.figure);

      if (
        figure === null ||
        typeof record.id !== 'string' ||
        typeof record.name !== 'string' ||
        record.name.trim().length === 0
      ) {
        continue;
      }

      clean.push({
        id: record.id,
        name: record.name.trim().slice(0, MAX_NAME_LENGTH),
        presetId: typeof record.presetId === 'string' ? record.presetId : 'base',
        figure,
        savedAt: typeof record.savedAt === 'string' ? record.savedAt : new Date(0).toISOString(),
        ...(typeof record.owner === 'string' ? { owner: record.owner } : {}),
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
    // Somebody else's on this browser stay where they are.
    const others = readStored().filter((character) => !mine(character));
    const owned = viewer === null ? characters : characters.map((character) => ({ ...character, owner: viewer as string }));
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify([...owned, ...others]));
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
  input: { name: string; presetId: string; figure: Figure },
): SavedCharacter[] {
  const name = input.name.trim().slice(0, MAX_NAME_LENGTH);

  const saved: SavedCharacter = {
    id: `${Date.now().toString(36)}-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 16) || 'figure'}`,
    name: name.length === 0 ? nextCharacterName(existing) : name,
    presetId: input.presetId,
    // Deep-copied, because the store hands out live objects: saving a reference would mean the saved figure
    // changed as the reader kept editing it, which is the opposite of what saving a snapshot means.
    figure: JSON.parse(JSON.stringify(input.figure)) as Figure,
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
  afterPersist?.(characters);
  // Anything else listing the shelf (the profile's ON YOUR PROFILE row) hears about a save or a removal at once.
  listeners.forEach((listener) => listener());
}

/** The shelf as a sign-in left it: saved here and redrawn, with nothing to send back. */
export function writeSyncedShelf(characters: readonly SavedCharacter[]): void {
  writeLibrary(characters);
  listeners.forEach((listener) => listener());
}

/**
 * This browser's shelf and the account's brought together. Pure. The later save wins; a removal on the account beats a copy saved before it,
 * so a removed figure doesn't come back from another browser; `upload` is what the account lacks or holds an older copy of.
 */
export function mergeShelf(local: readonly SavedCharacter[], rows: readonly ShelfRow[]): { shelf: SavedCharacter[]; upload: SavedCharacter[] } {
  const held = new Map(rows.map((row) => [row.id, row]));
  const shelf = new Map<string, SavedCharacter>();
  const upload: SavedCharacter[] = [];
  for (const character of local) {
    const row = held.get(character.id);
    if (row === undefined) {
      shelf.set(character.id, character);
      upload.push(character);
    } else if (row.deletedAt !== null) {
      if (character.savedAt > row.deletedAt) {
        shelf.set(character.id, character);
        upload.push(character);
      }
    } else if (character.savedAt > row.savedAt) {
      shelf.set(character.id, character);
      upload.push(character);
    }
  }
  for (const row of rows) {
    if (row.deletedAt !== null || shelf.has(row.id)) continue;
    shelf.set(row.id, { id: row.id, name: row.name, presetId: row.presetId, figure: row.figure, savedAt: row.savedAt });
  }
  return { shelf: [...shelf.values()].sort((a, b) => b.savedAt.localeCompare(a.savedAt)), upload };
}

