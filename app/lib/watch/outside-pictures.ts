import { createWindowSlot } from '../ui/window-slot';

/**
 * Each viewer's own choice about outside pictures (SPEC-rooms-queues.md, section 6, "the per-viewer switch").
 *
 * Showing an outside picture makes the viewer's browser call a server chosen by whoever added the picture, and that
 * server learns the viewer's internet address and browser. So an outside picture arrives **covered**, naming its
 * host, and loads only when the viewer presses SHOW:
 * - a picture **you pasted in yourself, in this browser,** shows for you at once (you chose that server, and this
 *   browser has already asked it);
 * - anybody else's is covered, with `[ SHOW ]` and `[ ALWAYS SHOW IN THIS ROOM ]`;
 * - Preferences has OUTSIDE PICTURES: ASK (the start), ALWAYS SHOW, NEVER. A guest always gets ASK.
 *
 * "Yours" is what this browser remembers pasting, never whose name is on the queue row (code review, 2026-11-15):
 * a playlist somebody saved from a room and loaded again files every row under their own name, and that must not
 * make somebody else's picture load uncovered.
 *
 * Kept in this browser only (`localStorage`): it is about what this browser may be made to fetch, nothing is sent
 * anywhere, and no database change is needed. Pure apart from the storage it reads and writes.
 */

export type OutsideMode = 'ask' | 'always' | 'never';

export type OutsidePicturesState = {
  mode: OutsideMode;
  /** Rooms where this viewer pressed ALWAYS SHOW IN THIS ROOM. */
  rooms: readonly string[];
  /** The addresses of outside pictures this viewer pasted in themselves, in this browser. */
  added: readonly string[];
};

export const OUTSIDE_MODES: readonly { value: OutsideMode; label: string; tip: string }[] = [
  { value: 'ask', label: 'ASK', tip: 'Covered until you press SHOW' },
  { value: 'always', label: 'ALWAYS SHOW', tip: 'Loaded as soon as they come up' },
  { value: 'never', label: 'NEVER', tip: 'Never loaded' },
];

const KEY = 'debaser.outside-pictures.v1';
/** The newest are kept; a list in a browser should not grow for ever. */
const ROOMS_KEPT = 50;
const ADDED_KEPT = 200;
const START: OutsidePicturesState = { mode: 'ask', rooms: [], added: [] };

function isMode(value: unknown): value is OutsideMode {
  return value === 'ask' || value === 'always' || value === 'never';
}

function strings(value: unknown, longest: number, kept: number): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string' && entry.length <= longest).slice(-kept) : [];
}

/** What the browser has kept, or the start. Anything unreadable is the start: covered. */
export function parseOutsidePictures(raw: string | null): OutsidePicturesState {
  if (raw === null) return START;
  try {
    const held = JSON.parse(raw) as { mode?: unknown; rooms?: unknown; added?: unknown };
    return { mode: isMode(held.mode) ? held.mode : 'ask', rooms: strings(held.rooms, 80, ROOMS_KEPT), added: strings(held.added, 2048, ADDED_KEPT) };
  } catch {
    return START;
  }
}

function readStored(): OutsidePicturesState {
  try {
    return typeof window === 'undefined' ? START : parseOutsidePictures(window.localStorage.getItem(KEY));
  } catch {
    return START;
  }
}

// Read once, as the module loads in the browser; the server, and the first paint, see the start (covered).
const slot = createWindowSlot<OutsidePicturesState>(readStored());

export const outsidePicturesState = slot.state;
export const outsidePicturesServerState = (): OutsidePicturesState => START;
export const subscribeToOutsidePictures = slot.subscribe;

function keep(next: OutsidePicturesState): void {
  slot.set(next);
  try {
    window.localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Storage shut: the choice lasts for this visit.
  }
}

export function setOutsideMode(mode: OutsideMode): void {
  const now = slot.state();
  if (now.mode !== mode) keep({ ...now, mode });
}

/** `[ ALWAYS SHOW IN THIS ROOM ]`: remembered in this browser only. */
export function alwaysShowInRoom(roomId: string): void {
  const now = slot.state();
  if (!now.rooms.includes(roomId)) keep({ ...now, rooms: [...now.rooms, roomId].slice(-ROOMS_KEPT) });
}

/** Said once this viewer's own paste of an outside picture has passed its check here: that address is theirs. */
export function noteAddedHere(url: string): void {
  const now = slot.state();
  if (!now.added.includes(url)) keep({ ...now, added: [...now.added, url].slice(-ADDED_KEPT) });
}

/** Whether this browser remembers this viewer pasting that very address. */
export function addedHere(state: OutsidePicturesState, url: string): boolean {
  return state.added.includes(url);
}

export type OutsideAnswer = 'show' | 'ask' | 'never';

/**
 * What happens to an outside picture as it comes up, before any press: shown at once, covered with SHOW, or never
 * loaded. One you pasted yourself always shows. A guest is always asked, whatever a shared browser has kept.
 */
export function outsideAnswer(state: OutsidePicturesState, picture: { mine: boolean; roomId: string | null; guest: boolean }): OutsideAnswer {
  if (picture.guest) return 'ask';
  if (picture.mine) return 'show';
  if (state.mode === 'never') return 'never';
  if (state.mode === 'always') return 'show';
  return picture.roomId !== null && state.rooms.includes(picture.roomId) ? 'show' : 'ask';
}
