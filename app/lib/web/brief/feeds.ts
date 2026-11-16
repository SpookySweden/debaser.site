/**
 * The reading sources mixed into MEDIA's default feed (SPEC-media-feed.md; Luke's yes and decisions 1A, 2A, 3A,
 * 2026-11-16): papers, news, long reads and tech links, read live by `/api/web/brief` and never stored.
 *
 * No fetching here, so the page may import this file too: `hosts.ts` builds each reading platform's allow-list from
 * it, and the page re-checks every address against that list before it draws a link or a picture (`rowAddresses`).
 * Adding or removing an outlet is one entry below and `npm run checks:web`; no feed, host or picture ever comes from
 * the feeds themselves.
 */

/** The four kinds of reading, each its own platform in the stream's terms (types.ts `ReadingPlatform`). */
export type ReadingKind = 'paper' | 'news' | 'longread' | 'tech';
export const READING_KINDS: readonly ReadingKind[] = ['paper', 'news', 'longread', 'tech'];

export function isReadingKind(value: unknown): value is ReadingKind {
  return typeof value === 'string' && (READING_KINDS as readonly string[]).includes(value);
}

/**
 * One row of `/api/web/brief`: an item and its kind. Papers, articles and Wikipedia are rows of their kind's platform;
 * the broadcasters' news videos are ordinary YouTube rows (kind `news`) and the Archive's lectures ordinary Internet
 * Archive rows (kind `longread`), so they play as those always have.
 */
export type BriefRow = { kind: ReadingKind; item: import('../types').WebItem };

/** What the route answers. No person, no words: the same for everyone. */
export type BriefAnswer = { rows: BriefRow[] };

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

/**
 * How long each kind stays in the default feed (a search still finds it). Wikipedia's "In the news" is read from
 * today's list only, so it is as fresh as the list is.
 */
export const SHELF_LIFE_MS: Readonly<Record<ReadingKind, number>> = {
  news: 48 * HOUR_MS,
  tech: 3 * DAY_MS,
  paper: 30 * DAY_MS,
  longread: 365 * DAY_MS,
};

/**
 * One article feed (RSS 2.0, RSS 1.0 / RDF or Atom), chosen by hand.
 *
 * - `linkHosts` + `linkPath` (a path pattern, anchored when used): an entry's link is kept only when it is https on one
 *   of those hosts with that path shape; its query and fragment are dropped (they are the outlet's tracking:
 *   `?at_medium=RSS`, `?traffic_source=rss`, `?maca=`), and it is rebuilt from the host and path alone.
 * - `open`: Hacker News and Lobsters link anywhere on the web (Luke's decision 2A, 2026-11-16): the story's own address
 *   is kept when `openLink` passes it, and the row names that site. Never fetched, never framed, never a picture.
 * - `thumbHost` + `thumbPath`: the one picture host and path shape a feed's picture may have; anything else is dropped
 *   and the row draws no picture. Left out where a feed's pictures carry signatures or sizes in their query.
 * - `words`: whether the entries' own categories are kept as the row's words (they steer the feed, never shown).
 */
export type ArticleFeed = {
  /** Ours, part of every item id: lowercase letters and digits. */
  key: string;
  kind: Exclude<ReadingKind, 'paper'>;
  /** Shown on the row and its link key: BBC NEWS. */
  outlet: string;
  feedUrl: string;
  linkHosts: readonly string[];
  linkPath: string;
  open?: boolean;
  thumbHost?: string;
  thumbPath?: string;
  words?: boolean;
};

const SLUG = '[A-Za-z0-9][A-Za-z0-9._~-]{0,300}';
const YYYY = '20[0-9]{2}';
const MM = '[01][0-9]';
const DD = '[0-3][0-9]';
const WP_UPLOAD = `/wp-content/uploads/${YYYY}/${MM}/[A-Za-z0-9][A-Za-z0-9._-]{0,200}\\.(?:jpg|jpeg|png|webp)`;

