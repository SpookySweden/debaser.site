import { safeFetchJson, type FetchLike } from './safe-fetch';
import { buildUrl } from './urls';
import { youtubeItem } from './search/providers/youtube';
import type { WebItem } from './types';

/**
 * A linked YouTube account's new uploads, liked videos, and what they say about the person (Luke, 2026-11-04 and
 * 2026-11-13: "when signed in with google, the media page takes into account what would be shown on your youtube
 * homepage"; SPEC-media-picks.md).
 *
 * The honest limit: Google's API has no home feed (`activities.list?home=true` returns what a logged-out visitor sees),
 * and the real one needs the person's YouTube cookies, which the site never holds. So this reads the closest honest
 * things: the channels they subscribe to, those channels' newest uploads, their likes, their own playlists' names, and
 * the topics YouTube files those channels under (Wikipedia pages: Music, Film, Video game culture...).
 *
 * It uses the person's short-lived Google token for one request, and stores neither the token nor the answer on the
 * server. Metadata only (CLAUDE.md): `part=snippet` and `part=topicDetails`, never `statistics`, so no view, like or
 * subscriber count is even asked for. About 30 of the API's 10,000 daily units a read; never `search` (100 each).
 */
const HOST = 'www.googleapis.com';
/** Subscribed channels read: the API's largest page, in YouTube's own "relevance" order (the ones watched most first). */
const MAX_CHANNELS = 50;
/** Of those, how many have their newest uploads read (one request each). */
const UPLOAD_CHANNELS = 25;
const PER_CHANNEL = 3;
const MAX_LIKED = 50;
const MAX_PLAYLISTS = 25;
export const MAX_TOPICS = 30;
const CHANNEL_ID = /^UC[A-Za-z0-9_-]{22}$/;
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
/** A Google access token: printable, and short enough to be one. Anything else is not sent anywhere. */
export const GOOGLE_TOKEN = /^[A-Za-z0-9._~+/=-]{20,4096}$/;
/** YouTube files a channel under Wikipedia pages: `https://en.wikipedia.org/wiki/Music`. */
const TOPIC_PAGE = /^https:\/\/en\.wikipedia\.org\/wiki\/([^/?#]{1,120})$/;

const api = (resource: string, params: Record<string, string>) => buildUrl(HOST, ['youtube', 'v3', resource], Object.entries(params));

type Snippet = {
  title?: string;
  channelTitle?: string;
  videoOwnerChannelTitle?: string;
  description?: string;
  publishedAt?: string;
  resourceId?: { videoId?: string; channelId?: string };
};
type Page = { items?: { id?: unknown; snippet?: Snippet; topicDetails?: { topicCategories?: unknown } }[] };

/** A subscribed channel: its YouTube id and its name, nothing else. */
export type YouTubeChannel = { id: string; name: string };

/** What one read finds. `topics` and `playlists` are plain words; nothing here is a count. */
export type YouTubeMine = { items: WebItem[]; channels: YouTubeChannel[]; topics: string[]; playlists: string[] };

export class YouTubeTokenError extends Error {}

/** A short line of someone else's words, as plain text (it is drawn as a text node, never markup). */
const plain = (value: unknown, max: number): string => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '');

/** `https://en.wikipedia.org/wiki/Video_game_culture` -> `Video game culture`; `Lifestyle_(sociology)` -> `Lifestyle`. */
export function topicWord(page: unknown): string | null {
  if (typeof page !== 'string') return null;
  const match = TOPIC_PAGE.exec(page);
  if (match === null) return null;
  let word: string;
  try {
    word = decodeURIComponent(match[1]);
  } catch {
    return null;
  }
  word = word.replace(/_/g, ' ').replace(/\s*\([^)]*\)\s*$/, '').trim();
  return /^[\p{L}\p{N}][\p{L}\p{N} '&-]{0,58}$/u.test(word) ? word : null;
}

export async function readYouTubeMine(token: string, fetchImpl: FetchLike = fetch, now = new Date()): Promise<YouTubeMine> {
  if (!GOOGLE_TOKEN.test(token)) throw new YouTubeTokenError('not a token');
  const signed: FetchLike = (url, init) =>
    fetchImpl(url, { ...init, headers: { ...init?.headers, Authorization: `Bearer ${token}` } });
  const read = async (url: string): Promise<Page> => (await safeFetchJson(url, { allowedHosts: [HOST], fetchImpl: signed })) as Page;

  // Any of these two failing means the token has run out or was refused: the page offers the link again.
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

  const channels: YouTubeChannel[] = [];
  for (const entry of subscriptions.items ?? []) {
    const id = entry.snippet?.resourceId?.channelId ?? '';
    const name = plain(entry.snippet?.title, 100);
    if (CHANNEL_ID.test(id) && name !== '' && !channels.some((channel) => channel.id === id)) channels.push({ id, name });
    if (channels.length === MAX_CHANNELS) break;
  }

  // A channel's uploads are its id with UU for UC. Anything here failing only leaves its own part out.
  const [uploads, playlists, topicPage] = await Promise.all([
    Promise.all(
      channels.slice(0, UPLOAD_CHANNELS).map(({ id }) =>
        read(api('playlistItems', { part: 'snippet', playlistId: `UU${id.slice(2)}`, maxResults: String(PER_CHANNEL) })).catch((): Page => ({})),
      ),
    ),
    read(api('playlists', { part: 'snippet', mine: 'true', maxResults: String(MAX_PLAYLISTS) })).catch((): Page => ({})),
    channels.length === 0
      ? Promise.resolve<Page>({})
      : read(api('channels', { part: 'topicDetails', id: channels.map(({ id }) => id).join(','), maxResults: String(MAX_CHANNELS) })).catch((): Page => ({})),
  ]);

  // The topics most of their channels share come first.
  const topicCounts = new Map<string, number>();
  for (const channel of topicPage.items ?? []) {
    const pages = channel.topicDetails?.topicCategories;
    if (!Array.isArray(pages)) continue;
    for (const word of new Set(pages.map(topicWord).filter((word): word is string => word !== null))) topicCounts.set(word, (topicCounts.get(word) ?? 0) + 1);
  }
  const topics = [...topicCounts.entries()]
    .sort(([a, x], [b, y]) => y - x || a.localeCompare(b))
    .slice(0, MAX_TOPICS)
    .map(([word]) => word);

  const playlistNames = [...new Set((playlists.items ?? []).map((entry) => plain(entry.snippet?.title, 80)).filter((name) => name !== ''))].slice(0, MAX_PLAYLISTS);

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
  const items = [...found.values()].sort((a, b) => (a.publishedAt < b.publishedAt ? 1 : a.publishedAt > b.publishedAt ? -1 : 0));
  return { items, channels, topics, playlists: playlistNames };
}
