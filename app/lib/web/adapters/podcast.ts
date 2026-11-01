/**
 * Podcasts, through their own public RSS 2.0 feeds.
 *
 * **The host problem.** A podcast lives wherever its owner hosts it, which fights WEB's fixed host
 * allow-lists. The answer is that only feeds chosen by hand in code can be read: `source.ref` must be
 * exactly one `feedUrl` from `PODCAST_FEEDS` (`../hosts.ts`). Each entry also fixes the one host and path
 * shape an episode link may have, the artwork to show and the licence. Nothing the feed says can add a
 * host: an episode link off its pattern falls back to the show's page, the feed's image URLs are ignored,
 * and the stream never fetches or links the audio file (it only says whether an episode is audio or video).
 * PLAY hands an audio episode's file address to the site's music bar, whose browser streams it from the
 * podcast's own host (`../audio-files.ts`, Luke's OK 2026-10-31); the server still never fetches the file.
 *
 * One GET per source, parsed by the strict bounded reader in `./xml.ts` (no DTDs, no entities beyond
 * XML's five). The newest 50 entries are read; episodes marked explicit, blocked, or with no audio or
 * video enclosure are skipped. Feeds have no engagement data to ignore.
 *
 * An episode's id is a hash of its `<guid>` (or link, or enclosure URL): guids are often whole URLs with
 * query strings, and the id has to be a safe identifier that stays the same across reads.
 */
import { createHash } from 'node:crypto';
import { PLATFORM_HOSTS, PODCAST_FEEDS, type PodcastFeed } from '../hosts';
import { safeFetchText } from '../safe-fetch';
import { isAllowedUrl } from '../urls';
import { MAX_TEXT_LENGTH, plausibleIsoDate, sanitiseText } from '../sanitise';
import type { WebItem, WebItemKind, WebSource } from '../types';
import type { WebAdapter, WebAdapterDeps } from './types';
import { child, childText, children, parseXml, type XmlElement } from './xml';

export const POD_ALLOWED_HOSTS = PLATFORM_HOSTS.podcast.hosts;
export const POD_LINK_HOSTS = PLATFORM_HOSTS.podcast.linkHosts;
export const POD_MAX_ITEMS = 50;
const MAX_DURATION_SECONDS = 7 * 24 * 60 * 60;

/** The feed a source names, or null unless its ref is exactly one of the hand-picked feed URLs. */
export function validRef(ref: unknown): PodcastFeed | null {
  if (typeof ref !== 'string') return null;
  return PODCAST_FEEDS.find((feed) => feed.feedUrl === ref) ?? null;
}

/** `itunes:duration`: seconds, `MM:SS` or `HH:MM:SS`. */
export function parseDuration(value: string | undefined): number | undefined {
  const text = value?.trim();
  if (!text || !/^\d{1,6}(:\d{1,2}){0,2}$/.test(text)) return undefined;
  const seconds = text.split(':').reduce((total, part) => total * 60 + Number(part), 0);
  return seconds > 0 && seconds <= MAX_DURATION_SECONDS ? seconds : undefined;
}

/**
 * A readable creator out of an RSS `<author>`, which is often `email (Name)`: the name in brackets when
 * there is one, and never an email address.
 */
export function creatorName(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const bracketed = value.match(/\(([^()]+)\)\s*$/);
  const text = (bracketed ? bracketed[1] : value).replace(/\S+@\S+/g, ' ');
  return sanitiseText(text, 200) || undefined;
}

function isYes(value: string | undefined): boolean {
  return /^(yes|true|explicit)$/i.test(value?.trim() ?? '');
}

function kindOf(item: XmlElement): WebItemKind | null {
  const type = child(item, 'enclosure')?.attrs.type?.trim().toLowerCase() ?? '';
  if (type.startsWith('audio/')) return 'audio';
  if (type.startsWith('video/')) return 'video';
  return null;
}

