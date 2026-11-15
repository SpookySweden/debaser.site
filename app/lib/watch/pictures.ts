import { PLATFORM_HOSTS } from '../web/hosts';
import { isAllowedUrl } from '../web/urls';
import { LINK_TITLE_MAX } from './link-limits';
import { isSitePath } from './songs';
import type { WatchLink } from './types';

/**
 * Pictures in a queue (SPEC-rooms-queues.md, section 6; Luke's answers 4A, 5B, 6B). Pure and client-safe.
 *
 * A picture entry is a link to one still image, with its title (and who made it, where known): never a copy. It
 * takes its turn like anything else, goes on the room's screen and **stays until somebody presses NEXT**: there is
 * no timer, and nothing behind it plays until then.
 *
 * Where a picture may come from decides how it is shown:
 * - **the site's own** (a FILES picture, STREAM ART: one of the site's paths, or its own storage) and **a source the
 *   site already trusts** (a MEDIA image result's own picture, on that platform's allow-listed picture host) are
 *   drawn as they are, the way their rows already draw them;
 * - anything else is an **outside picture**. It is never drawn by itself: whoever looks at it is told where it is
 *   from first (phase 6 builds the SHOW key and its guards; until then it is named and not loaded). This is decided
 *   again in every viewer's browser from the address alone, so a row written past the site's own checks still
 *   cannot make anybody's browser call a server they were not told about.
 */

export const PICTURE_KIND = 'picture' as const;

export const PICTURE_REFUSALS = {
  notPicture: 'NOT A PICTURE LINK',
  svg: "SVG PICTURES CAN'T BE QUEUED",
  outside: 'ONLY PICTURES FROM THE SITE AND ITS OWN SOURCES CAN BE QUEUED FOR NOW',
} as const;

/** SVG is refused by its name wherever it lives: it is a picture format that is really a small program. */
export function looksLikeSvg(url: string): boolean {
  const path = url.split(/[?#]/)[0].toLowerCase();
  return path.endsWith('.svg') || path.endsWith('.svgz');
}

/** The site's own storage, as the page knows it (the public address every upload is read from). */
function ownStorageBase(): string | null {
  const base = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').replace(/\/+$/, '');
  return base.startsWith('https://') ? `${base}/storage/v1/object/public/` : null;
}

/** Where the site keeps the files that ship with it: the only site path a picture is drawn from. */
const SITE_PICTURES = '/assets/';

/**
 * Anything in an address that makes a browser go somewhere other than where the address seems to point: a backslash
 * (read as a slash), a space or control character (dropped), `..` (walked up), or one of those written as an escape.
 */
function hasPathTricks(url: string): boolean {
  for (let at = 0; at < url.length; at += 1) {
    const code = url.charCodeAt(at);
    if (code === 92 || code <= 32 || code === 127) return true;
  }
  const lower = url.toLowerCase();
  return lower.includes('..') || lower.includes('%2e') || lower.includes('%2f') || lower.includes('%5c');
}

/**
 * One of the site's own pictures: a file under the site's own `/assets/`, or a file in its own storage. Decided the
 * way a browser reads the address (`isSitePath`), with nothing in it that walks somewhere else, and never a route
 * that does work when asked (`/api/...`, the image optimiser): a picture's address is only ever a file.
 */
export function isSitePicture(url: string): boolean {
  if (typeof url !== 'string' || hasPathTricks(url)) return false;
  if (url.startsWith('/')) return isSitePath(url) && url.startsWith(SITE_PICTURES) && !url.includes('?') && !url.includes('#');
  const storage = ownStorageBase();
  if (storage === null || !url.startsWith(storage)) return false;
  try {
    const parsed = new URL(url);
    return parsed.origin === new URL(storage).origin && parsed.pathname.startsWith(new URL(storage).pathname) && parsed.username === '' && parsed.password === '';
  } catch {
    return false;
  }
}

/** A MEDIA platform's own picture: on that platform's allow-listed picture host, at its picture path. */
export function isPlatformPicture(url: string): boolean {
  return Object.values(PLATFORM_HOSTS).some((allow) => {
    if (!isAllowedUrl(url, allow.thumbHosts ?? allow.hosts)) return false;
    try {
      return allow.thumbPath.test(new URL(url).pathname);
    } catch {
      return false;
    }
  });
}

/** Drawn as it is: the site's own, or a source the site already trusts. Everything else is an outside picture. */
export function isTrustedPicture(url: string): boolean {
  return isSitePicture(url) || isPlatformPicture(url);
}

export function isPictureLink(link: WatchLink | null | undefined): boolean {
  return link !== null && link !== undefined && link.kind === PICTURE_KIND;
}

/** The host an outside picture would be loaded from, for the line that names it; '' when the address does not read. */
export function pictureHost(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

/**
 * A picture as a queue holds it. The title carries who made it, where known (`TITLE · MAKER`): a queue row keeps an
 * address, a kind and a title, nothing else.
 */
export function pictureLink(url: string, title: string, maker?: string | null): WatchLink {
  const name = title.trim().length > 0 ? title.trim() : 'A PICTURE';
  const by = maker !== undefined && maker !== null && maker.trim().length > 0 ? ` · ${maker.trim()}` : '';
  return { url, kind: PICTURE_KIND, title: `${name}${by}`.slice(0, LINK_TITLE_MAX) };
}

/** Why a picture may not be written to a queue, or null. The address's own rules (https or a site path, length) are `queueRefusal`'s. */
export function pictureRefusal(link: WatchLink): string | null {
  if (link.kind !== PICTURE_KIND) return PICTURE_REFUSALS.notPicture;
  if (isSitePicture(link.url)) return null;
  if (looksLikeSvg(link.url)) return PICTURE_REFUSALS.svg;
  if (!isTrustedPicture(link.url)) return PICTURE_REFUSALS.outside;
  return null;
}
