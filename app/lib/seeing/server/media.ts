/**
 * Media found in a page's own words (SPEC-seeing-machine.md, "Media to the Room"): what it plays, what it says it plays (og:video, JSON-LD),
 * players it frames, and links to media files. Addresses and titles; nothing is fetched. Pure.
 */
import type { FoundMedia } from '../engine';

const MEDIA_MOST = 60;
/** A link to one of these is media; anything else is a page. */
export const MEDIA_FILE = /\.(?:mp4|m4v|webm|mov|ogv|mp3|m4a|aac|ogg|oga|opus|wav|flac|m3u8|mpd)(?:[?#]|$)/i;
/** Platforms whose own address is media, when it names one. */
const PLATFORM = /^https:\/\/(?:(?:www\.|m\.|music\.)?youtube(?:-nocookie)?\.com\/(?:watch\?|embed\/|live\/|shorts\/)|youtu\.be\/|(?:www\.|player\.)?vimeo\.com\/(?:video\/)?\d|(?:www\.|m\.)?twitch\.tv\/(?:videos\/\d|[A-Za-z0-9_]{3,25}$)|(?:www\.)?dailymotion\.com\/(?:video|embed)\/)/i;

export const isMediaLink = (address: string): boolean => MEDIA_FILE.test(address) || PLATFORM.test(address);

/** `PT1H2M3S`, as seconds. */
export function isoSeconds(text: unknown): number | null {
  const match = typeof text === 'string' ? /^P(?:(\d{1,3})D)?T?(?:(\d{1,4})H)?(?:(\d{1,4})M)?(?:(\d{1,6})(?:\.\d+)?S)?$/.exec(text) : null;
  if (match === null) return null;
  const seconds = Number(match[1] ?? 0) * 86400 + Number(match[2] ?? 0) * 3600 + Number(match[3] ?? 0) * 60 + Number(match[4] ?? 0);
  return seconds > 0 ? seconds : null;
}

export function createMediaFinder(page: string) {
  const found: FoundMedia[] = [];
  const seen = new Set<string>();
  const add = (address: string | null | undefined, title: string, from: FoundMedia['from'], seconds: number | null = null): void => {
    if (typeof address !== 'string' || found.length >= MEDIA_MOST) return;
    let url: URL;
    try {
      url = new URL(address.trim(), page);
    } catch {
      return;
    }
    if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.href.length > 2000 || seen.has(url.href)) return;
    seen.add(url.href);
    found.push({ address: url.href, title: title.replace(/\s+/g, ' ').trim().slice(0, 160), from, seconds });
  };

  /** Schema.org's words about a video or a sound, wherever they are in what the page wrote. */
  const linkedData = (text: string): void => {
    if (text.length > 300_000) return;
    let value: unknown;
    try {
      value = JSON.parse(text);
    } catch {
      return;
    }
    let looked = 0;
    const walk = (node: unknown, depth: number): void => {
      looked += 1;
      if (looked > 3000 || depth > 8 || typeof node !== 'object' || node === null) return;
      if (Array.isArray(node)) {
        for (const each of node) walk(each, depth + 1);
        return;
      }
      const thing = node as Record<string, unknown>;
      const kinds = (Array.isArray(thing['@type']) ? thing['@type'] : [thing['@type']]).map(String);
      if (kinds.some((kind) => /^(?:VideoObject|AudioObject|MusicRecording|PodcastEpisode|Clip|Movie)$/.test(kind))) {
        const title = typeof thing.name === 'string' ? thing.name : '';
        const seconds = isoSeconds(thing.duration);
        add(thing.contentUrl as string, title, 'declared', seconds);
        add(thing.embedUrl as string, title, 'declared', seconds);
      }
      for (const each of Object.values(thing)) walk(each, depth + 1);
    };
    walk(value, 0);
  };

  return { add, linkedData, list: (): FoundMedia[] => found };
}
