import type { SupabaseClient } from '@supabase/supabase-js';
import { decodePoolFile, POOL_BUCKET, type PoolFileRow } from '../web/pool-files';
import { poolStore, type PoolFileStore } from '../web/pool-store';
import { canonicalIso, rowToItem, WEB_ITEM_COLUMNS, WEB_ITEMS_TABLE, type WebItemRow } from '../web/rows';
import type { WebItem } from '../web/types';
import { heldFile, heldOrder, seededOrder, type HeldOrder } from './pool-file-cache';
import { poorTitle } from './title-quality';
import type { TagStationRepository } from './repository';
import type { PoolStep, StationRow, SweptCounts, SweptWord } from './types';
import { FACETS, type Facet, type WordFact } from './word-facts';

/**
 * TAG STATION's read of the live data: `web_items` with each item's row from `web_item_tags`, and the tagged results nobody saved
 * from `web_seen_items` (SPEC-tag-station.md). Reads only.
 *
 * The client carries the reader's own session token (`getTagRepository`): `web_item_tags` can be read by signed-in people
 * only, and Row Level Security shows only enabled items. A read that fails throws; the route says so in plain words.
 */

/** PostgREST's own cap on one answer. Newest first, so past this the oldest items drop off the map. */
export const MAX_ITEMS = 1000;

type RowWithWords = WebItemRow & { web_item_tags: { words: string[] | null } | { words: string[] | null }[] | null };

/** Far more different words than a tagged item could bring for a long time, and a limit on the reads of one build. */
const MAX_WORD_PAGES = 20;

/** A row of `web_word_stats` holding how many items have been counted (word sweep's `TOTAL_ROW`). */
const TOTAL_ROW = '#total';
type PoolRow = { id: string; platform: string; external_id: string; host: string | null; kind: string; title: string; creator: string | null; published_at: string | null; words: string[] | null };

/** A swept row as a row of the map. Its addresses are built from its id by each platform's fixed shape, and checked again when they're drawn. */
function poolToRow(row: PoolRow): StationRow {
  const id = row.external_id;
  const addresses: Partial<WebItem> =
    row.platform === 'internet_archive'
      ? { url: `https://archive.org/details/${id}`, canonicalUrl: `https://archive.org/details/${id}`, thumbnailUrl: `https://archive.org/services/img/${id}`, embedUrl: `https://archive.org/embed/${id}` }
      : row.platform === 'peertube' && row.host
        ? { url: `https://${row.host}/videos/watch/${id}`, canonicalUrl: `https://${row.host}/videos/watch/${id}`, embedUrl: `https://${row.host}/videos/embed/${id}` }
        : row.platform === 'openverse'
          ? { url: `https://openverse.org/${row.kind === 'audio' ? 'audio' : 'image'}/${id}`, canonicalUrl: `https://openverse.org/${row.kind === 'audio' ? 'audio' : 'image'}/${id}`, thumbnailUrl: `https://api.openverse.org/v1/${row.kind === 'audio' ? 'audio' : 'images'}/${id}/thumb/` }
          : {};
  const playable = addresses.url !== undefined;
  return {
    item: {
      id: row.id,
      platform: row.platform as WebItem['platform'],
      externalId: id,
      kind: KINDS.includes(row.kind as WebItem['kind']) ? (row.kind as WebItem['kind']) : 'other',
      url: '',
      canonicalUrl: '',
      title: row.title,
      ...(row.creator ? { creator: row.creator } : {}),
      publishedAt: row.published_at ? canonicalIso(row.published_at) : '',
      fetchedAt: '',
      ...addresses,
    },
    claudeWords: row.words ?? [],
    listOnly: true,
    ...(playable ? {} : { seenOnly: true }),
  };
}

/** The map's own sample of the pool: the newest few files, a spread of what's in them. */
const SAMPLE_FILES = 8;

