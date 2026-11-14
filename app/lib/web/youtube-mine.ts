import { channelStandings, liveChannelIds, type ChannelEvidence } from '../recommender/youtube-picks';
import { safeFetchJson, type FetchLike } from './safe-fetch';
import { buildUrl } from './urls';
import { taggedShort } from './shorts';
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
 * Which channels still matter (Luke, 2026-11-14: "many users are subscribed to many channels they no longer watch, and
 * most often watch videos from channels they are not subscribed to"): the likes are read with the day each was liked
 * (the person's own "liked videos" list), and the videos in their playlists with the day each was added, so a channel
 * stands by what they did with it lately, subscribed or not (`recommender/youtube-picks.ts`). New uploads are read for
 * the channels that stand first, then the browser's hint of channels they watch on this site, then the rest.
 *
 * It uses the person's short-lived Google token for one request, and stores neither the token nor the answer on the
 * server. Metadata only (CLAUDE.md): `part=snippet`, `contentDetails` (a video's id and upload date) and `topicDetails`,
 * never `statistics`, so no view, like or subscriber count is even asked for. About 40 of the API's 10,000 daily units a
 * read; never `search` (100 each).
 */
const HOST = 'www.googleapis.com';
/** Subscribed channels read: the API's largest page, in YouTube's own "relevance" order (the ones watched most first). */
const MAX_CHANNELS = 50;
/** How many channels have their newest uploads read (one request each). */
const UPLOAD_CHANNELS = 25;
const PER_CHANNEL = 3;
const MAX_LIKED = 50;
const MAX_PLAYLISTS = 25;
/** Of the person's playlists, how many have their videos' channels read (one request each). */
const SAVED_PLAYLISTS = 10;
/** Days kept for one channel: enough to tell "lately and often" from "once, long ago". */
const DAYS_KEPT = 5;
/** Channels the evidence may name: the subscriptions and the channels behind likes and playlists. */
const MAX_EVIDENCE = 150;
/** A like with no date (the fallback list has none) is taken to be this many days older than the one before it. */
const UNDATED_LIKE_DAYS = 4;
export const MAX_TOPICS = 30;
/** The person's own "liked videos" list, as YouTube names it. */
const LIKED_LIST = 'LL';
const CHANNEL_ID = /^UC[A-Za-z0-9_-]{22}$/;
const PLAYLIST_ID = /^[A-Za-z0-9_-]{10,64}$/;
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const DAY_MS = 86_400_000;
/** A Google access token: printable, and short enough to be one. Anything else is not sent anywhere. */
export const GOOGLE_TOKEN = /^[A-Za-z0-9._~+/=-]{20,4096}$/;
/** YouTube files a channel under Wikipedia pages: `https://en.wikipedia.org/wiki/Music`. */
const TOPIC_PAGE = /^https:\/\/en\.wikipedia\.org\/wiki\/([^/?#]{1,120})$/;

const api = (resource: string, params: Record<string, string>) => buildUrl(HOST, ['youtube', 'v3', resource], Object.entries(params));

type Snippet = {
  title?: string;
  channelId?: string;
  channelTitle?: string;
  videoOwnerChannelId?: string;
  videoOwnerChannelTitle?: string;
  description?: string;
  publishedAt?: string;
  resourceId?: { videoId?: string; channelId?: string };
};
type Page = { items?: { id?: unknown; snippet?: Snippet; contentDetails?: { videoPublishedAt?: unknown }; topicDetails?: { topicCategories?: unknown } }[] };

/** A subscribed channel: its YouTube id and its name, nothing else. */
export type YouTubeChannel = { id: string; name: string };

/**
 * What one read finds. `topics` and `playlists` are plain words; nothing here is a count.
 * `uploads`: new videos, the channels that stand first. `liked`: the person's likes, newest like first, with `likedAt`
 * saying when (by video id). `evidence`: each channel's likes and playlist adds by day, the subscriptions first in
 * YouTube's order. `items` is both lists, newest first, as before.
 */
export type YouTubeMine = {
  items: WebItem[];
  uploads: WebItem[];
  liked: WebItem[];
  likedAt: Record<string, string>;
  channels: YouTubeChannel[];
  topics: string[];
  playlists: string[];
  evidence: ChannelEvidence[];
};

const isoDay = (value: unknown): string | null => {
  const at = typeof value === 'string' ? Date.parse(value) : NaN;
  return Number.isFinite(at) ? new Date(at).toISOString() : null;
};

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

/** The ids the browser hints at: channels the person watches on this site. Only real ids, a few. */
export function preferredChannels(value: unknown): string[] {
  return Array.isArray(value) ? [...new Set(value.filter((id): id is string => typeof id === 'string' && CHANNEL_ID.test(id)))].slice(0, UPLOAD_CHANNELS) : [];
}

export async function readYouTubeMine(token: string, fetchImpl: FetchLike = fetch, now = new Date(), prefer: readonly string[] = []): Promise<YouTubeMine> {
  if (!GOOGLE_TOKEN.test(token)) throw new YouTubeTokenError('not a token');
  const signed: FetchLike = (url, init) =>
    fetchImpl(url, { ...init, headers: { ...init?.headers, Authorization: `Bearer ${token}` } });
  const read = async (url: string): Promise<Page> => (await safeFetchJson(url, { allowedHosts: [HOST], fetchImpl: signed })) as Page;

  // The likes, with the day of each: the person's own "liked videos" list says when. If YouTube will not give that list,
  // the plain list of likes (newest first, no days). Both failing, or the subscriptions failing, means the token has run
  // out or was refused: the page offers the link again.
  let liked: Page;
  let likesDated = true;
  let subscriptions: Page;
  try {
    [liked, subscriptions] = await Promise.all([
      read(api('playlistItems', { part: 'snippet,contentDetails', playlistId: LIKED_LIST, maxResults: String(MAX_LIKED) })).catch(() => {
        likesDated = false;
        return read(api('videos', { part: 'snippet', myRating: 'like', maxResults: String(MAX_LIKED) }));
      }),
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

  // The person's playlists: their names, and (for the first few) which channels their videos are from and when added.
  const playlists = await read(api('playlists', { part: 'snippet', mine: 'true', maxResults: String(MAX_PLAYLISTS) })).catch((): Page => ({}));
  const playlistNames = [...new Set((playlists.items ?? []).map((entry) => plain(entry.snippet?.title, 80)).filter((name) => name !== ''))].slice(0, MAX_PLAYLISTS);
  const playlistIds = (playlists.items ?? []).map((entry) => entry.id).filter((id): id is string => typeof id === 'string' && PLAYLIST_ID.test(id)).slice(0, SAVED_PLAYLISTS);
  const saved = await Promise.all(
    playlistIds.map((playlistId) => read(api('playlistItems', { part: 'snippet', playlistId, maxResults: '50' })).catch((): Page => ({}))),
  );

  // What each channel has to show: the subscriptions first, in YouTube's order, then the channels behind likes and playlists.
  const evidence = new Map<string, ChannelEvidence>(channels.map(({ id, name }) => [id, { id, name, subscribed: true, liked: [], saved: [] }]));
  const channelOf = (id: unknown, name: unknown): ChannelEvidence | null => {
    if (typeof id !== 'string' || !CHANNEL_ID.test(id)) return null;
    const known = evidence.get(id);
    if (known !== undefined) return known;
    const shown = plain(name, 100);
    if (shown === '' || evidence.size >= MAX_EVIDENCE) return null;
    const added: ChannelEvidence = { id, name: shown, subscribed: false, liked: [], saved: [] };
    evidence.set(id, added);
    return added;
  };
  const likedAt: Record<string, string> = {};
  (liked.items ?? []).forEach((entry, index) => {
    const snippet = entry.snippet;
    const videoId = likesDated ? snippet?.resourceId?.videoId : entry.id;
    if (typeof videoId !== 'string' || !VIDEO_ID.test(videoId)) return;
    const day = (likesDated ? isoDay(snippet?.publishedAt) : null) ?? new Date(now.getTime() - index * UNDATED_LIKE_DAYS * DAY_MS).toISOString();
    likedAt[`youtube:${videoId}`] = day;
    const channel = likesDated ? channelOf(snippet?.videoOwnerChannelId, snippet?.videoOwnerChannelTitle) : channelOf(snippet?.channelId, snippet?.channelTitle);
    if (channel !== null && channel.liked.length < DAYS_KEPT) channel.liked.push(day);
  });
  for (const page of saved) {
    for (const entry of page.items ?? []) {
      const day = isoDay(entry.snippet?.publishedAt);
      const channel = channelOf(entry.snippet?.videoOwnerChannelId, entry.snippet?.videoOwnerChannelTitle);
      if (day !== null && channel !== null) channel.saved.push(day);
    }
  }
  for (const channel of evidence.values()) channel.saved = channel.saved.sort((a, b) => (a < b ? 1 : a > b ? -1 : 0)).slice(0, DAYS_KEPT);
  const evidenceList = [...evidence.values()];

  // Whose new videos to read: the channels that stand by this evidence, then the ones the browser says are watched here,
  // then the other subscriptions in YouTube's order (they only ever top up a thin shelf).
  const standings = channelStandings({ evidence: evidenceList, rows: [], now: now.getTime() });
  const uploadIds = [...new Set([...liveChannelIds(standings), ...prefer.filter((id) => CHANNEL_ID.test(id)), ...channels.map(({ id }) => id)])].slice(0, UPLOAD_CHANNELS);
  // Topics: the channels that stand first, then the subscriptions, in one request.
  const topicIds = [...new Set([...standings.filter((standing) => standing.id !== null && standing.weight > 0).map((standing) => standing.id as string), ...channels.map(({ id }) => id)])].slice(0, MAX_CHANNELS);

  // A channel's uploads are its id with UU for UC. Anything here failing only leaves its own part out.
  const [uploads, topicPage] = await Promise.all([
    Promise.all(
      uploadIds.map((id) =>
        // UULF is the channel's uploads without Shorts (YouTube's own list; Luke, 2026-11-14: no Shorts). A channel with no
        // such list falls back to all its uploads, with any Short tagged #shorts still left out below.
        read(api('playlistItems', { part: 'snippet', playlistId: `UULF${id.slice(2)}`, maxResults: String(PER_CHANNEL) }))
          .catch(() => read(api('playlistItems', { part: 'snippet', playlistId: `UU${id.slice(2)}`, maxResults: String(PER_CHANNEL) })))
          .catch((): Page => ({})),
      ),
    ),
    topicIds.length === 0
      ? Promise.resolve<Page>({})
      : read(api('channels', { part: 'topicDetails', id: topicIds.join(','), maxResults: String(MAX_CHANNELS) })).catch((): Page => ({})),
  ]);

  // The topics the channels that stand share come first; a subscription nobody watches any more counts for little.
  const standingOf = new Map(standings.filter((standing) => standing.id !== null).map((standing) => [standing.id as string, standing]));
  const topicWeights = new Map<string, number>();
  for (const channel of topicPage.items ?? []) {
    const pages = channel.topicDetails?.topicCategories;
    if (!Array.isArray(pages)) continue;
    const standing = typeof channel.id === 'string' ? standingOf.get(channel.id) : undefined;
    const counts = standing !== undefined && standing.weight > 0 ? 1 + Math.min(standing.weight, 4) : 0.25;
    for (const word of new Set(pages.map(topicWord).filter((word): word is string => word !== null))) topicWeights.set(word, (topicWeights.get(word) ?? 0) + counts);
  }
  const topics = [...topicWeights.entries()]
    .sort(([a, x], [b, y]) => y - x || a.localeCompare(b))
    .slice(0, MAX_TOPICS)
    .map(([word]) => word);

  const fetchedAt = now.toISOString();
  const video = (id: unknown, snippet: Snippet | undefined, publishedAt: string | null): WebItem | null => {
    if (typeof id !== 'string' || !VIDEO_ID.test(id) || snippet === undefined) return null;
    if (taggedShort(snippet.title, snippet.description)) return null;
    return youtubeItem(id, { title: snippet.title, creator: snippet.videoOwnerChannelTitle ?? snippet.channelTitle, description: snippet.description }, publishedAt ?? fetchedAt, fetchedAt);
  };
  const newest = (a: WebItem, b: WebItem) => (a.publishedAt < b.publishedAt ? 1 : a.publishedAt > b.publishedAt ? -1 : 0);
  const once = (list: (WebItem | null)[]): WebItem[] => {
    const found = new Map<string, WebItem>();
    for (const item of list) if (item !== null && !found.has(item.id)) found.set(item.id, item);
    return [...found.values()];
  };
  const uploadItems = once(uploads.flatMap((page) => (page.items ?? []).map((entry) => video(entry.snippet?.resourceId?.videoId, entry.snippet, isoDay(entry.snippet?.publishedAt)))));
  const likedItems = once(
    (liked.items ?? []).map((entry) =>
      likesDated
        ? // In the liked list `publishedAt` is the day of the like; the video's own date is beside it.
          video(entry.snippet?.resourceId?.videoId, entry.snippet, isoDay(entry.contentDetails?.videoPublishedAt))
        : video(entry.id, entry.snippet, isoDay(entry.snippet?.publishedAt)),
    ),
  );
  const items = once([...uploadItems, ...likedItems]).sort(newest);
  return { items, uploads: uploadItems, liked: likedItems, likedAt, channels, topics, playlists: playlistNames, evidence: evidenceList };
}
