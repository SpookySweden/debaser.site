/**
 * Addresses in BROWSER (SPEC-seeing-machine.md): what somebody typed or pressed, turned into one the machine can be asked for, or a
 * refusal in plain words. Pure. This only keeps mistakes out of the page: what may really be fetched is decided on the server, by the
 * guarded fetch, which trusts nothing here.
 */

/** The built-in page's own addresses (`see:test`, `see:test/2`): nothing is fetched for them. */
export const BUILT_IN_PREFIX = 'see:';

/** Longer than this is not an address anybody typed, and no site needs it. */
export const ADDRESS_MOST = 2000;

export type ReadAddress = { ok: true; address: string } | { ok: false; reason: string };

const refuse = (reason: string): ReadAddress => ({ ok: false, reason });

/** `javascript:`, `data:`, `file:`, `mailto:`... but not `localhost:3000` or `example.com:80`, which are a name and a port. */
const SCHEME = /^([a-z][a-z0-9+.-]*):(?!\d+(?:[/?#]|$))/i;

export function isBuiltIn(address: string): boolean {
  return address.startsWith(BUILT_IN_PREFIX);
}

/** This computer, a home or office network, a link-local or carrier's inside address, written as four numbers (as `new URL` writes them). */
const INSIDE_IPV4 = /^(?:127|10|0)\.\d+\.\d+\.\d+$|^192\.168\.\d+\.\d+$|^172\.(?:1[6-9]|2\d|3[01])\.\d+\.\d+$|^169\.254\.\d+\.\d+$|^100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.\d+\.\d+$/;

/** Names that mean a computer inside a house or an office network (`nas.local`, `router.home`, a tailnet's `ts.net`, `.onion`). */
const INSIDE_NAME = /\.(?:local|localdomain|lan|home|internal|intranet|corp|private|arpa|onion|ts\.net)\.?$/i;

/** What was typed into the address box, or pressed on a page. */
export function readAddress(text: string): ReadAddress {
  const typed = text.trim();
  if (typed.length === 0) return refuse('NO ADDRESS');
  if (typed.length > ADDRESS_MOST) return refuse('THAT ADDRESS IS TOO LONG');
  if (/[\u0000- \u007f]/.test(typed)) return refuse("THAT ISN'T AN ADDRESS");
  if (isBuiltIn(typed.toLowerCase())) {
    const address = typed.toLowerCase();
    return /^see:[a-z0-9/-]{1,40}$/.test(address) ? { ok: true, address } : refuse("THAT ISN'T AN ADDRESS");
  }
  const scheme = SCHEME.exec(typed)?.[1].toLowerCase();
  if (scheme !== undefined && scheme !== 'http' && scheme !== 'https') return refuse('ONLY HTTP AND HTTPS ADDRESSES OPEN HERE');
  let url: URL;
  try {
    url = new URL(scheme === undefined ? `https://${typed}` : typed);
  } catch {
    return refuse("THAT ISN'T AN ADDRESS");
  }
  // `localhost:3000` is an address, of a computer in the house: said in the server's own words, which refuses it whatever this says.
  if (/(?:^|\.)localhost\.?$/i.test(url.hostname)) return refuse('NOT A PUBLIC ADDRESS');
  // So are `[::1]` (the server's eye asks no IPv6 address) and the house's own IPv4 ranges: the server's list decides, this only says it first.
  if (url.hostname.startsWith('[') || INSIDE_IPV4.test(url.hostname) || INSIDE_NAME.test(url.hostname)) return refuse('NOT A PUBLIC ADDRESS');
  // `new URL('https://hello')` is a fine URL and not an address anybody meant.
  if (scheme === undefined && !url.hostname.includes('.')) return refuse("THAT ISN'T AN ADDRESS");
  if (url.username.length > 0 || url.password.length > 0) return refuse('NO NAME OR PASSWORD IN AN ADDRESS');
  return { ok: true, address: url.href };
}

/** An address on a port other than the ordinary two, which the server's eye refuses (public-address.ts): said before it is asked for. */
export function oddPort(address: string): boolean {
  try {
    const { port } = new URL(address);
    return port !== '' && port !== '80' && port !== '443';
  } catch {
    return false;
  }
}

export const ODD_PORT_SAID = "THE SERVER'S EYE ASKS ONLY PORTS 80 AND 443";

/** A short name for an address, until its page says its own title. */
export function shortName(address: string): string {
  if (isBuiltIn(address)) return address.startsWith('see:kept/') ? 'KEPT PAGE' : 'TEST PAGE';
  try {
    return new URL(address).hostname.replace(/^www\./, '');
  } catch {
    return address.slice(0, 40);
  }
}

/** The part after `#` stays in the browser, so an address never lands in a server's log (the spec's reason for using it). */
const HASH_KEY = 'see';

export function browserHref(address: string | null): string {
  return address === null ? '/browser' : `/browser#${HASH_KEY}=${encodeURIComponent(address)}`;
}

/** A media item the extension's reader pressed TO THE ROOM for: `/browser#media=<address>&title=<title>`. It waits in the tray for a press here. */
export function mediaInHash(hash: string): { address: string; title: string } | null {
  const match = /^#?media=([^&]+)(?:&title=(.*))?$/.exec(hash);
  if (match === null) return null;
  try {
    const read = readAddress(decodeURIComponent(match[1]));
    return read.ok && /^https?:/.test(read.address) ? { address: read.address, title: decodeURIComponent(match[2] ?? '').replace(/\s+/g, ' ').trim().slice(0, 160) } : null;
  } catch {
    return null;
  }
}

/** The address a `/browser#see=` link carries, or null. Never opened by itself unless it is the page already in front: a link from anywhere can carry one. */
export function addressInHash(hash: string): string | null {
  const match = new RegExp(`^#?${HASH_KEY}=(.+)$`).exec(hash);
  if (match === null) return null;
  let text: string;
  try {
    text = decodeURIComponent(match[1]);
  } catch {
    return null;
  }
  const read = readAddress(text);
  return read.ok ? read.address : null;
}
