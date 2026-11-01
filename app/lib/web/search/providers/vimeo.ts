/**
 * Vimeo, for a pasted link only: Vimeo's keyless oEmbed (`vimeo.com/api/oembed.json`), asked about the
 * address built from the validated numeric id - never the pasted address itself. It gives the title,
 * channel, description, upload date and length. Vimeo has no keyless search, so it is not searched.
 *
 * Live-checked 2026-10-31 (video 76979871): oEmbed 200; player https://player.vimeo.com/video/{id} 200 with
 * no X-Frame-Options; thumbnail on i.vimeocdn.com 200 image/jpeg once its `?region=` query is dropped.
 * Private and unlisted videos answer 403/404 (or need a hash WEB never carries): nothing to show.
 */
import { PLATFORM_HOSTS } from '../../hosts';
import { SafeFetchError, safeFetchJson } from '../../safe-fetch';
import { MAX_TEXT_LENGTH, plausibleIsoDate, sanitiseText } from '../../sanitise';
import { buildUrl, isAllowedUrl } from '../../urls';
import type { WebItem } from '../../types';
import type { SearchDeps, SearchProvider } from '../types';

const HOST = 'vimeo.com';
export const VIMEO_HOSTS = [HOST] as const;
export const VIMEO_ID = /^[1-9][0-9]{0,11}$/;
const MAX_DURATION_SECONDS = 7 * 24 * 60 * 60;

export function vimeoOembedUrl(id: string): string {
  return buildUrl(HOST, ['api', 'oembed.json'], [['url', buildUrl(HOST, [id])]]);
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

/** Vimeo's thumbnail, rebuilt on its own host from a path of exactly the allowed shape; the query is dropped. */
function thumbnail(value: unknown): string | undefined {
  if (!isAllowedUrl(value, ['i.vimeocdn.com'])) return undefined;
  const path = new URL(value).pathname;
  return PLATFORM_HOSTS.vimeo.thumbPath.test(path) ? `https://i.vimeocdn.com${path}` : undefined;
}

/** "2013-10-15 14:08:29" (Vimeo's oEmbed date, UTC) as ISO, or undefined. */
function uploadDate(value: unknown, fetchedAt: string): string | undefined {
  const text = str(value);
  if (!text || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(text)) return undefined;
  return plausibleIsoDate(`${text.replace(' ', 'T')}Z`, fetchedAt);
}

/** An oEmbed answer as a WebItem, or null when it is not this public video. */
export function toWebItem(body: unknown, id: string, fetchedAt: string): WebItem | null {
  if (!VIMEO_ID.test(id) || !body || typeof body !== 'object' || Array.isArray(body)) return null;
  const root = body as Record<string, unknown>;
  if (str(root.type) !== 'video' || String(root.video_id) !== id) return null;
  const page = buildUrl(HOST, [id]);
  const title = sanitiseText(str(root.title), 300) || id;
  const creator = sanitiseText(str(root.author_name), 200) || undefined;
  const description = sanitiseText(str(root.description), MAX_TEXT_LENGTH) || undefined;
  const thumb = thumbnail(root.thumbnail_url);
  const duration = root.duration;
  return {
    id: `vimeo:${id}`,
    platform: 'vimeo',
    externalId: id,
    kind: 'video',
    url: page,
    canonicalUrl: page,
    title,
    ...(creator ? { creator } : {}),
    ...(description ? { description } : {}),
    ...(thumb ? { thumbnailUrl: thumb } : {}),
    embedUrl: buildUrl('player.vimeo.com', ['video', id]),
    ...(typeof duration === 'number' && Number.isInteger(duration) && duration > 0 && duration <= MAX_DURATION_SECONDS
      ? { durationSeconds: duration }
      : {}),
    publishedAt: uploadDate(root.upload_date, fetchedAt) ?? fetchedAt,
    fetchedAt,
  };
}

export async function vimeoById(id: string, deps: SearchDeps): Promise<WebItem | null> {
  if (!VIMEO_ID.test(id)) return null;
  let body: unknown;
  try {
    body = await safeFetchJson(vimeoOembedUrl(id), { allowedHosts: VIMEO_HOSTS, fetchImpl: deps.fetch });
  } catch (error) {
    // 403 private, 404 gone: nothing WEB can play.
    if (error instanceof SafeFetchError && error.status !== undefined && error.status >= 400 && error.status < 500) return null;
    throw error;
  }
  return toWebItem(body, id, (deps.now?.() ?? new Date()).toISOString());
}

/** Fetch-one only: Vimeo is never searched (no keyless search), so `search` finds nothing. */
export const vimeoLookup: SearchProvider = {
  platform: 'vimeo',
  allowedHosts: VIMEO_HOSTS,
  timeoutMs: 10_000,
  async search() {
    return { items: [], next: null };
  },
  fetchOne: vimeoById,
};
