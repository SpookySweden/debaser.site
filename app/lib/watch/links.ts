import type { WatchLink, WatchLinkKind } from './types';

/**
 * Video links in a stream room's queue (SPEC-watch-links.md): which player a pasted address needs, and
 * what is refused, in words fit to show. Pure, apart from `probeVideoLink`, which asks this browser.
 *
 * Only addresses that play directly are taken. Nothing here, or anywhere, fetches the video for the
 * reader, pretends to be the site it came from, or gets round a site's locks on its streams (decided).
 */

export const LINK_KINDS: readonly WatchLinkKind[] = ['file', 'hls', 'dash', 'youtube', 'vimeo', 'dailymotion', 'twitch'];

/** The database holds these limits too (supabase/migrations/20261030181430_watch_queue_links.sql). */
export const LINK_URL_MAX = 2048;
export const LINK_TITLE_MAX = 200;

/** Video files a `<video>` plays from their address. */
const FILE_EXTENSIONS = ['mp4', 'webm', 'ogg', 'ogv', 'mov'];

/** How long the adder's browser is given to load a link before it is refused. */
export const LINK_PROBE_MS = 15000;

export const LINK_REFUSALS = {
  notVideo: 'NOT A VIDEO LINK',
  notHttps: 'ONLY HTTPS LINKS',
  tooLong: 'THIS LINK IS TOO LONG',
  wouldNotLoad: "THIS LINK WOULDN'T LOAD",
} as const;

export function isLinkKind(value: string | null | undefined): value is WatchLinkKind {
  return typeof value === 'string' && (LINK_KINDS as readonly string[]).includes(value);
}

export type LinkVerdict = { ok: true; link: WatchLink } | { ok: false; reason: string };

/** What a pasted address is, with the title it starts with; or why it is refused. */
export function recognizeLink(text: string): LinkVerdict {
  const raw = text.trim();
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: LINK_REFUSALS.notVideo };
  }

  if (url.protocol === 'http:') return { ok: false, reason: LINK_REFUSALS.notHttps };
  if (url.protocol !== 'https:' || url.hostname.length === 0) return { ok: false, reason: LINK_REFUSALS.notVideo };
  if (raw.length > LINK_URL_MAX) return { ok: false, reason: LINK_REFUSALS.tooLong };

  const name = fileName(url);
  const extension = name.includes('.') ? name.slice(name.lastIndexOf('.') + 1).toLowerCase() : '';
  if (FILE_EXTENSIONS.includes(extension)) return { ok: true, link: { url: raw, kind: 'file', title: clampTitle(name) || url.hostname } };

  return { ok: false, reason: LINK_REFUSALS.notVideo };
}

/** The title the adder typed, or the one the link came with when the box is left empty. */
export function linkTitle(typed: string, fallback: string): string {
  return clampTitle(typed) || clampTitle(fallback);
}

function clampTitle(text: string): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, LINK_TITLE_MAX).trim();
}

/** The last part of the address's path, decoded: `https://x/a/My%20Clip.mp4` -> `My Clip.mp4`. */
function fileName(url: URL): string {
  const last = url.pathname.split('/').filter((part) => part.length > 0).pop() ?? '';
  try {
    return decodeURIComponent(last);
  } catch {
    return last;
  }
}

/**
 * Loads a direct file link in this browser, off screen, before it is queued: null when it would play,
 * else the refusal. Only the start of the file is read (`preload="metadata"`), and nothing is kept.
 */
export function probeVideoLink(url: string, timeoutMs = LINK_PROBE_MS): Promise<string | null> {
  return new Promise((resolve) => {
    const video = document.createElement('video');
    let timer = 0;
    let done = false;
    const finish = (reason: string | null) => {
      if (done) return;
      done = true;
      window.clearTimeout(timer);
      video.removeAttribute('src');
      video.load();
      resolve(reason);
    };
    // iPhone Safari may ignore `preload` and load nothing until a video is played. A browser that never
    // started (idle, nothing read, no error) is let through: the room still skips a link that won't play.
    timer = window.setTimeout(() => {
      const neverStarted = video.error === null && video.readyState === 0 && video.networkState === video.NETWORK_IDLE;
      finish(neverStarted ? null : LINK_REFUSALS.wouldNotLoad);
    }, timeoutMs);
    video.preload = 'metadata';
    video.muted = true;
    for (const loaded of ['loadedmetadata', 'loadeddata', 'durationchange', 'canplay']) video.addEventListener(loaded, () => finish(null), { once: true });
    video.addEventListener('error', () => finish(LINK_REFUSALS.wouldNotLoad), { once: true });
    video.src = url;
  });
}
