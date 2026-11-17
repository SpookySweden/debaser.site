'use client';

import { registerBackdropThreads } from './lib/backdrops/threads';

// FLUID's world on a thread of its own (PERF 1b). Kept out of the backgrounds' own files so the checks that compile them for
// Node never meet `import.meta` (see `./lib/backdrops/threads.ts`).
registerBackdropThreads({
  fluid: () => new Worker(new URL('./lib/backdrops/backdrop.worker.ts', import.meta.url)),
});

/** Draws nothing: it is here so the line above is in every page's code before a background starts. */
export default function BackdropThreads() {
  return null;
}
