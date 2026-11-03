/**
 * WEB: one chronological stream of media collected from other platforms (SPEC-web.md).
 *
 * **Metadata only.** These types are the whole of what WEB keeps about a remote item, and they have
 * no room for likes, views, downloads, ratings, follower counts or comments: the forum owns those, and
 * `scripts/check-web-types.cjs` fails if a field with one of those names appears here. Nothing in this
 * folder downloads, copies or re-hosts media either - an item is a link, a hotlinked thumbnail and,
 * where the platform offers one, its own official embed.
 */

import { MEDIA_SERVERS, type MediaServerId } from './media-servers';
import type { MediaInfo } from './media-titles';

/** Every platform WEB can read. Each has exactly one adapter in `app/lib/web/adapters/`, but the media servers. */
export type WebPlatform = StreamPlatform | SearchOnlyPlatform | MediaServerId;

/**
 * Luke's own and his friends' media servers (SPEC-media-servers.md): each one listed in `media-servers.ts` is a
 * platform of its own (not a SOURCE choice since 2026-11-02). They have no adapter: their
 * titles come from the servers' list files (media-titles.ts) and live in their own tables.
 */
export type { MediaServerId } from './media-servers';

/** The platforms a stream source can read (one adapter each in `app/lib/web/adapters/`). */
export type StreamPlatform = 'internet_archive' | 'peertube' | 'openverse' | 'podcast' | 'youtube';

/** The same list at run time, for the page (the adapters themselves are server-only). */
export const STREAM_PLATFORMS = ['internet_archive', 'peertube', 'openverse', 'podcast', 'youtube'] as const satisfies readonly StreamPlatform[];
// Fails to compile when a stream platform is added to the type but not to the list above.
const STREAM_PLATFORMS_COMPLETE: Record<StreamPlatform, true> = Object.fromEntries(STREAM_PLATFORMS.map((platform) => [platform, true])) as Record<(typeof STREAM_PLATFORMS)[number], true>;
void STREAM_PLATFORMS_COMPLETE;

/**
 * Found only by searching everywhere or by a pasted link (`app/lib/web/search/`, SPEC-web-search.md): no
 * stream source reads them, but an opened one can be saved into the stream like any other item.
 */
export type SearchOnlyPlatform = 'wikimedia_commons' | 'vimeo' | 'kino';

export type WebItemKind = 'audio' | 'video' | 'image' | 'text' | 'other';

export type WebItem = {
  /** Ours: `${platform}:${externalId}`, unique across the stream. */
  id: string;
  platform: WebPlatform;
  /** The platform's own identifier, validated by `isSafeIdentifier` before any URL is built from it. */
  externalId: string;
  kind: WebItemKind;
  /** The item's page on the platform (https, on the adapter's allow-listed hosts). */
  url: string;
  /** The platform's preferred address for the item; often the same as `url`. */
  canonicalUrl: string;
  title: string;
  creator?: string;
  /** Plain text, already sanitised (`sanitiseText`). Never rendered as HTML. */
  description?: string;
  /** Hotlinked from the platform, never copied. */
  thumbnailUrl?: string;
  /** The platform's official player; loaded only after the reader asks for it. */
  embedUrl?: string;
  licenseUrl?: string;
  durationSeconds?: number;
  tags?: string[];
  /**
   * The language the platform says the item is in (`normaliseLanguage`: `es`, `pt-BR`), when it says: PeerTube,
   * the Internet Archive, TMDB for KINO. Shown as a flag (app/lib/web/language.ts); not saved with stored rows,
   * which read their language from the title instead.
   */
  language?: string;
  /**
   * A media-server title only (media-titles.ts): its type, TMDB number, which servers hold it (and which
   * episodes) and TMDB's details. Absent on every other item.
   */
  media?: MediaInfo;
  /** ISO 8601. The stream is ordered by this, newest first, then by `id`. */
  publishedAt: string;
  /** ISO 8601: when WEB last read it. */
  fetchedAt: string;
};

/** Something WEB reads from: a query, a channel or a feed on one platform. */
export type WebSource = {
  id: string;
  platform: WebPlatform;
  /** What the adapter asks for; its meaning is the adapter's (a search query for the Internet Archive). */
  ref: string;
  /** Shown to people; the platform's name is shown next to every item regardless. */
  label: string;
  enabled: boolean;
  lastCheckedAt?: string;
  lastError?: string;
};

/** The name shown next to every item's link. One stream, so the source is always visible. */
export const PLATFORM_LABELS: Record<WebPlatform, string> = {
  internet_archive: 'INTERNET ARCHIVE',
  peertube: 'PEERTUBE',
  openverse: 'OPENVERSE',
  podcast: 'PODCAST',
  youtube: 'YOUTUBE',
  wikimedia_commons: 'WIKIMEDIA COMMONS',
  vimeo: 'VIMEO',
  // TMDB's films and shows, asked only when KINO is the SOURCE (search/providers/kino.ts).
  kino: 'KINO',
  ...(Object.fromEntries(MEDIA_SERVERS.map((server) => [server.id, server.label])) as Record<MediaServerId, string>),
};
