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
/** Streams, played through a library (stream-player.ts): HLS playlists and DASH manifests. */
const STREAM_EXTENSIONS: Record<string, WatchLinkKind> = { m3u8: 'hls', mpd: 'dash' };

/** How long the adder's browser is given to load a link before it is refused. */
export const LINK_PROBE_MS = 15000;

export const LINK_REFUSALS = {
  notVideo: 'NOT A VIDEO LINK',
  notEmbeddable: "THIS VIDEO CAN'T BE EMBEDDED",
  offline: 'THIS CHANNEL IS OFFLINE',
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

  // A YouTube video is kept as its plain watch address, whatever form it was pasted in. Its title
  // starts as a placeholder; the room fills in the real one from YouTube (youtube-player.ts).
  const youtube = youtubeId(url);
  if (youtube !== null) return { ok: true, link: { url: youtubeWatchUrl(youtube), kind: 'youtube', title: `YOUTUBE ${youtube}` } };
  // Vimeo and Twitch likewise (step 4). Vimeo's title comes from Vimeo; Twitch has no public title
  // lookup, so a channel is titled by its name and a past broadcast by its number.
  const vimeo = vimeoVideo(url);
  if (vimeo !== null) return { ok: true, link: { url: vimeoUrl(vimeo), kind: 'vimeo', title: `VIMEO ${vimeo.id}` } };
  const twitch = twitchTarget(url);
  if (twitch !== null)
    return { ok: true, link: { url: twitchUrl(twitch), kind: 'twitch', title: twitch.channel !== undefined ? `${twitch.channel.toUpperCase()} ON TWITCH` : `TWITCH VIDEO ${twitch.video}` } };

  const name = fileName(url);
  const extension = name.includes('.') ? name.slice(name.lastIndexOf('.') + 1).toLowerCase() : '';
  if (FILE_EXTENSIONS.includes(extension)) return { ok: true, link: { url: raw, kind: 'file', title: clampTitle(name) || url.hostname } };
  const stream = STREAM_EXTENSIONS[extension];
  if (stream !== undefined) return { ok: true, link: { url: raw, kind: stream, title: clampTitle(name) || url.hostname } };

  return { ok: false, reason: LINK_REFUSALS.notVideo };
}

/** Every form a YouTube video's address comes in: watch, youtu.be, shorts, live, embed. */
const YOUTUBE_HOSTS = ['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtube-nocookie.com', 'www.youtube-nocookie.com'];
const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;

export function youtubeId(url: URL): string | null {
  const host = url.hostname.toLowerCase();
  let id: string | null = null;
  if (host === 'youtu.be') id = url.pathname.split('/')[1] ?? null;
  else if (YOUTUBE_HOSTS.includes(host)) {
    if (url.pathname === '/watch') id = url.searchParams.get('v');
    else id = /^\/(?:shorts|live|embed)\/([^/]+)/.exec(url.pathname)?.[1] ?? null;
  }
  return id !== null && YOUTUBE_ID.test(id) ? id : null;
}

export function youtubeWatchUrl(id: string): string {
  return `https://www.youtube.com/watch?v=${id}`;
}

/** The YouTube video a stored link plays, or null. */
export function youtubeIdOf(link: WatchLink): string | null {
  if (link.kind !== 'youtube') return null;
  try {
    return youtubeId(new URL(link.url));
  } catch {
    return null;
  }
}

/** A Vimeo video: its number, and the key an unlisted one needs (the `h` in its address). */
export type VimeoVideo = { id: string; hash?: string };
const VIMEO_HOSTS = ['vimeo.com', 'www.vimeo.com', 'player.vimeo.com'];

