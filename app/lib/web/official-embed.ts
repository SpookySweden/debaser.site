import { PLATFORM_HOSTS } from './hosts';
import { isAllowedUrl } from './urls';

/** The longest address a stream room keeps (watch_queue's own limit, app/lib/watch/links.ts). */
const URL_MAX = 2048;

/** The one sandbox a WEB embed gets, on /web and in a stream room: the platform's scripts on its own origin. */
export const WEB_EMBED_SANDBOX = 'allow-scripts allow-same-origin';

/**
 * An address, if it is a WEB platform's official player: https, on one of a platform's allow-listed hosts
 * (app/lib/web/hosts.ts), with that platform's exact embed path and no query or fragment. Anything else is
 * null and is never framed. A stream room reads a stored `embed` link through this before every frame and
 * both watch repositories before every write, so a bad row cannot point a room anywhere else.
 */
export function officialEmbedUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > URL_MAX) return null;
  for (const allow of Object.values(PLATFORM_HOSTS)) {
    if (!isAllowedUrl(value, allow.hosts)) continue;
    const url = new URL(value);
    if (url.search === '' && url.hash === '' && allow.embedPath.test(url.pathname)) return value;
  }
  return null;
}