/** Every endpoint answered 200 with no key on 2026-11-16 (SPEC-media-feed.md, "New reading sources"). */
export const ARTICLE_FEEDS: readonly ArticleFeed[] = [
  {
    key: 'bbc',
    kind: 'news',
    outlet: 'BBC NEWS',
    feedUrl: 'https://feeds.bbci.co.uk/news/world/rss.xml',
    linkHosts: ['www.bbc.co.uk', 'www.bbc.com'],
    linkPath: `/news/(?:articles/[a-z0-9]{8,20}|${SLUG})`,
    thumbHost: 'ichef.bbci.co.uk',
    thumbPath: '/ace/standard/[0-9]{2,4}/cpsprodpb/[0-9a-f]{3,5}/live/[0-9a-f-]{36}\\.(?:jpg|jpeg|png|webp)',
  },
  {
    key: 'npr',
    kind: 'news',
    outlet: 'NPR',
    feedUrl: 'https://feeds.npr.org/1001/rss.xml',
    linkHosts: ['www.npr.org'],
    linkPath: `/${YYYY}/${MM}/${DD}/[A-Za-z0-9-]{1,40}/${SLUG}`,
  },
  {
    key: 'dw',
    kind: 'news',
    outlet: 'DW',
    feedUrl: 'https://rss.dw.com/rdf/rss-en-all',
    linkHosts: ['www.dw.com'],
    linkPath: `/en/${SLUG}/[a-z]-[0-9]{4,12}`,
  },
  {
    key: 'aljazeera',
    kind: 'news',
    outlet: 'AL JAZEERA',
    feedUrl: 'https://www.aljazeera.com/xml/rss/all.xml',
    linkHosts: ['www.aljazeera.com'],
    linkPath: `/(?:news|features|economy|opinions|video|program|sports|gallery)(?:/[a-z0-9-]{1,60})?/${YYYY}/[0-9]{1,2}/[0-9]{1,2}/${SLUG}`,
  },
  {
    key: 'pbs',
    kind: 'news',
    outlet: 'PBS NEWSHOUR',
    feedUrl: 'https://www.pbs.org/newshour/feeds/rss/headlines',
    linkHosts: ['www.pbs.org'],
    linkPath: `/newshour/[a-z-]{2,40}/${SLUG}`,
    thumbHost: 'd3i6fh83elv35t.cloudfront.net',
    thumbPath: `/static/${YYYY}/${MM}/[A-Za-z0-9][A-Za-z0-9._-]{0,200}\\.(?:jpg|jpeg|png|webp)`,
    words: true,
  },
  {
    key: 'guardian',
    kind: 'news',
    outlet: 'THE GUARDIAN',
    feedUrl: 'https://www.theguardian.com/world/rss',
    linkHosts: ['www.theguardian.com'],
    linkPath: `/[a-z-]{2,40}(?:/[a-z-]{2,40})?/${YYYY}/[a-z]{3}/${DD}/${SLUG}`,
    words: true,
  },
  {
    key: 'quanta',
    kind: 'longread',
    outlet: 'QUANTA MAGAZINE',
    feedUrl: 'https://www.quantamagazine.org/feed/',
    linkHosts: ['www.quantamagazine.org'],
    linkPath: `/${SLUG}/?`,
    thumbHost: 'www.quantamagazine.org',
    thumbPath: WP_UPLOAD,
    words: true,
  },
  {
    key: 'aeon',
    kind: 'longread',
    outlet: 'AEON',
    feedUrl: 'https://aeon.co/feed.rss',
    linkHosts: ['aeon.co'],
    linkPath: `/(?:essays|videos|ideas)/${SLUG}`,
  },
  {
    // `/feed/` answers 308 to here, and safe-fetch follows no redirects (live-checked 2026-11-16).
    key: 'nautilus',
    kind: 'longread',
    outlet: 'NAUTILUS',
    feedUrl: 'https://nautil.us/feed',
    linkHosts: ['nautil.us'],
    linkPath: `/${SLUG}/?`,
    words: true,
  },
  {
    key: 'owid',
    kind: 'longread',
    outlet: 'OUR WORLD IN DATA',
    feedUrl: 'https://ourworldindata.org/atom.xml',
    linkHosts: ['ourworldindata.org'],
    linkPath: `/${SLUG}`,
  },
  {
    // The front page in its own order. Only the title and the story's address are read: no points, no comment counts,
    // and the comments link is dropped.
    key: 'hn',
    kind: 'tech',
    outlet: 'HACKER NEWS',
    feedUrl: 'https://news.ycombinator.com/rss',
    linkHosts: [],
    linkPath: '(?!)',
    open: true,
  },
  {
    key: 'lobsters',
    kind: 'tech',
    outlet: 'LOBSTERS',
    feedUrl: 'https://lobste.rs/rss',
    linkHosts: [],
    linkPath: '(?!)',
    open: true,
    words: true,
  },
  {
    key: 'hackaday',
    kind: 'tech',
    outlet: 'HACKADAY',
    feedUrl: 'https://hackaday.com/blog/feed/',
    linkHosts: ['hackaday.com'],
    linkPath: `/${YYYY}/${MM}/${DD}/${SLUG}/?`,
    thumbHost: 'hackaday.com',
    thumbPath: WP_UPLOAD,
    words: true,
  },
  {
    key: 'make',
    kind: 'tech',
    outlet: 'MAKE:',
    feedUrl: 'https://makezine.com/feed/',
    linkHosts: ['makezine.com'],
    linkPath: `/(?:article|projects)/${SLUG}(?:/${SLUG}){0,4}/?`,
    words: true,
  },
];

