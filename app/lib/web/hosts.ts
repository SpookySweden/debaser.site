import { MEDIA_SERVERS, serverHost, type MediaServerId } from './media-servers';
import { KINO_PAGE_HOST, KINO_PAGE_PATH } from './kino';
import { TMDB_IMAGE_HOST } from './media-titles';
import type { WebPlatform } from './types';

/** A media title's picture: TMDB's poster at the stream's size, or a plain path on the server (no `..`). */
const MEDIA_PICTURE_PATH = /^(?:\/t\/p\/w342\/[A-Za-z0-9]{8,64}\.(?:jpg|jpeg|png|webp)|\/(?!.*\.\.)[A-Za-z0-9._~/-]{1,300})$/;

/** One identifier as a path segment: the same rule as `isSafeIdentifier`. */
const ID = '[A-Za-z0-9][A-Za-z0-9._-]*';
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
/** Matches no path: for a platform with no embeddable player. */
const NEVER = /(?!)/;
/** A YouTube video id as WEB accepts it: 11 characters, alphanumeric first (see adapters/youtube.ts). */
const YT_VIDEO = '[A-Za-z0-9][A-Za-z0-9_-]{10}';
/**
 * A Wikimedia Commons file name as one path segment: what `encodeURIComponent` leaves of it (spaces already
 * underscores), so anything outside these characters is percent-encoded and nothing can end the segment.
 * An encoded slash, dot or backslash is refused: our names never carry one (`fileSegment` refuses `/`), and a
 * row that did could point the player at another page of Commons.
 */
export const COMMONS_FILE = "(?:[A-Za-z0-9_.!~*'()-]|%(?!2[Ff]|2[Ee]|5[Cc])[0-9A-Fa-f]{2}){1,600}";

/**
 * The PeerTube instances a source may name (`{instance}/{channel}`). Chosen by hand and live-checked
 * (2026-10-31: API, thumbnails and player all 200, player framable). Adding one is a code change, never data.
 */
export const PEERTUBE_INSTANCES: readonly string[] = ['video.blender.org', 'framatube.org', 'tilvids.com'];

/**
 * The podcast feeds WEB may read, each chosen by hand. A podcast source's `ref` must be exactly one of
 * these `feedUrl`s, so the feed list *is* the host allow-list: no feed, page or picture host ever comes
 * from a source row or from the feed itself.
 *
 * - `episodeHost` + `episodePath` (a path pattern, anchored when used): an episode's own `<link>` is
 *   kept only when it is https on that host with that shape and no query; otherwise the row links to
 *   `showUrl`.
 * - `artworkUrl`: the one picture every episode shows, picked here. The feed's image URLs are never used.
 * - `licenseUrl`: the show's licence, as its feed states it in words (`<copyright>`), linked here.
 * - The audio file (`<enclosure>`) is never fetched, linked or played: it only tells audio from video.
 *   There is no embed; podcasts have no official player.
 *
 * Adding a feed: verify it live (feed, episode pages, artwork), add an entry, run `npm run checks:web`.
 */
export type PodcastFeed = {
  /** Ours, part of every item id: lowercase letters and digits. */
  key: string;
  feedUrl: string;
  showUrl: string;
  episodeHost: string;
  episodePath: string;
  artworkUrl?: string;
  licenseUrl?: string;
};

export const PODCAST_FEEDS: readonly PodcastFeed[] = [
  {
    // Hacker Public Radio: a community podcast, CC BY-SA 4.0. Live-checked 2026-10-31: feed, artwork, pages 200.
    key: 'hpr',
    feedUrl: 'https://hackerpublicradio.org/hpr_ogg_rss.php',
    showUrl: 'https://hackerpublicradio.org/about.html',
    episodeHost: 'hackerpublicradio.org',
    episodePath: '/eps/hpr[0-9]{1,6}/index\\.html',
    artworkUrl: 'https://hackerpublicradio.org/images/hpr_feed_small.png',
    licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/',
  },
];

/* --- the reading in MEDIA's default feed (SPEC-media-feed.md; brief/feeds.ts re-exports these) ------------- */

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
  kind: 'news' | 'longread' | 'tech';
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

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const unique = (values: string[]) => [...new Set(values)];
const pathOf = (url: string) => new URL(url).pathname;
const hostOf = (url: string) => new URL(url).hostname;

