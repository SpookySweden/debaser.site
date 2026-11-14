/**
 * YouTube's own "watch next" for one video, through InnerTube (`POST https://www.youtube.com/youtubei/v1/next`, the WEB
 * client), the JSON API YouTube's own website calls. Luke, 2026-11-14: people "most often watch videos from channels
 * they are not subscribed to", and Google's official API gives no watch history, no home page and (since 2023) no
 * related videos. This is the list YouTube shows beside a video, which is where those other channels come from.
 *
 * The risk, said once: InnerTube is undocumented and YouTube can change or block it at any time. When it does, this
 * throws and the route falls back to a search of the video's own title words (`nextWords`), which has the official
 * Data API behind it (search/providers/youtube.ts).
 *
 * The rules this keeps (SPEC-web.md), as the InnerTube search does (search/providers/youtube-innertube.ts):
 * - JSON only: one POST through `safe-fetch` to one allow-listed host, a 6s wait, no redirects, the size cap;
 * - metadata only: a video's id, title, channel name and approximate age. The answer also carries view counts, badges,
 *   pictures' addresses, comments and links: none is read, and nothing in the answer is ever fetched (a row's addresses
 *   are built from the validated id, as for every YouTube row);
 * - no Shorts (shorts.ts), no live or upcoming broadcasts, no playlists or mixes;
 * - playback stays the youtube-nocookie embed.
 *
 * YouTube has two shapes for a suggestion and sends either: the older `compactVideoRenderer`, and since 2025 a
 * `lockupViewModel` whose age is short ("11mo ago"). Both are read.
 */
import { safeFetchJson } from './safe-fetch';
import { buildUrl } from './urls';
import { isShortsAddress, taggedShort } from './shorts';
import type { WebItem } from './types';
import { INNERTUBE_HOSTS, INNERTUBE_TIMEOUT_MS, relativeDate, toWebItem } from './search/providers/youtube-innertube';
import { YT_VIDEO_ID, youtubeItem } from './search/providers/youtube';

/** The WEB client YouTube's site sends; YouTube accepts older versions, so this is not kept current. */
const CLIENT = { clientName: 'WEB', clientVersion: '2.20250101.00.00', hl: 'en', gl: 'US' } as const;

export const NEXT_URL = buildUrl(INNERTUBE_HOSTS[0], ['youtubei', 'v1', 'next'], [['prettyPrint', 'false']]);
/** How many suggestions one video gives the page. */
export const NEXT_MAX = 12;

