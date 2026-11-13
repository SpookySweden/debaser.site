'use client';

import { getSupabaseBrowserClient } from '../supabase/client';
import type { WebItem } from './types';
import type { YouTubeSignals } from './recommend';
import { forgetAccountTaste, readAccountTaste, saveAccountTaste } from './youtube-taste';

/**
 * The browser's half of linking YouTube (youtube-mine.ts). Off until Luke has allowed the YouTube permission in Google
 * Cloud and set NEXT_PUBLIC_GOOGLE_VIDEOS_LINK=on (SPEC-media-picks.md), so nobody meets a Google error screen before then.
 *
 * Google's token sits in the person's own session for about an hour. What it finds is kept in this browser for a week
 * under their account, so the list stays when the token has gone, and only they ever see it: someone else signing in on
 * the same browser gets nothing. UNLINK forgets it.
 */
export const YOUTUBE_LINK_ON = process.env.NEXT_PUBLIC_GOOGLE_VIDEOS_LINK === 'on';

const KEY = 'debaser.youtube-mine.v1';
const LINKER = 'debaser.youtube-linker.v1';
const KEEP_MS = 7 * 86_400_000;

/** What one read found: the videos, and the channels, topics and playlist names that teach the page's order. */
export type YouTubeFound = { items: WebItem[]; channels: { id: string; name: string }[]; topics: string[]; playlists: string[] } & YouTubeSignals;

const NOTHING_FOUND: YouTubeFound = { items: [], channels: [], topics: [], playlists: [] };

const strings = (value: unknown): string[] => (Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : []);

/** Only the shapes a read gives: a kept copy from an older version, or a hand-edited one, is read as far as it fits. */
function found(value: { items?: unknown; channels?: unknown; topics?: unknown; playlists?: unknown }): YouTubeFound {
  return {
    items: Array.isArray(value.items) ? (value.items as WebItem[]) : [],
    channels: Array.isArray(value.channels)
      ? value.channels.filter((entry): entry is { id: string; name: string } => typeof entry?.id === 'string' && typeof entry?.name === 'string')
      : [],
    topics: strings(value.topics),
    playlists: strings(value.playlists),
  };
}

function kept(user: string): YouTubeFound {
  try {
    const saved = JSON.parse(window.localStorage.getItem(KEY) ?? 'null') as { user?: string; at?: number; items?: unknown } | null;
    if (!saved || saved.user !== user || !Array.isArray(saved.items) || typeof saved.at !== 'number' || Date.now() - saved.at > KEEP_MS) return NOTHING_FOUND;
    return found(saved);
  } catch {
    return NOTHING_FOUND;
  }
}

function keep(user: string, what: YouTubeFound): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify({ user, at: Date.now(), ...what }));
  } catch {
    // Kept for this visit only.
  }
}

/** UNLINK: this browser's copy and the account's copy (youtube-taste.ts) both go. */
export function forgetYouTube(): void {
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    // Nothing was kept.
  }
  void forgetAccountTaste();
}

/** Notes who is linking, because choosing another Google account on Google's page can come back as another account here. */
export async function rememberLinker(): Promise<void> {
  const db = getSupabaseBrowserClient();
  if (db === null) return;
  try {
    const { data } = await db.auth.getSession();
    if (data.session) window.sessionStorage.setItem(LINKER, data.session.user.id);
  } catch {
    // Without the note a switch of account simply goes unremarked.
  }
}

function takeLinker(): string | null {
  try {
    const id = window.sessionStorage.getItem(LINKER);
    window.sessionStorage.removeItem(LINKER);
    return id;
  } catch {
    return null;
  }
}

/**
 * `needsLink`: nothing to show, or the link has run out. `fresh`: just read from Google, while its permission lasts
 * (about an hour after linking or REFRESH); otherwise it is what this browser kept, up to a week old.
 */
export type YouTubeMine = YouTubeFound & { needsLink: boolean; wrongAccount: boolean; fresh: boolean };

/**
 * What this person's YouTube offers now, or what was kept. It reads Google by itself on every visit while Google's
 * permission lasts, so linking once is enough for that hour; after that the kept copy is used and REFRESH asks again.
 */
export async function readMine(): Promise<YouTubeMine> {
  const nothing: YouTubeMine = { ...NOTHING_FOUND, needsLink: false, wrongAccount: false, fresh: false };
  const db = getSupabaseBrowserClient();
  if (db === null) return nothing;
  try {
    const { data } = await db.auth.getSession();
    const session = data.session;
    if (!session) return nothing;
    const linker = takeLinker();
    if (linker !== null && linker !== session.user.id) return { ...nothing, needsLink: true, wrongAccount: true };
    const saved = kept(session.user.id);
    if (!session.provider_token) {
      // Nothing kept in this browser (another machine linked it, or the week ran out): the account's channels and
      // topics still teach the order, while LINK YOUTUBE offers the videos again.
      const account = saved.channels.length === 0 && saved.topics.length === 0 ? await readAccountTaste(session.user.id) : null;
      return { ...nothing, ...saved, ...(account ?? {}), needsLink: saved.items.length === 0 };
    }
    const answer = await fetch('/api/web/youtube/mine', {
      method: 'POST',
      headers: { Authorization: `Bearer ${session.access_token}`, 'x-google-token': session.provider_token },
    });
    if (!answer.ok) return { ...nothing, ...saved, needsLink: answer.status === 403 };
    const read = found((await answer.json()) as Record<string, unknown>);
    keep(session.user.id, read);
    void saveAccountTaste(session.user.id, { channels: read.channels, topics: read.topics });
    return { ...nothing, ...read, fresh: true };
  } catch {
    return { ...nothing, needsLink: true };
  }
}
