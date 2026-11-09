import { brotliCompressSync, brotliDecompressSync, constants } from 'node:zlib';
import { unstable_cache } from 'next/cache';
import { stationFacts, stationGraph, stationIncomplete } from './graph-cache';
import type { TagStationRepository } from './repository';
import type { StationGraph } from './types';
import type { WordFact } from './word-facts';

/**
 * The built map, kept where every server can reach it (Next's cache, which outlasts a server and a deploy). Building one takes 15 seconds or more, and every fresh
 * server used to build its own while a reader waited. Now a reader gets the kept one in a blink, and when it's old it's rebuilt behind the scenes. SERVER ONLY. One map
 * for everyone, whoever's request built it: since 2026-11-09 visitors may read everything it is built from (MEDIA opened to them, and the spend flag with
 * 20261109011919_media_visitors_tag_limit.sql), so a visitor's map and a reader's are the same. A new read added here must be readable by visitors too, or the
 * map would differ by who asked first. The routes' answers are never kept by Vercel's edge.
 *
 * Packed, because the cache takes 2 MB an item and the map is about 4 MB as text: 700 KB or so like this.
 */
const REBUILD_SECONDS = 3 * 60 * 60;
/** How long this server keeps its unpacked copy before asking the shared one again. */
const HELD_MS = 10 * 60 * 1000;
const MAX_PACKED = 1_900_000;

export type SharedMap = { graph: StationGraph; facts: readonly WordFact[] };

export function packMap(map: SharedMap): string {
  return brotliCompressSync(Buffer.from(JSON.stringify(map), 'utf8'), { params: { [constants.BROTLI_PARAM_QUALITY]: 9 } }).toString('base64');
}

export function unpackMap(packed: string): SharedMap {
  return JSON.parse(brotliDecompressSync(Buffer.from(packed, 'base64')).toString('utf8')) as SharedMap;
}

let held: { map: SharedMap; at: number } | null = null;

/** The map and the word pass's answers. Anything short of a whole map is never shared: this server shows it for a few minutes, and the next ask tries again. */
export async function sharedStationMap(repository: TagStationRepository): Promise<SharedMap> {
  if (held !== null && Date.now() - held.at < HELD_MS) return held.map;
  const build = async (): Promise<SharedMap> => ({
    graph: await stationGraph(() => repository.rows(), Date.now(), () => repository.limitReached(), () => repository.wordFacts(), () => repository.pool()),
    facts: stationFacts(),
  });
  try {
    const packed = await unstable_cache(
      async () => {
        const map = await build();
        const text = packMap(map);
        if (stationIncomplete() || text.length > MAX_PACKED) throw new Error('MAP_NOT_SHARED');
        return text;
      },
      ['tag-station-map-1', repository.source],
      { revalidate: REBUILD_SECONDS },
    )();
    const map = unpackMap(packed);
    held = { map, at: Date.now() };
    return map;
  } catch {
    return build();
  }
}