/** The episode's own page when it has the feed's allowed host and shape; otherwise the show's page. */
function episodeLink(item: XmlElement, feed: PodcastFeed): string {
  const link = childText(item, 'link')?.trim();
  if (link && isAllowedUrl(link, [feed.episodeHost])) {
    const url = new URL(link);
    if (url.search === '' && url.hash === '' && new RegExp(`^${feed.episodePath}$`).test(url.pathname)) return url.toString();
  }
  return feed.showUrl;
}

/** An episode's id (see the top of this file), or null when it has nothing stable to hash. */
export function episodeExternalId(item: XmlElement, feed: PodcastFeed): string | null {
  const basis = (childText(item, 'guid') ?? childText(item, 'link') ?? child(item, 'enclosure')?.attrs.url ?? '').trim();
  if (basis === '') return null;
  return `${feed.key}-${createHash('sha256').update(basis).digest('hex').slice(0, 32)}`;
}

/** One `<item>` as a WebItem, or null when it is explicit, blocked, not audio/video, unidentifiable or undated. */
export function toWebItem(item: XmlElement, feed: PodcastFeed, fetchedAt: string): WebItem | null {
  if (item.name !== 'item') return null;
  if (isYes(childText(item, 'itunes:explicit')) || isYes(childText(item, 'itunes:block'))) return null;
  const kind = kindOf(item);
  if (!kind) return null;

  const externalId = episodeExternalId(item, feed);
  if (!externalId) return null;

  const publishedAt = plausibleIsoDate(childText(item, 'pubDate'), fetchedAt);
  if (!publishedAt) return null;

  const page = episodeLink(item, feed);
  const title = sanitiseText(childText(item, 'title'), 300) || 'Untitled episode';
  const creator = creatorName(childText(item, 'itunes:author') ?? childText(item, 'author'));
  const description =
    sanitiseText(childText(item, 'description') ?? childText(item, 'itunes:summary'), MAX_TEXT_LENGTH) || undefined;
  const durationSeconds = parseDuration(childText(item, 'itunes:duration'));

  return {
    id: `podcast:${externalId}`,
    platform: 'podcast',
    externalId,
    kind,
    url: page,
    canonicalUrl: page,
    title,
    ...(creator ? { creator } : {}),
    ...(description ? { description } : {}),
    ...(feed.artworkUrl ? { thumbnailUrl: feed.artworkUrl } : {}),
    ...(feed.licenseUrl ? { licenseUrl: feed.licenseUrl } : {}),
    ...(durationSeconds ? { durationSeconds } : {}),
    publishedAt,
    fetchedAt,
  };
}

/** The episodes out of a feed, or a thrown error when it is not RSS 2.0. */
export function parseFeed(xml: string, feed: PodcastFeed, fetchedAt: string): WebItem[] {
  const root = parseXml(xml);
  const channel = root.name === 'rss' ? child(root, 'channel') : undefined;
  if (!channel) throw new Error('not an RSS feed');
  const seen = new Set<string>();
  const items: WebItem[] = [];
  for (const entry of children(channel, 'item').slice(0, POD_MAX_ITEMS)) {
    const item = toWebItem(entry, feed, fetchedAt);
    if (!item || seen.has(item.id)) continue;
    seen.add(item.id);
    items.push(item);
  }
  return items;
}

export const podcastAdapter: WebAdapter = {
  platform: 'podcast',
  allowedHosts: POD_ALLOWED_HOSTS,
  linkHosts: POD_LINK_HOSTS,
  async fetchItems(source: WebSource, deps: WebAdapterDeps = {}): Promise<WebItem[]> {
    const feed = validRef(source.ref);
    if (!feed) throw new Error('source ref is not one of the podcast feeds listed in hosts.ts');
    const xml = await safeFetchText(feed.feedUrl, {
      allowedHosts: [new URL(feed.feedUrl).hostname],
      fetchImpl: deps.fetch,
      accept: 'application/rss+xml, application/xml;q=0.9, text/xml;q=0.8',
    });
    return parseFeed(xml, feed, (deps.now?.() ?? new Date()).toISOString());
  },
};
