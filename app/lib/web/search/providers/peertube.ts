/**
 * Search everywhere: all of PeerTube, through Sepia Search (sepiasearch.org, Framasoft's keyless index of
 * public PeerTube videos; `GET /api/v1/search/videos`).
 *
 * Every video lives on its own instance, and its player plays from there. So an item is kept only when its
 * instance is in the public instances index (`../peertube-index.ts`) and the video's account, channel and
 * page all name that one instance; every address is then built from that host and the validated uuid, as
 * the stream's adapter does. The search result alone never decides a host. Sepia sends views, likes and
 * comment counts too; they are never read. Public, safe-for-work, finished videos only. POPULAR asks Sepia's own
 * `-views` order and DATE its `publishedAt` (SPEC-web-sort.md, live-checked 2026-11-02); no count is read either way.
 *
 * Live-checked 2026-10-31 ("night of the living dead": 10,868 hits): see the commit message for the
 * status codes. Sepia refuses `start` of 9000 or more; WEB stops paging at 1000.
 *   page       https://{instance}/videos/watch/{uuid}
 *   thumbnail  https://{instance}/lazy-static/thumbnails/{file}   (file name matched from `thumbnailPath`, rebuilt)
 *   embed      https://{instance}/videos/embed/{uuid}
 */
import { PT_LICENCES } from '../../adapters/peertube';
import { safeFetchJson } from '../../safe-fetch';
import { MAX_TEXT_LENGTH, plausibleIsoDate, sanitiseText } from '../../sanitise';
import { buildUrl } from '../../urls';
import type { WebItem } from '../../types';
import { peertubeHosts } from '../peertube-index';
import type { ProviderPage, SearchDeps, SearchOrder, SearchPage, SearchProvider } from '../types';
import { normaliseLanguage } from '../../language';

const SEPIA = 'sepiasearch.org';
export const PT_SEARCH_HOSTS = [SEPIA] as const;
export const PT_SEARCH_COUNT = 20;
const MAX_START = 1000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const THUMB_PATH = /^\/(lazy-static|static)\/thumbnails\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(?:jpg|jpeg|png|webp))$/;
const PUBLIC = 1;
const MAX_DURATION_SECONDS = 7 * 24 * 60 * 60;

/** Sepia's own sort for an order; best match sends none. */
const PT_SORTS: Record<SearchOrder, string | null> = { relevance: null, popular: '-views', newest: '-publishedAt', oldest: 'publishedAt' };

export function sepiaSearchUrl(words: string, start: number, order: SearchOrder = 'relevance'): string {
  const sort = PT_SORTS[order];
  return buildUrl(SEPIA, ['api', 'v1', 'search', 'videos'], [
    ['search', words],
    ['start', String(start)],
    ['count', String(PT_SEARCH_COUNT)],
    ['nsfw', 'false'],
    ...(sort === null ? [] : [['sort', sort] as const]),
  ]);
}

