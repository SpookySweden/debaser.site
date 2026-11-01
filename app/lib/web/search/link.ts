/**
 * Paste-a-link (SPEC-web-search.md): a YouTube, Vimeo, Internet Archive, PeerTube or Wikimedia Commons address
 * pasted into the /web search box becomes that one item, playable, with no key needed. SERVER ONLY.
 *
 * The pasted address is never fetched, followed or kept. It is read for one thing - which platform and which
 * id - by strict rules per platform; the id is validated; and the item is then asked of the platform's own
 * API (oEmbed or its item API) at an address built from that id, exactly as a search result would be. A
 * PeerTube link counts only on an instance in the public instances index, and even then nothing is fetched
 * from the instance: Sepia Search is asked by uuid.
 */
import { isSafeIdentifier } from '../urls';
import { looksLikeLink } from '../link-shape';
import type { WebItem } from '../types';
import { internetArchiveSearch } from './providers/internet-archive';
import { peertubeSearch } from './providers/peertube';
import { VIMEO_ID, vimeoById } from './providers/vimeo';
import { commonsByFileName, wikimediaCommonsSearch } from './providers/wikimedia-commons';
import { YT_VIDEO_ID, youtubeById } from './providers/youtube';
import type { SearchDeps } from './types';

export type PastedLink =
  | { platform: 'youtube'; id: string }
  | { platform: 'vimeo'; id: string }
  | { platform: 'internet_archive'; id: string }
  | { platform: 'peertube'; host: string; uuid: string }
  | { platform: 'wikimedia_commons'; pageId: string }
  | { platform: 'wikimedia_commons'; fileName: string };

const YOUTUBE_HOSTS = ['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'www.youtube-nocookie.com'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** PeerTube's short ids: a uuid written in the Flickr base-58 alphabet (the `short-uuid` package it uses). */
const BASE58 = '123456789abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ';
const SHORT_UUID = /^[1-9A-HJ-NP-Za-km-z]{16,24}$/;

/** A PeerTube short id as its uuid, or null. */
export function shortUuidToUuid(short: string): string | null {
  if (!SHORT_UUID.test(short)) return null;
  let value = BigInt(0);
  for (const char of short) value = value * BigInt(58) + BigInt(BASE58.indexOf(char));
  const hex = value.toString(16);
  if (hex.length > 32) return null;
  const full = hex.padStart(32, '0');
  return `${full.slice(0, 8)}-${full.slice(8, 12)}-${full.slice(12, 16)}-${full.slice(16, 20)}-${full.slice(20)}`;
}

function peertubeUuid(value: string | undefined): string | null {
  if (!value) return null;
  return UUID.test(value) ? value : shortUuidToUuid(value);
}

/** The platform and id a pasted address names, or null when it is not one WEB recognises. */
export function parseLink(raw: unknown, peertubeHosts: ReadonlySet<string>): PastedLink | null {
  if (!looksLikeLink(raw)) return null;
  const text = raw.trim();
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    return null;
  }
  if ((url.protocol !== 'https:' && url.protocol !== 'http:') || url.username || url.password || url.port) return null;
  const host = url.hostname.toLowerCase();
  const parts = url.pathname.split('/').filter((part) => part.length > 0);

  if (host === 'youtu.be') {
    return parts.length === 1 && YT_VIDEO_ID.test(parts[0]) ? { platform: 'youtube', id: parts[0] } : null;
  }
  if (YOUTUBE_HOSTS.includes(host)) {
    const id = parts.length === 1 && parts[0] === 'watch' ? url.searchParams.get('v') : parts.length === 2 && ['shorts', 'embed', 'live', 'v'].includes(parts[0]) ? parts[1] : null;
    return id && YT_VIDEO_ID.test(id) ? { platform: 'youtube', id } : null;
  }
  if (host === 'vimeo.com' || host === 'www.vimeo.com') {
    return parts.length === 1 && VIMEO_ID.test(parts[0]) ? { platform: 'vimeo', id: parts[0] } : null;
  }
  if (host === 'player.vimeo.com') {
    // A `?h=` hash marks an unlisted video, which is not public: not shown.
    return parts.length === 2 && parts[0] === 'video' && VIMEO_ID.test(parts[1]) && !url.searchParams.has('h') ? { platform: 'vimeo', id: parts[1] } : null;
  }
  if (host === 'archive.org' || host === 'www.archive.org') {
    return parts.length >= 2 && (parts[0] === 'details' || parts[0] === 'embed') && isSafeIdentifier(parts[1]) ? { platform: 'internet_archive', id: parts[1] } : null;
  }
  if (host === 'commons.wikimedia.org' || host === 'commons.m.wikimedia.org') {
    const curid = url.searchParams.get('curid');
    if (curid && /^[1-9][0-9]{0,11}$/.test(curid)) return { platform: 'wikimedia_commons', pageId: curid };
    if (parts.length === 2 && parts[0] === 'wiki' && parts[1].startsWith('File:')) {
      let name: string;
      try {
        name = decodeURIComponent(parts[1].slice('File:'.length));
      } catch {
        return null;
      }
      return name.length > 0 ? { platform: 'wikimedia_commons', fileName: name } : null;
    }
    return null;
  }
  if (peertubeHosts.has(host)) {
    const id =
      parts.length === 2 && parts[0] === 'w' ? parts[1] : parts.length === 3 && parts[0] === 'videos' && (parts[1] === 'watch' || parts[1] === 'embed') ? parts[2] : undefined;
    const uuid = peertubeUuid(id);
    return uuid ? { platform: 'peertube', host, uuid } : null;
  }
  return null;
}

/** The one item a parsed link names, from the platform's own API, or null when the platform has nothing to show. */
export async function resolveLink(link: PastedLink, deps: SearchDeps): Promise<WebItem | null> {
  switch (link.platform) {
    case 'youtube':
      return youtubeById(link.id, deps);
    case 'vimeo':
      return vimeoById(link.id, deps);
    case 'internet_archive':
      return internetArchiveSearch.fetchOne(link.id, deps);
    case 'peertube': {
      const item = await peertubeSearch.fetchOne(link.uuid, deps);
      // Sepia's copy must live on the instance the link named.
      return item && new URL(item.url).hostname === link.host ? item : null;
    }
    case 'wikimedia_commons':
      return 'pageId' in link ? wikimediaCommonsSearch.fetchOne(link.pageId, deps) : commonsByFileName(link.fileName, deps);
  }
}
