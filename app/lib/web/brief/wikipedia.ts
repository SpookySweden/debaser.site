/**
 * Wikipedia's front page (SPEC-media-feed.md): the Wikimedia REST "featured" feed for today, one JSON request. Two of its
 * parts are read: `news` ("In the news", a NEWS row per story) and `tfa` (the featured article, a LONG READ row). The
 * `mostread` part carries view counts and is never read; nor are the others. Text is CC BY-SA; rows credit WIKIPEDIA,
 * and safe-fetch sends the descriptive User-Agent Wikimedia asks for. Server-only.
 *
 * A story's title is its own sentence; its link is the first article it names, built from that article's title on
 * en.wikipedia.org, and its description is that article's summary.
 */
import { createHash } from 'node:crypto';
import { safeFetchJson, type FetchLike } from '../safe-fetch';
import { buildUrl } from '../urls';
import { MAX_TEXT_LENGTH, sanitiseText } from '../sanitise';
import type { WebItem } from '../types';
import { WIKIPEDIA_HOST, WIKIPEDIA_PAGE_PATH, type BriefRow } from './feeds';

export const ITN_MAX = 8;

/** Today's feed (UTC), by date in the path. */
export function wikipediaUrl(day: Date): string {
  const yyyy = String(day.getUTCFullYear());
  const mm = String(day.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(day.getUTCDate()).padStart(2, '0');
  return buildUrl(WIKIPEDIA_HOST, ['api', 'rest_v1', 'feed', 'featured', yyyy, mm, dd]);
}

/** An article's page from its title, or null when the title makes no listed address. */
export function articlePage(title: unknown): string | null {
  if (typeof title !== 'string') return null;
  const name = title.trim().replace(/ /g, '_');
  if (name === '' || name.length > 255 || /[\u0000-\u001f#<>[\]{}|]/.test(name)) return null;
  const page = buildUrl(WIKIPEDIA_HOST, ['wiki', name]);
  return WIKIPEDIA_PAGE_PATH.test(new URL(page).pathname) ? page : null;
}

type Article = { title?: unknown; titles?: { canonical?: unknown; normalized?: unknown }; extract?: unknown };

const canonical = (article: Article | undefined): unknown => article?.titles?.canonical ?? article?.title;
const shown = (article: Article | undefined): string => sanitiseText(article?.titles?.normalized ?? String(article?.title ?? '').replace(/_/g, ' '), 300);

/** The day the feed is for, as the rows' date: midnight UTC of the day asked. */
function dayStart(fetchedAt: string): string {
  return `${fetchedAt.slice(0, 10)}T00:00:00.000Z`;
}

/** "In the news" and the featured article, as brief rows; a thrown error when the shape is wrong. */
export function parseFeatured(body: unknown, fetchedAt: string): BriefRow[] {
  if (!body || typeof body !== 'object') throw new Error('unexpected response shape');
  const feed = body as { news?: unknown; tfa?: unknown };
  const publishedAt = dayStart(fetchedAt);
  const rows: BriefRow[] = [];
  const news = Array.isArray(feed.news) ? feed.news.slice(0, ITN_MAX) : [];
  for (const story of news as { story?: unknown; links?: unknown }[]) {
    const title = sanitiseText(story?.story, 300);
    const links = Array.isArray(story?.links) ? (story.links as Article[]) : [];
    const page = articlePage(canonical(links[0]));
    if (!title || !page) continue;
    const externalId = `wiki-${createHash('sha256').update(title).digest('hex').slice(0, 32)}`;
    const description = sanitiseText(links[0]?.extract, MAX_TEXT_LENGTH) || undefined;
    const tags = [...new Set(links.map((link) => shown(link).toLowerCase()).filter(Boolean))].slice(0, 6);
    const item: WebItem = {
      id: `news:${externalId}`,
      platform: 'news',
      externalId,
      kind: 'text',
      url: page,
      canonicalUrl: page,
      title,
      ...(description ? { description } : {}),
      ...(tags.length > 0 ? { tags } : {}),
      outlet: 'WIKIPEDIA',
      publishedAt,
      fetchedAt,
    };
    rows.push({ kind: 'news', item });
  }
  const tfa = feed.tfa as Article | undefined;
  const page = articlePage(canonical(tfa));
  const title = shown(tfa);
  if (page && title) {
    const externalId = `wikitfa-${createHash('sha256').update(page).digest('hex').slice(0, 32)}`;
    const description = sanitiseText(tfa?.extract, MAX_TEXT_LENGTH) || undefined;
    rows.push({
      kind: 'longread',
      item: {
        id: `longread:${externalId}`,
        platform: 'longread',
        externalId,
        kind: 'text',
        url: page,
        canonicalUrl: page,
        title,
        ...(description ? { description } : {}),
        outlet: 'WIKIPEDIA',
        publishedAt,
        fetchedAt,
      },
    });
  }
  return rows;
}

export async function fetchWikipedia(deps: { fetch?: FetchLike; now?: () => Date } = {}): Promise<BriefRow[]> {
  const now = deps.now?.() ?? new Date();
  const body = await safeFetchJson(wikipediaUrl(now), { allowedHosts: [WIKIPEDIA_HOST], fetchImpl: deps.fetch });
  return parseFeatured(body, now.toISOString());
}
