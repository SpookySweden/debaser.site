import type { PoolFileRow } from '../web/pool-files';

/**
 * A pool file never changes once written, so it's kept in the server's memory while there's room: about 40,000 rows at most. SERVER ONLY. The route has
 * checked the reader's session before anything here is asked for.
 */
const FILES_HELD = 20;
const heldFiles = new Map<string, Promise<PoolFileRow[]>>();

export function heldFile(path: string, read: () => Promise<PoolFileRow[]>): Promise<PoolFileRow[]> {
  const known = heldFiles.get(path);
  if (known) return known;
  const load = read().catch((problem) => {
    heldFiles.delete(path);
    throw problem;
  });
  heldFiles.set(path, load);
  for (const oldest of heldFiles.keys()) {
    if (heldFiles.size <= FILES_HELD) break;
    heldFiles.delete(oldest);
  }
  return load;
}