export type PlatformAddresses = {
  /** Where the adapter may fetch from, and the only hosts an item's page, thumbnail and player may use. */
  hosts: readonly string[];
  /** Extra hosts an item may only *link* to (a licence page). Never fetched, never framed. */
  linkHosts: readonly string[];
  /** The path shapes each address must have, on top of the host: a row cannot frame just any page. */
  pagePath: RegExp;
  thumbPath: RegExp;
  embedPath: RegExp;
  /**
   * Narrower hosts for one kind of address, when a platform splits them across hosts (YouTube: pages on
   * youtu.be, pictures on i.ytimg.com, the player only on www.youtube-nocookie.com). Each must be in `hosts`.
   */
  pageHosts?: readonly string[];
  thumbHosts?: readonly string[];
  embedHosts?: readonly string[];
  /**
   * The one exact query string a player address must carry, for a platform whose player is a page asked
   * for by query (Wikimedia Commons: `?embedplayer=yes`). Every other address, and every other platform's
   * player, must have no query at all.
   */
  embedQuery?: string;
  /**
   * Item-id prefixes whose page link may be any public https address (`urls.ts` `openLink`): Hacker News and
   * Lobsters stories, Luke's decision 2A (2026-11-16). Only the link: their pictures and players stay on the lists.
   */
  openPagePrefixes?: readonly string[];
};

/** A reading kind's addresses from its article feeds (brief/feeds.ts), plus any fixed page host it also links to. */
function readingAddresses(kind: 'news' | 'longread' | 'tech', morePages: readonly string[] = [], morePath?: RegExp): PlatformAddresses {
  const hosts = articleHosts(kind);
  const pages = articlePaths(kind, 'link');
  return {
    hosts: unique([...hosts.fetch, ...hosts.pages, ...hosts.thumbs, ...morePages]),
    linkHosts: [],
    pagePath: morePath ? new RegExp(`${pages.source}|${morePath.source}`) : pages,
    thumbPath: articlePaths(kind, 'thumb'),
    embedPath: NEVER,
    pageHosts: unique([...hosts.pages, ...morePages]),
    thumbHosts: hosts.thumbs,
    embedHosts: [],
  };
}

/**
 * Each platform's allow-lists, in a file the page may import (no fetching here).
 *
 * The adapter builds every URL on these hosts and paths; the page checks each one again before it draws
 * a link, an image or a player (`rowAddresses`), so a bad row in the database later still cannot point
 * anywhere else - or frame some other page of the same site with scripts allowed.
 */
