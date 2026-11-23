/**
 * Files lately fetched, in memory only and for a few minutes (SPEC-seeing-machine.md: 256 MB, nothing on disk). They were fetched with
 * nobody's cookies, so they are the same for everybody. SERVER ONLY.
 */
import { LIMITS } from './limits';

export type KeptFile = { type: string; body: Uint8Array };

export function createCache(most: number = LIMITS.cacheBytes, lasts: number = LIMITS.cacheMs, now: () => number = Date.now) {
  const files = new Map<string, KeptFile & { until: number }>();
  let size = 0;

  const drop = (key: string) => {
    const file = files.get(key);
    if (file === undefined) return;
    files.delete(key);
    size -= file.body.byteLength;
  };

  return {
    get(key: string): KeptFile | null {
      const file = files.get(key);
      if (file === undefined) return null;
      if (file.until <= now()) {
        drop(key);
        return null;
      }
      // Put at the end: the oldest to be asked for goes first.
      files.delete(key);
      files.set(key, file);
      return file;
    },
    put(key: string, file: KeptFile): void {
      if (file.body.byteLength > most / 8) return;
      drop(key);
      files.set(key, { ...file, until: now() + lasts });
      size += file.body.byteLength;
      for (const oldest of files.keys()) {
        if (size <= most) break;
        drop(oldest);
      }
    },
    size: () => size,
  };
}

const holder = globalThis as typeof globalThis & { debaserSeeingCache?: ReturnType<typeof createCache> };
export const cache = (holder.debaserSeeingCache ??= createCache());
