/**
 * ANNA'S ARCHIVE (Luke, 2026-11-13; rearchitected 2026-11-14): search hits a home-run proxy
 * (Luke's desktop, WireGuard-split-tunnelled + Playwright + persistent Anna's cookies at
 * `I:\debaser-cache\.browser-profile\`). The proxy's `/search?q=` returns JSON; each hit's
 * externalId becomes `shadow:<md5>` so the reader can queue it for download via `/download`
 * and serve it from `/file/<md5>` once cached on the home HDD.
 *
 * When `SHADOW_PROXY_URL`/`SHADOW_PROXY_TOKEN` are unset (or the proxy is offline), the
 * provider throws `SearchProblemError('NO ANSWER')` so the panel shows a one-line problem
 * under the search box — the source still appears in WHERE FROM so the reader sees it.
 */
import type { WebItem } from '../../types';
import { SearchProblemError, type ProviderPage, type SearchDeps, type SearchKind, type SearchPage, type SearchProvider } from '../types';

const SHADOW_PROXY_URL = (process.env.SHADOW_PROXY_URL ?? '').trim().replace(/\/+$/, '');
const SHADOW_PROXY_TOKEN = (process.env.SHADOW_PROXY_TOKEN ?? '').trim();

export const ANNA_PAGE_SIZE = 20;

type ProxyHit = { md5: string; title?: string; author?: string; year?: string; ext?: string; size?: string };
type ProxyAnswer = { ok: boolean; hits?: ProxyHit[]; challenged?: boolean; lastError?: string };

function toAnnaItem(hit: ProxyHit, fetchedAt: string): WebItem {
  const md5 = hit.md5.toLowerCase();
  const title = (hit.title ?? '').trim() || 'ANNA\'S ARCHIVE BOOK';
  const creator = (hit.author ?? '').trim();
  const year = (hit.year ?? '').trim();
  return {
    id: `anna:${md5}`,
    platform: 'anna',
    externalId: `shadow:${md5}`,
    kind: 'text',
    url: `https://annas-archive.gd/md5/${md5}`,
    canonicalUrl: `https://annas-archive.gd/md5/${md5}`,
    title,
    ...(creator ? { creator } : {}),
    publishedAt: /^\d{4}$/.test(year)
      ? new Date(Date.UTC(Number(year), 0, 1)).toISOString()
      : fetchedAt,
    fetchedAt,
  };
}

export const annaSearch: SearchProvider = {
  platform: 'anna',
  allowedHosts: [],
  timeoutMs: 25_000,
  sortedTimeoutMs: 25_000,
  orders: [],
  byAuthor: true,
  async search(words: string, _page: ProviderPage | null, _deps: SearchDeps, author = '', kind?: SearchKind): Promise<SearchPage> {
    if (kind !== undefined && kind !== 'text') return { items: [], next: null };
    if (words.length === 0 && author.length === 0) return { items: [], next: null };
    if (!SHADOW_PROXY_URL || !SHADOW_PROXY_TOKEN) {
      throw new SearchProblemError('NO ANSWER');
    }
    const fetchedAt = new Date().toISOString();
    const query = author.length > 0 ? `${words} ${author}`.trim() : words;
    const url = `${SHADOW_PROXY_URL}/search?q=${encodeURIComponent(query)}&ext=epub&limit=${ANNA_PAGE_SIZE}&token=${encodeURIComponent(SHADOW_PROXY_TOKEN)}`;
    try {
      const response = await fetch(url, {
        cache: 'no-store',
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(25_000),
      });
      if (!response.ok) throw new SearchProblemError('NO ANSWER');
      const answer = (await response.json()) as ProxyAnswer;
      if (!answer.ok || !Array.isArray(answer.hits)) {
        throw new SearchProblemError('NO ANSWER');
      }
      const items = answer.hits.filter((hit) => /^[0-9a-f]{32}$/i.test(hit.md5)).map((hit) => toAnnaItem(hit, fetchedAt));
      return { items, next: null };
    } catch (error) {
      if (error instanceof SearchProblemError) throw error;
      throw new SearchProblemError('NO ANSWER');
    }
  },
  async fetchOne(): Promise<WebItem | null> {
    return null;
  },
};
