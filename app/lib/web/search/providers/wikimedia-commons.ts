/**
 * Search everywhere: Wikimedia Commons, through the MediaWiki API (commons.wikimedia.org/w/api.php, keyless):
 * a full-text search of the File namespace with each file's upload time, uploader, type and the licence and
 * credit lines Commons extracts from its page (`extmetadata`, filtered to four fields). No engagement data
 * exists there to ask for.
 *
 * An item's id is the file page's numeric id, so every id is safe. Addresses (live-checked 2026-10-31):
 *   page       https://commons.wikimedia.org/wiki/Special:Redirect/page/{pageid}   (301 to the file page)
 *   thumbnail  https://thumb.wikimedia.org/wikipedia/commons/thumb/...             (path matched from `thumburl`, rebuilt, query dropped)
 *   embed      https://commons.wikimedia.org/wiki/File:{name}?embedplayer=yes      (Commons' own player page;
 *              200, no X-Frame-Options, no frame-ancestors). Audio and video only, and never the raw file on
 *              upload.wikimedia.org: Commons plays it through its own player.
 *
 * DATE (SPEC-web-sort.md, live-checked 2026-11-02) is Commons' own `create_timestamp` order, which is the file's
 * first upload. So a sorted search asks for every upload of each file (`iilimit`) and dates the file by its oldest,
 * so the date shown agrees with the order; the picture, words and licence are still the newest upload's. No
 * popularity order exists here, so POPULAR never asks Commons (Luke).
 */
import { PLATFORM_HOSTS } from '../../hosts';
import { safeFetchJson } from '../../safe-fetch';
import { MAX_TEXT_LENGTH, plausibleIsoDate, sanitiseText } from '../../sanitise';
import { buildUrl, isAllowedUrl } from '../../urls';
import type { WebItem, WebItemKind } from '../../types';
import type { ProviderPage, SearchDeps, SearchKind, SearchOrder, SearchPage, SearchProvider } from '../types';

const API_HOST = 'commons.wikimedia.org';
const THUMB_HOST = 'thumb.wikimedia.org';
export const WC_SEARCH_HOSTS = [API_HOST] as const;
export const WC_SEARCH_LIMIT = 20;
/** MediaWiki stops full-text search offsets at 10,000; WEB stops much sooner. */
const MAX_OFFSET = 1000;
const PAGE_ID = /^[1-9][0-9]{0,11}$/;
const FILE_NS = 6;
const COMMONS = PLATFORM_HOSTS.wikimedia_commons;
const MAX_FILE_NAME = 240;

const MEDIATYPE_KINDS: Record<string, WebItemKind> = {
  VIDEO: 'video',
  AUDIO: 'audio',
  BITMAP: 'image',
  DRAWING: 'image',
  OFFICE: 'text',
};

const COMMON_PARAMS: readonly (readonly [string, string])[] = [
  ['action', 'query'],
  ['format', 'json'],
  ['formatversion', '2'],
  ['prop', 'imageinfo'],
  ['iiprop', 'url|timestamp|user|extmetadata|mediatype'],
  ['iiurlwidth', '320'],
  ['iiextmetadatafilter', 'Artist|ImageDescription|LicenseUrl|ObjectName'],
];

/** A `type:` filter as Commons' own search keyword (checked live 2026-11-01: each returns only that kind). */
const KIND_FILETYPE: Record<SearchKind, string> = { video: 'video', audio: 'audio', image: 'bitmap|drawing', text: 'office' };

/** Every upload of a file, newest first, so a sorted search can date it by its first; files rarely have more. */
const WC_UPLOADS = 50;

