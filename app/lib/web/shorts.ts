/**
 * YouTube Shorts are left out of MEDIA (Luke, 2026-11-14: "remove youtube shorts from results"). Pure and client-safe:
 * the search providers, the hourly stream's feed reader, YOUR YOUTUBE and the page all ask the same questions.
 *
 * How a Short is known, best first:
 * - its own address is a `/shorts/<id>` page (YouTube's channel feeds and its search pages link a Short that way);
 * - YouTube's search marks it with a Shorts player (`reelWatchEndpoint`), held by the InnerTube reader;
 * - YOUR YOUTUBE reads each channel's long-form uploads list (`UULF…`, which YouTube keeps without Shorts);
 * - and, as a last net, a title or description tagged `#shorts`.
 * Nothing here is a count or a rating, and nothing is stored: a Short is simply not listed.
 */

const SHORTS_PATH = /^\/shorts\/[A-Za-z0-9_-]{11}\/?$/;
const SHORTS_TAG = /(^|[^\p{L}\p{N}_])#shorts?\b/iu;

/** A YouTube address that is a Short's own page. */
export function isShortsAddress(address: string | null | undefined): boolean {
  if (!address) return false;
  try {
    const url = new URL(address, 'https://www.youtube.com');
    return /(^|\.)youtube\.com$/.test(url.hostname) && SHORTS_PATH.test(url.pathname);
  } catch {
    return false;
  }
}

/** Words tagged as a Short. */
export function taggedShort(...texts: (string | null | undefined)[]): boolean {
  return texts.some((text) => typeof text === 'string' && SHORTS_TAG.test(text));
}

/** A row MEDIA should leave out: a YouTube item that is known, or tagged, as a Short. */
export function isShort(item: { platform: string; url?: string; canonicalUrl?: string; title?: string; description?: string }): boolean {
  if (item.platform !== 'youtube') return false;
  return isShortsAddress(item.url) || isShortsAddress(item.canonicalUrl) || taggedShort(item.title, item.description);
}
