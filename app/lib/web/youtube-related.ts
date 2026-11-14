'use client';

import type { SeedVideo } from '../recommender/youtube-picks';
import type { WebItem } from './types';

/**
 * The browser's half of YouTube's "watch next" (youtube-next.ts; Luke, 2026-11-14): which of the person's videos have
 * been asked about, and what came back, kept in this browser for a day under their account. That is what brings channels
 * they are not subscribed to onto YOUR YOUTUBE.
 *
 * Kept small and slow on purpose: a video is asked about once a day at most, and a person's browser asks about at most
 * `DAY_SEEDS` videos a day (the server has its own limit, and its answers are cached by video). The shelf never waits
 * long for it: with something kept, that is used at once and the rest is asked in the background for the next visit.
 * Someone else signing in on this browser gets nothing of it. UNLINK and ERASE do not need to reach it: it holds only
 * public videos' titles, and goes by itself in a day.
 */
const KEY = 'debaser.youtube-next.v1';
const KEEP_MS = 24 * 60 * 60 * 1000;
const DAY_SEEDS = 12;
/** How long a first visit waits for YouTube's answer before showing the shelf without it. */
const WAIT_MS = 2500;

type KeptSeed = { at: number; title: string; items: WebItem[] };
type Kept = { user: string | null; day: number; asked: number; bySeed: Record<string, KeptSeed> };

export type Related = { item: WebItem; seed: string };

const today = () => Math.floor(Date.now() / KEEP_MS);

function read(user: string | null): Kept {
  const empty: Kept = { user, day: today(), asked: 0, bySeed: {} };
  try {
    const saved = JSON.parse(window.localStorage.getItem(KEY) ?? 'null') as Partial<Kept> | null;
    if (!saved || typeof saved.bySeed !== 'object' || saved.bySeed === null) return empty;
    // The mock site has no accounts of its own: whoever's copy it is.
    if (user !== null && saved.user !== user) return empty;
    const bySeed = Object.fromEntries(
      Object.entries(saved.bySeed).filter(([, seed]) => typeof seed?.at === 'number' && Date.now() - seed.at < KEEP_MS && Array.isArray(seed.items) && typeof seed.title === 'string'),
    );
    return { user, day: today(), asked: saved.day === today() && typeof saved.asked === 'number' ? saved.asked : 0, bySeed };
  } catch {
    return empty;
  }
}

function write(kept: Kept): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(kept));
  } catch {
    // Kept for this visit only.
  }
}

/** What is kept for these seeds, in their order, each suggestion with the title of the video it came after. */
export function keptRelated(user: string | null, seeds: readonly SeedVideo[]): Related[] {
  const kept = read(user);
  return seeds.flatMap((seed) => (kept.bySeed[seed.id]?.items ?? []).map((item) => ({ item, seed: kept.bySeed[seed.id].title || seed.title })));
}

/** Asks about the seeds not asked about today, within the day's count, and keeps what comes back. */
async function ask(user: string, token: string, seeds: readonly SeedVideo[], topics: readonly string[]): Promise<void> {
  const kept = read(user);
  const wanted = seeds.filter((seed) => kept.bySeed[seed.id] === undefined).slice(0, Math.max(0, DAY_SEEDS - kept.asked));
  if (wanted.length === 0) return;
  // Counted before asking, so a page opened twice at once cannot ask twice as much.
  write({ ...kept, asked: kept.asked + wanted.length });
  const answer = await fetch('/api/web/youtube/related', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ seeds: wanted.map(({ id, title, creator }) => ({ id, title, creator })), topics: topics.slice(0, 3) }),
  });
  if (!answer.ok) return;
  const body = (await answer.json()) as { related?: { seed?: unknown; items?: unknown }[] };
  const after = read(user);
  for (const one of Array.isArray(body.related) ? body.related : []) {
    const seed = wanted.find((wantedSeed) => wantedSeed.id === one.seed);
    if (seed === undefined || !Array.isArray(one.items)) continue;
    const items = (one.items as WebItem[]).filter((item) => typeof item?.id === 'string' && typeof item?.title === 'string' && item.platform === 'youtube');
    // An empty answer is kept too: the video is not asked about again today.
    after.bySeed[seed.id] = { at: Date.now(), title: seed.title, items };
  }
  write(after);
}

/**
 * The suggestions for these seeds. With something already kept, that at once (the rest is asked in the background and
 * shows next visit); with nothing kept, it waits up to `WAIT_MS` for YouTube. `token` null (the mock site, or signed
 * out): only what is kept.
 */
export async function relatedNow(user: string | null, token: string | null, seeds: readonly SeedVideo[], topics: readonly string[]): Promise<Related[]> {
  if (typeof window === 'undefined' || seeds.length === 0) return [];
  const have = keptRelated(user, seeds);
  if (user === null || token === null) return have;
  const asking = ask(user, token, seeds, topics).catch(() => undefined);
  if (have.length > 0) return have;
  await Promise.race([asking, new Promise((resolve) => window.setTimeout(resolve, WAIT_MS))]);
  return keptRelated(user, seeds);
}
