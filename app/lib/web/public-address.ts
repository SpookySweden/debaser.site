/**
 * Which addresses the any-site fetch may go to (SPEC-seeing-machine.md, "The guarded fetch"). Pure, and server-side only in use.
 *
 * SERVER sits beside everything in the house: the torrent page, Jellyfin, the database, the screens engine, the remote desktop, the router
 * and Tailscale all answer the machine doing the fetching. So an address is refused unless it is plainly a public one, and a name is
 * refused unless it is plainly somebody else's. It is a list of what may be, not of what may not.
 */

/** Names that are ours, or only mean anything on this machine, this network or Tailscale. A name is refused if it is one of these or under one. */
const OWN_NAMES = ['debaser.site', 'debaser-site.vercel.app', 'cfargotunnel.com', 'trycloudflare.com'] as const;
const LOCAL_ENDINGS = ['localhost', 'local', 'localdomain', 'internal', 'intranet', 'lan', 'home', 'home.arpa', 'corp', 'private', 'ts.net', 'arpa', 'onion', 'test', 'example', 'invalid', 'alt'] as const;

/** IPv4 ranges that are not anybody's public address (IANA's special-purpose registry), as [first address, prefix length]. */
const NOT_PUBLIC: readonly (readonly [string, number])[] = [
  ['0.0.0.0', 8], // this network; on most systems it reaches this machine
  ['10.0.0.0', 8], // private
  ['100.64.0.0', 10], // shared address space: Tailscale
  ['127.0.0.0', 8], // this machine
  ['169.254.0.0', 16], // link-local, and cloud metadata
  ['172.16.0.0', 12], // private: Docker
  ['192.0.0.0', 24],
  ['192.0.2.0', 24], // documentation
  ['192.31.196.0', 24],
  ['192.52.193.0', 24],
  ['192.88.99.0', 24], // 6to4 relays
  ['192.168.0.0', 16], // private: the house
  ['192.175.48.0', 24],
  ['198.18.0.0', 15], // benchmarks
  ['198.51.100.0', 24], // documentation
  ['203.0.113.0', 24], // documentation
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4], // reserved, and broadcast
];

/** Four numbers written plainly (`93.184.216.34`), as one number; null for any other spelling. */
export function ipv4Number(text: string): number | null {
  const parts = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(text);
  if (parts === null) return null;
  let value = 0;
  for (const part of parts.slice(1)) {
    // `010` is eight to some readers and ten to others: neither is taken.
    if (part.length > 1 && part.startsWith('0')) return null;
    const number = Number(part);
    if (number > 255) return null;
    value = value * 256 + number;
  }
  return value;
}

/** A public IPv4 address. Everything else is not: any IPv6 (the machine fetches over IPv4 only), any other spelling, any reserved range. */
export function isPublicAddress(address: string, alsoRefused: readonly string[] = []): boolean {
  const value = ipv4Number(address);
  if (value === null) return false;
  if (alsoRefused.some((refused) => ipv4Number(refused) === value)) return false;
  return !NOT_PUBLIC.some(([first, length]) => {
    const size = 2 ** (32 - length);
    return Math.floor(value / size) === Math.floor((ipv4Number(first) ?? 0) / size);
  });
}

function under(name: string, ending: string): boolean {
  return name === ending || name.endsWith(`.${ending}`);
}

/** A name that may be looked up: a full public name that is not ours. An address written as numbers is not a name. */
export function isPublicName(hostname: string): boolean {
  const name = hostname.toLowerCase().replace(/\.$/, '');
  if (name.length > 253 || !/^[a-z0-9_-]{1,63}(?:\.[a-z0-9_-]{1,63})+$/.test(name)) return false;
  // The last label is never a number: `1.2.3.4`, `0x7f.1`, `2130706433.1` are addresses in somebody's spelling.
  if (/^(?:\d+|0x[0-9a-f]*)$/.test(name.slice(name.lastIndexOf('.') + 1))) return false;
  return ![...OWN_NAMES, ...LOCAL_ENDINGS].some((ending) => under(name, ending));
}

export type AnySiteVerdict = { ok: true; url: URL; host: string } | { ok: false; reason: string };

const refuse = (reason: string): AnySiteVerdict => ({ ok: false, reason });

/**
 * Whether an address may be asked for at all, before anything is looked up: http or https, ports 80 and 443, no user name, a public
 * name or a public address. `new URL` has already turned every other spelling of an IPv4 address (decimal, octal, hex, short) into four
 * plain numbers, so there is one spelling to judge.
 */
export function judgeAddress(address: string, alsoRefused: readonly string[] = []): AnySiteVerdict {
  if (address.length > 4000) return refuse('THAT ADDRESS IS TOO LONG');
  let url: URL;
  try {
    url = new URL(address);
  } catch {
    return refuse("THAT ISN'T AN ADDRESS");
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return refuse('ONLY HTTP AND HTTPS ADDRESSES OPEN HERE');
  if (url.username !== '' || url.password !== '') return refuse('NO NAME OR PASSWORD IN AN ADDRESS');
  if (url.port !== '' && url.port !== '80' && url.port !== '443') return refuse('ONLY THE ORDINARY PORTS, 80 AND 443');
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  if (ipv4Number(host) !== null) return isPublicAddress(host, alsoRefused) ? { ok: true, url, host } : refuse('NOT A PUBLIC ADDRESS');
  return isPublicName(host) ? { ok: true, url, host } : refuse('NOT A PUBLIC ADDRESS');
}
