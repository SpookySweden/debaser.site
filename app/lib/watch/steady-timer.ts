/**
 * A repeating timer that keeps its pace in a background tab.
 *
 * Chrome slows a hidden, silent tab's timers to one wake-up a minute once it has been hidden five minutes
 * ("intensive throttling"). A host who paused and went to another tab would then write the room once a
 * minute, and the room's rule for a vanished host - quiet for 8 seconds (`watch_take_over`) - would let
 * anybody in the room take over a host who never left. A dedicated worker's own timer is not slowed that
 * way, so it does the counting and the page does the work when told.
 *
 * Where a worker cannot be made (no Worker, a blocked blob address) it falls back to a plain interval.
 */
export function steadyInterval(callback: () => void, ms: number): () => void {
  const every = Math.max(250, Math.floor(ms));

  if (typeof Worker !== 'undefined' && typeof Blob !== 'undefined' && typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function') {
    try {
      const source = URL.createObjectURL(new Blob([`setInterval(function () { postMessage(0); }, ${every});`], { type: 'text/javascript' }));
      const worker = new Worker(source);
      worker.onmessage = () => callback();

      return () => {
        worker.terminate();
        URL.revokeObjectURL(source);
      };
    } catch {
      // Fall through to the page's own timer.
    }
  }

  const timer = setInterval(callback, every);
  return () => clearInterval(timer);
}