/**
 * One step of digging: files are read two at a time until there are enough rows or it has read the most it may, so a common word costs two files and a rare one six. A file is about 80 KB of the
 * free plan's 5 GB of downloads a month (SPEC-discover.md).
 */
const FILES_AT_ONCE = 2;
const MOST_FILES_PER_STEP = 6;
/** The first step happens by itself, on every search and word, so it reads no more than a press does for a common word's few. */
const MOST_FILES_FIRST_STEP = 4;
const ENOUGH_ROWS = 30;
const MOST_ROWS_PER_STEP = 300;
/** A page of PostgREST's answer, and how many pages of file names to read at most. */
const FILES_PAGE = 1000;
const MOST_FILE_PAGES = 5;
/** The columns of a seen row anyone may read (supabase/migrations/*_web_seen_items.sql). */
const SEEN_COLUMNS = 'id, platform, kind, title, creator, published_at, words';
const KINDS: readonly WebItem['kind'][] = ['audio', 'video', 'image', 'text', 'other'];

type SeenRow = { id: string; platform: string; kind: string | null; title: string | null; creator: string | null; published_at: string | null; words: string[] | null };

/** A seen result as a row of the map: its words and name, and no address, because it was never saved. */
function seenToRow(row: SeenRow): StationRow {
  return {
    item: {
      id: row.id,
      platform: row.platform as WebItem['platform'],
      externalId: row.id.slice(row.platform.length + 1),
      kind: KINDS.includes(row.kind as WebItem['kind']) ? (row.kind as WebItem['kind']) : 'other',
      url: '',
      canonicalUrl: '',
      title: row.title ?? row.id,
      ...(row.creator ? { creator: row.creator } : {}),
      publishedAt: row.published_at ? canonicalIso(row.published_at) : '',
      fetchedAt: '',
    },
    claudeWords: row.words ?? [],
    seenOnly: true,
  };
}

const fileRowToRow = (row: PoolFileRow): StationRow =>
  poolToRow({ id: `${row.platform}:${row.externalId}`, platform: row.platform, external_id: row.externalId, host: row.host, kind: row.kind, title: row.title, creator: row.creator, published_at: row.publishedAt, words: [...row.words] });