export const PLATFORM_HOSTS: Record<WebPlatform, PlatformAddresses> = {
  internet_archive: {
    hosts: ['archive.org'],
    linkHosts: ['creativecommons.org', 'www.creativecommons.org'],
    pagePath: new RegExp(`^/details/${ID}$`),
    thumbPath: new RegExp(`^/services/img/${ID}$`),
    embedPath: new RegExp(`^/embed/${ID}$`),
  },
  peertube: {
    hosts: PEERTUBE_INSTANCES,
    linkHosts: ['creativecommons.org'],
    pagePath: new RegExp(`^/videos/watch/${UUID}$`),
    thumbPath: new RegExp(`^/(lazy-static|static)/thumbnails/${UUID}\\.(jpg|jpeg|png|webp)$`),
    embedPath: new RegExp(`^/videos/embed/${UUID}$`),
  },
  openverse: {
    hosts: ['api.openverse.org', 'openverse.org'],
    linkHosts: ['creativecommons.org'],
    pagePath: new RegExp(`^/(image|audio)/${UUID}$`),
    thumbPath: new RegExp(`^/v1/(images|audio)/${UUID}/thumb/$`),
    // Openverse has no player of its own (its pages refuse framing): never an embed.
    embedPath: NEVER,
  },
  podcast: {
    hosts: unique(PODCAST_FEEDS.flatMap((feed) => [hostOf(feed.feedUrl), hostOf(feed.showUrl), feed.episodeHost, ...(feed.artworkUrl ? [hostOf(feed.artworkUrl)] : [])])),
    linkHosts: ['creativecommons.org'],
    pagePath: new RegExp(`^(?:${PODCAST_FEEDS.flatMap((feed) => [feed.episodePath, escapeRegExp(pathOf(feed.showUrl))]).join('|')})$`),
    thumbPath: new RegExp(`^(?:${PODCAST_FEEDS.flatMap((feed) => (feed.artworkUrl ? [escapeRegExp(pathOf(feed.artworkUrl))] : [])).join('|') || '(?!)'})$`),
    embedPath: NEVER,
  },
  youtube: {
    hosts: ['www.youtube.com', 'youtu.be', 'i.ytimg.com', 'www.youtube-nocookie.com'],
    linkHosts: [],
    pagePath: new RegExp(`^/${YT_VIDEO}$`),
    thumbPath: new RegExp(`^/vi/${YT_VIDEO}/hqdefault\\.jpg$`),
    embedPath: new RegExp(`^/embed/${YT_VIDEO}$`),
    pageHosts: ['youtu.be'],
    thumbHosts: ['i.ytimg.com'],
    // The privacy-enhanced player only: never www.youtube.com/embed.
    embedHosts: ['www.youtube-nocookie.com'],
  },
  // Live-checked 2026-10-31 (app/lib/web/search/providers/wikimedia-commons.ts): the page is reached by its
  // page id; the player is Commons' own embed page (200, no X-Frame-Options, no frame-ancestors), never the
  // raw file on upload.wikimedia.org; thumbnails come from Commons' thumbnail host.
  wikimedia_commons: {
    hosts: ['commons.wikimedia.org', 'thumb.wikimedia.org'],
    linkHosts: ['creativecommons.org'],
    pagePath: /^\/wiki\/Special:Redirect\/page\/[1-9][0-9]{0,11}$/,
    thumbPath: new RegExp(`^/wikipedia/commons/thumb/[0-9a-f]/[0-9a-f]{2}/${COMMONS_FILE}/[0-9]{2,4}px-${COMMONS_FILE}$`),
    embedPath: new RegExp(`^/wiki/File:${COMMONS_FILE}$`),
    embedQuery: '?embedplayer=yes',
    pageHosts: ['commons.wikimedia.org'],
    thumbHosts: ['thumb.wikimedia.org'],
    embedHosts: ['commons.wikimedia.org'],
  },
  // A pasted link only (oEmbed, keyless). Live-checked 2026-10-31: player 200 with no X-Frame-Options.
  vimeo: {
    hosts: ['vimeo.com', 'player.vimeo.com', 'i.vimeocdn.com'],
    linkHosts: [],
    pagePath: /^\/[1-9][0-9]{0,11}$/,
    thumbPath: /^\/video\/[0-9]{1,15}-[0-9a-f]{16,128}-d_[0-9]{2,4}x[0-9]{2,4}$/,
    embedPath: /^\/video\/[1-9][0-9]{0,11}$/,
    pageHosts: ['vimeo.com'],
    thumbHosts: ['i.vimeocdn.com'],
    embedHosts: ['player.vimeo.com'],
  },
  // KINO (kino.ts): a link out to the title's TMDB page and TMDB's poster on its image host; no player.
  kino: {
    hosts: [KINO_PAGE_HOST, TMDB_IMAGE_HOST],
    linkHosts: [],
    pagePath: KINO_PAGE_PATH,
    thumbPath: /^\/t\/p\/w342\/[A-Za-z0-9]{8,64}\.(?:jpg|jpeg|png|webp)$/,
    embedPath: NEVER,
    pageHosts: [KINO_PAGE_HOST],
    thumbHosts: [TMDB_IMAGE_HOST],
    embedHosts: [],
  },
  // BOOKS (search/providers/books.ts, SPEC-books.md): Open Library's work page and its cover service; no player (the
  // site's own reader reads a Project Gutenberg copy's text through /api/web/book, never from these addresses).
  books: {
    hosts: ['openlibrary.org', 'covers.openlibrary.org'],
    linkHosts: [],
    pagePath: /^\/works\/OL[1-9][0-9]{0,11}W$/,
    thumbPath: /^\/b\/id\/[1-9][0-9]{0,11}-M\.jpg$/,
    embedPath: NEVER,
    pageHosts: ['openlibrary.org'],
    thumbHosts: ['covers.openlibrary.org'],
    embedHosts: [],
  },
  // AUDIOBOOKS (search/providers/audiobooks.ts, SPEC-books.md): LibriVox's book page and the archive.org picture of the
  // recording; no player (the chapters play in the music bar from archive.org, as MEDIA's audio does).
  audiobooks: {
    hosts: ['librivox.org', 'archive.org'],
    linkHosts: [],
    pagePath: /^\/[a-z0-9][a-z0-9-]{0,200}\/$/,
    thumbPath: /^\/services\/img\/[A-Za-z0-9][A-Za-z0-9._-]{0,100}$/,
    embedPath: NEVER,
    pageHosts: ['librivox.org'],
    thumbHosts: ['archive.org'],
    embedHosts: [],
  },
  // IPFS (Luke, 2026-11-11): a book named in `app/lib/books/ipfs-catalogue.ts`, its page and cover at the first gateway by
  // their CIDs. No player: the row's READ opens the book in the site's reader (`lib/books/ipfs.ts` fetches it).
  ipfs: {
    hosts: ['4everland.io'],
    linkHosts: [],
    pagePath: /^\/ipfs\/(?:Qm[1-9A-HJ-NP-Za-km-z]{44}|b[a-z2-7]{50,120})$/,
    thumbPath: /^\/ipfs\/(?:Qm[1-9A-HJ-NP-Za-km-z]{44}|b[a-z2-7]{50,120})$/,
    embedPath: NEVER,
    pageHosts: ['4everland.io'],
    thumbHosts: ['4everland.io'],
    embedHosts: [],
  },
  // The reading in MEDIA's default feed (SPEC-media-feed.md, brief/feeds.ts): a link out and, for a few feeds, a picture;
  // never a player. Papers: arXiv's abstract page and Europe PMC's article page.
  paper: {
    hosts: [ARXIV_API_HOST, ARXIV_PAGE_HOST, EUROPE_PMC_API_HOST, EUROPE_PMC_PAGE_HOST],
    linkHosts: [],
    pagePath: new RegExp(`${ARXIV_PAGE_PATH.source}|${EUROPE_PMC_PAGE_PATH.source}`),
    thumbPath: NEVER,
    embedPath: NEVER,
    pageHosts: [ARXIV_PAGE_HOST, EUROPE_PMC_PAGE_HOST],
    thumbHosts: [],
    embedHosts: [],
  },
  // News: the listed outlets' article pages (their query dropped), and Wikipedia's "In the news" articles.
  news: readingAddresses('news', [WIKIPEDIA_HOST], WIKIPEDIA_PAGE_PATH),
  // Long reads: the listed magazines, and Wikipedia's article of the day.
  longread: readingAddresses('longread', [WIKIPEDIA_HOST], WIKIPEDIA_PAGE_PATH),
  // Tech: Hackaday and Make:'s pages. Hacker News and Lobsters rows link to the story's own site (decision 2A), which
  // `rowAddresses` allows only for their id prefixes and only through `openLink`.
  tech: { ...readingAddresses('tech'), openPagePrefixes: OPEN_LINK_PREFIXES },
  // The media servers (SPEC-media-servers.md), one entry each from media-servers.ts. A title's row has no link
  // and no embed of its own here: its player is built per server by `mediaPlayUrl` (media-titles.ts), on that
  // server's host. Its picture is TMDB's poster on TMDB's image host, or a picture from the server's list on the
  // server's own host (`serverPicture`).
  ...(Object.fromEntries(
    MEDIA_SERVERS.map((server): [MediaServerId, PlatformAddresses] => [
      server.id,
      {
        hosts: [serverHost(server), TMDB_IMAGE_HOST],
        linkHosts: [],
        pagePath: NEVER,
        thumbPath: MEDIA_PICTURE_PATH,
        embedPath: NEVER,
        pageHosts: [],
        thumbHosts: [serverHost(server), TMDB_IMAGE_HOST],
        embedHosts: [],
      },
    ]),
  ) as Record<MediaServerId, PlatformAddresses>),
};
