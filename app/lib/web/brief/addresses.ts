import type { RowAddresses } from '../row-addresses';
import type { WebItem } from '../types';
import { isAllowedUrl } from '../urls';
import {
  ARXIV_PAGE_HOST,
  ARXIV_PAGE_PATH,
  articleHosts,
  articlePaths,
  EUROPE_PMC_PAGE_HOST,
  EUROPE_PMC_PAGE_PATH,
  OPEN_LINK_PREFIXES,
  openLink,
  WIKIPEDIA_HOST,
  WIKIPEDIA_PAGE_PATH,
  type ReadingKind,
} from './feeds';

/**
 * The addresses a reading row may use (SPEC-media-feed.md): the page's re-check for papers, news, long reads and tech
 * links, the same rule `rowAddresses` applies to every other row (an https address on the listed hosts, with the listed
 * path shape, no query, no fragment), from the lists in `./feeds.ts`. Pure, so `scripts/check-web-brief.cjs` holds it.
 *
 * Kept apart from `hosts.ts` / `row-addresses.ts` on purpose: those are loaded by the site-wide windows in the layout,
 * and every way of adding the reading lists to them broke the production prerender of the layout (2026-11-16, bisected
 * in a clean copy). Reading rows are drawn on MEDIA only, which asks here.
 */

type ReadingLists = { pageHosts: readonly string[]; pagePath: RegExp; thumbHosts: readonly string[]; thumbPath: RegExp };

let built: Readonly<Record<ReadingKind, ReadingLists>> | null = null;

function lists(): Readonly<Record<ReadingKind, ReadingLists>> {
  const article = (kind: 'news' | 'longread' | 'tech', wikipedia: boolean): ReadingLists => {
    const hosts = articleHosts(kind);
    const pages = articlePaths(kind, 'link');
    return {
      pageHosts: wikipedia ? [...hosts.pages, WIKIPEDIA_HOST] : hosts.pages,
      pagePath: wikipedia ? new RegExp(`${pages.source}|${WIKIPEDIA_PAGE_PATH.source}`) : pages,
      thumbHosts: hosts.thumbs,
      thumbPath: articlePaths(kind, 'thumb'),
    };
  };
  built ??= {
    paper: {
      pageHosts: [ARXIV_PAGE_HOST, EUROPE_PMC_PAGE_HOST],
      pagePath: new RegExp(`${ARXIV_PAGE_PATH.source}|${EUROPE_PMC_PAGE_PATH.source}`),
      thumbHosts: [],
      thumbPath: /(?!)/,
    },
    news: article('news', true),
    longread: article('longread', true),
    tech: article('tech', false),
  };
  return built;
}

/** An https address on one of `hosts`, with exactly the path shape given, and no query or fragment. */
function shaped(value: unknown, hosts: readonly string[], path: RegExp): string | null {
  if (!isAllowedUrl(value, hosts)) return null;
  const url = new URL(value);
  return url.search === '' && url.hash === '' && path.test(url.pathname) ? value : null;
}

/** Whether a row is a reading row: its platform is one of the four kinds. */
export function isReadingRow(item: Pick<WebItem, 'platform'>): boolean {
  return item.platform === 'paper' || item.platform === 'news' || item.platform === 'longread' || item.platform === 'tech';
}

/**
 * A reading row's link and picture, each re-checked; never a player or a licence. A Hacker News or Lobsters story goes to
 * its own site (decision 2A): only for their id prefixes, and only through `openLink`.
 */
export function readingRowAddresses(item: WebItem): RowAddresses {
  if (!isReadingRow(item)) return { link: null, thumb: null, embed: null, licence: null };
  const allow = lists()[item.platform as ReadingKind];
  const open = OPEN_LINK_PREFIXES.some((prefix) => item.id.startsWith(prefix));
  return {
    link: open ? openLink(item.url) : shaped(item.url, allow.pageHosts, allow.pagePath),
    thumb: shaped(item.thumbnailUrl, allow.thumbHosts, allow.thumbPath),
    embed: null,
    licence: null,
  };
}
