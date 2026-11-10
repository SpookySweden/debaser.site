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
};

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
