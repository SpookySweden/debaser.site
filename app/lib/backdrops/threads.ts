/**
 * Which backgrounds run their world on a thread of their own (`./backdrop.worker.ts`, PERF 1b), and starting that thread.
 * The `new Worker(new URL(...))` line the bundler reads lives in `app/BackdropThreads.tsx` and registers here (as the studio's
 * workers do, `../animate/workers.ts`), so the checks that compile the backgrounds for Node, which has no `import.meta`
 * there, never meet it.
 *
 * Null where it can't be done - no workers, no OffscreenCanvas (an older browser), nothing registered - or for a background
 * that stays on the page; the page then runs the engine itself, exactly as before.
 */
const starters: Record<string, () => Worker> = {};

export function registerBackdropThreads(list: Record<string, () => Worker>): void {
  Object.assign(starters, list);
}

export function backdropThread(id: string, canvas: HTMLCanvasElement): Worker | null {
  const start = starters[id];
  if (start === undefined) return null;
  if (typeof Worker === 'undefined' || typeof canvas.transferControlToOffscreen !== 'function') return null;
  try {
    return start();
  } catch {
    return null;
  }
}
