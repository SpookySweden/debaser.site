'use client';

import { useEffect, useState } from 'react';
import { getMusicRepository } from '../audio/repository';
import { getLettersRepository } from '../letters/repository';
import { getRecommendationsRepository } from '../recommendations/repository';
import { getSupabaseBrowserClient } from '../supabase/client';
import { getPresetStore, withPreset } from '../tag-station/presets';
import { EMPTY_RECIPE } from '../tag-station/recipe';
import { WATCH_DATA_SOURCE } from '../watch/repository';
import type { Person } from './feed-rank';
import { getRecommendationStore, type RecommendedPick } from './recommendations';
import { MAX_PAGE_SIZE } from './paging';
import { getWebRepository } from './repository';
import type { WebItem } from './types';
import type { WebStreamItem } from './dedupe';

/**
 * What MEDIA's default feed, version 2, reads besides what the page already has (SPEC-media-feed-v2.md): the whole saved
 * stream once a visit, and the person's openly shared signals. Every read is one the person may already make elsewhere on
 * the site (their letters, recommendations sent to and by them, VANITY's closeness, the queues of rooms they joined), through
 * the existing stores, so the mock and Supabase sites both answer. Each read has a short time limit; one that fails or is
 * slow leaves its signal out for this visit. Nothing here is sent anywhere or kept.
 */

/** Things a person filed or shared: a MEDIA row's id and the title it was filed with. */
export type FiledThing = { ref: string; title: string };
export type FeedPeopleSignals = {
  letters: readonly FiledThing[];
  recommended: readonly FiledThing[];
  /** Sent to this person in a recommendation, newest first, with who sent it. */
  sent: readonly (FiledThing & { people: readonly Person[] })[];
  /** Queued in rooms this person joined: by anyone (their titles teach), and who queued it. */
  queued: readonly (FiledThing & { by: string | null })[];
  closeness: readonly { id: string; closeness: number }[];
  /** People's public picks (an item id and who), as MEDIA's RECOMMENDED reads them: ANON to a visitor. */
  picks: readonly RecommendedPick[];
  /** The active DISCOVER preset's words (the ones it must or may have). */
  presetWords: readonly string[];
};

export const NO_PEOPLE_SIGNALS: FeedPeopleSignals = { letters: [], recommended: [], sent: [], queued: [], closeness: [], picks: [], presetWords: [] };

const LIMIT_MS = 3000;
/** The whole saved stream's read, page after page: past this the feed weighs the pages it has. */
const POOL_LIMIT_MS = 6000;
/** How many letters and recommendations are opened for their things: the newest. */
const NEWEST = 8;
/** The most saved rows the feed weighs (SPEC-media-feed-v2.md, "The candidates"). */
export const POOL_MAX = 1000;

/** A read that takes too long, or fails, gives `fallback`. */
function within<T>(read: Promise<T>, fallback: T): Promise<T> {
  return Promise.race([read.catch(() => fallback), new Promise<T>((resolve) => window.setTimeout(() => resolve(fallback), LIMIT_MS))]);
}

/** MEDIA rows among a letter's or a recommendation's things. */
const mediaThings = (things: readonly { kind: string; ref: string; title: string }[]): FiledThing[] =>
  things.filter((thing) => thing.kind === 'web').map((thing) => ({ ref: thing.ref, title: thing.title }));

async function readLetters(userId: string): Promise<FiledThing[]> {
  const repository = getLettersRepository();
  const letters = (await repository.listOf(userId)).slice(0, NEWEST);
  const items = await Promise.all(letters.map((letter) => repository.items(letter.id).catch(() => [])));
  return items.flatMap(mediaThings);
}

async function readRecommendations(): Promise<{ sent: FeedPeopleSignals['sent']; recommended: FiledThing[] }> {
  const repository = getRecommendationsRepository();
  const [forMe, mine, oldKey] = await Promise.all([
    repository.list('for_me').catch(() => []),
    repository.list('sent').catch(() => []),
    getRecommendationStore()
      .mine()
      .catch((): string[] => []),
  ]);
  const sent = await Promise.all(
    forMe.slice(0, NEWEST).map(async (rec) => {
      const things = mediaThings(await repository.items(rec.id).catch(() => []));
      const people: Person[] = rec.sender ? [{ id: rec.sender, name: rec.senderName ?? '' }] : [];
      return things.map((thing) => ({ ...thing, people }));
    }),
  );
  const own = await Promise.all(mine.slice(0, NEWEST).map(async (rec) => mediaThings(await repository.items(rec.id).catch(() => []))));
  return { sent: sent.flat(), recommended: [...own.flat(), ...oldKey.map((ref) => ({ ref, title: '' }))] };
}

/** The queues of rooms this person joined (the room refs their history keeps). Members may read them; others get nothing. */
async function readQueued(roomIds: readonly string[]): Promise<FeedPeopleSignals['queued']> {
  if (roomIds.length === 0 || WATCH_DATA_SOURCE !== 'supabase') return [];
  const db = getSupabaseBrowserClient();
  if (db === null) return [];
  const { data, error } = await db
    .from('watch_queue')
    .select('web_ref, source_title, added_by')
    .in('room_id', roomIds.slice(0, 20))
    .not('web_ref', 'is', null)
    .order('added_at', { ascending: false })
    .limit(200);
  if (error || !data) return [];
  return (data as { web_ref: string | null; source_title: string | null; added_by: string | null }[])
    .filter((row) => typeof row.web_ref === 'string' && row.web_ref.includes(':'))
    .map((row) => ({ ref: String(row.web_ref), title: String(row.source_title ?? '').slice(0, 200), by: row.added_by }));
}

