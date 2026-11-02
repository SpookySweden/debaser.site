/**
 * Pictures in stream chat: a line that is nothing but one link to a GIPHY picture or a Wikimedia Commons
 * thumbnail is drawn as that picture, hotlinked from the platform (never copied or proxied). Anything else stays plain text. Pure, so the
 * room, the record and the server route share one rule.
 */

/** The picture hosts a chat line may point at. GIPHY serves from media0-4 and i.giphy.com. */
const GIPHY_HOST = /^(?:media[0-9]?|i)\.giphy\.com$/;
const PICTURE_PATH = /\.(?:gif|jpe?g|png|webp)$/i;
/** Commons' thumbnail host and path shape, as WEB allows them (`lib/web/hosts.ts`, copied so this file stays tiny). */
const COMMONS_THUMB_HOST = 'thumb.wikimedia.org';
const COMMONS_FILE = "(?:[A-Za-z0-9_.!~*'()-]|%(?!2[Ff]|2[Ee]|5[Cc])[0-9A-Fa-f]{2}){1,600}";
const COMMONS_THUMB_PATH = new RegExp(`^/wikipedia/commons/thumb/[0-9a-f]/[0-9a-f]{2}/${COMMONS_FILE}/[0-9]{2,4}px-${COMMONS_FILE}$`);

/** The picture a chat line shows, or null when the line is words. */
export function chatImageUrl(body: string): string | null {
  const text = body.trim();
  if (text.length === 0 || /\s/.test(text)) return null;
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || url.username !== '' || url.password !== '' || url.port !== '') return null;
  const host = GIPHY_HOST.test(url.hostname) || (url.hostname === COMMONS_THUMB_HOST && COMMONS_THUMB_PATH.test(url.pathname));
  if (!host || !PICTURE_PATH.test(url.pathname)) return null;
  // Rebuilt without a query or fragment, so nothing rides along to the host.
  return `https://${url.hostname}${url.pathname}`;
}

/** Where a picture search looks: GIPHY's GIFs or stickers, or Wikimedia Commons' free images. */
export type ImageSearchKind = 'gif' | 'sticker' | 'image';

export const IMAGE_SEARCH_KINDS: readonly ImageSearchKind[] = ['gif', 'sticker', 'image'];

/** One search result: a small picture to choose from, and the link the chat line will hold. */
export type ImageResult = { id: string; title: string; thumb: string; url: string };

const record = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
const text = (value: unknown): string => (typeof value === 'string' ? value : '');

/** GIPHY's search answer, as results. A result whose links fail `chatImageUrl` is dropped. */
export function readGiphy(answer: unknown): ImageResult[] {
  const data = record(answer)?.data;
  if (!Array.isArray(data)) return [];
  const results: ImageResult[] = [];
  for (const entry of data) {
    const item = record(entry);
    const images = record(item?.images);
    const shown = chatImageUrl(text(record(images?.fixed_height)?.url));
    const thumb = chatImageUrl(text(record(images?.fixed_height_small)?.url)) ?? shown;
    if (item === null || shown === null || thumb === null) continue;
    results.push({ id: text(item.id), title: text(item.title).slice(0, 120), thumb, url: shown });
  }
  return results;
}

/**
 * Commons' search answer (`formatversion=2`, `extmetadata` filtered to AttributionRequired), as results: only
 * files Commons says need no credit line, so a picture can stand alone in chat. The thumbnail's query (tracking
 * tags) is dropped by `chatImageUrl`.
 */
export function readCommons(answer: unknown): ImageResult[] {
  const pages = record(record(answer)?.query)?.pages;
  if (!Array.isArray(pages)) return [];
  const results: ImageResult[] = [];
  for (const entry of pages) {
    const page = record(entry);
    const info = Array.isArray(page?.imageinfo) ? record(page.imageinfo[0]) : null;
    if (page === null || info === null) continue;
    if (text(record(record(info.extmetadata)?.AttributionRequired)?.value) !== 'false') continue;
    const url = chatImageUrl(text(info.thumburl));
    if (url === null || typeof page.pageid !== 'number') continue;
    const title = text(page.title).replace(/^File:/, '').replace(/\.[A-Za-z0-9]{2,5}$/, '');
    results.push({ id: String(page.pageid), title: title.slice(0, 120), thumb: url, url });
  }
  return results;
}
