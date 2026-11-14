'use client';

import type { ChannelEvidence, ChannelStanding } from '../recommender/youtube-picks';
import { keptAsEvidence, keptChannels } from '../recommender/youtube-read';
import { getSupabaseBrowserClient } from '../supabase/client';

/**
 * YOUR YOUTUBE's channels and topics on the person's account (`user_youtube_taste`, Luke's OK 2026-11-13: "Yes, add
 * it"), so MEDIA leans the same way on their phone and their computer. Only those two: no videos (those stay in the
 * browser for a week, youtube-link.ts), no counts, and never Google's token. Owner only by Row Level Security.
 *
 * Since 2026-11-14 (Luke's OK: "up to 50 channels that matter, each with subscribed yes/no and its latest like or add
 * date") the channels kept are the ones that stand first (subscribed or not), each with whether it is subscribed and
 * the day of its latest like or playlist add, so another device does not take every subscription for an unwatched one.
 *
 * A copy older than 30 days is not used (YouTube's terms), and the hourly MEDIA fetch deletes it
 * (`web_forget_old_youtube_taste`). UNLINK deletes it at once. With no Supabase (the mock site) every call does nothing:
 * the browser's own copy is the only one, as it was before.
 */
const KEEP_MS = 30 * 86_400_000;
const MAX_TOPICS = 30;

/** What the account gives back: the subscriptions, the topic words, and what each kept channel has to show. */
export type AccountTaste = { channels: { id: string; name: string }[]; topics: string[]; evidence: ChannelEvidence[] };

/** What this person's account holds, if it was read from YouTube in the last 30 days. */
export async function readAccountTaste(person: string): Promise<AccountTaste | null> {
  const db = getSupabaseBrowserClient();
  if (db === null) return null;
  try {
    const { data, error } = await db.from('user_youtube_taste').select('channels, topics, updated_at').eq('person', person).maybeSingle();
    if (error || !data || Date.now() - Date.parse(String(data.updated_at)) > KEEP_MS) return null;
    const topics = Array.isArray(data.topics) ? data.topics.filter((word): word is string => typeof word === 'string').slice(0, MAX_TOPICS) : [];
    const evidence = keptAsEvidence(data.channels);
    return { channels: evidence.filter((channel) => channel.subscribed).map(({ id, name }) => ({ id, name })), topics, evidence };
  } catch {
    return null;
  }
}

/** Saves a fresh read over the last one. A save that fails leaves the browser's copy, which works on its own. */
export async function saveAccountTaste(person: string, taste: { evidence: readonly ChannelEvidence[]; standings: readonly ChannelStanding[]; topics: readonly string[] }): Promise<void> {
  const db = getSupabaseBrowserClient();
  if (db === null) return;
  try {
    await db.from('user_youtube_taste').upsert({
      person,
      channels: keptChannels(taste.evidence, taste.standings),
      topics: taste.topics.slice(0, MAX_TOPICS).map((word) => word.slice(0, 60)),
      updated_at: new Date().toISOString(),
    });
  } catch {
    // The browser's copy stands.
  }
}

/** UNLINK: the account's copy goes at once. */
export async function forgetAccountTaste(): Promise<void> {
  const db = getSupabaseBrowserClient();
  if (db === null) return;
  try {
    const { data } = await db.auth.getSession();
    const person = data.session?.user.id;
    if (person) await db.from('user_youtube_taste').delete().eq('person', person);
  } catch {
    // Nothing to forget, or it goes in 30 days by itself.
  }
}
