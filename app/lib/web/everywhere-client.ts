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

const PROBLEMS = new Set(['NOT SET UP', 'DAILY LIMIT REACHED', 'KEY REFUSED', 'NO ANSWER', 'COULD NOT READ', 'NO POPULARITY ORDER', "CAN'T SORT BY DATE", 'SORTED THE FIRST 500 MATCHES']);
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
export async function searchEverywhere(
  query: string,
  cursor: string | null,
  provider?: WebPlatform,
  from: string | null = null,
  type = 'all',
  extra: { vibe?: boolean; keyword?: number; order?: 'relevance' | 'popular' | 'newest' | 'oldest' } = {},
): Promise<EverywherePage> {
  const params = new URLSearchParams({ q: query });
  if (provider !== undefined) params.set('provider', provider);
  // The SORT row's order (web-sort.ts `searchOrder`); only the order travels, never a count.
  if (extra.order !== undefined) params.set('order', extra.order);
  // VIBE (search-intent.ts) and, for KINO, a related TMDB keyword (related.ts).
  if (extra.vibe) params.set('vibe', 'on');
  if (extra.keyword !== undefined && Number.isInteger(extra.keyword) && extra.keyword > 0) params.set('keyword', String(extra.keyword));
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

export type Related = { suggestion: string | null; topics: { label: string; query: string; keyword?: number }[] };

/** "Did you mean" and related topics for some words (`/api/web/related`); nothing at all on any failure. */
export async function loadRelated(query: string, kino: boolean): Promise<Related> {
  const none: Related = { suggestion: null, topics: [] };
  const headers = await webSessionHeaders();
  if (headers === null) return none;
  try {
    const params = new URLSearchParams({ q: query });
    if (kino) params.set('kino', '1');
    const response = await fetch(`/api/web/related?${params.toString()}`, { credentials: 'omit', headers });
    if (!response.ok) return none;
    const body = (await response.json()) as { suggestion?: unknown; topics?: unknown };
    const words = (value: unknown) => (typeof value === 'string' && /^[\p{L}\p{N} ]{1,80}$/u.test(value) ? value : null);
    const topics = (Array.isArray(body.topics) ? body.topics : []).flatMap((raw) => {
      const topic = (raw ?? {}) as { label?: unknown; query?: unknown; keyword?: unknown };
      const label = typeof topic.label === 'string' && /^[\p{L}\p{N} :]{1,80}$/u.test(topic.label) ? topic.label : null;
      const query = words(topic.query);
      if (label === null || query === null) return [];
      return [typeof topic.keyword === 'number' && Number.isInteger(topic.keyword) && topic.keyword > 0 ? { label, query, keyword: topic.keyword } : { label, query }];
    });
    return { suggestion: words(body.suggestion), topics: topics.slice(0, 3) };
  } catch {
    return none;
  }
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
