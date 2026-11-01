/**
 * The PeerTube instances WEB may show, link and frame: the public instances index that joinpeertube.org
 * keeps (instances.joinpeertube.org, the same index Sepia Search reads), plus the hand-picked
 * `PEERTUBE_INSTANCES`. SERVER ONLY.
 *
 * A host is used only when it is in this list - never because a search result names it. The list is fetched
 * on the server, held for six hours in memory and a day in Next's fetch cache, and handed to the page by
 * `GET /api/web/peertube-hosts` so the page can re-check every PeerTube address against the same list.
 * Nothing in WEB ever fetches from an instance found this way: searches go to Sepia Search only.
 *
 * Live-checked 2026-10-31: 1,738 hosts, 52 KB, one request (`count` up to 5000 is honoured).
 */
import { PEERTUBE_INSTANCES } from '../hosts';
import { safeFetchJson, type FetchLike } from '../safe-fetch';
import { buildUrl } from '../urls';

const INDEX_HOST = 'instances.joinpeertube.org';
export const PEERTUBE_INDEX_HOSTS = [INDEX_HOST] as const;
export const PEERTUBE_INDEX_URL = buildUrl(INDEX_HOST, ['api', 'v1', 'instances', 'hosts'], [
  ['count', '5000'],
  ['start', '0'],
]);
const HOLD_MS = 6 * 60 * 60 * 1000;
/** Fewer than this means the index answered something odd; the fixed list is used alone instead. */
const MIN_PLAUSIBLE = 50;
const MAX_HOSTS = 10_000;

/**
 * A public DNS name: lowercase labels, a letters-only top-level label, no port, no IP address, nothing
 * local. What the page will put in an https URL's host, so nothing else may pass.
 */
const HOSTNAME = /^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const LOCAL_SUFFIX = /\.(?:local|localhost|internal|lan|home|corp|intranet|test|example|invalid|onion)$/;

export function isPublicHostname(value: unknown): value is string {
  return typeof value === 'string' && HOSTNAME.test(value) && !LOCAL_SUFFIX.test(value);
}

/** The hosts out of an index answer (unknown entries skipped), or a thrown error when the shape is wrong. */
export function parseIndex(body: unknown): Set<string> {
  const data = (body as { data?: unknown } | null)?.data;
  if (!Array.isArray(data)) throw new Error('unexpected response shape');
  const hosts = new Set<string>();
  for (const entry of data.slice(0, MAX_HOSTS)) {
    const host = (entry as { host?: unknown } | null)?.host;
    if (isPublicHostname(host)) hosts.add(host);
  }
  return hosts;
}

let held: { at: number; hosts: ReadonlySet<string> } | null = null;
/** After a failed read, the fixed list is used for a minute before the index is tried again. */
const RETRY_MS = 60 * 1000;
let failedAt: number | null = null;

/**
 * The allowed hosts. Never throws: when the index cannot be read, or answers something implausible, the
 * fixed list stands alone until the next try (so a failure narrows what is shown, never widens it).
 */
export async function peertubeHosts(fetchImpl?: FetchLike, now = Date.now()): Promise<ReadonlySet<string>> {
  if (held && now - held.at < HOLD_MS) return held.hosts;
  let hosts: Set<string> = new Set(PEERTUBE_INSTANCES);
  if (failedAt !== null && now - failedAt < RETRY_MS) return hosts;
  try {
    const found = parseIndex(await safeFetchJson(PEERTUBE_INDEX_URL, { allowedHosts: PEERTUBE_INDEX_HOSTS, fetchImpl, maxBytes: 1024 * 1024 }));
    if (found.size >= MIN_PLAUSIBLE) hosts = new Set([...PEERTUBE_INSTANCES, ...found]);
  } catch {
    // The fixed list alone, tried again after a minute: not held for six hours, and not asked on every
    // request while the index is down.
    failedAt = now;
    return hosts;
  }
  failedAt = null;
  held = { at: now, hosts };
  return hosts;
}