export function commonsSearchUrl(words: string, offset: number, kind?: SearchKind, order: SearchOrder = 'relevance'): string {
  const dated = order === 'newest' || order === 'oldest';
  return buildUrl(API_HOST, ['w', 'api.php'], [
    ...COMMON_PARAMS,
    ['generator', 'search'],
    ['gsrnamespace', String(FILE_NS)],
    ['gsrsearch', kind === undefined ? words : `${words} filetype:${KIND_FILETYPE[kind]}`],
    ['gsrlimit', String(WC_SEARCH_LIMIT)],
    ['gsroffset', String(offset)],
    ...(dated ? ([['gsrsort', order === 'newest' ? 'create_timestamp_desc' : 'create_timestamp_asc'], ['iilimit', String(WC_UPLOADS)]] as const) : []),
  ]);
}

export function commonsPageUrl(pageId: string): string {
  return buildUrl(API_HOST, ['w', 'api.php'], [...COMMON_PARAMS, ['pageids', pageId]]);
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

/** One `extmetadata` field's value (Commons wraps each as `{ value, source }`). */
function meta(info: Record<string, unknown>, field: string): string | undefined {
  return str(record(record(info.extmetadata)?.[field])?.value);
}

/**
 * The file's name as one path segment, from the page title `File:Name.ext`: spaces as underscores, then
 * percent-encoded, so it can only ever be one segment of `/wiki/File:...`. Null for anything odd.
 */
export function fileSegment(title: unknown): string | null {
  if (typeof title !== 'string' || !title.startsWith('File:')) return null;
  const name = title.slice('File:'.length).trim().replace(/ /g, '_');
  if (name.length === 0 || name.length > MAX_FILE_NAME || /[\u0000-\u001f\u007f/#?]/.test(name)) return null;
  return encodeURIComponent(name);
}

/** The thumbnail, rebuilt on the thumbnail host from a path of exactly the allowed shape; the query is dropped. */
function thumbnail(value: unknown): string | undefined {
  if (!isAllowedUrl(value, [THUMB_HOST, 'upload.wikimedia.org'])) return undefined;
  const path = new URL(value).pathname;
  return COMMONS.thumbPath.test(path) ? `https://${THUMB_HOST}${path}` : undefined;
}

function licenceUrl(value: string | undefined): string | undefined {
  const text = value?.trim();
  if (!text) return undefined;
  const upgraded = text.replace(/^http:\/\//i, 'https://').replace(/^\/\//, 'https://');
  return isAllowedUrl(upgraded, COMMONS.linkHosts) ? upgraded : undefined;
}

/** One file page as a WebItem, or null when it is not a usable file. */
export function toWebItem(doc: unknown, fetchedAt: string): WebItem | null {
  const page = record(doc);
  if (!page || page.ns !== FILE_NS || page.missing === true) return null;
  const pageId = typeof page.pageid === 'number' ? String(page.pageid) : undefined;
  if (!pageId || !PAGE_ID.test(pageId)) return null;
  const segment = fileSegment(page.title);
  if (!segment) return null;
  const info = record(Array.isArray(page.imageinfo) ? page.imageinfo[0] : undefined);
  if (!info) return null;

  // The first upload (the last entry when every upload was asked for; the only one otherwise).
  const uploads = Array.isArray(page.imageinfo) ? page.imageinfo : [];
  const publishedAt = plausibleIsoDate(record(uploads[uploads.length - 1])?.timestamp, fetchedAt);
  if (!publishedAt) return null;

  const kind = MEDIATYPE_KINDS[str(info.mediatype) ?? ''] ?? 'other';
  // Written out: buildUrl would encode the colon of Special:Redirect. pageId is digits only.
  const link = `https://${API_HOST}/wiki/Special:Redirect/page/${pageId}`;
  const fallbackTitle = decodeURIComponent(segment).replace(/_/g, ' ').replace(/\.[A-Za-z0-9]{2,5}$/, '');
  const title = sanitiseText(meta(info, 'ObjectName'), 300) || sanitiseText(fallbackTitle, 300) || pageId;
  const creator = sanitiseText(meta(info, 'Artist'), 200) || sanitiseText(str(info.user), 200) || undefined;
  const description = sanitiseText(meta(info, 'ImageDescription'), MAX_TEXT_LENGTH) || undefined;
  const thumb = thumbnail(info.thumburl);
  const licence = licenceUrl(meta(info, 'LicenseUrl'));

  return {
    id: `wikimedia_commons:${pageId}`,
    platform: 'wikimedia_commons',
    externalId: pageId,
    kind,
    url: link,
    canonicalUrl: link,
    title,
    ...(creator ? { creator } : {}),
    ...(description ? { description } : {}),
    ...(thumb ? { thumbnailUrl: thumb } : {}),
    // Commons' own player page, for what it can play; never the file itself.
    ...(kind === 'video' || kind === 'audio' ? { embedUrl: `https://${API_HOST}/wiki/File:${segment}${COMMONS.embedQuery}` } : {}),
    ...(licence ? { licenseUrl: licence } : {}),
    publishedAt,
    fetchedAt,
  };
}

/** The items and the next offset out of an API answer; a thrown error when the shape is wrong. */
export function parseCommons(body: unknown, fetchedAt: string): SearchPage {
  const root = record(body);
  if (!root || root.error !== undefined) throw new Error('the API answered an error');
  const pages = record(root.query)?.pages;
  // A search with no hits has no `query` at all.
  if (pages === undefined && root.query === undefined) return { items: [], next: null };
  if (!Array.isArray(pages)) throw new Error('unexpected response shape');
  const sorted = [...pages].sort((a, b) => (Number(record(a)?.index) || 0) - (Number(record(b)?.index) || 0));
  const items: WebItem[] = [];
  for (const doc of sorted) {
    const item = toWebItem(doc, fetchedAt);
    if (item && !items.some((seen) => seen.id === item.id)) items.push(item);
  }
  const offset = record(root.continue)?.gsroffset;
  return {
    items,
    next: typeof offset === 'number' && Number.isInteger(offset) && offset > 0 && offset < MAX_OFFSET ? offset : null,
  };
}

function offsetOf(page: ProviderPage | null): number {
  return typeof page === 'number' && Number.isInteger(page) && page >= 0 && page < MAX_OFFSET ? page : 0;
}

export const wikimediaCommonsSearch: SearchProvider = {
  platform: 'wikimedia_commons',
  allowedHosts: WC_SEARCH_HOSTS,
  timeoutMs: 10_000,
  orders: ['newest', 'oldest'],
  async search(words: string, page: ProviderPage | null, deps: SearchDeps, _author?: string, kind?: SearchKind): Promise<SearchPage> {
    const body = await safeFetchJson(commonsSearchUrl(words, offsetOf(page), kind, deps.order), { allowedHosts: WC_SEARCH_HOSTS, fetchImpl: deps.fetch });
    return parseCommons(body, (deps.now?.() ?? new Date()).toISOString());
  },
  async fetchOne(externalId: string, deps: SearchDeps): Promise<WebItem | null> {
    if (!PAGE_ID.test(externalId)) return null;
    const body = await safeFetchJson(commonsPageUrl(externalId), { allowedHosts: WC_SEARCH_HOSTS, fetchImpl: deps.fetch });
    const { items } = parseCommons(body, (deps.now?.() ?? new Date()).toISOString());
    return items.find((item) => item.externalId === externalId) ?? null;
  },
};

/**
 * One file by its name (a pasted `/wiki/File:...` link): the name is decoded, checked like a page title
 * (`fileSegment`) and sent as the API's `titles` value - the pasted address itself is never fetched.
 */
export async function commonsByFileName(name: string, deps: SearchDeps): Promise<WebItem | null> {
  const title = `File:${name.replace(/_/g, ' ')}`;
  if (fileSegment(title) === null) return null;
  const body = await safeFetchJson(buildUrl(API_HOST, ['w', 'api.php'], [...COMMON_PARAMS, ['titles', title]]), {
    allowedHosts: WC_SEARCH_HOSTS,
    fetchImpl: deps.fetch,
  });
  const { items } = parseCommons(body, (deps.now?.() ?? new Date()).toISOString());
  return items[0] ?? null;
}
