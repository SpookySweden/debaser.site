/**
 * Which backgrounds run their world on a thread of their own (`./backdrop.worker.ts`, PERF 1b), and starting that thread.
 * Null where it can't be done - no workers, no OffscreenCanvas (an older browser) - or for a background that stays on the
 * page; the page then runs the engine itself, exactly as before.
 */
export function backdropThread(id: string, canvas: HTMLCanvasElement): Worker | null {
  if (id !== 'fluid') return null;
  if (typeof Worker === 'undefined' || typeof canvas.transferControlToOffscreen !== 'function') return null;
  try {
    return new Worker(new URL('./backdrop.worker.ts', import.meta.url));
  } catch {
    return null;
  }
}
