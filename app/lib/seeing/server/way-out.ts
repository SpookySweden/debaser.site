/**
 * The server eye's way out (SPEC-seeing-machine.md, "SERVER EYE"): looking a name up, and going to the address that was judged.
 * SERVER ONLY.
 *
 * `SEEING_EXIT` names the way: `direct` (home, Luke's answer 2) is the only one built, so moving to his own server changes a line.
 */
import type { LookupFunction } from 'node:net';
import { Agent, buildConnector, fetch as undiciFetch } from 'undici';
import { ipv4Number, isPublicAddress } from '../../web/public-address';
import type { AnySiteWay } from '../../web/safe-fetch';

/** Cloudflare's resolver that answers 0.0.0.0 for known malware and phishing (1.1.1.2; answer 16). Asked by its own address, so nothing is looked up to ask it. */
const RESOLVER = 'https://1.1.1.2/dns-query';
/** The same company's page that says what address a request came from. */
const WHERE_AM_I = 'https://1.1.1.1/cdn-cgi/trace';

const NAMES_KEPT_MOST = 2000;
const NAME_KEPT_MS = 60_000;
const HOME_KEPT_MS = 10 * 60_000;
const ASK_TIMEOUT_MS = 5000;
const AGENTS_MOST = 64;

type Kept = { addresses: string[]; until: number };

/** Held on the process, so a route's own copy of this file shares them. */
type Held = { names: Map<string, Kept>; agents: Map<string, Agent>; home: { address: string; until: number } | null };
const holder = globalThis as typeof globalThis & { debaserSeeingWay?: Held };
const held: Held = (holder.debaserSeeingWay ??= { names: new Map(), agents: new Map(), home: null });

async function resolve(name: string, signal: AbortSignal): Promise<string[]> {
  const kept = held.names.get(name);
  if (kept !== undefined && kept.until > Date.now()) return kept.addresses;
  const response = await fetch(`${RESOLVER}?name=${encodeURIComponent(name)}&type=A`, {
    headers: { Accept: 'application/dns-json' },
    cache: 'no-store',
    redirect: 'error',
    signal: AbortSignal.any([signal, AbortSignal.timeout(ASK_TIMEOUT_MS)]),
  });
  if (!response.ok) throw new Error('the resolver did not answer');
  const answer = (await response.json()) as { Answer?: { type?: number; data?: unknown }[] };
  const addresses = (answer.Answer ?? []).filter((each) => each.type === 1 && typeof each.data === 'string').map((each) => each.data as string);
  if (held.names.size >= NAMES_KEPT_MOST) held.names.clear();
  held.names.set(name, { addresses, until: Date.now() + NAME_KEPT_MS });
  return addresses;
}

async function homeAddress(): Promise<string | null> {
  if (held.home !== null && held.home.until > Date.now()) return held.home.address;
  try {
    const response = await fetch(WHERE_AM_I, { cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(ASK_TIMEOUT_MS) });
    const address = /^ip=([0-9.]+)$/m.exec(await response.text())?.[1] ?? '';
    if (ipv4Number(address) !== null) held.home = { address, until: Date.now() + HOME_KEPT_MS };
  } catch {
    // The last one known stands in while it can't be asked; with none known, nothing is fetched.
  }
  return held.home?.address ?? null;
}

/** An agent that goes to one address whatever the name, and hangs up if it finds itself anywhere else. */
export function agentFor(address: string): Agent {
  if (!isPublicAddress(address)) throw new Error('not a public address');
  const kept = held.agents.get(address);
  if (kept !== undefined) return kept;
  const lookup: LookupFunction = (_name, options, callback) => {
    if (options.all === true) callback(null, [{ address, family: 4 }]);
    else callback(null, address, 4);
  };
  const connector = buildConnector({ lookup, allowH2: false, timeout: ASK_TIMEOUT_MS });
  const agent = new Agent({
    connect: (options, callback) =>
      connector(options, (error, socket) => {
        if (error !== null) return callback(error, null);
        if (socket.remoteAddress !== address) {
          socket.destroy();
          return callback(new Error('connected somewhere else'), null);
        }
        return callback(null, socket);
      }),
    keepAliveTimeout: 5000,
    connections: 6,
    maxResponseSize: 64 * 1024 * 1024,
  });
  if (held.agents.size >= AGENTS_MOST) {
    const oldest = held.agents.entries().next().value;
    if (oldest !== undefined) {
      held.agents.delete(oldest[0]);
      void oldest[1].close().catch(() => undefined);
    }
  }
  held.agents.set(address, agent);
  return agent;
}

async function connect(url: URL, address: string, init: { headers: Record<string, string>; signal: AbortSignal }): Promise<Response> {
  const answer = await undiciFetch(url, { method: 'GET', redirect: 'manual', credentials: 'omit', headers: init.headers, signal: init.signal, dispatcher: agentFor(address) });
  return answer as unknown as Response;
}

const DIRECT: AnySiteWay = { resolve, connect, homeAddress };

/**
 * For the local drives only: every name leads to one made-up public address, and that address is a server on this machine. A server that is
 * not a production one, started with SEEING_DEV_OPEN=1, and nothing else, can have it: a production build can never.
 */
function fixtureWay(port: number): AnySiteWay {
  return {
    resolve: async (name) => (name.endsWith('.seeing-fixture.org') ? ['93.184.216.34'] : []),
    homeAddress: async () => '81.2.69.142',
    connect: async (url, _address, init) => {
      const at = new URL(url);
      at.protocol = 'http:';
      at.host = `127.0.0.1:${port}`;
      const answer = await undiciFetch(at, { method: 'GET', redirect: 'manual', headers: { ...init.headers, 'X-Fixture-Host': url.hostname }, signal: init.signal });
      return answer as unknown as Response;
    },
  };
}

/** Null when the setting names a way that isn't built: nothing is fetched by another way than the one asked for. */
export function wayOut(env: Record<string, string | undefined>): AnySiteWay | null {
  const name = (env.SEEING_EXIT ?? '').trim();
  if (name === '' || name === 'direct') return DIRECT;
  const fixture = /^fixture:(\d{4,5})$/.exec(name);
  if (fixture !== null && env.NODE_ENV !== 'production' && env.SEEING_DEV_OPEN === '1') return fixtureWay(Number(fixture[1]));
  return null;
}
