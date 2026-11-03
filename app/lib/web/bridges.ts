import type { ForumAnchor } from '../forum/types';
import { LINK_TITLE_MAX, LINK_URL_MAX, recognizeLink, twitchTarget, twitchUrl, vimeoUrl, vimeoVideo, youtubeId, youtubeWatchUrl } from '../watch/links';
import type { WatchLink, WatchLinkKind } from '../watch/types';
import { MEDIA_SERVER_IDS, type MediaServerId } from './media-servers';
import { officialEmbedUrl } from './official-embed';
import { rowAddresses } from './row-addresses';
export { officialEmbedUrl, WEB_EMBED_SANDBOX } from './official-embed';
import { PLATFORM_LABELS, type WebItem, type WebPlatform } from './types';

/**
 * WEB's two bridges (SPEC-web.md, Phase 5): an item's forum thread and an item in a stream room.
 *
 * Pure and client-safe, so `scripts/check-web-bridges.cjs` holds every rule here against hostile items.
 * Nothing here fetches: the forum files a thread by anchor as it does for a track, and the room plays the
 * platform's own official player, never the media itself.
 */

/* --- the forum ------------------------------------------------------------------------------------ */

/** Where a WEB item's thread links back to: the stream it is listed on, the archive page (at /web until 2026-11-03). */
export const WEB_HREF = '/archive';

/** `web_items.id`: `${platform}:${externalId}`, the same shape the table CHECKs. */
const WEB_ITEM_ID = /^[a-z][a-z0-9_]{0,40}:[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/;

/** The longest label a WEB thread is filed under; a title is third-party text of any length. */
export const WEB_ANCHOR_LABEL_MAX = 200;

/**
 * The anchor an item's thread is filed under: keyed by `web_items.id`, labelled with the item's title.
 *
 * The label is written into the thread when it is first filed, so the thread still reads after the item
 * is hidden or gone from the stream (`webItemStatus`). The partial unique index on (anchor_kind,
 * anchor_id) keeps it to one thread per item, exactly as for a track.
 */
export function webAnchor(item: Pick<WebItem, 'id' | 'title'>): ForumAnchor {
  const title = item.title.replace(/\s+/g, ' ').trim().slice(0, WEB_ANCHOR_LABEL_MAX).trim();
  return {
    kind: 'web',
    id: item.id,
    label: title.length === 0 ? item.id : title,
    href: WEB_HREF,
  };
}

/** The `web_items.id` a thread is filed under, or null for any other anchor or a malformed id. */
export function webAnchorItemId(anchor: Pick<ForumAnchor, 'kind' | 'id'>): string | null {
  return anchor.kind === 'web' && WEB_ITEM_ID.test(anchor.id) ? anchor.id : null;
}

/** Whether a WEB thread's item is still in the stream. */
export type WebItemStatus = 'checking' | 'live' | 'gone';

/**
 * What a WEB thread says about its item, from one read of the stream.
 *
 *   item       found: live
 *   null       the read worked and found nothing: hidden (a takedown) or deleted, so gone
 *   undefined  still reading, or the read failed: say nothing rather than call it gone
 *
 * A malformed id can never be read, so it is gone without a read.
 */
export function webItemStatus(anchor: Pick<ForumAnchor, 'kind' | 'id'>, read: WebItem | null | undefined): WebItemStatus {
  const itemId = webAnchorItemId(anchor);
  if (itemId === null) return 'gone';
  if (read === undefined) return 'checking';
  return read !== null && read.id === itemId ? 'live' : 'gone';
}

/** The plain note a WEB thread shows once its item has left the stream. */
export const ITEM_GONE_NOTE = 'ITEM GONE: NO LONGER IN THE ARCHIVE';

/* --- the stream room ------------------------------------------------------------------------------ */

/**
 * Which player a platform's items get in a stream room.
 *
 * A site the room already drives (`youtube`, `vimeo`, `twitch`) only where that really is the platform;
 * everything else is `embed`: the platform's own official player in a sandboxed frame, on its allow-listed
 * embed address (app/lib/web/hosts.ts). Never `file`, `hls` or `dash`: WEB never plays a media file itself.
 * null means the platform's items cannot be queued. A new platform must say which (TypeScript asks).
 */
export const WATCH_KIND_BY_PLATFORM: Record<WebPlatform, Extract<WatchLinkKind, 'youtube' | 'vimeo' | 'twitch' | 'embed'> | null> = {
  internet_archive: 'embed',
  peertube: 'embed',
  // The room already drives YouTube with its own player, from the canonical watch address.
  youtube: 'youtube',
  // Link only on /web (no official player), so nothing to put in a room.
  openverse: null,
  podcast: null,
  // Commons' player is a page asked for by query (`?embedplayer=yes`), which a room's `embed` link may not
  // carry (official-embed.ts): link and PLAY on /web only.
  wikimedia_commons: null,
  // The room already drives Vimeo with its own player.
  vimeo: 'vimeo',
  // KINO rows have no player at all (kino.ts).
  kino: null,
  // Media-server titles play on /web only, from the server's own player (SPEC-media-servers.md).
  ...(Object.fromEntries(MEDIA_SERVER_IDS.map((id) => [id, null])) as Record<MediaServerId, null>),
};

/** Whether a link may go in a room's queue from WEB: https, a fitting kind, and an allow-listed address. */
export function isQueueableWebLink(link: WatchLink): boolean {
  if (typeof link.url !== 'string' || !link.url.startsWith('https://') || link.url.length > LINK_URL_MAX) return false;
  if (link.title.length === 0 || link.title.length > LINK_TITLE_MAX) return false;
  if (link.kind === 'embed') return officialEmbedUrl(link.url) !== null;
  // A site the room already drives: only its own canonical address, exactly as a pasted link is kept.
  if (link.kind === 'youtube' || link.kind === 'vimeo' || link.kind === 'twitch') {
    const verdict = recognizeLink(link.url);
    return verdict.ok && verdict.link.kind === link.kind && verdict.link.url === link.url;
  }
  return false;
}

/**
 * The link a stream room queues for a WEB item, or null when it cannot be watched there.
 *
 * Only video and audio. Every address is the row's own, re-checked against the platform's allow-list
 * (`rowAddresses`), so nothing the database holds can smuggle another address into a room.
 */
export function watchLinkForItem(item: WebItem): WatchLink | null {
  if (item.kind !== 'video' && item.kind !== 'audio') return null;
  const kind = WATCH_KIND_BY_PLATFORM[item.platform];
  if (kind === undefined || kind === null) return null;

  const addresses = rowAddresses(item);
  const title = item.title.replace(/\s+/g, ' ').trim().slice(0, LINK_TITLE_MAX).trim() || PLATFORM_LABELS[item.platform];

  if (kind === 'embed') {
    const url = officialEmbedUrl(addresses.embed);
    return url === null ? null : { url, kind, title };
  }

  // A site the room drives with its own player: read the video from the row's page or player address.
  for (const address of [addresses.link, addresses.embed]) {
    if (address === null) continue;
    const parsed = new URL(address);
    if (kind === 'youtube') {
      const id = youtubeId(parsed);
      if (id !== null) return { url: youtubeWatchUrl(id), kind, title };
    } else if (kind === 'vimeo') {
      const video = vimeoVideo(parsed);
      if (video !== null) return { url: vimeoUrl(video), kind, title };
    } else {
      const target = twitchTarget(parsed);
      if (target !== null) return { url: twitchUrl(target), kind, title };
    }
  }
  return null;
}
