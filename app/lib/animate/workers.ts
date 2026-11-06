/**
 * Starting a background worker. The `new Worker(new URL(...))` lines the bundler reads live in `app/animate/AnimateBoot.tsx` and register here,
 * so everything else (and the checks that compile it for Node, which has no `import.meta` there) can ask for a worker by name.
 */
export type WorkerName = 'save' | 'regions' | 'export';

const starters: Partial<Record<WorkerName, () => Worker>> = {};

export function registerWorkers(list: Partial<Record<WorkerName, () => Worker>>): void {
  Object.assign(starters, list);
}

/** A new worker, or null where there is no way to make one. */
export function startWorker(name: WorkerName): Worker | null {
  if (typeof Worker === 'undefined') return null;
  try {
    return starters[name]?.() ?? null;
  } catch {
    return null;
  }
}
