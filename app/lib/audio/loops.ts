import type { AudioTrack } from './tracks';

/**
 * RADI-OH: the places you have been, kept so you can go back to them.
 *
 * A loop is a *place in a track*, not a track. That distinction is the whole feature: coming back to a
 * song from the beginning is what the shelf already does, and what this is for is coming back to the
 * bar you were on, or the point where somebody else's queue had got to before you followed it.
 *
 * **Why a loop is created by following a queue.** Catching up takes the shared player over - the site
 * has one audio element, so listening along means your own track stops. Rather than losing it, whatever
 * was playing when the takeover happened is pushed here first, as a loop. That is the contract between
 * the two features: `queue` displaces, `radio` remembers. It also means the tab is never decorative,
 * which is why it exists at all rather than being a placeholder in the brief.
 *
 * Stored per browser, like the player's own settings (`debaser.audio.player.v1`), and for the same
 * reason: this is one reader's history of where they were, not something to be shared or synced. It
 * needs no table, no policy and no account - a loop you made signed out is still yours on this machine.
 */

export type LoopSource = {
  id: string;
  /** What the loop is called on its plate: the track's title, or the account whose queue it came from. */
  label: string;
  /** The track's `src`: the same key the player queues on and a like points at. */
  trackId: string;
  /** Where in that track the loop returns to. */
  positionSeconds: number;
  /**
   * Why this loop exists.
   *
   * `own` is a place in your own listening. `taken-over` is what was playing when a queue was followed,
   * which is the automatic kind and the one the tab exists for. Kept as a field rather than inferred
   * because the row says different words for each - "YOU WERE HERE" against "DISPLACED BY <name>".
   */
  kind: 'own' | 'taken-over';
  /** When it was saved, so the list can be newest first and a loop can age out. */
  savedAt: string;
  /** For a taken-over loop: the account whose queue displaced it, so the plate can say whose fault it was. */
  displacedBy?: string;
};

/** The most loops kept. Past this the oldest go, because a history nobody prunes is a list nobody reads. */
export const MAX_LOOPS = 24;

/** Where the loops live. Named like the player's own key so the storage reads as one set of settings. */
const LOOPS_KEY = 'debaser.audio.loops.v1';

/**
 * What a loop is called when the track it points at is gone.
 *
 * The same shape as `unresolvedTrackTitle`: a loop stores the track's `src` and not a copy of it, so a
 * renamed file is not a stale label here and a deleted one leaves a loop the app cannot place. The row
 * says so rather than drawing blank.
 */
export function loopLabel(loop: LoopSource, shelf: AudioTrack[]): string {
  const track = shelf.find((entry) => entry.src === loop.trackId);

  return track?.title ?? `${loop.label} (NOT ON THE SHELF)`;
}

/* ------------------------------------------------------------------------------------------------
 * The store
 * ------------------------------------------------------------------------------------------------ */

/**
 * The loops, as a tiny external store.
 *
 * The same shape as `DesktopSidebar`'s panel and `MusicPlayer`'s bar setting: a module-level value read
 * through `useSyncExternalStore`, so a window can draw the list and a catch-up can write to it without
 * either knowing about the other. A provider would work too and would be more machinery than a list
 * read in two places needs.
 */
const listeners = new Set<() => void>();

/** One shared empty array, so a reader with no loops does not get a new identity on every render. */
const NONE: LoopSource[] = [];

/** Whether one parsed entry is really a loop - a hand-edited storage entry costs its own row, not a throw. */
function isLoop(value: unknown): value is LoopSource {
  if (typeof value !== 'object' || value === null) return false;

  const entry = value as Partial<LoopSource>;

  return (
    typeof entry.id === 'string' &&
    typeof entry.label === 'string' &&
    typeof entry.trackId === 'string' &&
    typeof entry.positionSeconds === 'number' &&
    typeof entry.savedAt === 'string' &&
    (entry.kind === 'own' || entry.kind === 'taken-over')
  );
}

function readStored(): LoopSource[] {
  if (typeof window === 'undefined') return NONE;

  try {
    const raw = window.localStorage.getItem(LOOPS_KEY);
    if (raw === null) return NONE;

    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return NONE;

    return parsed.filter(isLoop);
  } catch {
    // Storage blocked, or the entry is not JSON: an empty history is the honest answer.
    return NONE;
  }
}

let loops: LoopSource[] = readStored();

function persist(): void {
  try {
    window.localStorage.setItem(LOOPS_KEY, JSON.stringify(loops));
  } catch {
    // Storage unavailable: the loops hold for this visit only, which is better than throwing.
  }
}

/** The loops as they are now, for `useSyncExternalStore`. */
export function loopState(): LoopSource[] {
  return loops;
}

/** The server render has no storage, so it has no loops - and hydration matches it. */
export function loopServerState(): LoopSource[] {
  return NONE;
}

/** Draws from the store: the listener fires when a loop is saved or cleared. */
export function subscribeToLoops(listener: () => void): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

function commit(next: LoopSource[]): void {
  loops = next;
  persist();

  for (const listener of listeners) listener();
}

/**
 * Save a loop.
 *
 * The newest goes first and the list is trimmed to `MAX_LOOPS` from the end, so the oldest fall off on
 * their own - a history that grows without limit is one that costs a slow read on every page, and nobody
 * scrolls to the bottom of it.
 *
 * Saving the *same place* twice replaces rather than duplicates: a loop is a place, and two plates for
 * one place would be a list that lies about how much history it holds. The identity is the track and the
 * whole second, because a second is as fine as a position is worth keeping.
 */
export function saveLoop(entry: {
  label: string;
  trackId: string;
  positionSeconds: number;
  kind: LoopSource['kind'];
  displacedBy?: string;
}): LoopSource {
  const at = Math.max(0, Math.floor(entry.positionSeconds));

  const loop: LoopSource = {
    id: `${entry.trackId}@${at}`,
    label: entry.label,
    trackId: entry.trackId,
    positionSeconds: at,
    kind: entry.kind,
    savedAt: new Date().toISOString(),
    displacedBy: entry.displacedBy,
  };

  commit([loop, ...loops.filter((existing) => existing.id !== loop.id)].slice(0, MAX_LOOPS));

  return loop;
}

/** Clear one loop - what the red X in its corner does. */
export function clearLoop(id: string): void {
  const next = loops.filter((loop) => loop.id !== id);

  // Nothing changed: do not wake every listener for a press that removed nothing.
  if (next.length !== loops.length) commit(next);
}

/** Clear them all, for a reader who wants the tab empty. */
export function clearAllLoops(): void {
  if (loops.length > 0) commit(NONE);
}
