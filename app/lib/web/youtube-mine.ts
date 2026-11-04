import { safeFetchJson, type FetchLike } from './safe-fetch';
import { buildUrl } from './urls';
import { youtubeItem } from './search/providers/youtube';
import type { WebItem } from './types';

/**
 * A linked YouTube account's new uploads and liked videos (Luke, 2026-11-04; SPEC-media-picks.md). Google's API has no
 * real home page to give: `activities.list?home=true` returns what a logged-out visitor sees, so this is the closest
 * honest thing. It uses the person's short-lived Google token for one request, and stores neither the token nor the
 * answer on the server.
 *
 * Metadata only (CLAUDE.md): `part=snippet`, so no view or like counts are even asked for.
 */
const HOST = 'www.googleapis.com';
const MAX_CHANNELS = 10;
const PER_CHANNEL = 3;
const MAX_LIKED = 15;
const CHANNEL_ID = /^UC[A-Za-z0-9_-]{22}$/;
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
/** A Google access token: printable, and short enough to be one. Anything else is not sent anywhere. */
export const GOOGLE_TOKEN = /^[A-Za-z0-9._~+/=-]{20,4096}$/;

const api = (resource: string, params: Record<string, string>) => buildUrl(HOST, ['youtube', 'v3', resource], Object.entries(params));

type Snippet = {
  title?: string;
  channelTitle?: string;
  videoOwnerChannelTitle?: string;
  description?: string;
  publishedAt?: string;
  resourceId?: { videoId?: string; channelId?: string };
};
type Page = { items?: { id?: unknown; snippet?: Snippet }[] };

export class YouTubeTokenError extends Error {}

export async function readYouTubeMine(token: string, fetchImpl: FetchLike = fetch, now = new Date()): Promise<WebItem[]> {
  if (!GOOGLE_TOKEN.test(token)) throw new YouTubeTokenError('not a token');
  const signed: FetchLike = (url, init) =>
    fetchImpl(url, { ...init, headers: { ...init?.headers, Authorization: `Bearer ${token}` } });
  const read = async (url: string): Promise<Page> => (await safeFetchJson(url, { allowedHosts: [HOST], fetchImpl: signed })) as Page;

  // Any read failing here means the token has run out or was refused: the page offers the link again.
  let liked: Page;
  let subscriptions: Page;
  try {
    [liked, subscriptions] = await Promise.all([
      read(api('videos', { part: 'snippet', myRating: 'like', maxResults: String(MAX_LIKED) })),
      read(api('subscriptions', { part: 'snippet', mine: 'true', order: 'relevance', maxResults: String(MAX_CHANNELS) })),
    ]);
  } catch {
    throw new YouTubeTokenError('refused');
  }

  const channels = (subscriptions.items ?? [])
    .map((entry) => entry.snippet?.resourceId?.channelId ?? '')
    .filter((id) => CHANNEL_ID.test(id))
    .slice(0, MAX_CHANNELS);
  // A channel's uploads are its id with UU for UC. One channel that fails only leaves its videos out.
  const uploads = await Promise.all(
    channels.map((id) =>
      read(api('playlistItems', { part: 'snippet', playlistId: `UU${id.slice(2)}`, maxResults: String(PER_CHANNEL) })).catch((): Page => ({})),
    ),
  );

  const fetchedAt = now.toISOString();
  const found = new Map<string, WebItem>();
  const add = (id: unknown, snippet: Snippet | undefined) => {
    if (typeof id !== 'string' || !VIDEO_ID.test(id) || snippet === undefined || found.has(id)) return;
    found.set(
      id,
      youtubeItem(
        id,
        { title: snippet.title, creator: snippet.videoOwnerChannelTitle ?? snippet.channelTitle, description: snippet.description },
        snippet.publishedAt ?? fetchedAt,
        fetchedAt,
      ),
    );
  };
  for (const page of uploads) for (const entry of page.items ?? []) add(entry.snippet?.resourceId?.videoId, entry.snippet);
  for (const entry of liked.items ?? []) add(entry.id, entry.snippet);
  return [...found.values()].sort((a, b) => (a.publishedAt < b.publishedAt ? 1 : a.publishedAt > b.publishedAt ? -1 : 0));
}
