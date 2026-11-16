/**
 * News, long reads and tech links from the hand-picked article feeds in `./feeds.ts` (SPEC-media-feed.md): RSS 2.0,
 * RSS 1.0 (RDF) or Atom, one GET per feed, parsed by the strict bounded reader in `../adapters/xml.ts`. Server-only.
 *
 * Kept: headline, the feed's own summary, author, date, the article's address rebuilt from its listed host and path
 * (query and fragment dropped), the entry's categories as words where the feed is marked for it, and a picture only
 * where the feed's picture host and path rule pass. Never the article's text. Hacker News and Lobsters entries keep only
 * the title, the date, the story's own address (`openLink`, decision 2A) and, for Lobsters, its tags: no points, no
 * comment counts, no comments link, no usernames.
 */
import { createHash } from 'node:crypto';
import { safeFetchText, type FetchLike } from '../safe-fetch';
import { isAllowedUrl } from '../urls';
import { MAX_TEXT_LENGTH, plausibleIsoDate, sanitiseText } from '../sanitise';
import type { WebItem } from '../types';
import { child, childText, children, parseXml, type XmlElement } from '../adapters/xml';
import { creatorName } from '../adapters/podcast';
import { openLink, openLinkSite, type ArticleFeed } from './feeds';

export const ARTICLES_PER_FEED = 40;

/** The entries of an RSS 2.0, RSS 1.0 (RDF) or Atom document, or a thrown error when it is none of them. */
export function entriesOf(root: XmlElement): XmlElement[] {
  if (root.name === 'rss') {
    const channel = child(root, 'channel');
    if (!channel) throw new Error('RSS without a channel');
    return children(channel, 'item');
  }
  if (root.name === 'rdf:RDF') return children(root, 'item');
  if (root.name === 'feed') return children(root, 'entry');
  throw new Error('not an RSS or Atom feed');
}

/** The entry's link as the feed gives it: RSS `<link>`, or Atom's alternate `<link href>`. */
function rawLink(entry: XmlElement): string | undefined {
  if (entry.name === 'entry') {
    const links = children(entry, 'link');
    const alternate = links.find((link) => (link.attrs.rel ?? 'alternate') === 'alternate') ?? links[0];
    return alternate?.attrs.href;
  }
  return childText(entry, 'link');
}

/** The article's address for this feed (see the top of this file), or null when it is off the feed's list. */
export function articleLink(value: string | undefined, feed: ArticleFeed): string | null {
  const text = value?.trim();
  if (!text) return null;
  if (feed.open) return openLink(text);
  if (!isAllowedUrl(text, feed.linkHosts)) return null;
  const url = new URL(text);
  if (!new RegExp(`^(?:${feed.linkPath})$`).test(url.pathname)) return null;
  return `https://${url.hostname.toLowerCase()}${url.pathname}`;
}

/** The entry's picture on the feed's picture host and path, rebuilt without its query; else undefined. */
export function articlePicture(entry: XmlElement, feed: ArticleFeed): string | undefined {
  if (!feed.thumbHost || !feed.thumbPath) return undefined;
  const candidates = [
    child(entry, 'media:thumbnail')?.attrs.url,
    ...children(entry, 'media:content')
      .filter((one) => one.attrs.medium === 'image' || (one.attrs.type ?? '').startsWith('image/') || (one.attrs.medium === undefined && one.attrs.type === undefined))
      .map((one) => one.attrs.url),
    ...children(entry, 'enclosure')
      .filter((one) => (one.attrs.type ?? '').startsWith('image/'))
      .map((one) => one.attrs.url),
  ];
  const shape = new RegExp(`^(?:${feed.thumbPath})$`);
  for (const candidate of candidates) {
    if (!isAllowedUrl(candidate, [feed.thumbHost])) continue;
    const url = new URL(candidate);
    if (shape.test(url.pathname)) return `https://${feed.thumbHost}${url.pathname}`;
  }
  return undefined;
}

/** The entry's own words: RSS `<category>` text or Atom `<category term>`, when the feed is marked for them. */
function wordsOf(entry: XmlElement, feed: ArticleFeed): string[] {
  if (!feed.words) return [];
  const words = children(entry, 'category').map((one) => sanitiseText(one.attrs.term ?? one.text, 60).toLowerCase());
  return [...new Set(words.filter((word) => word.length > 1))].slice(0, 8);
}

function authorOf(entry: XmlElement): string | undefined {
  const atom = childText(child(entry, 'author'), 'name');
  return creatorName(childText(entry, 'dc:creator') ?? atom ?? childText(entry, 'author'));
}

export function toArticle(entry: XmlElement, feed: ArticleFeed, fetchedAt: string): WebItem | null {
  if (entry.name !== 'item' && entry.name !== 'entry') return null;
  const link = articleLink(rawLink(entry), feed);
  if (!link) return null;
  const publishedAt = plausibleIsoDate(
    childText(entry, 'pubDate') ?? childText(entry, 'dc:date') ?? childText(entry, 'published') ?? childText(entry, 'updated'),
    fetchedAt,
  );
  if (!publishedAt) return null;
  const title = sanitiseText(childText(entry, 'title'), 300);
  if (!title) return null;

  const basis = (childText(entry, 'guid') ?? childText(entry, 'id') ?? link).trim();
  const externalId = `${feed.key}-${createHash('sha256').update(basis).digest('hex').slice(0, 32)}`;
  // An open link's row names the story's site, not a person; its feed's summary is only a comments link.
  const creator = feed.open ? openLinkSite(link) : authorOf(entry);
  const description = feed.open
    ? undefined
    : sanitiseText(childText(entry, 'description') ?? childText(entry, 'summary') ?? childText(entry, 'content'), MAX_TEXT_LENGTH) || undefined;
  const thumbnailUrl = articlePicture(entry, feed);
  const tags = wordsOf(entry, feed);

  return {
    id: `${feed.kind}:${externalId}`,
    platform: feed.kind,
    externalId,
    kind: 'text',
    url: link,
    canonicalUrl: link,
    title,
    ...(creator ? { creator } : {}),
    ...(description ? { description } : {}),
    ...(thumbnailUrl ? { thumbnailUrl } : {}),
    ...(tags.length > 0 ? { tags } : {}),
    outlet: feed.outlet,
    publishedAt,
    fetchedAt,
  };
}

/** One feed's articles, in the feed's own order (Hacker News's front page keeps its order this way). */
export function parseArticles(xml: string, feed: ArticleFeed, fetchedAt: string): WebItem[] {
  const seen = new Set<string>();
  const items: WebItem[] = [];
  for (const entry of entriesOf(parseXml(xml)).slice(0, ARTICLES_PER_FEED)) {
    const item = toArticle(entry, feed, fetchedAt);
    if (!item || seen.has(item.id) || seen.has(item.url)) continue;
    seen.add(item.id);
    seen.add(item.url);
    items.push(item);
  }
  return items;
}

export async function fetchArticles(feed: ArticleFeed, deps: { fetch?: FetchLike; now?: () => Date } = {}): Promise<WebItem[]> {
  const xml = await safeFetchText(feed.feedUrl, {
    allowedHosts: [new URL(feed.feedUrl).hostname],
    fetchImpl: deps.fetch,
    accept: 'application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.8',
  });
  return parseArticles(xml, feed, (deps.now?.() ?? new Date()).toISOString());
}
