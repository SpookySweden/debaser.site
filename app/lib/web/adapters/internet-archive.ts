/**
 * The Internet Archive, through its public, keyless Advanced Search API (archive.org/advancedsearch.php).
 *
 * One GET per source: `q` is the source's query, newest first, 25 rows, and only the metadata fields
 * WEB keeps. `downloads` and every other engagement field are never asked for. Fields arrive as a string
 * or an array of strings depending on the item, so every read goes through `first`.
 *
 * URLs are built from the validated identifier alone (live-checked 2026-10-31, SPEC-web.md):
 *   page       https://archive.org/details/{id}
 *   thumbnail  https://archive.org/services/img/{id}
 *   embed      https://archive.org/embed/{id}
 */
import { PLATFORM_HOSTS } from '../hosts';
import { safeFetchJson } from '../safe-fetch';
import { buildUrl, isAllowedUrl, isSafeIdentifier } from '../urls';
import { MAX_TEXT_LENGTH, plausibleIsoDate, sanitiseText } from '../sanitise';
import type { WebItem, WebItemKind, WebSource } from '../types';
import type { WebAdapter, WebAdapterDeps } from './types';
import { normaliseLanguage } from '../language';

export const IA_ALLOWED_HOSTS = PLATFORM_HOSTS.internet_archive.hosts;
/** Licence pages an item may link to (Creative Commons is what the Archive's `licenseurl` almost always is). */
export const IA_LINK_HOSTS = PLATFORM_HOSTS.internet_archive.linkHosts;
const HOST = 'archive.org';

export const IA_ROWS = 25;
export const IA_MAX_QUERY_LENGTH = 500;
export const IA_FIELDS = [
  'identifier',
  'title',
  'creator',
  'description',
  'date',
  'publicdate',
  'mediatype',
  'licenseurl',
  'access-restricted-item',
  'language',
] as const;

const MEDIATYPE_KINDS: Record<string, WebItemKind> = {
  audio: 'audio',
  etree: 'audio',
  movies: 'video',
  image: 'image',
  texts: 'text',
};

/** The first string of a field that may be a string, an array of strings, or missing. */
function first(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.find((entry): entry is string => typeof entry === 'string');
  return undefined;
}

/** Every string of such a field, joined (several creators read as one line). */
function joined(value: unknown, separator: string): string | undefined {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    const parts = value.filter((entry): entry is string => typeof entry === 'string');
    return parts.length > 0 ? parts.join(separator) : undefined;
  }
  return undefined;
}

function isRestricted(value: unknown): boolean {
  const flag = Array.isArray(value) ? value[0] : value;
  return flag === true || (typeof flag === 'string' && flag.trim().toLowerCase() === 'true');
}

function isoDate(value: unknown, fetchedAt: string): string | undefined {
  return plausibleIsoDate(first(value), fetchedAt);
}

/** A licence URL, upgraded to https, kept only on an allow-listed licence host. */
function licenceUrl(value: unknown): string | undefined {
  const text = first(value)?.trim();
  if (!text) return undefined;
  const upgraded = text.replace(/^http:\/\//i, 'https://');
  return isAllowedUrl(upgraded, IA_LINK_HOSTS) ? upgraded : undefined;
}

/** The search query, or null when it is not one WEB will send. */
export function validQuery(ref: unknown): string | null {
  if (typeof ref !== 'string') return null;
  const query = ref.trim();
  // A query has no business carrying control characters.
  if (query.length === 0 || query.length > IA_MAX_QUERY_LENGTH || /[\u0000-\u001f\u007f]/.test(query)) return null;
  return query;
}

export function searchUrl(query: string): string {
  return buildUrl(HOST, ['advancedsearch.php'], [
    ['q', query],
    ...IA_FIELDS.map((field) => ['fl[]', field] as const),
    ['sort[]', 'publicdate desc'],
    ['rows', String(IA_ROWS)],
    ['page', '1'],
    ['output', 'json'],
  ]);
}

/** One search document as a WebItem, or null when it is restricted, unidentifiable or undated. */
export function toWebItem(doc: unknown, fetchedAt: string): WebItem | null {
  if (!doc || typeof doc !== 'object') return null;
  const record = doc as Record<string, unknown>;

  const id = first(record.identifier);
  if (!isSafeIdentifier(id)) return null;
  if (isRestricted(record['access-restricted-item'])) return null;

  const publishedAt = isoDate(record.publicdate, fetchedAt) ?? isoDate(record.date, fetchedAt);
  if (!publishedAt) return null;

  const page = buildUrl(HOST, ['details', id]);
  const kind = MEDIATYPE_KINDS[first(record.mediatype) ?? ''] ?? 'other';
  const title = sanitiseText(first(record.title), 300) || id;
  const creator = sanitiseText(joined(record.creator, '; '), 200) || undefined;
  const description = sanitiseText(joined(record.description, ' '), MAX_TEXT_LENGTH) || undefined;
  const licence = licenceUrl(record.licenseurl);
  const language = normaliseLanguage(first(record.language));

  return {
    id: `internet_archive:${id}`,
    platform: 'internet_archive',
    externalId: id,
    kind,
    url: page,
    canonicalUrl: page,
    title,
    ...(creator ? { creator } : {}),
    ...(description ? { description } : {}),
    thumbnailUrl: buildUrl(HOST, ['services', 'img', id]),
    // The Archive's player handles audio, video and books; an image or "other" item is a link only.
    ...(kind === 'audio' || kind === 'video' || kind === 'text' ? { embedUrl: buildUrl(HOST, ['embed', id]) } : {}),
    ...(licence ? { licenseUrl: licence } : {}),
    ...(language ? { language } : {}),
    publishedAt,
    fetchedAt,
  };
}

/** The documents out of an Advanced Search response, or a thrown error when the shape is wrong. */
export function parseSearchResponse(body: unknown, fetchedAt: string): WebItem[] {
  const docs = (body as { response?: { docs?: unknown } } | null)?.response?.docs;
  if (!Array.isArray(docs)) throw new Error('unexpected response shape');
  const seen = new Set<string>();
  const items: WebItem[] = [];
  for (const doc of docs) {
    const item = toWebItem(doc, fetchedAt);
    if (!item || seen.has(item.id)) continue;
    seen.add(item.id);
    items.push(item);
  }
  return items;
}

export const internetArchiveAdapter: WebAdapter = {
  platform: 'internet_archive',
  allowedHosts: IA_ALLOWED_HOSTS,
  linkHosts: IA_LINK_HOSTS,
  async fetchItems(source: WebSource, deps: WebAdapterDeps = {}): Promise<WebItem[]> {
    const query = validQuery(source.ref);
    if (!query) throw new Error('source query is empty, too long or malformed');
    const body = await safeFetchJson(searchUrl(query), { allowedHosts: IA_ALLOWED_HOSTS, fetchImpl: deps.fetch });
    return parseSearchResponse(body, (deps.now?.() ?? new Date()).toISOString());
  },
};
