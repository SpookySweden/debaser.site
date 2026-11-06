'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { webSessionHeaders } from '../web/web-session';
import { buildIndex, type StationIndex } from './query';
import type { StationItem, StationTag } from './types';
import { eraOf } from './words';

/** One visit's seed: a reader's list stays steady while they look at it, and differs next time. */
const SEED = Math.random().toString(36).slice(2, 12);

/** What's asked of the pool's files: these words, a MEDIA search's text, or whatever the files hold. */
export type PoolAsk = { words: readonly string[] } | { q: string } | { browse: true };

/** All that's been dug up so far. `next` is the place in the files, null when they've run out. `tags` are asked words the map doesn't show, and how many items each is on. */
export type PoolAnswer = { items: readonly StationItem[]; next: number | null; files: number; tags: readonly { word: string; items: number }[] };

const NOTHING: PoolAnswer = { items: [], next: null, files: 0, tags: [] };

const held = new Map<string, Promise<PoolAnswer>>();

async function askFiles(ask: PoolAsk, from: number): Promise<PoolAnswer> {
  const headers = await webSessionHeaders();
  if (headers === null) return NOTHING;
  const query = new URLSearchParams('words' in ask ? ask.words.map((word) => ['word', word]) : []);
  if ('q' in ask) query.set('q', ask.q);
  if ('browse' in ask) query.set('browse', '1');
  // A search shares its files between readers, so the server's copy of them is used again. A list is this reader's own spread.
  if (!('q' in ask)) query.set('seed', SEED);
  if (from > 0) query.set('from', String(from));
  const response = await fetch(`/api/tag-station/more?${query.toString()}`, { headers });
  if (!response.ok) throw new Error('POOL_MORE');
  const body = (await response.json()) as Partial<PoolAnswer>;
  return { items: body.items ?? [], next: body.next ?? null, files: body.files ?? 0, tags: body.tags ?? [] };
}

/** The first step for this ask, or all that's been dug so far this visit. Nothing, never an error, when it can't be read: the list just goes on without it, and the next ask tries again. */
export function poolAnswer(ask: PoolAsk): Promise<PoolAnswer> {
  const key = JSON.stringify(ask);
  const known = held.get(key);
  if (known) return known;
  const load = askFiles(ask, 0).catch((): PoolAnswer => {
    held.delete(key);
    return NOTHING;
  });
  held.set(key, load);
  return load;
}

/** The next step, added to what's there. When it can't be read, what's there stays, and so does the place, so the next press tries the same files again. */
export async function digFurther(ask: PoolAsk, sofar: PoolAnswer): Promise<PoolAnswer> {
  if (sofar.next === null) return sofar;
  try {
    const step = await askFiles(ask, sofar.next);
    const seen = new Set(sofar.items.map((item) => item.id));
    const merged: PoolAnswer = { items: [...sofar.items, ...step.items.filter((item) => !seen.has(item.id))], next: step.next, files: step.files, tags: sofar.tags };
    held.set(JSON.stringify(ask), Promise.resolve(merged));
    return merged;
  } catch {
    return sofar;
  }
}

/** A word the map doesn't show, as a word a list can be made from. It has a place, so the map can mark it when it's chosen, and no neighbours yet. */
function offMapTag({ word, items }: { word: string; items: number }): StationTag {
  let hash = 7;
  for (const letter of word) hash = (Math.imul(hash, 31) + letter.charCodeAt(0)) >>> 0;
  return { name: word, count: items, claude: items, platform: 0, era: eraOf(word), facet: null, first: null, latest: null, x: 0.1 + ((hash % 800) / 1000), y: 0.1 + (((hash >>> 10) % 800) / 1000), partners: [] };
}

/** The index with these items added to what can be listed, and any asked word the map doesn't show. The map's own words stay as they are. */
export function withMore(index: StationIndex, more: readonly StationItem[], tags: readonly { word: string; items: number }[] = []): StationIndex {
  const fresh = more.filter((item) => !index.itemById.has(item.id));
  const newWords = tags.filter((tag) => !index.tagByName.has(tag.word));
  if (fresh.length === 0 && newWords.length === 0) return index;
  return { ...buildIndex({ ...index.graph, items: [...index.graph.items, ...fresh], tags: [...index.graph.tags, ...newWords.map(offMapTag)] }), total: index.total };
}

export type Digging = {
  answer: PoolAnswer;
  /** The first step is still on its way. */
  loading: boolean;
  /** A later step is on its way. */
  digging: boolean;
  /** There are files left to read. */
  more: boolean;
  dig: () => void;
};

/** One ask's items and the way to dig for more. Null asks for nothing. */
export function useDigging(ask: PoolAsk | null): Digging {
  const key = ask === null ? '' : JSON.stringify(ask);
  const [found, setFound] = useState<{ key: string; answer: PoolAnswer }>({ key: '', answer: NOTHING });
  const [digging, setDigging] = useState(false);
  useEffect(() => {
    if (key === '') return;
    let live = true;
    void poolAnswer(JSON.parse(key) as PoolAsk).then((answer) => {
      if (live) setFound({ key, answer });
    });
    return () => {
      live = false;
    };
  }, [key]);
  const answer = found.key === key ? found.answer : NOTHING;
  const dig = useCallback(() => {
    if (digging || key === '' || found.key !== key || found.answer.next === null) return;
    setDigging(true);
    void digFurther(JSON.parse(key) as PoolAsk, found.answer).then((next) => {
      setFound((current) => (current.key === key ? { key, answer: next } : current));
      setDigging(false);
    });
  }, [digging, found, key]);
  return { answer, loading: key !== '' && found.key !== key, digging, more: answer.next !== null, dig };
}

/** The map's index, with what's been dug up for this ask added to what can be listed. */
export function useMoreItems(index: StationIndex | null, ask: PoolAsk | null): Digging & { index: StationIndex | null } {
  const digging = useDigging(index === null ? null : ask);
  const { answer } = digging;
  const withItems = useMemo(() => (index === null ? null : withMore(index, answer.items, answer.tags)), [index, answer]);
  return { ...digging, index: withItems };
}

/** How far through the files a list has got, for the line beside its [ MORE ]. Empty when nothing has been read yet. */
export function digLine({ next, files }: PoolAnswer): string {
  if (files === 0) return '';
  return next === null ? `READ ALL ${files} FILES.` : `READ ${next} OF ${files} FILES.`;
}
