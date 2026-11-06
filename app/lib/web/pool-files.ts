import { brotliCompressSync, brotliDecompressSync, constants } from 'node:zlib';

/**
 * Swept items as compressed files (Luke, 2026-11-06: "find a way around the database limit"; SPEC-discover.md). A row in the database takes about
 * 520 bytes, so the free plan's 500 MB holds far fewer than the 1.7 million items the sweep can read. The same row in one of these files takes
 * about 30: columns, the file's own list of words, and Brotli over the lot. SERVER ONLY.
 *
 * Metadata only, like the table they replace: source, id, type, title, creator, date, Claude's words and a film's TMDB number from Wikidata. No
 * description, no counts, no person. A file is written once by the job and never changes, so it can be kept in memory for as long as there's room.
 */

export type PoolFileRow = {
  platform: string;
  externalId: string;
  host: string | null;
  kind: string;
  title: string;
  creator: string | null;
  /** ISO, or null. Whole seconds are kept, which is all a date needs. */
  publishedAt: string | null;
  tmdbRef: string | null;
  words: readonly string[];
};

export const POOL_BUCKET = 'web-pool';

/** The items in one file. Small enough to fetch in a blink, and a list reads only a few. */
export const ITEMS_PER_FILE = 2000;

type Columns = {
  v: 1;
  /** Each file's own list of what repeats. */
  platforms: string[];
  kinds: string[];
  words: string[];
  p: number[];
  x: string[];
  h: string[];
  k: number[];
  t: string[];
  c: string[];
  /** Seconds, or 0 for no date. */
  d: number[];
  m: string[];
  /** Indexes into `words`. */
  w: number[][];
};

/** Rows as a file. Pure. */
export function encodePoolFile(rows: readonly PoolFileRow[]): Buffer {
  const indexer = () => {
    const seen = new Map<string, number>();
    return {
      seen,
      of: (value: string): number => {
        const at = seen.get(value);
        if (at !== undefined) return at;
        seen.set(value, seen.size);
        return seen.size - 1;
      },
    };
  };
  const platforms = indexer();
  const kinds = indexer();
  const words = indexer();
  const columns: Columns = {
    v: 1,
    p: rows.map((row) => platforms.of(row.platform)),
    x: rows.map((row) => row.externalId),
    h: rows.map((row) => row.host ?? ''),
    k: rows.map((row) => kinds.of(row.kind)),
    t: rows.map((row) => row.title),
    c: rows.map((row) => row.creator ?? ''),
    d: rows.map((row) => {
      const time = row.publishedAt === null ? Number.NaN : Date.parse(row.publishedAt);
      return Number.isFinite(time) ? Math.floor(time / 1000) : 0;
    }),
    m: rows.map((row) => row.tmdbRef ?? ''),
    w: rows.map((row) => row.words.map(words.of)),
    platforms: [],
    kinds: [],
    words: [],
  };
  columns.platforms = [...platforms.seen.keys()];
  columns.kinds = [...kinds.seen.keys()];
  columns.words = [...words.seen.keys()];
  return brotliCompressSync(Buffer.from(JSON.stringify(columns), 'utf8'), {
    params: { [constants.BROTLI_PARAM_QUALITY]: 9, [constants.BROTLI_PARAM_LGWIN]: 22 },
  });
}

/** A file back as rows. Throws on anything that isn't one. */
export function decodePoolFile(file: Uint8Array): PoolFileRow[] {
  const columns = JSON.parse(brotliDecompressSync(file).toString('utf8')) as Columns;
  if (columns.v !== 1) throw new Error('POOL_FILE');
  return columns.x.map((externalId, at) => ({
    platform: columns.platforms[columns.p[at]],
    externalId,
    host: columns.h[at] || null,
    kind: columns.kinds[columns.k[at]],
    title: columns.t[at],
    creator: columns.c[at] || null,
    publishedAt: columns.d[at] === 0 ? null : new Date(columns.d[at] * 1000).toISOString(),
    tmdbRef: columns.m[at] || null,
    words: columns.w[at].map((one) => columns.words[one]),
  }));
}

/** Every different word in some rows, for the file's row in `web_pool_shards`. */
export function wordsIn(rows: readonly PoolFileRow[]): string[] {
  return [...new Set(rows.flatMap((row) => row.words))].sort();
}
