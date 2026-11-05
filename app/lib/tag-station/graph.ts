import { comparePartners, MIN_SHARED, npmi } from './closeness';
import { layoutTags } from './layout';
import type { ItemWord, Partner, StationGraph, StationItem, StationRow, StationTag } from './types';
import { cleanWord, eraOf, wordKey } from './words';

/**
 * Turns saved items and their words into the map's data (SPEC-tag-station.md). Pure and repeatable: the same rows always
 * give the same answer, so a check can hold it, and `npm run tags:build` runs exactly this on the mock.
 *
 * SERVER ONLY through `layout.ts`, which brings in the UMAP library: browser code reads the finished graph, never this.
 */

/** Partners kept per word. */
export const MAX_PARTNERS = 30;
/** Words kept on one item, so one row with hundreds of platform tags can't flood the map. */
const MAX_WORDS_PER_ITEM = 40;
/** A description is only read on the page beside a title. */
const MAX_DESCRIPTION = 400;

const round = (value: number): number => Math.round(value * 1000) / 1000;

export function buildStationGraph(rows: readonly StationRow[]): StationGraph {
  // Every spelling of each word, with how often it appears, so the shown spelling is the commonest one.
  const spellings = new Map<string, Map<string, number>>();
  const parsed = rows.map(({ item, claudeWords }) => {
    const found = new Map<string, { claude: boolean; platform: boolean }>();
    const note = (raw: unknown, source: 'claude' | 'platform') => {
      const word = cleanWord(raw);
      if (word === null) return;
      const key = wordKey(word);
      if (key.length === 0) return;
      const known = spellings.get(key) ?? new Map<string, number>();
      known.set(word, (known.get(word) ?? 0) + 1);
      spellings.set(key, known);
      const entry = found.get(key) ?? { claude: false, platform: false };
      entry[source] = true;
      found.set(key, entry);
    };
    claudeWords.forEach((word) => note(word, 'claude'));
    (item.tags ?? []).forEach((word) => note(word, 'platform'));
    return { item, found: [...found.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).slice(0, MAX_WORDS_PER_ITEM) };
  });

  const nameOf = new Map<string, string>();
  for (const [key, known] of spellings) {
    const best = [...known.entries()].sort(([a, countA], [b, countB]) => countB - countA || (a < b ? -1 : 1))[0];
    nameOf.set(key, best[0]);
  }

  const items: StationItem[] = parsed
    .map(({ item, found }) => {
      const words: ItemWord[] = found.map(([key, source]) => ({ word: nameOf.get(key) as string, ...source }));
      // Named one by one, not spread: only what a row's page needs reaches the answer, and nothing else a row may ever carry.
      const station: StationItem = {
        id: item.id,
        platform: item.platform,
        externalId: item.externalId,
        kind: item.kind,
        url: item.url,
        canonicalUrl: item.canonicalUrl,
        title: item.title,
        publishedAt: item.publishedAt,
        fetchedAt: item.fetchedAt,
        ...(item.creator ? { creator: item.creator } : {}),
        ...(item.description ? { description: item.description.slice(0, MAX_DESCRIPTION) } : {}),
        ...(item.thumbnailUrl ? { thumbnailUrl: item.thumbnailUrl } : {}),
        ...(item.embedUrl ? { embedUrl: item.embedUrl } : {}),
        ...(item.licenseUrl ? { licenseUrl: item.licenseUrl } : {}),
        ...(item.durationSeconds !== undefined ? { durationSeconds: item.durationSeconds } : {}),
        ...(item.language ? { language: item.language } : {}),
        words,
      };
      return station;
    })
    .sort((a, b) => (a.id < b.id ? -1 : 1));

  const total = items.length;
  const stats = new Map<string, { count: number; claude: number; platform: number; first: string | null; latest: string | null }>();
  const pairs = new Map<string, number>();
  const pairKey = (a: string, b: string) => (a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`);
  for (const item of items) {
    for (const entry of item.words) {
      const stat = stats.get(entry.word) ?? { count: 0, claude: 0, platform: 0, first: null, latest: null };
      stat.count += 1;
      if (entry.claude) stat.claude += 1;
      if (entry.platform) stat.platform += 1;
      if (Number.isFinite(Date.parse(item.publishedAt))) {
        if (stat.first === null || item.publishedAt < stat.first) stat.first = item.publishedAt;
        if (stat.latest === null || item.publishedAt > stat.latest) stat.latest = item.publishedAt;
      }
      stats.set(entry.word, stat);
    }
    for (let i = 0; i < item.words.length; i += 1) {
      for (let j = i + 1; j < item.words.length; j += 1) {
        const key = pairKey(item.words[i].word, item.words[j].word);
        pairs.set(key, (pairs.get(key) ?? 0) + 1);
      }
    }
  }

  const partnersOf = new Map<string, Partner[]>([...stats.keys()].map((name) => [name, []]));
  for (const [key, shared] of pairs) {
    const [a, b] = key.split('\u0000');
    const score = round(npmi(shared, stats.get(a)!.count, stats.get(b)!.count, total));
    const close = shared >= MIN_SHARED;
    partnersOf.get(a)!.push({ name: b, shared, npmi: score, close });
    partnersOf.get(b)!.push({ name: a, shared, npmi: score, close });
  }

  const names = [...stats.keys()].sort();
  // Laid out from every partner, before the list is cut for the page: a word's whole row says where it belongs.
  const places = layoutTags(names.map((name) => ({ name, count: stats.get(name)!.count, partners: partnersOf.get(name)! })));

  const tags: StationTag[] = names.map((name) => {
    const stat = stats.get(name)!;
    const place = places.get(name) ?? { x: 0.5, y: 0.5 };
    return {
      name,
      count: stat.count,
      claude: stat.claude,
      platform: stat.platform,
      era: eraOf(name),
      first: stat.first,
      latest: stat.latest,
      x: place.x,
      y: place.y,
      partners: [...partnersOf.get(name)!].sort(comparePartners).slice(0, MAX_PARTNERS),
    };
  });

  return { tags, items };
}
