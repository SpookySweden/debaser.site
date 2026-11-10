'use client';

import { useEffect, useSyncExternalStore } from 'react';
import { getRecommendationsRepository } from './repository';
import type { RecommendationItem, RecommendationSummary, RecommendationTab } from './types';

/**
 * What the recommendations page and the sidebar key have read, shared so a change in one shows in the other: the three
 * lists, each recommendation's things, and who has played what (the faces). Re-read on `refreshRecommendations()`.
 */

type Entry<T> = { value: T | null; error: string | null; loading: boolean };

const lists = new Map<RecommendationTab, Entry<RecommendationSummary[]>>();
const items = new Map<string, Entry<RecommendationItem[]>>();
let players: Record<string, string[]> = {};
const listeners = new Set<() => void>();
let version = 0;

function changed(): void {
  version += 1;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function useVersion(): number {
  return useSyncExternalStore(subscribe, () => version, () => 0);
}

const LOADING: Entry<never> = { value: null, error: null, loading: true };

function loadList(tab: RecommendationTab): void {
  const held = lists.get(tab);
  lists.set(tab, { value: held?.value ?? null, error: null, loading: true });
  changed();
  getRecommendationsRepository()
    .list(tab)
    .then(async (value) => {
      lists.set(tab, { value, error: null, loading: false });
      const found = await getRecommendationsRepository().players(value.map((rec) => rec.id));
      players = { ...players, ...found };
      changed();
    })
    .catch((error: unknown) => {
      lists.set(tab, { value: held?.value ?? null, error: error instanceof Error ? error.message : 'The recommendations could not be read.', loading: false });
      changed();
    });
}

/** One tab's list, read on first use. `who` re-reads it when the reader signs in or out. */
export function useRecommendationList(tab: RecommendationTab, who: string | null): Entry<RecommendationSummary[]> {
  useVersion();
  useEffect(() => {
    loadList(tab);
  }, [tab, who]);
  return lists.get(tab) ?? LOADING;
}

/** One recommendation's things, in order. */
export function useRecommendationItems(id: string | null): Entry<RecommendationItem[]> {
  useVersion();
  useEffect(() => {
    if (!id || items.get(id)?.value) return;
    items.set(id, LOADING);
    changed();
    getRecommendationsRepository()
      .items(id)
      .then(
        (value) => {
          items.set(id, { value, error: null, loading: false });
          changed();
        },
        () => {
          items.set(id, { value: null, error: 'That recommendation could not be read.', loading: false });
          changed();
        },
      );
  }, [id]);
  return id ? (items.get(id) ?? LOADING) : { value: [], error: null, loading: false };
}

/** Who has played something in a recommendation: person ids, earliest first. */
export function usePlayers(id: string): string[] {
  useVersion();
  return players[id] ?? [];
}

/** How many sent to this reader are still unopened: the sidebar key's [ n NEW ]. */
export function useUnreadRecommendations(me: string | null, wanted: boolean): number {
  const list = useRecommendationList('for_me', wanted ? me : null);
  if (!me || !wanted) return 0;
  return (list.value ?? []).filter((rec) => rec.readAt === null).length;
}

export function refreshRecommendations(): void {
  for (const tab of lists.keys()) loadList(tab);
}

/** Opened by a recipient: its NEW mark goes, here and on the sidebar key. */
export async function markOpened(rec: RecommendationSummary, me: string): Promise<void> {
  if (rec.readAt !== null) return;
  await getRecommendationsRepository().markRead(rec.id, me);
  const held = lists.get('for_me');
  if (held?.value) {
    lists.set('for_me', { ...held, value: held.value.map((each) => (each.id === rec.id ? { ...each, readAt: new Date().toISOString() } : each)) });
    changed();
  }
}

/** WATCH, LISTEN or READ pressed inside a recommendation: the reader's face goes beside its title. */
export async function notePlayed(id: string, me: string): Promise<void> {
  if ((players[id] ?? []).includes(me)) return;
  players = { ...players, [id]: [...(players[id] ?? []), me] };
  changed();
  await getRecommendationsRepository().played(id);
}

export async function deleteRecommendation(id: string): Promise<void> {
  await getRecommendationsRepository().remove(id);
  for (const [tab, held] of lists) if (held.value) lists.set(tab, { ...held, value: held.value.filter((rec) => rec.id !== id) });
  changed();
}
