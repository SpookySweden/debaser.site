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

type ShortsItem = { platform: string; url?: string; canonicalUrl?: string; title?: string; description?: string; creator?: string; durationSeconds?: number; live?: true };

/**
 * Music is never left out on a guess (Luke, 2026-11-14: "make sure the shorts thing doesnt affect any music on youtube at
 * all"): a song or music video, YouTube's auto-made `- Topic` artist channels and YouTube Music among them, is dropped only
 * when YouTube's own `/shorts/<id>` page says it is a Short (shorts-check.ts), never by a tag or its length.
 */
export function isMusicItem(item: ShortsItem): boolean {
  return item.platform === 'youtube' && typeof item.creator === 'string' && /\s-\sTopic$/i.test(item.creator.trim());
}

/** YouTube lets a Short run to three minutes, so anything that long or less (or of unknown length) is worth asking about. */
export const SHORT_MAX_SECONDS = 180;

/**
 * Whether a YouTube row's length makes it worth asking YouTube about (shorts-check.ts). Length only picks what to ask: it
 * never leaves a row out by itself, since plenty of songs and music videos are under three minutes.
 */
export function shortCandidate(item: ShortsItem): boolean {
  // A live broadcast has no length yet and is never a Short (SPEC-live-streams.md): nothing to ask YouTube.
  if (item.live === true) return false;
  return item.platform === 'youtube' && (item.durationSeconds === undefined || item.durationSeconds <= SHORT_MAX_SECONDS);
}

/** A row MEDIA should leave out: a YouTube item that is known, or tagged, as a Short. A music item never is, by marks alone. */
export function isShort(item: ShortsItem): boolean {
  if (item.platform !== 'youtube' || isMusicItem(item)) return false;
  return isShortsAddress(item.url) || isShortsAddress(item.canonicalUrl) || taggedShort(item.title, item.description);
}

/** A YouTube video's id from a row (`youtube:<id>`), or null. */
export function youtubeIdOf(item: { platform: string; externalId?: string }): string | null {
  return item.platform === 'youtube' && typeof item.externalId === 'string' && /^[A-Za-z0-9_-]{11}$/.test(item.externalId) ? item.externalId : null;
}
