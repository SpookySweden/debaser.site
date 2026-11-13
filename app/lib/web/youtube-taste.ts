'use client';

import { getSupabaseBrowserClient } from '../supabase/client';

/** A subscribed channel, as youtube-mine.ts reads it (not imported: that file sits with the server's fetching code). */
type YouTubeChannel = { id: string; name: string };

/**
 * YOUR YOUTUBE's channels and topics on the person's account (`user_youtube_taste`, Luke's OK 2026-11-13: "Yes, add
 * it"), so MEDIA leans the same way on their phone and their computer. Only those two: no videos (those stay in the
 * browser for a week, youtube-link.ts), no counts, and never Google's token. Owner only by Row Level Security.
 *
 * A copy older than 30 days is not used (YouTube's terms), and the hourly MEDIA fetch deletes it
 * (`web_forget_old_youtube_taste`). UNLINK deletes it at once. With no Supabase (the mock site) every call does nothing:
 * the browser's own copy is the only one, as it was before.
 */
const KEEP_MS = 30 * 86_400_000;
const MAX_CHANNELS = 50;
const MAX_TOPICS = 30;
const CHANNEL_ID = /^UC[A-Za-z0-9_-]{22}$/;

export type AccountTaste = { channels: YouTubeChannel[]; topics: string[] };

const channelsOf = (value: unknown): YouTubeChannel[] =>
  Array.isArray(value)
    ? value
        .filter((entry): entry is YouTubeChannel => typeof entry?.id === 'string' && CHANNEL_ID.test(entry.id) && typeof entry?.name === 'string')
        .map(({ id, name }) => ({ id, name: name.slice(0, 100) }))
        .slice(0, MAX_CHANNELS)
    : [];

/** What this person's account holds, if it was read from YouTube in the last 30 days. */
export async function readAccountTaste(person: string): Promise<AccountTaste | null> {
  const db = getSupabaseBrowserClient();
  if (db === null) return null;
  try {
    const { data, error } = await db.from('user_youtube_taste').select('channels, topics, updated_at').eq('person', person).maybeSingle();
    if (error || !data || Date.now() - Date.parse(String(data.updated_at)) > KEEP_MS) return null;
    const topics = Array.isArray(data.topics) ? data.topics.filter((word): word is string => typeof word === 'string').slice(0, MAX_TOPICS) : [];
    return { channels: channelsOf(data.channels), topics };
  } catch {
    return null;
  }
}

/** Saves a fresh read over the last one. A save that fails leaves the browser's copy, which works on its own. */
export async function saveAccountTaste(person: string, taste: AccountTaste): Promise<void> {
  const db = getSupabaseBrowserClient();
  if (db === null) return;
  try {
    await db.from('user_youtube_taste').upsert({
      person,
      channels: channelsOf(taste.channels),
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
