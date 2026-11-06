import { comparePartners, MIN_SHARED, npmi } from './closeness';
import { layoutTags } from './layout';
import type { ItemWord, Partner, StationGraph, StationItem, StationRow, StationTag, SweptCounts } from './types';
import { buildWordRules, type WordFact } from './word-facts';
import { cleanWord, eraOf, wordKey } from './words';

/**
 * Turns saved items and their words into the map's data (SPEC-tag-station.md). Pure and repeatable: the same rows always
 * give the same answer, so a check can hold it, and `npm run tags:build` runs exactly this on the mock.
 *
 * SERVER ONLY through `layout.ts`, which brings in the UMAP library: browser code reads the finished graph, never this.
 */

/** Partners kept per word. */
export const MAX_PARTNERS = 30;
/** Words sent to the page, commonest first. The map can't show more, and the answer stays a size a browser can hold. */
export const MAX_TAGS = 2000;
/** Words kept on one item, so one row with hundreds of platform tags can't flood the map. */
const MAX_WORDS_PER_ITEM = 40;
/** A description is only read on the page beside a title. */
const MAX_DESCRIPTION = 400;

const round = (value: number): number => Math.round(value * 1000) / 1000;

export function buildStationGraph(rows: readonly StationRow[], facts: readonly WordFact[] = [], swept: SweptCounts = { counted: 0, words: [] }): StationGraph {
  const rules = buildWordRules(facts);
  const allKeys = new Set<string>();
  // Every spelling of each word, with how often it appears, so the shown spelling is the commonest one.
  const spellings = new Map<string, Map<string, number>>();
  const parsed = rows.map(({ item, claudeWords, seenOnly, listOnly }) => {
    const found = new Map<string, { claude: boolean; platform: boolean }>();
    const note = (raw: unknown, source: 'claude' | 'platform') => {
      const word = cleanWord(raw);
      if (word === null) return;
      const own = wordKey(word);
      if (own.length === 0 || rules.isVague(own)) return;
      const key = rules.canonical(own);
      allKeys.add(own);
      const known = spellings.get(key) ?? new Map<string, number>();
      known.set(word, (known.get(word) ?? 0) + 1);
      spellings.set(key, known);
      const entry = found.get(key) ?? { claude: false, platform: false };
      entry[source] = true;
      found.set(key, entry);
    };
    claudeWords.forEach((word) => note(word, 'claude'));
    (item.tags ?? []).forEach((word) => note(word, 'platform'));
    return { item, seenOnly, listOnly, found: [...found.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).slice(0, MAX_WORDS_PER_ITEM) };
  });

  // The sweep's words count towards the shown spelling too, by how many items carried them.
  const sweptWords = swept.words
    .map((one) => {
      const word = cleanWord(one.word);
      const own = word === null ? '' : wordKey(word);
      return { word, own, entry: one };
    })
    .filter((one): one is { word: string; own: string; entry: (typeof swept.words)[number] } => one.word !== null && one.own.length > 0 && !rules.isVague(one.own));
  for (const { word, own, entry } of sweptWords) {
    const key = rules.canonical(own);
    allKeys.add(own);
    const known = spellings.get(key) ?? new Map<string, number>();
    known.set(word, (known.get(word) ?? 0) + entry.items);
    spellings.set(key, known);
  }

  const nameOf = new Map<string, string>();
  for (const [key, known] of spellings) {
    const best = [...known.entries()].sort(([a, countA], [b, countB]) => countB - countA || (a < b ? -1 : 1))[0];
    nameOf.set(key, best[0]);
  }

  const notCounted = new Set(parsed.filter((one) => one.listOnly).map((one) => one.item.id));
  const items: StationItem[] = parsed
    .map(({ item, seenOnly, listOnly, found }) => {
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
        ...(seenOnly ? { seenOnly: true } : {}),
        ...(listOnly ? { catalogue: true } : {}),
        words,
      };
      return station;
    })
    .sort((a, b) => (a.id < b.id ? -1 : 1));

  const total = items.length - notCounted.size + swept.counted;
  const stats = new Map<string, { count: number; claude: number; platform: number; first: string | null; latest: string | null }>();
  const pairs = new Map<string, number>();
  const pairKey = (a: string, b: string) => (a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`);
  for (const item of items) {
    if (notCounted.has(item.id)) continue;
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

  // A swept item's word still needs dates on the map, but its count is already in the sweep's.
  for (const item of items) {
    if (!notCounted.has(item.id) || !Number.isFinite(Date.parse(item.publishedAt))) continue;
    for (const entry of item.words) {
      const stat = stats.get(entry.word) ?? { count: 0, claude: 0, platform: 0, first: null, latest: null };
      if (stat.first === null || item.publishedAt < stat.first) stat.first = item.publishedAt;
      if (stat.latest === null || item.publishedAt > stat.latest) stat.latest = item.publishedAt;
      stats.set(entry.word, stat);
    }
  }
  // The sweep's counts. Two words can each hold the pair in their top lists, or only one can: the larger is the one that's right.
  const sweptPairs = new Map<string, number>();
  for (const { own, entry } of sweptWords) {
    const name = nameOf.get(rules.canonical(own)) as string;
    const stat = stats.get(name) ?? { count: 0, claude: 0, platform: 0, first: null, latest: null };
    stat.count += entry.items;
    stat.claude += entry.items;
    stats.set(name, stat);
    for (const [other, shared] of Object.entries(entry.partners)) {
      const cleaned = cleanWord(other);
      const otherKey = cleaned === null ? '' : wordKey(cleaned);
      if (otherKey.length === 0 || rules.isVague(otherKey)) continue;
      const otherName = nameOf.get(rules.canonical(otherKey));
      if (otherName === undefined || otherName === name) continue;
      const key = pairKey(name, otherName);
      sweptPairs.set(key, Math.max(sweptPairs.get(key) ?? 0, shared));
    }
  }
  for (const [key, shared] of sweptPairs) pairs.set(key, (pairs.get(key) ?? 0) + shared);

  // The commonest words, and only pairs between them. A word that's only on a listed item, and dropped here, leaves that item's chips too.
  const kept = new Set([...stats.keys()].sort((a, b) => stats.get(b)!.count - stats.get(a)!.count || (a < b ? -1 : 1)).slice(0, MAX_TAGS));
  if (kept.size < stats.size) {
    for (const name of [...stats.keys()]) if (!kept.has(name)) stats.delete(name);
    for (const key of [...pairs.keys()]) {
      const [a, b] = key.split('\u0000');
      if (!kept.has(a) || !kept.has(b)) pairs.delete(key);
    }
    for (const item of items) item.words = item.words.filter((entry) => kept.has(entry.word));
  }
  for (const item of items) item.words = item.words.filter((entry) => stats.has(entry.word));

  const partnersOf = new Map<string, Partner[]>([...stats.keys()].map((name) => [name, []]));
  for (const [key, shared] of pairs) {
    const [a, b] = key.split('\u0000');
    if (!stats.has(a) || !stats.has(b)) continue;
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
      facet: eraOf(name) !== null ? 'era' : rules.facet(wordKey(name)),
      first: stat.first,
      latest: stat.latest,
      x: place.x,
      y: place.y,
      partners: [...partnersOf.get(name)!].sort(comparePartners).slice(0, MAX_PARTNERS),
    };
  });

  // Every spelling that isn't the shown one but lands on it: joined words, and any ever seen in the answers.
  const aliases: Record<string, string> = {};
  const shown = new Set(names.map((name) => wordKey(name)));
  for (const key of allKeys) {
    const name = nameOf.get(rules.canonical(key));
    if (name !== undefined && !shown.has(key)) aliases[key] = name;
  }
  for (const fact of facts) {
    const own = wordKey(fact.word);
    const name = nameOf.get(rules.canonical(own));
    if (own.length > 0 && name !== undefined && !shown.has(own) && !rules.isVague(own)) aliases[own] = name;
  }
  return { tags, items, ...(Object.keys(aliases).length > 0 ? { aliases } : {}), ...(swept.counted > 0 || total > 0 ? { tagged: total } : {}) };
}
