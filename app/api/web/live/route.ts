import { searchWords } from '../../../lib/web/search';
import { liveFetch } from '../../../lib/web/search/live-fetch';
import { twitchCategories, twitchLiveNow, twitchTop, TWITCH_LOGINS_MAX } from '../../../lib/web/search/providers/twitch';
import { youtubeSearch } from '../../../lib/web/search/providers/youtube';
import { clientAddress, makeRateLimiter } from '../../../lib/web/search/rate-limit';
import type { SearchDeps } from '../../../lib/web/search/types';
import type { WebItem } from '../../../lib/web/types';

/**
 * What is live now, for the pages that need it without a search (SPEC-live-streams.md):
 *
 *   GET /api/web/live?channels=<login,login,...>   -> { items }  the Twitch channels among these that are live now
 *   GET /api/web/live?words=<word word ...>        -> { items }  lives that fit these words: Twitch's categories for each
 *                                                                word, and YouTube's lives for the first two
 *   GET /api/web/live                              -> { items }  the most-watched lives on Twitch now (Twitch's own order)
 *
 * `channels` and `words` may come together (FOR YOU's candidates: the channels in your history and your linked YouTube's
 * channels' names, your taste's words). Only logins (`[a-z0-9_]`) and plain words (`searchWords`) are passed on; nothing else of
 * what was sent goes anywhere. Answers are kept a minute on this server (live-fetch.ts) and never by the browser. A live is
 * never saved. No viewer count is ever part of an item; Twitch's own order is the only use one has here.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

/** Each word becomes at most this many categories and lives per category. */
const MAX_WORDS = 5;
const PER_CATEGORY = 6;
/** YouTube is asked for the first words only (InnerTube; each is a search). */
const YOUTUBE_WORDS = 2;
const LOGIN = /^[a-z0-9][a-z0-9_]{1,24}$/;

const perAddress = makeRateLimiter(30, 60_000);
const perInstance = makeRateLimiter(300, 60_000);

function json(body: Record<string, unknown>, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
}

function deps(): SearchDeps {
  return {
    fetch: liveFetch,
    liveFetch,
    live: true,
    env: {
      YOUTUBE_API_KEY: process.env.YOUTUBE_API_KEY,
      TWITCH_CLIENT_ID: process.env.TWITCH_CLIENT_ID,
      TWITCH_CLIENT_SECRET: process.env.TWITCH_CLIENT_SECRET,
    },
  };
}

/** The logins asked about: lower-cased, valid, distinct, at most Helix's 100. */
function loginsOf(raw: string | null): string[] {
  if (raw === null) return [];
  return [...new Set(raw.split(',').map((part) => part.trim().toLowerCase()).filter((part) => LOGIN.test(part)))].slice(0, TWITCH_LOGINS_MAX);
}

export async function GET(request: Request): Promise<Response> {
  // Open to signed-out visitors too, like all of MEDIA.
  if (!perAddress.allow(clientAddress(request.headers)) || !perInstance.allow('all')) return json({ error: 'Too many asks. Wait a minute and try again.' }, 429);
  const params = new URL(request.url).searchParams;
  if ((params.get('channels') ?? '').length > 3000 || (params.get('words') ?? '').length > 300) return json({ error: 'That is too long.' }, 400);
  const channels = loginsOf(params.get('channels'));
  const words = (searchWords(params.get('words') ?? '') ?? []).slice(0, MAX_WORDS);
  const asked = deps();

  const lists: Promise<WebItem[]>[] = [];
  if (channels.length > 0) lists.push(twitchLiveNow(channels, asked));
  for (const word of words) {
    lists.push(
      twitchCategories(word, asked).then((categories) => (categories.length === 0 ? [] : twitchTop(asked, categories[0], PER_CATEGORY))),
    );
  }
  for (const word of words.slice(0, YOUTUBE_WORDS)) {
    lists.push(
      youtubeSearch
        .search(word, null, asked)
        .then((page) => page.items.filter((item) => item.live === true).slice(0, PER_CATEGORY))
        .catch(() => []),
    );
  }
  if (channels.length === 0 && words.length === 0) lists.push(twitchTop(asked));

  const seen = new Set<string>();
  const items: WebItem[] = [];
  for (const list of await Promise.all(lists)) {
    for (const item of list) {
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      items.push(item);
    }
  }
  return json({ items }, 200);
}