async function readPresetWords(): Promise<string[]> {
  const active = (await getPresetStore().list()).find((preset) => preset.active);
  if (active === undefined) return [];
  const recipe = withPreset(EMPTY_RECIPE, active.settings);
  return [...recipe.must, ...recipe.any];
}

async function readCloseness(userId: string): Promise<FeedPeopleSignals['closeness']> {
  const rows = await getMusicRepository().forYou(userId);
  const best = new Map<string, number>();
  for (const row of rows) if (row.personId !== userId) best.set(row.personId, Math.max(best.get(row.personId) ?? 0, row.closeness));
  return [...best].map(([id, closeness]) => ({ id, closeness }));
}

/**
 * The person's shared signals: null until read, empty at once for a visitor. `roomIds`: the rooms their history says they
 * joined (null while the history is unread).
 */
export function useFeedSignals(on: boolean, userId: string | null, signedOut: boolean, roomIds: readonly string[] | null): FeedPeopleSignals | null {
  const [signals, setSignals] = useState<FeedPeopleSignals | null>(null);
  const rooms = roomIds === null ? null : roomIds.join(',');
  useEffect(() => {
    if (!on || signals !== null) return;
    if (!signedOut && (userId === null || rooms === null)) return;
    let live = true;
    void (async () => {
      if (signedOut || userId === null) {
        // A visitor: public picks only, without names (the store answers ANON); nothing about them is read or kept.
        const picks = await within(getRecommendationStore().feed(300), []);
        if (live) setSignals({ ...NO_PEOPLE_SIGNALS, picks });
        return;
      }
      const [letters, recommendations, queued, closeness, picks, presetWords] = await Promise.all([
        within(readLetters(userId), []),
        within(readRecommendations(), { sent: [], recommended: [] }),
        within(readQueued(rooms === null || rooms === '' ? [] : rooms.split(',')), []),
        within(readCloseness(userId), []),
        within(getRecommendationStore().feed(300), []),
        within(readPresetWords(), []),
      ]);
      if (live) setSignals({ letters, recommended: recommendations.recommended, sent: recommendations.sent, queued, closeness, picks, presetWords });
    })();
    return () => {
      live = false;
    };
  }, [on, userId, signedOut, rooms, signals]);
  return signals;
}

/**
 * The whole saved stream (up to `POOL_MAX` rows) with Claude's words, read once a visit: the ranker weighs every saved row,
 * not just the newest page (SPEC-media-feed-v2.md, fix 2). Pages are read one after another through the same `listItems`
 * the stream uses (so Shorts are left out and copies are folded as everywhere); each page's words are asked as it comes.
 */
export function useStreamPool(on: boolean, retry: number): readonly WebStreamItem[] | null {
  const [pool, setPool] = useState<readonly WebStreamItem[] | null>(null);
  /** The `retry` value a read came back empty after failing at: a new value (the stream answered after all) reads again. */
  const [failedAt, setFailedAt] = useState<number | null>(null);
  useEffect(() => {
    if (!on) return;
    if (pool !== null && failedAt !== null && failedAt !== retry) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setFailedAt(null);
      setPool(null);
      return;
    }
    if (pool !== null) return;
    let live = true;
    void (async () => {
      const repository = getWebRepository();
      const rows: WebStreamItem[] = [];
      const wordReads: Promise<void>[] = [];
      let cursor: string | null = null;
      let failed = false;
      // The whole read has a limit too: past it the feed weighs the pages it has, so the first screen never waits for ever.
      const deadline = Date.now() + POOL_LIMIT_MS;
      try {
        do {
          const page: { items: WebStreamItem[]; nextCursor: string | null } = await within(repository.listItems({ cursor, limit: MAX_PAGE_SIZE }), { items: [], nextCursor: null });
          const start = rows.length;
          rows.push(...page.items);
          const ids = page.items.map((item) => item.id);
          wordReads.push(
            repository
              .itemWords(ids)
              .then((words) => {
                for (let i = start; i < start + ids.length; i += 1) rows[i] = { ...rows[i], pickWords: words.get(rows[i].id) ?? rows[i].pickWords };
              })
              .catch(() => undefined),
          );
          cursor = page.nextCursor;
        } while (cursor !== null && rows.length < POOL_MAX && live && Date.now() < deadline);
        await within(Promise.all(wordReads), []);
      } catch {
        // A failed page keeps what came before it: the feed weighs what it has.
        failed = true;
      }
      if (!live) return;
      if (rows.length === 0) failed = true;
      setFailedAt(failed ? retry : null);
      setPool(rows);
    })();
    return () => {
      live = false;
    };
  }, [on, pool, failedAt, retry]);
  return pool;
}

/** A pool row by id, for resolving what a letter or a recommendation names. */
export function poolIndex(pool: readonly WebItem[]): ReadonlyMap<string, WebItem> {
  return new Map(pool.map((item) => [item.id, item]));
}
