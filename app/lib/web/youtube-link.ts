'use client';

import { readHistory } from '../recommender/history';
import { readSummary } from '../recommender/watch-summary';
import type { HistoryRow } from '../recommender/types';
import { asRead, NOTHING_READ, watchedHere, weigh, type YouTubeFound as Found, type YouTubeRead } from '../recommender/youtube-read';
import { getSupabaseBrowserClient } from '../supabase/client';
import type { WebItem } from './types';
import { relatedNow } from './youtube-related';
import { forgetAccountTaste, readAccountTaste, saveAccountTaste } from './youtube-taste';

/**
 * The browser's half of linking YouTube (youtube-mine.ts). Off until Luke has allowed the YouTube permission in Google
 * Cloud and set NEXT_PUBLIC_GOOGLE_VIDEOS_LINK=on (SPEC-media-picks.md), so nobody meets a Google error screen before then.
 *
 * Google's token sits in the person's own session for about an hour. What it finds is kept in this browser for a week
 * under their account, so the list stays when the token has gone, and only they ever see it: someone else signing in on
 * the same browser gets nothing. UNLINK forgets it.
 *
 * What is shown is worked out here, on every visit, from what was read and the person's own history on this site
 * (Luke, 2026-11-14; `recommender/youtube-read.ts` and `youtube-picks.ts`): the channels that still stand, a shelf of
 * about 7 familiar videos to 3 new ones, and a why for each. A subscription they no longer watch teaches and shows nothing.
 */
export const YOUTUBE_LINK_ON = process.env.NEXT_PUBLIC_GOOGLE_VIDEOS_LINK === 'on';

const KEY = 'debaser.youtube-mine.v1';
const LINKER = 'debaser.youtube-linker.v1';
const KEEP_MS = 7 * 86_400_000;

/** What the page is handed: the shelf in order (`items`, and `picks` with each one's why), and the channels that stand. */
export type YouTubeFound = Found<WebItem>;

const NOTHING_FOUND: YouTubeFound = weigh<WebItem>(NOTHING_READ, [], 0);

/** What this browser kept for this account. `user` null (the mock site, which has no accounts of its own): whoever's it is. */
function kept(user: string | null): YouTubeRead<WebItem> {
  try {
    const saved = JSON.parse(window.localStorage.getItem(KEY) ?? 'null') as ({ user?: string; at?: number } & Record<string, unknown>) | null;
    if (!saved || (user !== null && saved.user !== user) || typeof saved.at !== 'number' || Date.now() - saved.at > KEEP_MS) return NOTHING_READ;
    if (!Array.isArray(saved.uploads) && !Array.isArray(saved.items)) return NOTHING_READ;
    return asRead<WebItem>(saved);
  } catch {
    return NOTHING_READ;
  }
}

function keep(user: string, what: YouTubeRead<WebItem>): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify({ user, at: Date.now(), ...what }));
  } catch {
    // Kept for this visit only.
  }
}

/** UNLINK: this browser's copy and the account's copy (youtube-taste.ts) both go, and the page load's own read with them. */
export function forgetYouTube(): void {
  readOnce = null;
  lastShelf = null;
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

/** What the last read had to weigh, kept for the visit so a press of the feedback key can reshape the shelf at once. */
let lastShelf: { read: YouTubeRead<WebItem>; related: Awaited<ReturnType<typeof relatedNow>> } | null = null;

/**
 * The same read weighed again with the person's history as it is now (after NOT FOR ME, SHOW LESS FROM THIS CHANNEL,
 * MORE LIKE THIS or an import). Nothing is asked of Google or YouTube. Null when nothing has been read yet.
 */
export async function reweighMine(): Promise<YouTubeFound | null> {
  if (lastShelf === null) return null;
  const { read, related } = lastShelf;
  const [rows, summary] = await Promise.all([readHistory(3000).catch((): HistoryRow[] => []), readSummary()]);
  return weigh(read, rows, Date.now(), { related, summary });
}

let readOnce: Promise<YouTubeMine> | null = null;

/** `readMine`, asked once per page load and shared (DISCOVER's FOR YOU lane and its map chips both use it). */
export function readMineOnce(): Promise<YouTubeMine> {
  readOnce ??= readMine();
  return readOnce;
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
  try {
    // The person's own history on this site: what they play and finish here says which channels still matter.
    const history = () => readHistory(3000).catch((): HistoryRow[] => []);
    /** The read weighed, with YouTube's "watch next" for their latest videos (youtube-related.ts) on the shelf too. */
    const shelf = async (read: YouTubeRead<WebItem>, rows: readonly HistoryRow[], user: string | null, token: string | null): Promise<YouTubeFound> => {
      const now = Date.now();
      // An imported YouTube history's summary, if they brought one (Google Takeout; recommender/watch-summary.ts).
      const summary = await readSummary();
      const first = weigh(read, rows, now, { summary });
      const related = await relatedNow(user, token, first.seeds, read.topics).catch(() => []);
      lastShelf = { read, related };
      return related.length === 0 ? first : weigh(read, rows, now, { related, summary });
    };
    if (db === null) {
      // The mock site has no Google to ask: it shows a copy this browser was given, weighed the same way.
      const saved = kept(null);
      return { ...nothing, ...(await shelf(saved, await history(), null, null)), needsLink: saved.uploads.length === 0 && saved.liked.length === 0 };
    }
    const { data } = await db.auth.getSession();
    const session = data.session;
    if (!session) return nothing;
    if (session.user.is_anonymous) return nothing;
    const linker = takeLinker();
    if (linker !== null && linker !== session.user.id) return { ...nothing, needsLink: true, wrongAccount: true };
    const saved = kept(session.user.id);
    const rows = await history();
    const mine = (read: YouTubeRead<WebItem>) => shelf(read, rows, session.user.id, session.access_token);
    if (!session.provider_token) {
      // Nothing kept in this browser (another machine linked it, or the week ran out): the account's channels and
      // topics still teach the order, while LINK YOUTUBE offers the videos again.
      const account = saved.channels.length === 0 && saved.topics.length === 0 ? await readAccountTaste(session.user.id) : null;
      const read = account === null ? saved : asRead<WebItem>({ ...account, uploads: [] });
      return { ...nothing, ...(await mine(read)), needsLink: saved.uploads.length === 0 && saved.liked.length === 0 };
    }
    const answer = await fetch('/api/web/youtube/mine', {
      method: 'POST',
      headers: { Authorization: `Bearer ${session.access_token}`, 'x-google-token': session.provider_token, 'Content-Type': 'application/json' },
      // A hint only: YouTube ids of channels they play here, so those channels' new videos are read first.
      body: JSON.stringify({ prefer: watchedHere(saved, rows) }),
    });
    if (!answer.ok) return { ...nothing, ...(await mine(saved)), needsLink: answer.status === 403 };
    const read = asRead<WebItem>((await answer.json()) as Record<string, unknown>);
    keep(session.user.id, read);
    // The account keeps the channels that stand by YouTube's own evidence, never what was played on this site.
    void saveAccountTaste(session.user.id, { evidence: read.evidence, standings: weigh(read, [], Date.now()).standings, topics: read.topics });
    return { ...nothing, ...(await mine(read)), fresh: true };
  } catch {
    return { ...nothing, needsLink: true };
  }
}
