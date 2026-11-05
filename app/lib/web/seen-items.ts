import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { FETCH_ONE_PROVIDERS } from './search/index';
import type { SearchDeps } from './search/types';
import type { SeenItem } from './tagging';
import type { WebItem, WebPlatform } from './types';
import { isSafeIdentifier } from './urls';

/**
 * Search results that get Claude's words without being saved (Luke, 2026-11-05; SPEC-tag-station.md). SERVER ONLY.
 *
 * The rule that makes this safe, the one `web_request_add` already follows: nobody can feed text into a paid batch. All that goes
 * into the table is a platform and an id. The tagging job then reads the title and description from that platform's own API.
 * Not who saw it, and not what they searched for: a person's count of names today is kept apart, with nothing about which.
 */

/** What the table takes. A media server's title has `media`, and friends' lists aren't sent to Claude. */
const SEEN_PLATFORMS: readonly WebPlatform[] = ['internet_archive', 'youtube', 'peertube', 'wikimedia_commons', 'openverse', 'vimeo', 'kino'];
/** The most `web_seen_add` takes in one call. */
const MAX_NAMES = 100;
/** Names already sent from this server instance, so the same search asked twice doesn't cost a person's allowance twice. */
const MAX_REMEMBERED = 20_000;
const noted = new Set<string>();

/** The names a page of results comes to, by platform. Pure. */
export function namesToNote(items: readonly WebItem[]): Map<WebPlatform, string[]> {
  const names = new Map<WebPlatform, string[]>();
  for (const item of items) {
    if (item.media !== undefined || !SEEN_PLATFORMS.includes(item.platform) || !isSafeIdentifier(item.externalId)) continue;
    const list = names.get(item.platform) ?? [];
    if (list.length < MAX_NAMES) list.push(item.externalId);
    names.set(item.platform, list);
  }
  return names;
}

function clientFor(token: string): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';
  if (!url || !key || process.env.NEXT_PUBLIC_WEB_DATA_SOURCE !== 'supabase') return null;
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false }, global: { headers: { Authorization: `Bearer ${token}` } } });
}

/**
 * Names what a search just returned, with the reader's own session, which the route has already checked. Never throws and never
 * logs: being seen is never worth a visible error. On the mock accounts there is no session and no table, so it does nothing.
 * `client` is for checks.
 */
export async function noteSeen(request: Request, items: readonly WebItem[], client?: Pick<SupabaseClient, 'rpc'> | null): Promise<void> {
  try {
    const header = request.headers.get('authorization') ?? '';
    const token = header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : '';
    const db = client !== undefined ? client : token.length > 0 ? clientFor(token) : null;
    if (db === null) return;
    const fresh = items.filter((item) => !noted.has(item.id));
    const names = namesToNote(fresh);
    if (names.size === 0) return;
    if (noted.size > MAX_REMEMBERED) noted.clear();
    for (const item of fresh) noted.add(item.id);
    await Promise.all([...names].map(([platform, ids]) => db.rpc('web_seen_add', { p_platform: platform, p_external_ids: ids })));
  } catch {
    // Not tagged this time; the next person to see it names it again.
  }
}

/** How long a run spends reading, so the batch still goes out inside the route's minute. */
const READ_BUDGET_MS = 30_000;
const READ_AT_ONCE = 8;

/**
 * What each platform says about the waiting names, through each platform's own one-item API. Some at a time, stopping when the time
 * is up: the rest wait for the next run. A platform with nothing to say counts against the name; one that didn't answer doesn't.
 */
export async function readSeenItems(
  names: readonly { id: string; platform: string; external_id: string }[],
  deps: Pick<SearchDeps, 'fetch' | 'env'>,
  now: () => number = Date.now,
): Promise<{ items: SeenItem[]; unreadable: string[] }> {
  const items: SeenItem[] = [];
  const unreadable: string[] = [];
  const deadline = now() + READ_BUDGET_MS;
  let next = 0;
  const worker = async () => {
    while (next < names.length && now() < deadline) {
      const name = names[next];
      next += 1;
      const provider = Object.hasOwn(FETCH_ONE_PROVIDERS, name.platform) ? FETCH_ONE_PROVIDERS[name.platform as WebPlatform] : undefined;
      if (provider === undefined || !isSafeIdentifier(name.external_id)) {
        unreadable.push(name.id);
        continue;
      }
      try {
        const item = await provider.fetchOne(name.external_id, deps);
        if (item === null || item.externalId !== name.external_id || item.title.length === 0) {
          unreadable.push(name.id);
          continue;
        }
        const published = Date.parse(item.publishedAt);
        items.push({
          id: name.id,
          kind: item.kind,
          title: item.title,
          creator: item.creator ?? null,
          description: item.description ?? null,
          tags: item.tags ?? null,
          publishedAt: Number.isFinite(published) ? new Date(published).toISOString() : null,
        });
      } catch {
        // No answer this time: tried again next run, with no mark against it.
      }
    }
  };
  await Promise.all(Array.from({ length: READ_AT_ONCE }, worker));
  return { items, unreadable };
}