/** The broadcasters' news videos (SPEC-media-feed.md): read by the stream's own YouTube adapter, ids live-checked 2026-11-16. */
export const NEWS_CHANNELS: readonly { channelId: string; outlet: string }[] = [
  { channelId: 'UCknLrEdhRCp1aegoMqRaCZg', outlet: 'DW NEWS' },
  { channelId: 'UC6ZFN9Tx6xh-skXCuRHCDpQ', outlet: 'PBS NEWSHOUR' },
  { channelId: 'UCNye-wNBqNL5ZzHSJj3l8Bg', outlet: 'AL JAZEERA ENGLISH' },
];

/** Lectures as long reads: the stream's own Internet Archive adapter, this one query, newest first in English (2026-11-16: 1,007 items). */
export const LECTURE_QUERY = 'mediatype:movies AND subject:(lecture) AND licenseurl:*creativecommons* AND (language:eng OR language:English)';

/* --- papers and Wikipedia: fixed hosts and paths ------------------------------------------------------------- */

export const ARXIV_API_HOST = 'export.arxiv.org';
export const ARXIV_PAGE_HOST = 'arxiv.org';
/** A new-style arXiv id with its version (`2611.18561v1`), or an old-style one (`hep-th/9901001v2`) as one segment. */
export const ARXIV_ID = /^(?:[0-9]{4}\.[0-9]{4,5}|[a-z-]{2,20}(?:\.[A-Z]{2})?\/[0-9]{7})(?:v[0-9]{1,3})?$/;
export const ARXIV_PAGE_PATH = /^\/abs\/(?:[0-9]{4}\.[0-9]{4,5}|[a-z-]{2,20}(?:\.[A-Z]{2})?\/[0-9]{7})(?:v[0-9]{1,3})?$/;

export const EUROPE_PMC_API_HOST = 'www.ebi.ac.uk';
export const EUROPE_PMC_PAGE_HOST = 'europepmc.org';
export const EUROPE_PMC_PAGE_PATH = /^\/article\/(?:PPR|MED|PMC|AGR|CBA|CTX|ETH|HIR|NBK|PAT)\/[A-Za-z0-9]{1,20}$/;

export const WIKIPEDIA_HOST = 'en.wikipedia.org';
/** One article title as a path segment, as `encodeURIComponent` leaves it (spaces already underscores). */
export const WIKIPEDIA_PAGE_PATH = /^\/wiki\/(?:[A-Za-z0-9_.!~*'()-]|%[0-9A-Fa-f]{2}){1,600}$/;

/* --- the open links (decision 2A) ---------------------------------------------------------------------------- */

const OPEN_LINK_MAX = 600;
const IP_LITERAL = /^(?:[0-9.]+|\[.*\])$/;

/**
 * A Hacker News or Lobsters story's own address, or null: https, an ordinary public host name (no port, no login, no
 * address written as numbers, nothing local), no fragment, at most 600 characters. Its query is kept, since a story
 * page may need one. The page checks it again before drawing the link.
 */
export function openLink(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > OPEN_LINK_MAX) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase();
  if (url.protocol !== 'https:' || url.username !== '' || url.password !== '' || url.port !== '') return null;
  if (!host.includes('.') || IP_LITERAL.test(host) || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) return null;
  url.hash = '';
  return url.toString();
}

/** The site an open link goes to, as the row names it: `GITHUB.COM` (no `www.`). */
export function openLinkSite(link: string): string {
  return new URL(link).hostname.replace(/^www\./, '').toUpperCase();
}

/** The item-id prefixes whose rows link to the open web: the feeds marked `open`. */
export const OPEN_LINK_PREFIXES: readonly string[] = ARTICLE_FEEDS.filter((feed) => feed.open).map((feed) => `${feed.kind}:${feed.key}-`);

/** Every host a kind's article feeds are read from, link to and take pictures from, for `hosts.ts`. */
export function articleHosts(kind: ArticleFeed['kind']): { fetch: string[]; pages: string[]; thumbs: string[] } {
  const feeds = ARTICLE_FEEDS.filter((feed) => feed.kind === kind);
  const unique = (values: string[]) => [...new Set(values)];
  return {
    fetch: unique(feeds.map((feed) => new URL(feed.feedUrl).hostname)),
    pages: unique(feeds.flatMap((feed) => feed.linkHosts)),
    thumbs: unique(feeds.flatMap((feed) => (feed.thumbHost ? [feed.thumbHost] : []))),
  };
}

/** One kind's article path shapes as one anchored pattern (`hosts.ts`); '(?!)' when it has none. */
export function articlePaths(kind: ArticleFeed['kind'], which: 'link' | 'thumb'): RegExp {
  const parts = ARTICLE_FEEDS.filter((feed) => feed.kind === kind && !feed.open).flatMap((feed) => {
    const part = which === 'link' ? feed.linkPath : feed.thumbPath;
    return part ? [part] : [];
  });
  return new RegExp(`^(?:${parts.join('|') || '(?!)'})$`);
}
