'use client';

import { useEffect, useSyncExternalStore } from 'react';
import { getSupabaseBrowserClient } from '../supabase/client';
import { WEB_DATA_SOURCE } from './repository';
import type { WebItem, WebPlatform } from './types';

/**
 * Recommending (Luke, 2026-11-05; SPEC-discover.md): one press of `[ RECOMMEND ]` on a MEDIA row, pressed again to take it back, with no note.
 * Only names travel: a platform and an id, through the database function `web_recommend_set`, so a browser can't put text anywhere. The same
 * press asks for the item to be saved into the stream, so a recommended row can still be played later.
 *
 * Mock and Supabase stores behind one switch (`NEXT_PUBLIC_WEB_DATA_SOURCE`). The mock keeps them for the page load: it has no database.
 */

/**
 * Said on the PRIVACY tab and beside the list. Since 2026-11-10 (SPEC-recommendations.md) people's picks are the MEDIA things in
 * public recommendations: posting one publicly is the choice, so there's no switch to turn off.
 */
export const RECOMMEND_NOTE =
  "PEOPLE'S PICKS HERE ARE MEDIA THINGS IN PUBLIC RECOMMENDATIONS (THE RECOMMENDATIONS PAGE). WHEN YOU POST ONE PUBLICLY, SIGNED-IN PEOPLE SEE YOUR NAME, PICTURE AND STATUS NEXT TO IT. DELETE IT THERE TO TAKE IT BACK.";

/** Rows that can't be recommended: KINO's and media servers' carry TMDB's words, and have no id the stream can save. */
const RECOMMENDABLE: readonly WebPlatform[] = ['internet_archive', 'youtube', 'peertube', 'wikimedia_commons', 'openverse', 'vimeo'];

export function canRecommend(item: Pick<WebItem, 'platform' | 'media'>): boolean {
  return item.media === undefined && RECOMMENDABLE.includes(item.platform);
}

export type RecommendedPick = { person: string; displayName: string; itemId: string; at: string };

/** The start of a `person` that stands for nobody known: a recommendation a visitor sees without its name. */
export const ANON_PERSON = 'anon:';

export type RecommendationStore = {
  /** Item ids this reader has recommended. */
  mine(): Promise<string[]>;
  set(item: Pick<WebItem, 'id' | 'platform' | 'externalId'>, on: boolean): Promise<void>;
  /** Everyone's, newest first. */
  feed(limit: number): Promise<RecommendedPick[]>;
};

const mockMine = new Set<string>();
const MOCK_STORE: RecommendationStore = {
  mine: async () => [...mockMine],
  set: async (item, on) => {
    if (on) mockMine.add(item.id);
    else mockMine.delete(item.id);
  },
  feed: async () => [...mockMine].map((itemId) => ({ person: 'mock-reader', displayName: 'YOU', itemId, at: '2026-11-05T00:00:00.000Z' })),
};

const SUPABASE_STORE: RecommendationStore = {
  mine: async () => {
    const db = getSupabaseBrowserClient();
    if (db === null) return [];
    const { data, error } = await db.from('web_recommendations').select('platform, external_id').limit(1000);
    if (error) throw new Error('Your recommendations could not be read.');
    return ((data ?? []) as { platform: string; external_id: string }[]).map((row) => `${row.platform}:${row.external_id}`);
  },
  set: async (item, on) => {
    const db = getSupabaseBrowserClient();
    if (db === null) throw new Error('Sign in to recommend.');
    const { error } = await db.rpc('web_recommend_set', { p_platform: item.platform, p_external_id: item.externalId, p_on: on });
    if (error) throw new Error('That could not be saved. Try again.');
  },
  feed: async (limit) => {
    const db = getSupabaseBrowserClient();
    if (db === null) return [];
    const { data, error } = await db.rpc('web_recommendations_feed', { p_limit: limit });
    if (error) throw new Error('The recommendations could not be read.');
    // A visitor gets no person or name (the board's ANON rule; supabase/migrations/*_media_open_to_visitors.sql): each such
    // recommendation is its own ANON.
    return ((data ?? []) as { person: string | null; display_name: string | null; item_id: string; created_at: string }[]).map((row, at) => ({
      person: row.person ?? `${ANON_PERSON}${at}`,
      displayName: row.person === null ? 'ANON' : (row.display_name ?? 'ANON'),
      itemId: row.item_id,
      at: row.created_at,
    }));
  },
};

export function getRecommendationStore(): RecommendationStore {
  return WEB_DATA_SOURCE === 'supabase' ? SUPABASE_STORE : MOCK_STORE;
}

/** The reader's own, shared by every row on the page, read once per account, because signing out and in doesn't reload the page. */
let mineNow: ReadonlySet<string> = new Set<string>();
let loadedFor: string | null = null;
const listeners = new Set<() => void>();
const publish = (next: ReadonlySet<string>) => {
  mineNow = next;
  listeners.forEach((listener) => listener());
};
const NOTHING: ReadonlySet<string> = new Set<string>();

export function useMyRecommendations(userId: string | null): ReadonlySet<string> {
  useEffect(() => {
    if (userId === loadedFor) return;
    loadedFor = userId;
    publish(NOTHING);
    if (userId === null) return;
    void getRecommendationStore()
      .mine()
      .then((ids) => {
        // Only if it's still this person: they may have signed out while it was asked.
        if (loadedFor === userId) publish(new Set(ids));
      })
      .catch(() => {
        // Keys just start off; pressing one still works, and says so if it can't. The next row to appear asks again.
        if (loadedFor === userId) loadedFor = null;
      });
  }, [userId]);
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    () => mineNow,
    () => NOTHING,
  );
}

/** One press. The key changes at once and goes back if the save fails. */
export async function toggleRecommendation(item: Pick<WebItem, 'id' | 'platform' | 'externalId'>): Promise<boolean> {
  const on = !mineNow.has(item.id);
  const next = new Set(mineNow);
  if (on) next.add(item.id);
  else next.delete(item.id);
  publish(next);
  try {
    await getRecommendationStore().set(item, on);
    return on;
  } catch (problem) {
    publish(new Set([...mineNow].filter((id) => id !== item.id).concat(on ? [] : [item.id])));
    throw problem;
  }
}
