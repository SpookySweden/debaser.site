/**
 * YouTube, through a channel's public Atom feed (`www.youtube.com/feeds/videos.xml?channel_id=...`).
 * Keyless; no Data API.
 *
 * A source is one channel: `source.ref` is its channel id (`UC` + 22 characters). One GET per source; the
 * feed holds the channel's 15 newest videos. It also carries `media:community` with star ratings and view
 * counts: that element is never read. Parsed by the strict bounded reader in `./xml.ts`.
 *
 * URLs are built from the validated video id, never taken from the feed (live-checked 2026-10-31):
 *   page       https://youtu.be/{id}                         (303 to the watch page; no query string to carry)
 *   thumbnail  https://i.ytimg.com/vi/{id}/hqdefault.jpg     (200 image/jpeg)
 *   embed      https://www.youtube-nocookie.com/embed/{id}   (200, no X-Frame-Options, no frame-ancestors)
 *
 * A video id may start with `-` or `_`; WEB's ids and paging cursors require an alphanumeric first
 * character (`isSafeIdentifier`, `paging.ts`), so those videos (about 1 in 32) are skipped for now.
 */
import { PLATFORM_HOSTS } from '../hosts';
import { safeFetchText } from '../safe-fetch';
import { buildUrl, isSafeIdentifier } from '../urls';
import { MAX_TEXT_LENGTH, plausibleIsoDate, sanitiseText } from '../sanitise';
import type { WebItem, WebSource } from '../types';
import type { WebAdapter, WebAdapterDeps } from './types';
import { child, childText, children, parseXml, type XmlElement } from './xml';

export const YT_ALLOWED_HOSTS = PLATFORM_HOSTS.youtube.hosts;
export const YT_LINK_HOSTS = PLATFORM_HOSTS.youtube.linkHosts;
const FEED_HOST = 'www.youtube.com';

const CHANNEL_ID = /^UC[A-Za-z0-9_-]{22}$/;
/** YouTube's 11-character id, with WEB's alphanumeric first character. */
const VIDEO_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{10}$/;

/** The channel id, or null when it is not one. */
export function validRef(ref: unknown): string | null {
  return typeof ref === 'string' && CHANNEL_ID.test(ref) ? ref : null;
}

export function feedUrl(channelId: string): string {
  return buildUrl(FEED_HOST, ['feeds', 'videos.xml'], [['channel_id', channelId]]);
}

/** One `<entry>` as a WebItem, or null when it is from another channel, unidentifiable or undated. */
export function toWebItem(entry: XmlElement, channelId: string, fetchedAt: string): WebItem | null {
  if (entry.name !== 'entry') return null;
  const id = childText(entry, 'yt:videoId')?.trim();
  if (!id || !VIDEO_ID.test(id) || !isSafeIdentifier(id)) return null;
  if (childText(entry, 'yt:channelId')?.trim() !== channelId) return null;

  const publishedAt = plausibleIsoDate(childText(entry, 'published'), fetchedAt);
  if (!publishedAt) return null;

  // Only these two children of media:group are read; media:community (ratings, views) never is.
  const group = child(entry, 'media:group');
  const page = buildUrl('youtu.be', [id]);
  const title = sanitiseText(childText(entry, 'title') ?? childText(group, 'media:title'), 300) || id;
  const creator = sanitiseText(childText(child(entry, 'author'), 'name'), 200) || undefined;
  const description = sanitiseText(childText(group, 'media:description'), MAX_TEXT_LENGTH) || undefined;

  return {
    id: `youtube:${id}`,
    platform: 'youtube',
    externalId: id,
    kind: 'video',
    url: page,
    canonicalUrl: page,
    title,
    ...(creator ? { creator } : {}),
    ...(description ? { description } : {}),
    thumbnailUrl: buildUrl('i.ytimg.com', ['vi', id, 'hqdefault.jpg']),
    embedUrl: buildUrl('www.youtube-nocookie.com', ['embed', id]),
    publishedAt,
    fetchedAt,
  };
}

/** The videos out of a channel feed, or a thrown error when it is not an Atom feed. */
export function parseFeed(xml: string, channelId: string, fetchedAt: string): WebItem[] {
  const root = parseXml(xml);
  if (root.name !== 'feed') throw new Error('not an Atom feed');
  const seen = new Set<string>();
  const items: WebItem[] = [];
  for (const entry of children(root, 'entry')) {
    const item = toWebItem(entry, channelId, fetchedAt);
    if (!item || seen.has(item.id)) continue;
    seen.add(item.id);
    items.push(item);
  }
  return items;
}

export const youtubeAdapter: WebAdapter = {
  platform: 'youtube',
  allowedHosts: YT_ALLOWED_HOSTS,
  linkHosts: YT_LINK_HOSTS,
  async fetchItems(source: WebSource, deps: WebAdapterDeps = {}): Promise<WebItem[]> {
    const channelId = validRef(source.ref);
    if (!channelId) throw new Error('source ref is not a YouTube channel id');
    const xml = await safeFetchText(feedUrl(channelId), {
      allowedHosts: [FEED_HOST],
      fetchImpl: deps.fetch,
      accept: 'application/atom+xml, application/xml;q=0.9, text/xml;q=0.8',
    });
    return parseFeed(xml, channelId, (deps.now?.() ?? new Date()).toISOString());
  },
};
