import type { SupabaseClient } from '@supabase/supabase-js';
import { decodePoolFile, POOL_BUCKET, type PoolFileRow } from '../web/pool-files';
import { canonicalIso, rowToItem, WEB_ITEM_COLUMNS, WEB_ITEMS_TABLE, type WebItemRow } from '../web/rows';
import type { WebItem } from '../web/types';
import { heldFile } from './pool-file-cache';
import type { TagStationRepository } from './repository';
import type { StationRow, SweptCounts, SweptWord } from './types';
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
const POOL_COLUMNS = 'id, platform, external_id, host, kind, title, creator, published_at, words';
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

/** How many files one ask reads, and how many rows it answers with. */
const FILES_PER_ASK = 4;
const MOST_ROWS_PER_ASK = 300;
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

export function createSupabaseTagRepository(client: SupabaseClient): TagStationRepository {
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
    async pool(): Promise<{ rows: StationRow[]; swept: SweptCounts }> {
      const [items, words] = await Promise.all([
        client.from('web_pool_items').select(POOL_COLUMNS).order('published_at', { ascending: false, nullsFirst: false }).order('id', { ascending: false }).limit(MAX_ITEMS),
        // The commonest words only: this read costs the free plan's monthly allowance, and the map can't show more.
        client.from('web_word_stats').select('word, items, partners').order('items', { ascending: false }).order('word').limit(MAX_ITEMS),
      ]);
      const rows = items.error ? [] : ((items.data ?? []) as unknown as PoolRow[]).map(poolToRow);
      const all = words.error ? [] : ((words.data ?? []) as unknown as SweptWord[]);
      return {
        rows,
        swept: {
          counted: all.find((one) => one.word === TOTAL_ROW)?.items ?? 0,
          words: all.filter((one) => one.word !== TOTAL_ROW),
        },
      };
    },
    async poolFiles(words, seed): Promise<StationRow[]> {
      if (words.length === 0) return [];
      const { data, error } = await client.rpc('web_pool_shards_for', { p_words: [...words], p_limit: FILES_PER_ASK, p_seed: seed });
      if (error) return [];
      const files = await Promise.all(
        ((data ?? []) as string[]).map((path) =>
          heldFile(path, async () => {
            const answer = await client.storage.from(POOL_BUCKET).download(path);
            if (answer.error) throw new Error('POOL_FILE');
            return decodePoolFile(new Uint8Array(await answer.data.arrayBuffer()));
          }).catch((): PoolFileRow[] => []),
        ),
      );
      const wanted = new Set(words);
      const scored = files.flat().flatMap((row) => {
        const score = row.words.filter((word) => wanted.has(word)).length;
        return score === 0 ? [] : [{ row, score }];
      });
      // Those with most of the words first. Files come in the order the seed gave, so this list stays steady for a visit.
      scored.sort((a, b) => b.score - a.score);
      return scored.slice(0, MOST_ROWS_PER_ASK).map(({ row }) =>
        poolToRow({ id: `${row.platform}:${row.externalId}`, platform: row.platform, external_id: row.externalId, host: row.host, kind: row.kind, title: row.title, creator: row.creator, published_at: row.publishedAt, words: [...row.words] }),
      );
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
