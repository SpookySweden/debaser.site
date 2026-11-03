/**
 * PeerTube, through each instance's public, keyless REST API (`/api/v1/video-channels/{channel}/videos`).
 *
 * A source is one channel on one instance: `source.ref` is `{instance}/{channel}`, and the instance must
 * be on `PEERTUBE_INSTANCES` (`../hosts.ts`), a list kept in code. An instance never comes from remote
 * data or free text, so a source cannot point WEB at a host nobody chose.
 *
 * One GET per source, newest first, 25 videos, safe-for-work only. PeerTube has no field selection, so the
 * response carries views, likes and the rest; they are never read. Only public, local, finished videos are
 * kept (a live stream or a federated copy from another instance is skipped).
 *
 * URLs are built from the instance and the validated uuid (live-checked 2026-10-31 on video.blender.org,
 * framatube.org and tilvids.com, all 200, players framable: no frame-ancestors, tilvids sends
 * X-Frame-Options ALLOWALL, which browsers ignore):
 *   page       https://{instance}/videos/watch/{uuid}
 *   thumbnail  https://{instance}/lazy-static/thumbnails/{uuid}.{jpg|png|webp}  (file name from `thumbnailPath`, re-validated)
 *   embed      https://{instance}/videos/embed/{uuid}
 */
import { PEERTUBE_INSTANCES, PLATFORM_HOSTS } from '../hosts';
import { safeFetchJson } from '../safe-fetch';
import { buildUrl, isSafeIdentifier } from '../urls';
import { MAX_TEXT_LENGTH, plausibleIsoDate, sanitiseText } from '../sanitise';
import type { WebItem, WebSource } from '../types';
import type { WebAdapter, WebAdapterDeps } from './types';
import { normaliseLanguage } from '../language';

export const PT_ALLOWED_HOSTS = PLATFORM_HOSTS.peertube.hosts;
export const PT_LINK_HOSTS = PLATFORM_HOSTS.peertube.linkHosts;
export const PT_COUNT = 25;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** A PeerTube actor name: lowercase letters, digits, `_` and `.` (PeerTube's own rule), at most 50. */
const CHANNEL = /^[a-z0-9_][a-z0-9_.]{0,49}$/;
const THUMB_PATH = /^\/(lazy-static|static)\/thumbnails\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(?:jpg|jpeg|png|webp))$/;
const PUBLIC = 1;
const MAX_DURATION_SECONDS = 7 * 24 * 60 * 60;

/**
 * PeerTube's licence ids (its `VIDEO_LICENCES`). PeerTube names the licence without a version; these
 * point at the current Creative Commons versions. Built from this table, never from remote data.
 */
export const PT_LICENCES: Record<number, string> = {
  1: 'https://creativecommons.org/licenses/by/4.0/',
  2: 'https://creativecommons.org/licenses/by-sa/4.0/',
  3: 'https://creativecommons.org/licenses/by-nd/4.0/',
  4: 'https://creativecommons.org/licenses/by-nc/4.0/',
  5: 'https://creativecommons.org/licenses/by-nc-sa/4.0/',
  6: 'https://creativecommons.org/licenses/by-nc-nd/4.0/',
  7: 'https://creativecommons.org/publicdomain/zero/1.0/',
  8: 'https://creativecommons.org/publicdomain/mark/1.0/',
};

export type PeerTubeRef = { instance: string; channel: string };

/** `{instance}/{channel}` with the instance on the allow-list, or null. */
export function validRef(ref: unknown): PeerTubeRef | null {
  if (typeof ref !== 'string') return null;
  const parts = ref.trim().split('/');
  if (parts.length !== 2) return null;
  const [instance, channel] = parts;
  if (!PEERTUBE_INSTANCES.includes(instance) || !CHANNEL.test(channel) || !isSafeIdentifier(channel)) return null;
  return { instance, channel };
}

export function channelVideosUrl({ instance, channel }: PeerTubeRef): string {
  return buildUrl(instance, ['api', 'v1', 'video-channels', channel, 'videos'], [
    ['count', String(PT_COUNT)],
    ['sort', '-publishedAt'],
    ['nsfw', 'false'],
    ['skipCount', 'true'],
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

/** One video as a WebItem, or null when it is not public, local, finished and identifiable. */
export function toWebItem(doc: unknown, instance: string, fetchedAt: string): WebItem | null {
  const video = record(doc);
  if (!video || !PEERTUBE_INSTANCES.includes(instance)) return null;

  const uuid = str(video.uuid);
  if (!uuid || !UUID.test(uuid)) return null;
  if (idOf(video.privacy) !== PUBLIC || video.nsfw !== false || video.isLive === true) return null;
  // A video federated from elsewhere lives on another host: only the instance's own videos are kept.
  if (video.isLocal !== true) return null;
  const channelHost = str(record(video.channel)?.host);
  if (channelHost !== undefined && channelHost !== instance) return null;

  const publishedAt = plausibleIsoDate(video.publishedAt, fetchedAt);
  if (!publishedAt) return null;

  const page = buildUrl(instance, ['videos', 'watch', uuid]);
  const thumb = str(video.thumbnailPath)?.match(THUMB_PATH);
  const title = sanitiseText(str(video.name), 300) || uuid;
  const creator =
    sanitiseText(str(record(video.channel)?.displayName) ?? str(record(video.account)?.displayName), 200) || undefined;
  const description =
    sanitiseText(str(video.truncatedDescription) ?? str(video.description), MAX_TEXT_LENGTH) || undefined;
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
    ...(thumb ? { thumbnailUrl: buildUrl(instance, [thumb[1], 'thumbnails', thumb[2]]) } : {}),
    embedUrl: buildUrl(instance, ['videos', 'embed', uuid]),
    ...(licence ? { licenseUrl: licence } : {}),
    ...(language ? { language } : {}),
    ...(typeof duration === 'number' && Number.isInteger(duration) && duration > 0 && duration <= MAX_DURATION_SECONDS
      ? { durationSeconds: duration }
      : {}),
    publishedAt,
    fetchedAt,
  };
}

/** The videos out of a channel listing, or a thrown error when the shape is wrong. */
export function parseChannelVideos(body: unknown, instance: string, fetchedAt: string): WebItem[] {
  const data = record(body)?.data;
  if (!Array.isArray(data)) throw new Error('unexpected response shape');
  const seen = new Set<string>();
  const items: WebItem[] = [];
  for (const doc of data) {
    const item = toWebItem(doc, instance, fetchedAt);
    if (!item || seen.has(item.id)) continue;
    seen.add(item.id);
    items.push(item);
  }
  return items;
}

export const peertubeAdapter: WebAdapter = {
  platform: 'peertube',
  allowedHosts: PT_ALLOWED_HOSTS,
  linkHosts: PT_LINK_HOSTS,
  async fetchItems(source: WebSource, deps: WebAdapterDeps = {}): Promise<WebItem[]> {
    const ref = validRef(source.ref);
    if (!ref) throw new Error('source ref is not {allow-listed instance}/{channel}');
    // Only the source's own instance: a redirect to another allow-listed instance is refused too.
    const body = await safeFetchJson(channelVideosUrl(ref), { allowedHosts: [ref.instance], fetchImpl: deps.fetch });
    return parseChannelVideos(body, ref.instance, (deps.now?.() ?? new Date()).toISOString());
  },
};
