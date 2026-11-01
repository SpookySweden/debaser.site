/**
 * Search everywhere: YouTube the unofficial way, through InnerTube, the JSON API YouTube's own website calls
 * (`POST https://www.youtube.com/youtubei/v1/search`, the WEB client, videos only). Luke chose this on
 * 2026-11-01 (SPEC-web-search.md, "YouTube through InnerTube"): it needs no key and spends no quota, so the
 * official Data API (youtube.ts) is only the fallback when this fails.
 *
 * The risk, said once: InnerTube is undocumented and YouTube can change or block it at any time. When it
 * does, this throws and youtube.ts falls back to the Data API, then to "YOUTUBE: NO ANSWER".
 *
 * The rules this keeps (SPEC-web.md):
 * - JSON only: one POST through `safe-fetch` to one allow-listed host, a 6s wait, no redirects, the size cap;
 * - metadata only: id, title, channel name, the description snippet and an approximate date. Views, likes,
 *   badges, thumbnails' own addresses and every link in the answer are never read; nothing in the answer is
 *   ever fetched (the item's addresses are built from the validated id, as for every YouTube row);
 * - playback stays the youtube-nocookie embed.
 *
 * Dates: InnerTube says "3 years ago", not a date, so an item is dated that far back from the moment it was
 * read (months as 30 days, years as 365). Live and upcoming broadcasts have no such line and are skipped.
 */
import { safeFetchJson } from '../../safe-fetch';
import { buildUrl } from '../../urls';
import type { WebItem } from '../../types';
import type { SearchPage } from '../types';
import { YT_VIDEO_ID, youtubeItem } from './youtube';

const HOST = 'www.youtube.com';
export const INNERTUBE_HOSTS = [HOST] as const;
export const INNERTUBE_TIMEOUT_MS = 6_000;
/** A continuation token as InnerTube writes it (about 600 characters, base64url with %3D padding). */
export const INNERTUBE_TOKEN = /^[A-Za-z0-9_%=-]{20,800}$/;
/** YouTube's own filter for "Type: Video", as its search page sends it. */
const VIDEOS_ONLY = 'EgIQAQ==';
/** The WEB client YouTube's site sends; YouTube accepts older versions, so this is not kept current. */
const CLIENT = { clientName: 'WEB', clientVersion: '2.20250101.00.00', hl: 'en', gl: 'US' } as const;

export const INNERTUBE_URL = buildUrl(HOST, ['youtubei', 'v1', 'search'], [['prettyPrint', 'false']]);

/** The request body: words for a first page, or the token for the next one. Nothing else is sent. */
export function innertubeBody(words: string, continuation: string | null): Record<string, unknown> {
  return continuation === null
    ? { context: { client: CLIENT }, query: words, params: VIDEOS_ONLY }
    : { context: { client: CLIENT }, continuation };
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/** InnerTube's text: `{ simpleText }` or `{ runs: [{ text }] }`. */
function text(value: unknown): string | undefined {
  const node = record(value);
  if (!node) return undefined;
  if (typeof node.simpleText === 'string') return node.simpleText;
  const runs = list(node.runs).map((run) => record(run)?.text);
  return runs.every((run) => typeof run === 'string') && runs.length > 0 ? runs.join('') : undefined;
}

const UNIT_MS: Record<string, number> = {
  second: 1000,
  minute: 60_000,
  hour: 3_600_000,
  day: 86_400_000,
  week: 7 * 86_400_000,
  month: 30 * 86_400_000,
  year: 365 * 86_400_000,
};

/** "3 years ago" or "Streamed 2 weeks ago" as a date that far before `fetchedAt`; undefined for anything else. */
export function relativeDate(value: string | undefined, fetchedAt: string): string | undefined {
  const match = /^(?:Streamed |Premiered )?(\d{1,4}) (second|minute|hour|day|week|month|year)s? ago$/.exec(value?.trim() ?? '');
  if (!match) return undefined;
  return new Date(Date.parse(fetchedAt) - Number(match[1]) * UNIT_MS[match[2]]).toISOString();
}

/** One `videoRenderer` as a WebItem, or null. Only the id, title, channel, snippet and age are read. */
export function toWebItem(renderer: unknown, fetchedAt: string): WebItem | null {
  const video = record(renderer);
  if (!video) return null;
  const id = typeof video.videoId === 'string' ? video.videoId : undefined;
  if (!id || !YT_VIDEO_ID.test(id)) return null;
  // No age line means live now or upcoming: nothing to queue or play later.
  const publishedAt = relativeDate(text(video.publishedTimeText), fetchedAt);
  if (!publishedAt) return null;
  const snippet = text(record(list(video.detailedMetadataSnippets)[0])?.snippetText);
  return youtubeItem(id, { title: text(video.title), creator: text(video.ownerText) ?? text(video.longBylineText), description: snippet }, publishedAt, fetchedAt);
}

/**
 * The videos and the next page out of an answer: a first page (`contents...sectionListRenderer`) or a next
 * one (`onResponseReceivedCommands...continuationItems`). Shelves, films for sale, Shorts rows and ads are
 * not plain `videoRenderer`s and are passed over. A thrown error when neither shape is there.
 */
export function parseInnertube(body: unknown, fetchedAt: string): SearchPage {
  const root = record(body);
  const first = record(record(record(record(root?.contents)?.twoColumnSearchResultsRenderer)?.primaryContents)?.sectionListRenderer)?.contents;
  const more = list(root?.onResponseReceivedCommands).flatMap((command) => list(record(record(command)?.appendContinuationItemsAction)?.continuationItems));
  if (!Array.isArray(first) && more.length === 0) throw new Error('unexpected response shape');
  const sections = Array.isArray(first) ? first : more;

  const items: WebItem[] = [];
  let next: string | null = null;
  let videos = 0;
  let noResults = false;
  for (const section of sections) {
    const node = record(section);
    for (const entry of list(record(node?.itemSectionRenderer)?.contents)) {
      const renderer = record(entry)?.videoRenderer;
      if (renderer !== undefined) videos += 1;
      // YouTube's own "No results found" notice.
      if (record(entry)?.backgroundPromoRenderer !== undefined) noResults = true;
      const item = toWebItem(renderer, fetchedAt);
      if (item && !items.some((seen) => seen.id === item.id)) items.push(item);
    }
    const token = record(record(record(node?.continuationItemRenderer)?.continuationEndpoint)?.continuationCommand)?.token;
    if (typeof token === 'string' && INNERTUBE_TOKEN.test(token)) next = token;
  }
  // Videos none of which could be read (YouTube changed its wording, say), or neither videos nor the notice:
  // a failure, so youtube.ts falls back to the Data API instead of showing YouTube with nothing found.
  if ((videos > 0 && items.length === 0) || (videos === 0 && !noResults && next === null)) throw new Error('unreadable answer');
  return { items, next };
}

/** One page of InnerTube results. Throws (any error) when YouTube does not answer in the known shape. */
export async function innertubeSearch(words: string, continuation: string | null, fetchImpl: Parameters<typeof safeFetchJson>[1]['fetchImpl'], fetchedAt: string): Promise<SearchPage> {
  const body = await safeFetchJson(INNERTUBE_URL, {
    allowedHosts: INNERTUBE_HOSTS,
    fetchImpl,
    timeoutMs: INNERTUBE_TIMEOUT_MS,
    postJson: innertubeBody(words, continuation),
  });
  return parseInnertube(body, fetchedAt);
}
