import { PLATFORM_HOSTS } from './hosts';
import type { WebItem, WebPlatform } from './types';
import { isAllowedUrl } from './urls';

export type RowAddresses = {
  link: string | null;
  thumb: string | null;
  embed: string | null;
  licence: string | null;
};

/**
 * Hosts a platform may use on top of its fixed list. Only PeerTube has any: the instances in PeerTube's
 * public instances index, which the server reads and caches (`app/api/web/peertube-hosts`), never a host
 * taken from a search result alone. Each one is still held to the platform's exact path shapes.
 */
export type ExtraHosts = Partial<Record<WebPlatform, readonly string[]>>;

/** An https URL on one of `hosts`, with exactly the path shape given, and `query` (default: none) and no fragment. */
function shaped(value: unknown, hosts: readonly string[], path: RegExp, query = ''): string | null {
  if (!isAllowedUrl(value, hosts)) return null;
  const url = new URL(value);
  return url.search === query && url.hash === '' && path.test(url.pathname) ? value : null;
}

/**
 * The platforms whose player starts by itself when asked with `?autoplay=1`: each documents the flag;
 * PeerTube was watched starting at once on 2026-10-31. One that ignores it just shows its own button.
 */
const AUTOPLAY_PLATFORMS: readonly WebPlatform[] = ['youtube', 'peertube', 'internet_archive', 'vimeo'];

/**
 * A checked player address, asked to start at once: the reader has already pressed PLAY on our row, so
 * the platform's own big play button would be a second press for the same thing (Luke, 2026-10-31). Only
 * the one fixed flag is added, after `rowAddresses` has checked the address; a platform not listed is
 * framed as it was.
 *
 * `audio`: the row's language (`contentLanguage`). When it is known and isn't English, the players that take a
 * setting are asked to start with English subtitles (SPEC-subtitles.md, Luke 2026-11-03); their own CC menus
 * stay as they are, and a video with no English subtitles simply starts without.
 */
export function startingEmbed(embed: string, platform: WebPlatform, audio: string | null = null): string {
  const subtitled = withEnglishSubtitles(embed, platform, audio);
  if (!AUTOPLAY_PLATFORMS.includes(platform)) return subtitled;
  const url = new URL(subtitled);
  url.searchParams.set('autoplay', '1');
  return url.toString();
}

/** A checked player address asking for English subtitles from the start when `audio` is known and isn't English (`startingEmbed`); else as it was. */
export function withEnglishSubtitles(embed: string, platform: WebPlatform, audio: string | null): string {
  const subtitles = audio !== null && audio.split('-')[0] !== 'en' ? ENGLISH_SUBTITLES[platform] : undefined;
  if (subtitles === undefined) return embed;
  const url = new URL(embed);
  for (const [name, value] of subtitles) url.searchParams.set(name, value);
  return url.toString();
}

/** Each platform's documented way to ask its player for English subtitles from the start. */
const ENGLISH_SUBTITLES: Partial<Record<WebPlatform, readonly [string, string][]>> = {
  youtube: [['cc_load_policy', '1'], ['cc_lang_pref', 'en']],
  vimeo: [['texttrack', 'en']],
  peertube: [['subtitle', 'en']],
};

/**
 * The addresses a row may use, each re-checked against its platform's allow-list and path shapes.
 * Anything that fails is null, and the row draws no link, picture or player for it. Pure, so
 * `scripts/check-web-internet-archive.cjs` holds it against hostile items.
 */
export function rowAddresses(item: WebItem, extra: ExtraHosts = {}): RowAddresses {
  const allow = PLATFORM_HOSTS[item.platform];
  if (!allow) return { link: null, thumb: null, embed: null, licence: null };
  const more = extra[item.platform] ?? [];
  const hosts = (narrow: readonly string[] | undefined) => (more.length === 0 ? (narrow ?? allow.hosts) : [...(narrow ?? allow.hosts), ...more]);
  return {
    link: shaped(item.url, hosts(allow.pageHosts), allow.pagePath),
    thumb: shaped(item.thumbnailUrl, hosts(allow.thumbHosts), allow.thumbPath),
    embed: shaped(item.embedUrl, hosts(allow.embedHosts), allow.embedPath, allow.embedQuery ?? ''),
    licence: isAllowedUrl(item.licenseUrl, allow.linkHosts) ? item.licenseUrl : null,
  };
}
