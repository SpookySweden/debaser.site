import { isLoopbackAddress } from './wire';

/**
 * Which way a REMOTE picture travels, said plainly (Luke, 2026-11-21: "make sure its clear when something is done over
 * lan vs port forwarding or whatever its technically called").
 *
 * Nothing in SCREENS uses port forwarding (opening a port on the router so the internet can reach in): the router has
 * no open port. Our engine and other devices are reached straight across the home network, which is the only way
 * they can be reached today. The server by Remote Desktop goes through the Cloudflare tunnel, which the PC dials out
 * to, so it travels over the internet even from home.
 */

/** this-pc: the browser is on the PC itself. lan: straight across the home network. internet: straight, but over the
 * internet. relay: through a relay server. tunnel: through the Cloudflare tunnel to the PC. */
export type NetRoute = 'this-pc' | 'lan' | 'internet' | 'relay' | 'tunnel';

/** Before connecting, for our engine and other devices: which way it will go is only known once connected. */
export const DIRECT_WORDS = {
  label: 'DIRECT (HOME NETWORK OR INTERNET)',
  tip: 'Straight between the two devices: across your home network when both are on it, otherwise across the internet. No relay and no port opened on the router. A phone on mobile data may not get through yet.',
};

export const ROUTE_WORDS: Record<NetRoute, { label: string; tip: string }> = {
  'this-pc': {
    label: 'ON THIS PC',
    tip: 'This browser is on the PC itself: the picture never leaves the machine.',
  },
  lan: {
    label: 'HOME NETWORK (LAN, DIRECT)',
    tip: 'Straight across your home network between the two devices: nothing goes out to the internet, and no port is opened on the router.',
  },
  internet: {
    label: 'OVER THE INTERNET (DIRECT)',
    tip: 'Straight between the two devices, but across the internet: you are not on the same home network.',
  },
  relay: {
    label: 'OVER THE INTERNET (RELAYED)',
    tip: 'Through a relay server on the internet, because the two devices could not reach each other directly. Slower.',
  },
  tunnel: {
    label: 'OVER THE INTERNET (CLOUDFLARE TUNNEL)',
    tip: "Out to Cloudflare and back through the tunnel the PC dials out to (no port opened on the router), then across your home network from the PC to the server. It goes over the internet even when you are at home.",
  },
};

/** 10.x, 172.16-31.x, 192.168.x, 169.254.x, 100.64-127.x, and IPv6 private and link-local addresses. */
export function isHomeAddress(address: string): boolean {
  const a = address.toLowerCase().replace(/^\[|\]$/g, '');
  const four = /^(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/.exec(a);
  if (four) {
    const [x, y] = [Number(four[1]), Number(four[2])];
    return x === 10 || (x === 172 && y >= 16 && y <= 31) || (x === 192 && y === 168) || (x === 169 && y === 254) || (x === 100 && y >= 64 && y <= 127);
  }
  return /^f[cd][0-9a-f]{2}:/.test(a) || /^fe[89ab][0-9a-f]:/.test(a) || a.endsWith('.local');
}

/** The route of a chosen candidate pair's far end. */
export function routeOfCandidate(address: string | null, candidateType: string | null): NetRoute | null {
  if (candidateType === 'relay') return 'relay';
  if (address === null || address === '') return null;
  if (isLoopbackAddress(address)) return 'this-pc';
  return isHomeAddress(address) ? 'lan' : 'internet';
}

const text = (value: unknown): string | null => (typeof value === 'string' ? value : null);

/** Reads the route a WebRTC connection chose, from the browser's own statistics. Null until it has chosen. */
export async function routeOfConnection(connection: RTCPeerConnection): Promise<NetRoute | null> {
  const report = await connection.getStats();
  const byId = new Map<string, Record<string, unknown>>();
  report.forEach((entry: Record<string, unknown>) => {
    if (typeof entry.id === 'string') byId.set(entry.id, entry);
  });
  return routeFromStats(byId);
}

/** The same, from statistics already read (connection.ts reads them each second anyway). */
export function routeFromStats(byId: Map<string, Record<string, unknown>>): NetRoute | null {
  let pair: Record<string, unknown> | undefined;
  for (const entry of byId.values()) {
    if (entry.type === 'transport' && typeof entry.selectedCandidatePairId === 'string') pair = byId.get(entry.selectedCandidatePairId);
  }
  if (pair === undefined) {
    for (const entry of byId.values()) if (entry.type === 'candidate-pair' && entry.nominated === true && entry.state === 'succeeded') pair = entry;
  }
  const far = pair !== undefined && typeof pair.remoteCandidateId === 'string' ? byId.get(pair.remoteCandidateId) : undefined;
  if (far === undefined) return null;
  return routeOfCandidate(text(far.address) ?? text(far.ip), text(far.candidateType));
}
