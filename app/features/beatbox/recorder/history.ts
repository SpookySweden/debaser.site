// Undo and redo over whole-song snapshots. Song data never changes in place, so a snapshot
// costs almost nothing. Each entry is one undo step, such as one recorded pass.

export interface History<T> {
  readonly past: readonly T[];
  readonly present: T;
  readonly future: readonly T[];
}

const MAX_UNDO_STEPS = 200;

export function createHistory<T>(present: T): History<T> {
  return { past: [], present, future: [] };
}

export function pushHistory<T>(history: History<T>, next: T): History<T> {
  if (next === history.present) return history;
  return { past: [...history.past, history.present].slice(-MAX_UNDO_STEPS), present: next, future: [] };
}

/** Swaps the latest step for a new version of it, without adding an undo step. */
export function replaceHistory<T>(history: History<T>, next: T): History<T> {
  return { ...history, present: next };
}

export function undoHistory<T>(history: History<T>): History<T> {
  const previous = history.past[history.past.length - 1];
  if (previous === undefined) return history;
  return { past: history.past.slice(0, -1), present: previous, future: [history.present, ...history.future] };
}

export function redoHistory<T>(history: History<T>): History<T> {
  const [next, ...future] = history.future;
  if (next === undefined) return history;
  return { past: [...history.past, history.present], present: next, future };
}
