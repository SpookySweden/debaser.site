/**
 * Pictures in stream chat: a line that is nothing but one link to a GIPHY or Imgur picture is drawn as that
 * picture, hotlinked from the platform (never copied or proxied). Anything else stays plain text. Pure, so the
 * room, the record and the server route share one rule.
 */

/** The picture hosts a chat line may point at. GIPHY serves from media0-4 and i.giphy.com. */
const GIPHY_HOST = /^(?:media[0-9]?|i)\.giphy\.com$/;
const IMGUR_HOST = 'i.imgur.com';
const PICTURE_PATH = /\.(?:gif|jpe?g|png|webp)$/i;

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
  if (!GIPHY_HOST.test(url.hostname) && url.hostname !== IMGUR_HOST) return null;
  if (!PICTURE_PATH.test(url.pathname)) return null;
  // Rebuilt without a query or fragment, so nothing rides along to the host.
  return `https://${url.hostname}${url.pathname}`;
}

/** Where a picture search looks: GIPHY's GIFs or stickers, or Imgur's images. */
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

/** Imgur's gallery search answer, as results: still and animated pictures only, nothing marked NSFW. */
export function readImgur(answer: unknown): ImageResult[] {
  const data = record(answer)?.data;
  if (!Array.isArray(data)) return [];
  const results: ImageResult[] = [];
  for (const entry of data) {
    const post = record(entry);
    if (post === null || post.nsfw === true) continue;
    // An album offers its first picture; a single image offers itself.
    const image = post.is_album === true && Array.isArray(post.images) ? record(post.images[0]) : post;
    if (image === null || image.nsfw === true || !text(image.type).startsWith('image/')) continue;
    const url = chatImageUrl(text(image.link));
    const id = text(image.id);
    if (url === null || !/^[A-Za-z0-9]+$/.test(id)) continue;
    // Imgur's own thumbnail size: the id with `m` (medium, 320px) on the end.
    results.push({ id, title: text(post.title).slice(0, 120), thumb: `https://${IMGUR_HOST}/${id}m.jpg`, url });
  }
  return results;
}
