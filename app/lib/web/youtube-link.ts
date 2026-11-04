'use client';

import { getSupabaseBrowserClient } from '../supabase/client';
import type { WebItem } from './types';

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

function kept(user: string): WebItem[] {
  try {
    const saved = JSON.parse(window.localStorage.getItem(KEY) ?? 'null') as { user?: string; at?: number; items?: WebItem[] } | null;
    if (!saved || saved.user !== user || !Array.isArray(saved.items) || typeof saved.at !== 'number' || Date.now() - saved.at > KEEP_MS) return [];
    return saved.items;
  } catch {
    return [];
  }
}

function keep(user: string, items: readonly WebItem[]): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify({ user, at: Date.now(), items }));
  } catch {
    // Kept for this visit only.
  }
}

export function forgetYouTube(): void {
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    // Nothing was kept.
  }
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

export type YouTubeMine = { items: WebItem[]; needsLink: boolean; wrongAccount: boolean };

/** What this person's YouTube offers now, or what was kept. `needsLink`: nothing to show, or the link has run out. */
export async function readMine(): Promise<YouTubeMine> {
  const nothing: YouTubeMine = { items: [], needsLink: false, wrongAccount: false };
  const db = getSupabaseBrowserClient();
  if (db === null) return nothing;
  try {
    const { data } = await db.auth.getSession();
    const session = data.session;
    if (!session) return nothing;
    const linker = takeLinker();
    if (linker !== null && linker !== session.user.id) return { items: [], needsLink: true, wrongAccount: true };
    const saved = kept(session.user.id);
    if (!session.provider_token) return { items: saved, needsLink: saved.length === 0, wrongAccount: false };
    const answer = await fetch('/api/web/youtube/mine', {
      method: 'POST',
      headers: { Authorization: `Bearer ${session.access_token}`, 'x-google-token': session.provider_token },
    });
    if (!answer.ok) return { items: saved, needsLink: answer.status === 403, wrongAccount: false };
    const { items } = (await answer.json()) as { items: WebItem[] };
    keep(session.user.id, items);
    return { items, needsLink: false, wrongAccount: false };
  } catch {
    return { ...nothing, needsLink: true };
  }
}