export function createSupabaseTagRepository(client: SupabaseClient): TagStationRepository {
  // The reader's own session reads Supabase Storage; Cloudflare R2, if set up, is read by the server once the route has checked that session (pool-store.ts). Reads only.
  const refuseWrite = async () => {
    throw new Error('POOL_READ_ONLY');
  };
  const files: PoolFileStore = poolStore({
    put: refuseWrite,
    remove: refuseWrite,
    get: async (path) => {
      const answer = await client.storage.from(POOL_BUCKET).download(path);
      if (answer.error) {
        if ((answer.error as { statusCode?: string }).statusCode === '404') return null;
        throw new Error('POOL_FILE');
      }
      return new Uint8Array(await answer.data.arrayBuffer());
    },
  });
  const readWholeFile = (path: string) =>
    heldFile(path, async () => {
      const file = await files.get(path);
      // A file that's gone stays gone, so digging goes past it. Any other failure is thrown, and the same press can try again.
      return file === null ? [] : decodePoolFile(file);
    });
  const readFile = (path: string) => readWholeFile(path).catch((): PoolFileRow[] => []);

  /** File names holding any of these word numbers, or every file, as many pages as it takes. */
  const allPaths = async (ids: readonly number[] | null): Promise<string[]> => {
    const paths: string[] = [];
    for (let page = 0; page < MOST_FILE_PAGES; page += 1) {
      const names = client.from('web_pool_shards').select('path');
      const { data, error } = await (ids === null ? names : names.overlaps('words', [...ids])).order('id').range(page * FILES_PAGE, (page + 1) * FILES_PAGE - 1);
      if (error) throw new Error('POOL_FILES');
      paths.push(...((data ?? []) as { path: string }[]).map((row) => row.path));
      if ((data ?? []).length < FILES_PAGE) break;
    }
    return paths;
  };

  /** Which files to dig through. The rarest thing asked for comes first, since a common word's items are everywhere anyway. */
  const fileOrder = (groups: readonly (readonly string[])[]): Promise<HeldOrder> =>
    heldOrder(JSON.stringify(groups), async () => {
      if (groups.length === 0) return { order: [await allPaths(null)], counted: [] };
      const { data, error } = await client.from('web_word_stats').select('id, word, items').in('word', [...new Set(groups.flat())]);
      if (error) throw new Error('POOL_FILES');
      const known = (data ?? []) as { id: number; word: string; items: number }[];
      const counted = known.map(({ word, items }) => ({ word, items }));
      const of = (group: readonly string[]) => known.filter((one) => group.includes(one.word));
      const size = (group: readonly string[]) => of(group).reduce((sum, one) => sum + one.items, 0);
      // Items must carry every group, so only the rarest group's files can hold them.
      if (groups.length > 1) {
        if (groups.some((group) => of(group).length === 0)) return { order: [], counted };
        const rarest = [...groups].sort((a, b) => size(a) - size(b))[0];
        return { order: [await allPaths(of(rarest).map((one) => one.id))], counted };
      }
      if (known.length === 0) return { order: [], counted };
      const rarest = [...known].sort((a, b) => a.items - b.items)[0];
      const first = await allPaths([rarest.id]);
      if (known.length === 1) return { order: [first], counted };
      const inFirst = new Set(first);
      return { order: [first, (await allPaths(known.map((one) => one.id))).filter((path) => !inFirst.has(path))], counted };
    });
  return {
    source: 'supabase',
    async rows(): Promise<StationRow[]> {
      const [saved, seen] = await Promise.all([
        client
          .from(WEB_ITEMS_TABLE)
          .select(`${WEB_ITEM_COLUMNS}, web_item_tags(words)`)
          .order('published_at', { ascending: false })
          .order('id', { ascending: false })
          .limit(MAX_ITEMS),
        client.from('web_seen_items').select(SEEN_COLUMNS).neq('words', '{}').order('published_at', { ascending: false, nullsFirst: false }).order('id', { ascending: false }).limit(MAX_ITEMS),
      ]);
      if (saved.error || seen.error) throw new Error('The words could not be read.');
      const savedRows = ((saved.data ?? []) as unknown as RowWithWords[]).map((row): StationRow => {
        const { web_item_tags: tags, ...itemRow } = row;
        // One row per item, which PostgREST sends as an object; a list is handled too, in case it ever sends that.
        const held = Array.isArray(tags) ? tags[0] : tags;
        return { item: rowToItem(itemRow), claudeWords: held?.words ?? [] };
      });
      // A result saved since is the saved item, with its own words.
      const savedIds = new Set(savedRows.map((row) => row.item.id));
      const seenRows = ((seen.data ?? []) as unknown as SeenRow[]).filter((row) => !savedIds.has(row.id)).map(seenToRow);
      return [...savedRows, ...seenRows];
    },
    async pool(): Promise<{ rows: StationRow[]; swept: SweptCounts; incomplete?: boolean }> {
      const [sample, total, words] = await Promise.all([
        client.from('web_pool_shards').select('path').order('id', { ascending: false }).limit(SAMPLE_FILES),
        // On its own, and quick: a list opening doesn't wait on the rest.
        client.from('web_word_stats').select('items').eq('word', TOTAL_ROW).maybeSingle(),
        // The commonest words only: this read costs the free plan's monthly allowance, and the map can't show more.
        // Words on 20 or more items: the only ones its index holds (`web_word_stats_common20_idx`), and far more of them than the map can show.
        client.from('web_word_stats').select('word, items, partners').gte('items', 20).order('items', { ascending: false }).order('word').limit(MAX_ITEMS),
      ]);
      const opened = await Promise.all(((sample.data ?? []) as { path: string }[]).map(({ path }) => readFile(path)));
      const held = opened.flat();
      const every = Math.max(1, Math.ceil(held.length / MAX_ITEMS));
      const rows = held.filter((_, at) => at % every === 0).map(fileRowToRow);
      const all = words.error ? [] : ((words.data ?? []) as unknown as SweptWord[]);
      return {
        rows,
        swept: {
          counted: (total.data as { items?: number } | null)?.items ?? all.find((one) => one.word === TOTAL_ROW)?.items ?? 0,
          words: all.filter((one) => one.word !== TOTAL_ROW),
        },
        ...(sample.error || total.error || words.error ? { incomplete: true } : {}),
      };
    },
    async poolFiles({ words = [], every, seed, from }): Promise<PoolStep> {
      const groups = every ?? (words.length > 0 ? [words] : []);
      const { order, counted } = await fileOrder(groups);
      const paths = seededOrder(order, seed);
      const wanted = new Set(groups.flat());
      const found: { row: PoolFileRow; score: number }[] = [];
      let at = Math.max(0, from);
      const stop = at + (at === 0 ? MOST_FILES_FIRST_STEP : MOST_FILES_PER_STEP);
      while (at < paths.length && at < stop && found.length < ENOUGH_ROWS) {
        const part = paths.slice(at, Math.min(at + FILES_AT_ONCE, stop));
        for (const file of await Promise.all(part.map(readWholeFile))) {
          for (const row of file) {
            if (groups.length === 0) {
              if (!poorTitle(row.title, row.externalId)) found.push({ row, score: 0 });
            } else if (every === undefined || every.every((group) => row.words.some((word) => group.includes(word)))) {
              const score = row.words.filter((word) => wanted.has(word)).length;
              if (score > 0) found.push({ row, score });
            }
          }
        }
        at += part.length;
      }
      // Browsing takes a spread of what the files hold. Asking takes those with most of the words first; files come in the seed's order, so a list stays steady for a visit.
      const spread = Math.max(1, Math.ceil(found.length / MOST_ROWS_PER_STEP));
      const kept = groups.length === 0 ? found.filter((_, place) => place % spread === 0) : found.sort((a, b) => b.score - a.score).slice(0, MOST_ROWS_PER_STEP);
      return { rows: kept.map(({ row }) => fileRowToRow(row)), next: at < paths.length ? at : null, files: paths.length, counted };
    },
    async poolWords(words): Promise<string[]> {
      const { data, error } = await client.from('web_word_stats').select('word').in('word', [...words]);
      if (error) throw new Error('POOL_FILES');
      return ((data ?? []) as { word: string }[]).map((row) => row.word);
    },
    async wordFacts(): Promise<WordFact[]> {
      // PostgREST's cap is 1,000 rows an answer, so page by page, usually just one. Any failed page means no answers at all this time:
      // half a set would split joined words, and the map keeps what it builds for an hour.
      const rows: { word: string; facet: string | null; same_as: string | null; vague: boolean | null }[] = [];
      for (let page = 0; page < MAX_WORD_PAGES; page += 1) {
        const { data, error } = await client
          .from('web_word_facts')
          .select('word, facet, same_as, vague')
          .not('facet', 'is', null)
          .order('word')
          .range(page * MAX_ITEMS, (page + 1) * MAX_ITEMS - 1);
        if (error) return [];
        rows.push(...((data ?? []) as typeof rows));
        if ((data ?? []).length < MAX_ITEMS) break;
      }
      return rows.map((row) => ({
        word: row.word,
        facet: FACETS.includes(row.facet as Facet) ? (row.facet as Facet) : null,
        sameAs: row.same_as,
        vague: row.vague === true,
      }));
    },
    async limitReached(): Promise<boolean> {
      const { data, error } = await client.rpc('web_tag_limit_reached');
      return error === null && data === true;
    },
  };
}