export function vimeoVideo(url: URL): VimeoVideo | null {
  if (!VIMEO_HOSTS.includes(url.hostname.toLowerCase())) return null;
  const parts = url.pathname.split('/').filter((part) => part.length > 0);
  // vimeo.com/123, vimeo.com/123/abcdef, player.vimeo.com/video/123?h=abcdef, and the same number at the
  // end of channel, group and album pages (vimeo.com/channels/staffpicks/123).
  // An album's own number comes first in vimeo.com/album/9/video/123: the video's follows `video`.
  const afterVideo = parts.indexOf('video');
  // An album or showcase page with no video in it is a list, not a video.
  if (afterVideo === -1 && (parts[0] === 'album' || parts[0] === 'showcase')) return null;
  const at = afterVideo !== -1 ? afterVideo + 1 : parts.findIndex((part) => /^\d{1,12}$/.test(part));
  if (at === -1 || !/^\d{1,12}$/.test(parts[at] ?? '')) return null;
  const hash = (url.searchParams.get('h') ?? parts[at + 1]) || undefined;
  return { id: parts[at], hash: hash !== undefined && /^[0-9a-f]{6,20}$/i.test(hash) ? hash : undefined };
}

export function vimeoUrl(video: VimeoVideo): string {
  return video.hash === undefined ? `https://vimeo.com/${video.id}` : `https://vimeo.com/${video.id}/${video.hash}`;
}

/** A Twitch channel (watched live) or one of its past broadcasts. */
export type TwitchTarget = { channel: string; video?: undefined } | { video: string; channel?: undefined };
const TWITCH_HOSTS = ['twitch.tv', 'www.twitch.tv', 'm.twitch.tv', 'player.twitch.tv'];
/** Twitch's own pages, which look like channel names. */
const TWITCH_PAGES = ['directory', 'videos', 'settings', 'search', 'subscriptions', 'inventory', 'wallet', 'drops', 'friends', 'messages', 'login', 'signup', 'downloads', 'jobs', 'turbo', 'prime', 'store', 'p', 'u', 'popout', 'embed', 'moderator', 'broadcast'];

export function twitchTarget(url: URL): TwitchTarget | null {
  const host = url.hostname.toLowerCase();
  if (!TWITCH_HOSTS.includes(host)) return null;
  // player.twitch.tv/?channel=name or ?video=v123
  if (host === 'player.twitch.tv') {
    const channel = url.searchParams.get('channel');
    const video = url.searchParams.get('video')?.replace(/^v/, '');
    if (video && /^\d{1,12}$/.test(video)) return { video };
    return channel && /^[a-zA-Z0-9_]{3,25}$/.test(channel) ? { channel: channel.toLowerCase() } : null;
  }
  const parts = url.pathname.split('/').filter((part) => part.length > 0);
  // twitch.tv/videos/123 and twitch.tv/name/video/123
  if (parts[0] === 'videos' && /^\d{1,12}$/.test(parts[1] ?? '')) return { video: parts[1] };
  if (parts.length >= 3 && parts[1] === 'video' && /^\d{1,12}$/.test(parts[2])) return { video: parts[2] };
  // twitch.tv/name: the channel, live
  if (parts.length === 1 && /^[a-zA-Z0-9_]{3,25}$/.test(parts[0]) && !TWITCH_PAGES.includes(parts[0].toLowerCase())) return { channel: parts[0].toLowerCase() };
  return null;
}

export function twitchUrl(target: TwitchTarget): string {
  return target.video !== undefined ? `https://www.twitch.tv/videos/${target.video}` : `https://www.twitch.tv/${target.channel}`;
}

/** What a stored link points at on its site, read back from its kept address; null for other kinds. */
export function vimeoOf(link: WatchLink): VimeoVideo | null {
  return link.kind === 'vimeo' ? parsed(link.url, vimeoVideo) : null;
}
export function twitchOf(link: WatchLink): TwitchTarget | null {
  return link.kind === 'twitch' ? parsed(link.url, twitchTarget) : null;
}
function parsed<T>(address: string, read: (url: URL) => T | null): T | null {
  try {
    return read(new URL(address));
  } catch {
    return null;
  }
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

/** Whether a live stream's player should jump to its live edge: only when it has fallen well behind. */
export const LIVE_BEHIND_SECONDS = 10;
export function liveJump(edge: number | null, seconds: number): number | undefined {
  return edge !== null && Number.isFinite(edge) && edge - seconds > LIVE_BEHIND_SECONDS ? edge : undefined;
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
