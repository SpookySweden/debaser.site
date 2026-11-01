/**
 * Openverse, through its public, keyless anonymous API (api.openverse.org/v1), images or audio.
 *
 * A source is one search on one media type: `source.ref` is `image:{query}` or `audio:{query}`. One GET
 * per source, 20 results (the anonymous maximum), sensitive results left out. Openverse sends no
 * engagement data; it has no field selection either, so the response's direct file URLs, landing pages
 * and creator links arrive too and are never used: every address is built from the validated id.
 *
 * Openverse gives no upload date, only `indexed_on` (when Openverse found the work), so that is the date
 * the stream sorts by. It also has no player of its own, and the files it points at live on other sites,
 * so an item is a link to its Openverse page, never an embed.
 *
 * **Rate limits.** Anonymous use is 20 requests a minute and 200 a day per IP (the `x-ratelimit-*`
 * headers, 2026-10-31). Every Openverse source shares that budget, so they must be read rarely (a few
 * sources, a few times a day). A 429 is an error like any other, recorded on the source, never retried.
 *
 * Live-checked 2026-10-31 (the API was overloaded that day: some searches took 8-60 s, past the 10 s
 * fetch timeout, and the thumbnail endpoint answered 500; `unstable__sort_by` was ignored, so it is not sent):
 *   page       https://openverse.org/{image|audio}/{id}          (X-Frame-Options SAMEORIGIN: link only)
 *   thumbnail  https://api.openverse.org/v1/{images|audio}/{id}/thumb/   (Openverse's own thumbnail service)
 *   licence    `license_url`, kept only on creativecommons.org
 */
import { PLATFORM_HOSTS } from '../hosts';
import { safeFetchJson } from '../safe-fetch';
import { buildUrl, isAllowedUrl } from '../urls';
import { plausibleIsoDate, sanitiseText } from '../sanitise';
import type { WebItem, WebSource } from '../types';
import type { WebAdapter, WebAdapterDeps } from './types';

export const OV_ALLOWED_HOSTS = PLATFORM_HOSTS.openverse.hosts;
export const OV_LINK_HOSTS = PLATFORM_HOSTS.openverse.linkHosts;
const API_HOST = 'api.openverse.org';
const SITE_HOST = 'openverse.org';

/**
 * Openverse alone waits up to 20s, not the usual 10s (Luke, 2026-10-31): its searches took ~12s that day,
 * so at 10s every read failed. The run's time budget in ingest.ts keeps a run inside Vercel's 60s.
 */
export const OV_FETCH_TIMEOUT_MS = 20_000;

export const OV_PAGE_SIZE = 20;
export const OV_MAX_QUERY_LENGTH = 200;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MAX_DURATION_SECONDS = 7 * 24 * 60 * 60;

export type OpenverseMedia = 'image' | 'audio';
export type OpenverseRef = { media: OpenverseMedia; query: string };

/** The API's path segment for each media type. */
const ENDPOINT: Record<OpenverseMedia, string> = { image: 'images', audio: 'audio' };

/** `image:{query}` or `audio:{query}`, or null when it is not one WEB will send. */
export function validRef(ref: unknown): OpenverseRef | null {
  if (typeof ref !== 'string') return null;
  const match = ref.match(/^(image|audio):([\s\S]*)$/);
  if (!match) return null;
  const query = match[2].trim();
  if (query.length === 0 || query.length > OV_MAX_QUERY_LENGTH || /[\u0000-\u001f\u007f]/.test(query)) return null;
  return { media: match[1] as OpenverseMedia, query };
}

export function searchUrl({ media, query }: OpenverseRef): string {
  // The trailing '' gives the API's own trailing slash (`/v1/images/`), which saves a redirect.
  return buildUrl(API_HOST, ['v1', ENDPOINT[media], ''], [
    ['q', query],
    ['page_size', String(OV_PAGE_SIZE)],
    ['mature', 'false'],
  ]);
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

/** A licence URL, upgraded to https, kept only on an allow-listed licence host. */
function licenceUrl(value: unknown): string | undefined {
  const text = str(value)?.trim();
  if (!text) return undefined;
  const upgraded = text.replace(/^http:\/\//i, 'https://');
  return isAllowedUrl(upgraded, OV_LINK_HOSTS) ? upgraded : undefined;
}

/** One search result as a WebItem, or null when it is sensitive, unidentifiable or undated. */
export function toWebItem(doc: unknown, media: OpenverseMedia, fetchedAt: string): WebItem | null {
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return null;
  const record = doc as Record<string, unknown>;

  const id = str(record.id);
  if (!id || !UUID.test(id)) return null;
  if (record.mature !== false) return null;
  const sensitivity = record.unstable__sensitivity;
  if (Array.isArray(sensitivity) && sensitivity.length > 0) return null;

  const publishedAt = plausibleIsoDate(record.indexed_on, fetchedAt);
  if (!publishedAt) return null;

  const page = buildUrl(SITE_HOST, [media, id]);
  const title = sanitiseText(str(record.title), 300) || id;
  const creator = sanitiseText(str(record.creator), 200) || undefined;
  const licence = licenceUrl(record.license_url);
  // Images always have Openverse's thumbnail; audio only when the API says one exists. Only the
  // field's presence is read: the address is still built from the id.
  const hasThumb = media === 'image' || typeof record.thumbnail === 'string';
  const durationMs = record.duration;
  const durationSeconds =
    media === 'audio' && typeof durationMs === 'number' && Number.isFinite(durationMs) && durationMs > 0
      ? Math.round(durationMs / 1000)
      : undefined;

  return {
    id: `openverse:${id}`,
    platform: 'openverse',
    externalId: id,
    kind: media,
    url: page,
    canonicalUrl: page,
    title,
    ...(creator ? { creator } : {}),
    ...(hasThumb ? { thumbnailUrl: buildUrl(API_HOST, ['v1', ENDPOINT[media], id, 'thumb', '']) } : {}),
    ...(licence ? { licenseUrl: licence } : {}),
    ...(durationSeconds && durationSeconds <= MAX_DURATION_SECONDS ? { durationSeconds } : {}),
    publishedAt,
    fetchedAt,
  };
}

/** The results out of a search response, or a thrown error when the shape is wrong. */
export function parseSearchResponse(body: unknown, media: OpenverseMedia, fetchedAt: string): WebItem[] {
  const results = (body as { results?: unknown } | null)?.results;
  if (!Array.isArray(results)) throw new Error('unexpected response shape');
  const seen = new Set<string>();
  const items: WebItem[] = [];
  for (const doc of results) {
    const item = toWebItem(doc, media, fetchedAt);
    if (!item || seen.has(item.id)) continue;
    seen.add(item.id);
    items.push(item);
  }
  return items;
}

export const openverseAdapter: WebAdapter = {
  platform: 'openverse',
  allowedHosts: OV_ALLOWED_HOSTS,
  linkHosts: OV_LINK_HOSTS,
  async fetchItems(source: WebSource, deps: WebAdapterDeps = {}): Promise<WebItem[]> {
    const ref = validRef(source.ref);
    if (!ref) throw new Error('source ref is not image:{query} or audio:{query}');
    const body = await safeFetchJson(searchUrl(ref), {
      allowedHosts: [API_HOST],
      fetchImpl: deps.fetch,
      timeoutMs: OV_FETCH_TIMEOUT_MS,
    });
    return parseSearchResponse(body, ref.media, (deps.now?.() ?? new Date()).toISOString());
  },
};
