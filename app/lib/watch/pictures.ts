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
 * - anything else is an **outside picture** (any pasted https image link, answer 6B). It is never drawn by itself:
 *   whoever looks at it is told which host it is from first, and it loads only after they press SHOW
 *   (`outside-pictures.ts` keeps each viewer's choice). This is decided again in every viewer's browser from the
 *   address alone, so a row written past the site's own checks still cannot make anybody's browser call a server
 *   they were not told about.
 *
 * The guards on an outside picture (the SPEC's table), all kept in the browser, **never by our server**: https only;
 * a real, public address (no name and password, no port, no number address, no `localhost`, no one-word or
 * `.local` / `.internal` host); no SVG; 10 MB at most where the outside server says its size; at most 4,096
 * pixels a side and 16 million in all; loaded and drawn within 8 seconds; shown with no referrer; and every viewer's
 * browser checks the address, the size on screen and the time again, because an outside server can swap the picture.
 * Our server never fetches, copies, resizes or saves one: only its address and title are kept.
 */

export const PICTURE_KIND = 'picture' as const;

export const PICTURE_REFUSALS = {
  notPicture: 'NOT A PICTURE LINK',
  notEither: 'NOT A VIDEO OR PICTURE LINK',
  svg: "SVG PICTURES CAN'T BE QUEUED",
  notHttps: 'ONLY HTTPS LINKS',
  notPublic: 'ONLY A PUBLIC WEB ADDRESS: NO PASSWORD, PORT, NUMBER ADDRESS OR LOCAL NAME',
  tooBig: 'THIS PICTURE IS TOO BIG: 10 MB AT MOST',
  tooLarge: 'THIS PICTURE IS TOO LARGE: 4096 PIXELS A SIDE AT MOST',
  wouldNotLoad: "THIS PICTURE WOULDN'T LOAD",
  wontShow: "THIS PICTURE WON'T SHOW HERE",
} as const;

/** The most an outside picture may be. The megabytes only where its server says them; the pixels and the time always. */
export const PICTURE_MAX_BYTES = 10 * 1024 * 1024;
export const PICTURE_MAX_SIDE = 4096;
export const PICTURE_MAX_PIXELS = 16_000_000;
export const PICTURE_LOAD_MS = 8000;

/** File names a pasted link is taken as a picture by, before anything is loaded. Anything else is tried by drawing it. */
export const PICTURE_EXTENSIONS: readonly string[] = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'avif', 'bmp'];

/** Host names that never mean a public web server: a device on somebody's own network, or nowhere at all. */
const PRIVATE_ENDINGS: readonly string[] = ['local', 'localhost', 'localdomain', 'internal', 'lan', 'home', 'corp', 'intranet', 'router', 'gateway', 'arpa', 'test', 'invalid', 'onion'];

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

/**
 * Why an outside picture's address is refused, or null: https only, and a real, public address. This is what stops a
 * link aimed at a device on the viewer's own network. Read the way a browser reads it (`new URL` turns `0x7f.1`
 * and `2130706433` into the number address they are), and run again in every viewer's browser before anything loads.
 */
export function outsideAddressRefusal(url: string): string | null {
  if (typeof url !== 'string') return PICTURE_REFUSALS.notPicture;
  // A backslash, a space or a control character: a browser would read a different address from the one written.
  for (let at = 0; at < url.length; at += 1) {
    const code = url.charCodeAt(at);
    if (code === 92 || code <= 32 || code === 127) return PICTURE_REFUSALS.notPublic;
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return PICTURE_REFUSALS.notPicture;
  }
  if (parsed.protocol !== 'https:') return PICTURE_REFUSALS.notHttps;
  if (parsed.username !== '' || parsed.password !== '' || parsed.port !== '') return PICTURE_REFUSALS.notPublic;
  const host = parsed.hostname.toLowerCase().replace(/\.$/, '');
  // A number address (v4 as the parser normalised it, or v6 in its brackets), or a name with no dot in it.
  if (host.length === 0 || host.includes(':') || host.startsWith('[') || /^[0-9.]+$/.test(host) || !host.includes('.')) return PICTURE_REFUSALS.notPublic;
  const ending = host.slice(host.lastIndexOf('.') + 1);
  if (PRIVATE_ENDINGS.includes(ending) || /^[0-9]+$/.test(ending)) return PICTURE_REFUSALS.notPublic;
  if (looksLikeSvg(url)) return PICTURE_REFUSALS.svg;
  return null;
}

/** Whether a picture this big may be shown: 4,096 a side and 16 million pixels in all, at most. Nothing at all is not a picture. */
export function dimensionsRefusal(width: number, height: number): string | null {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return PICTURE_REFUSALS.wouldNotLoad;
  if (width > PICTURE_MAX_SIDE || height > PICTURE_MAX_SIDE || width * height > PICTURE_MAX_PIXELS) return PICTURE_REFUSALS.tooLarge;
  return null;
}

/**
 * What an outside server said about a picture when asked (a HEAD request), judged: an SVG or something that is no
 * image at all is refused, and so is one it says is over 10 MB. A server that says nothing decides nothing: the
 * drawing test does.
 */
export function headRefusal(type: string | null, bytes: number | null): string | null {
  const kind = (type ?? '').split(';')[0].trim().toLowerCase();
  if (kind.includes('svg')) return PICTURE_REFUSALS.svg;
  if (kind.length > 0 && !kind.startsWith('image/') && kind !== 'application/octet-stream' && kind !== 'binary/octet-stream') return PICTURE_REFUSALS.notPicture;
  if (bytes !== null && Number.isFinite(bytes) && bytes > PICTURE_MAX_BYTES) return PICTURE_REFUSALS.tooBig;
  return null;
}

/** Why a picture may not be written to a queue, or null. The address's own rules (https or a site path, length) are `queueRefusal`'s. */
export function pictureRefusal(link: WatchLink): string | null {
  if (link.kind !== PICTURE_KIND) return PICTURE_REFUSALS.notPicture;
  if (isSitePicture(link.url)) return null;
  if (looksLikeSvg(link.url)) return PICTURE_REFUSALS.svg;
  if (isTrustedPicture(link.url)) return null;
  // An outside picture: any public https address. What it turns out to be is each browser's to check before it shows.
  return outsideAddressRefusal(link.url);
}

/**
 * Who may take a queued picture out before it shows, besides a crown (the database's delete rule, change 4b):
 * whoever added it, and the room's host. Once it has shown it is part of the room's record, and NEXT takes it off.
 */
export function mayTakeOutPicture(entry: { link: WatchLink | null; addedBy: string | null; playedAt: string | null }, hostId: string, userId: string | null): boolean {
  return userId !== null && entry.playedAt === null && entry.link !== null && entry.link.kind === PICTURE_KIND && (entry.addedBy === userId || hostId === userId);
}

export type PictureVerdict = { ok: true; link: WatchLink } | { ok: false; reason: string };

/** A pasted address as a picture link, titled by its file name: its address rules only. Nothing is loaded here. */
export function recognizePicture(text: string): PictureVerdict {
  const raw = text.trim();
  if (!isTrustedPicture(raw)) {
    const refusal = outsideAddressRefusal(raw);
    if (refusal !== null) return { ok: false, reason: refusal };
  }
  let name = '';
  let host = '';
  try {
    const parsed = new URL(raw);
    host = parsed.hostname;
    name = decodeURIComponent(parsed.pathname.split('/').filter((part) => part.length > 0).pop() ?? '');
  } catch {
    // The title falls back to the host, or to A PICTURE.
  }
  return { ok: true, link: pictureLink(raw, name.length > 0 ? name : host) };
}

/* --- in the browser: the drawing test, and the question an outside server may answer ------------------------------ */

/**
 * Loads the picture as a picture, in this browser, with no referrer, and says how big it is; null when it would not
 * load or draw within the time. This is the only test that always runs: an outside server need not answer anything else.
 */
export function loadPicture(url: string, ms: number = PICTURE_LOAD_MS): Promise<{ width: number; height: number; image: HTMLImageElement } | null> {
  return new Promise((resolve) => {
    if (typeof Image === 'undefined') {
      resolve(null);
      return;
    }
    const image = new Image();
    let done = false;
    const finish = (answer: { width: number; height: number; image: HTMLImageElement } | null) => {
      if (done) return;
      done = true;
      window.clearTimeout(timer);
      image.onload = null;
      image.onerror = null;
      // Too slow: the browser is told to stop fetching it.
      if (answer === null) image.src = '';
      resolve(answer);
    };
    const timer = window.setTimeout(() => finish(null), ms);
    image.referrerPolicy = 'no-referrer';
    image.decoding = 'async';
    // The element itself is handed back: whoever shows the picture shows this one, never a second request for it.
    image.onload = () => finish({ width: image.naturalWidth, height: image.naturalHeight, image });
    image.onerror = () => finish(null);
    image.src = url;
  });
}

/** Asks the outside server what the picture is, where it allows the question; null when it does not answer. */
async function askHead(url: string): Promise<{ type: string | null; bytes: number | null } | null> {
  try {
    // A server that sends the question somewhere else has not answered it: the drawing test decides.
    const answer = await fetch(url, { method: 'HEAD', mode: 'cors', credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(PICTURE_LOAD_MS) });
    if (!answer.ok) return null;
    const length = answer.headers.get('content-length');
    return { type: answer.headers.get('content-type'), bytes: length === null ? null : Number(length) };
  } catch {
    return null;
  }
}

/**
 * The adder's check, in the adder's own browser, never by our server: the address rules, what the outside server says
 * about it where it will say, and then the drawing test, with the size on screen. Null when the picture may be queued.
 */
export async function probePicture(url: string): Promise<string | null> {
  const address = outsideAddressRefusal(url);
  if (address !== null) return address;
  const head = await askHead(url);
  if (head !== null) {
    const said = headRefusal(head.type, head.bytes);
    if (said !== null) return said;
  }
  const drawn = await loadPicture(url);
  if (drawn === null) return PICTURE_REFUSALS.wouldNotLoad;
  return dimensionsRefusal(drawn.width, drawn.height);
}
