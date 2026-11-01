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
 */
export function startingEmbed(embed: string, platform: WebPlatform): string {
  if (!AUTOPLAY_PLATFORMS.includes(platform)) return embed;
  const url = new URL(embed);
  url.searchParams.set('autoplay', '1');
  return url.toString();
}

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
