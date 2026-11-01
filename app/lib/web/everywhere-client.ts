import type { WebStreamItem } from './dedupe';
import { PLATFORM_HOSTS } from './hosts';
import { PLATFORM_LABELS, type WebItem, type WebPlatform } from './types';
import { SIGNED_OUT_REFUSAL, webSessionHeaders } from './web-session';

/**
 * The page's side of search everywhere and paste-a-link (SPEC-web-search.md). Client-safe: it only calls our
 * own routes (`/api/web/search`, `/api/web/peertube-hosts`), never a platform. What comes back is treated
 * as untrusted like any row: items with an unknown platform or missing fields are dropped here, and every
 * address is re-checked by `rowAddresses` before it is drawn; all text is rendered as text.
 */

export type ProviderLine = { platform: WebPlatform; label: string; problem: string };
export type LinkOutcome = 'found' | 'unknown' | 'not-found' | 'no-answer';

export type EverywherePage = {
  items: WebStreamItem[];
  /** One line per provider that failed or is not set up ("YOUTUBE: NOT SET UP"). */
  problems: ProviderLine[];
  nextCursor: string | null;
  link: LinkOutcome | null;
};

/** The route's refusal, in its own plain words (too many searches, too long). */
export class EverywhereError extends Error {}

const PROBLEMS = new Set(['NOT SET UP', 'DAILY LIMIT REACHED', 'KEY REFUSED', 'NO ANSWER', 'COULD NOT READ']);
const LINKS = new Set<LinkOutcome>(['found', 'unknown', 'not-found', 'no-answer']);

function isPlatform(value: unknown): value is WebPlatform {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(PLATFORM_LABELS, value);
}

function toItem(value: unknown): WebStreamItem | null {
  if (!value || typeof value !== 'object') return null;
  const item = value as Partial<WebItem>;
  if (!isPlatform(item.platform) || typeof item.id !== 'string' || typeof item.title !== 'string' || typeof item.publishedAt !== 'string') return null;
  if (!['audio', 'video', 'image', 'text', 'other'].includes(item.kind as string)) return null;
  return { ...(item as WebItem), alsoOn: [] };
}

/**
 * One search (or one pasted link) through our route. `cursor` asks for the next page of the same search;
 * `provider` asks one live source only; `from` keeps only one creator's items (the route takes one); `type`
 * (not 'all') has a source that can ask for one kind do so.
 */
export async function searchEverywhere(query: string, cursor: string | null, provider?: WebPlatform, from: string | null = null, type = 'all'): Promise<EverywherePage> {
  const params = new URLSearchParams({ q: query });
  if (provider !== undefined) params.set('provider', provider);
  if (from !== null) params.set('from', from);
  if (type !== 'all') params.set('type', type);
  if (cursor !== null) params.set('cursor', cursor);
  // The route answers signed-in people only (web-session.ts); signed out, nothing is sent at all.
  const headers = await webSessionHeaders();
  if (headers === null) throw new EverywhereError(SIGNED_OUT_REFUSAL);
  const response = await fetch(`/api/web/search?${params.toString()}`, { credentials: 'omit', headers });
  const body = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  if (!response.ok || body === null) {
    throw new EverywhereError(typeof body?.error === 'string' ? body.error.slice(0, 120) : 'COULD NOT SEARCH.');
  }
  const items = Array.isArray(body.items) ? body.items.map(toItem).filter((item): item is WebStreamItem => item !== null) : [];
  const problems = (Array.isArray(body.statuses) ? body.statuses : []).flatMap((status): ProviderLine[] => {
    const { platform, problem } = (status ?? {}) as { platform?: unknown; problem?: unknown };
    return isPlatform(platform) && typeof problem === 'string' && PROBLEMS.has(problem) ? [{ platform, label: PLATFORM_LABELS[platform], problem }] : [];
  });
  const link = LINKS.has(body.link as LinkOutcome) ? (body.link as LinkOutcome) : null;
  return { items, problems, nextCursor: typeof body.nextCursor === 'string' ? body.nextCursor : null, link };
}

/** Whether a PeerTube item is on an instance outside the fixed list, so the page needs the index's hosts. */
export function needsPeertubeHosts(item: WebItem): boolean {
  if (item.platform !== 'peertube') return false;
  try {
    return !PLATFORM_HOSTS.peertube.hosts.includes(new URL(item.url).hostname);
  } catch {
    return false;
  }
}

const HOSTNAME = /^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
let hostsRead: Promise<readonly string[]> | null = null;

/** The PeerTube instances from the public index, read once per page load from our own route. */
export function loadPeertubeHosts(): Promise<readonly string[]> {
  hostsRead ??= fetch('/api/web/peertube-hosts', { credentials: 'omit' })
    .then((response) => (response.ok ? response.json() : { hosts: [] }))
    .then((body: { hosts?: unknown }) => (Array.isArray(body.hosts) ? body.hosts.filter((host): host is string => typeof host === 'string' && HOSTNAME.test(host)) : []))
    .catch(() => {
      hostsRead = null;
      return [];
    });
  return hostsRead;
}