export function sepiaLookupUrl(uuid: string): string {
  return buildUrl(SEPIA, ['api', 'v1', 'search', 'videos'], [
    ['uuids', uuid],
    ['count', '1'],
    ['nsfw', 'false'],
  ]);
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function idOf(value: unknown): number | undefined {
  const id = record(value)?.id;
  return typeof id === 'number' ? id : undefined;
}

/** The host of a URL from the data, used only to compare with the account's host; never fetched or kept. */
function hostIn(value: unknown): string | undefined {
  try {
    return typeof value === 'string' ? new URL(value).host : undefined;
  } catch {
    return undefined;
  }
}

/** One Sepia result as a WebItem, or null when it is not public, finished, identifiable and on an indexed instance. */
export function toWebItem(doc: unknown, allowed: ReadonlySet<string>, fetchedAt: string): WebItem | null {
  const video = record(doc);
  if (!video) return null;
  const uuid = str(video.uuid);
  if (!uuid || !UUID.test(uuid)) return null;
  if (idOf(video.privacy) !== PUBLIC || video.nsfw !== false || video.isLive === true) return null;

  // One instance, named the same way by the account, the channel and the page, and in the index.
  const host = str(record(video.account)?.host);
  if (!host || !allowed.has(host)) return null;
  if (str(record(video.channel)?.host) !== host || hostIn(video.url) !== host) return null;

  const publishedAt = plausibleIsoDate(video.publishedAt, fetchedAt);
  if (!publishedAt) return null;

  const page = buildUrl(host, ['videos', 'watch', uuid]);
  const thumb = str(video.thumbnailPath)?.match(THUMB_PATH);
  const title = sanitiseText(str(video.name), 300) || uuid;
  const creator =
    sanitiseText(str(record(video.channel)?.displayName) ?? str(record(video.account)?.displayName), 200) || undefined;
  const description = sanitiseText(str(video.truncatedDescription) ?? str(video.description), MAX_TEXT_LENGTH) || undefined;
  const licence = PT_LICENCES[idOf(video.licence) ?? 0];
  const duration = video.duration;
  const language = normaliseLanguage(str(record(video.language)?.id));

  return {
    id: `peertube:${uuid}`,
    platform: 'peertube',
    externalId: uuid,
    kind: 'video',
    url: page,
    canonicalUrl: page,
    title,
    ...(creator ? { creator } : {}),
    ...(description ? { description } : {}),
    ...(thumb ? { thumbnailUrl: buildUrl(host, [thumb[1], 'thumbnails', thumb[2]]) } : {}),
    embedUrl: buildUrl(host, ['videos', 'embed', uuid]),
    ...(licence ? { licenseUrl: licence } : {}),
    ...(language ? { language } : {}),
    ...(typeof duration === 'number' && Number.isInteger(duration) && duration > 0 && duration <= MAX_DURATION_SECONDS
      ? { durationSeconds: duration }
      : {}),
    publishedAt,
    fetchedAt,
  };
}

/** The items and the next start out of a Sepia answer; a thrown error when the shape is wrong. */
export function parseSepia(body: unknown, start: number, allowed: ReadonlySet<string>, fetchedAt: string): SearchPage {
  const data = record(body)?.data;
  if (!Array.isArray(data)) throw new Error('unexpected response shape');
  const items: WebItem[] = [];
  for (const doc of data) {
    const item = toWebItem(doc, allowed, fetchedAt);
    if (item && !items.some((seen) => seen.id === item.id)) items.push(item);
  }
  const total = record(body)?.total;
  const nextStart = start + PT_SEARCH_COUNT;
  return { items, next: typeof total === 'number' && total > nextStart && nextStart < MAX_START ? nextStart : null };
}

function startOf(page: ProviderPage | null): number {
  return typeof page === 'number' && Number.isInteger(page) && page >= 0 && page < MAX_START && page % PT_SEARCH_COUNT === 0 ? page : 0;
}

async function allowedHosts(deps: SearchDeps): Promise<ReadonlySet<string>> {
  return deps.peertubeHosts ?? peertubeHosts(deps.fetch);
}

export const peertubeSearch: SearchProvider = {
  platform: 'peertube',
  allowedHosts: PT_SEARCH_HOSTS,
  timeoutMs: 10_000,
  orders: ['popular', 'newest', 'oldest'],
  async search(words: string, page: ProviderPage | null, deps: SearchDeps): Promise<SearchPage> {
    const start = startOf(page);
    const [body, allowed] = await Promise.all([
      safeFetchJson(sepiaSearchUrl(words, start, deps.order), { allowedHosts: PT_SEARCH_HOSTS, fetchImpl: deps.fetch }),
      allowedHosts(deps),
    ]);
    return parseSepia(body, start, allowed, (deps.now?.() ?? new Date()).toISOString());
  },
  async fetchOne(externalId: string, deps: SearchDeps): Promise<WebItem | null> {
    if (!UUID.test(externalId)) return null;
    const [body, allowed] = await Promise.all([
      safeFetchJson(sepiaLookupUrl(externalId), { allowedHosts: PT_SEARCH_HOSTS, fetchImpl: deps.fetch }),
      allowedHosts(deps),
    ]);
    const { items } = parseSepia(body, 0, allowed, (deps.now?.() ?? new Date()).toISOString());
    return items.find((item) => item.externalId === externalId) ?? null;
  },
};