/** The request body: the video, and nothing about who is asking. */
export function nextBody(videoId: string): Record<string, unknown> {
  return { context: { client: CLIENT }, videoId };
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

const SHORT_UNIT_MS: Record<string, number> = {
  s: 1000,
  sec: 1000,
  m: 60_000,
  min: 60_000,
  h: 3_600_000,
  hr: 3_600_000,
  d: 86_400_000,
  w: 7 * 86_400_000,
  wk: 7 * 86_400_000,
  mo: 30 * 86_400_000,
  y: 365 * 86_400_000,
  yr: 365 * 86_400_000,
};

/**
 * "11mo ago", "3w ago" or "3 years ago" as a date that far before `fetchedAt`; undefined for anything else, which is
 * how a view count beside it ("10M") is passed over without being read as anything.
 */
export function ageDate(value: unknown, fetchedAt: string): string | undefined {
  if (typeof value !== 'string') return undefined;
  const long = relativeDate(value, fetchedAt);
  if (long !== undefined) return long;
  const match = /^(?:Streamed |Premiered )?(\d{1,4}) ?(sec|s|min|m|hr|h|d|wk|w|mo|yr|y) ago$/.exec(value.trim());
  if (!match) return undefined;
  return new Date(Date.parse(fetchedAt) - Number(match[1]) * SHORT_UNIT_MS[match[2]]).toISOString();
}

/** One `lockupViewModel` as a WebItem, or null. Only its id, title, channel name and age are read. */
function lockupItem(value: unknown, fetchedAt: string): WebItem | null {
  const lockup = record(value);
  if (!lockup || lockup.contentType !== 'LOCKUP_CONTENT_TYPE_VIDEO') return null;
  const id = typeof lockup.contentId === 'string' ? lockup.contentId : '';
  if (!YT_VIDEO_ID.test(id)) return null;
  // No Shorts in MEDIA (shorts.ts; Luke, 2026-11-14): a Short opens YouTube's Shorts player, at its /shorts/ page.
  const opens = record(record(record(record(lockup.rendererContext)?.commandContext)?.onTap)?.innertubeCommand);
  if (opens?.reelWatchEndpoint !== undefined) return null;
  const opensAt = record(record(opens?.commandMetadata)?.webCommandMetadata)?.url;
  if (typeof opensAt === 'string' && isShortsAddress(opensAt)) return null;
  const meta = record(record(lockup.metadata)?.lockupMetadataViewModel);
  const title = record(meta?.title)?.content;
  if (typeof title !== 'string' || title.trim() === '' || taggedShort(title)) return null;
  // Rows of small print: the channel's name first, then its age among other things. The age is found by its shape.
  const rows = list(record(record(meta?.metadata)?.contentMetadataViewModel)?.metadataRows).map((row) =>
    list(record(row)?.metadataParts).map((part) => record(record(part)?.text)?.content),
  );
  const creator = rows[0]?.[0];
  let publishedAt: string | undefined;
  for (const part of rows.slice(1).flat()) publishedAt ??= ageDate(part, fetchedAt);
  // No age line means live now, upcoming, or not a plain video: nothing to queue or play later.
  if (publishedAt === undefined) return null;
  return youtubeItem(id, { title, creator: typeof creator === 'string' ? creator : undefined }, publishedAt, fetchedAt);
}

/**
 * The suggestions out of an answer, in YouTube's order, at most `NEXT_MAX`. A thrown error when the list is not where
 * it is expected, or holds videos none of which could be read (YouTube changed its wording, say): the caller falls
 * back. An answer with no videos at all is simply empty.
 */
export function parseNext(body: unknown, fetchedAt: string, seedId?: string): WebItem[] {
  const results = record(record(record(record(record(body)?.contents)?.twoColumnWatchNextResults)?.secondaryResults)?.secondaryResults)?.results;
  if (!Array.isArray(results)) throw new Error('unexpected response shape');
  // Older answers wrap the list in one section.
  const entries = results.flatMap((entry) => {
    const section = record(record(entry)?.itemSectionRenderer)?.contents;
    return Array.isArray(section) ? section : [entry];
  });
  const items: WebItem[] = [];
  let videos = 0;
  for (const entry of entries) {
    const node = record(entry);
    const compact = node?.compactVideoRenderer;
    const lockup = node?.lockupViewModel;
    if (compact !== undefined || record(lockup)?.contentType === 'LOCKUP_CONTENT_TYPE_VIDEO') videos += 1;
    const item = compact !== undefined ? toWebItem(compact, fetchedAt) : lockup !== undefined ? lockupItem(lockup, fetchedAt) : null;
    if (item === null || item.externalId === seedId || items.some((seen) => seen.id === item.id)) continue;
    items.push(item);
    if (items.length === NEXT_MAX) break;
  }
  if (videos > 0 && items.length === 0) throw new Error('unreadable answer');
  return items;
}

type FetchImpl = Parameters<typeof safeFetchJson>[1]['fetchImpl'];

/** YouTube's "watch next" for one video. Throws (any error) when YouTube does not answer in a known shape. */
export async function youtubeNext(videoId: string, fetchImpl: FetchImpl, fetchedAt: string): Promise<WebItem[]> {
  if (!YT_VIDEO_ID.test(videoId)) throw new Error('not a video id');
  const body = await safeFetchJson(NEXT_URL, { allowedHosts: INNERTUBE_HOSTS, fetchImpl, timeoutMs: INNERTUBE_TIMEOUT_MS, postJson: nextBody(videoId) });
  return parseNext(body, fetchedAt, videoId);
}

/** One video to ask about: only its id, title and channel name ever leave the browser. */
export type NextSeed = { id: string; title: string; creator: string };

/** `next`: YouTube's own list. `search`: the fallback's title-word search. `none`: neither had anything. */
export type RelatedAnswer = { seed: string; via: 'next' | 'search' | 'none'; items: WebItem[] };

/** What the browser sent, as far as it is shaped like seeds: real video ids, plain short words, a few at most. */
export function seedsFrom(value: unknown, most: number): NextSeed[] {
  const plain = (text: unknown, max: number) => (typeof text === 'string' ? text.replace(/\s+/g, ' ').trim().slice(0, max) : '');
  const seeds: NextSeed[] = [];
  for (const entry of Array.isArray(value) ? value : []) {
    const id = record(entry)?.id;
    if (typeof id !== 'string' || !YT_VIDEO_ID.test(id) || seeds.some((seed) => seed.id === id)) continue;
    seeds.push({ id, title: plain(record(entry)?.title, 200), creator: plain(record(entry)?.creator, 100) });
    if (seeds.length === most) break;
  }
  return seeds;
}

/**
 * The suggestions for one seed: YouTube's "watch next", or, when that fails or is empty, a search of the seed's own
 * title words (`search` is the site's YouTube search, which has the official Data API behind it). Never throws.
 */
export async function relatedFor(
  seed: NextSeed,
  deps: { fetch: FetchImpl; fetchedAt: string; topics?: readonly string[]; search: (words: string) => Promise<WebItem[]> },
): Promise<RelatedAnswer> {
  try {
    const items = await youtubeNext(seed.id, deps.fetch, deps.fetchedAt);
    if (items.length > 0) return { seed: seed.id, via: 'next', items };
  } catch {
    // Changed, blocked or slow: the fallback below.
  }
  const words = nextWords(seed, deps.topics);
  if (words === null) return { seed: seed.id, via: 'none', items: [] };
  try {
    const items = (await deps.search(words)).filter((item) => item.platform === 'youtube' && item.externalId !== seed.id).slice(0, NEXT_MAX);
    return { seed: seed.id, via: items.length > 0 ? 'search' : 'none', items };
  } catch {
    return { seed: seed.id, via: 'none', items: [] };
  }
}

/** Words too common to search by. */
const DULL = new Set(['the', 'and', 'for', 'with', 'from', 'this', 'that', 'official', 'video', 'full', 'part', 'episode', 'feat', 'ft', 'hd', '4k', 'new', 'how', 'why', 'what', 'you', 'your', 'are', 'was', 'not']);
const FALLBACK_WORDS = 5;

/**
 * The fallback's search words: the weightiest few words of the seed's own title, then its channel, then one topic if
 * the title gave too little. Plain words only; null when there is nothing to ask.
 */
export function nextWords(seed: { title: string; creator?: string }, topics: readonly string[] = []): string | null {
  const words = (text: string) =>
    text
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((word) => word.length > 2 && !DULL.has(word) && !/^\d+$/.test(word));
  const fromTitle = [...new Set(words(seed.title))].slice(0, FALLBACK_WORDS);
  const extra = fromTitle.length < 3 ? [...words(seed.creator ?? ''), ...words(topics[0] ?? '')].filter((word) => !fromTitle.includes(word)).slice(0, FALLBACK_WORDS - fromTitle.length) : [];
  const all = [...fromTitle, ...extra];
  return all.length === 0 ? null : all.join(' ');
}
