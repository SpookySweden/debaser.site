/**
 * The browser's own look-ups at OP.GG's site API (SPEC-leaguebot.md; the coordinator's U.GG finding, 2026-11-17): when U.GG
 * turns LEAGUEBOT's server away, the visitor's browser reads the player's last 100 ranked games, or their live game, from
 * OP.GG directly over its own connection. OP.GG answers any browser (CORS `*`). Browser-side: no server fetching code here,
 * only the pure shaping in `./opgg-site.ts`. Addresses are built from a checked Riot ID, a known server and OP.GG's own
 * summoner id; nothing about the player is stored.
 */

import type { LiveGame } from './live-types';
import { isOpggSummonerId, OPGG_SITE_HOST, opggGamesUrl, opggSpectateUrl, opggSummonerUrl, summonerIdOf, toOpggLive, toOpggSiteMatches } from './opgg-site';
import { regionById, type Region, type RegionId } from './regions';
import type { RiotId } from './riot-id';
import { STATS_GAMES, type MatchSummary } from './types';

class BrowserFetchError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'BrowserFetchError';
  }
}

async function getJson(url: string): Promise<unknown> {
  if (new URL(url).hostname !== OPGG_SITE_HOST) throw new BrowserFetchError('host not allowed');
  const response = await fetch(url, { credentials: 'omit', headers: { accept: 'application/json' }, signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new BrowserFetchError(`HTTP ${response.status}`, response.status);
  return response.json();
}

async function summonerId(region: Region, id: RiotId): Promise<string> {
  const found = summonerIdOf(await getJson(opggSummonerUrl(region, id)));
  if (found === null || !isOpggSummonerId(found)) throw new BrowserFetchError('not found');
  return found;
}

/** The player's last `want` ranked solo games from OP.GG, newest first, read 20 at a time. */
export async function browserOpggHistory(id: RiotId, regionId: RegionId, want = STATS_GAMES): Promise<MatchSummary[]> {
  const region = regionById(regionId);
  if (region === null) throw new BrowserFetchError('unknown server');
  const sid = await summonerId(region, id);
  const out: MatchSummary[] = [];
  let endedAt: string | undefined;
  for (let page = 0; page < Math.ceil(want / 20) + 1 && out.length < want; page += 1) {
    const answer = (await getJson(opggGamesUrl(region, sid, endedAt))) as { data?: { created_at?: unknown }[] };
    const rows = Array.isArray(answer.data) ? answer.data : [];
    out.push(...toOpggSiteMatches(answer, id));
    const last = rows[rows.length - 1]?.created_at;
    if (rows.length < 20 || typeof last !== 'string') break;
    endedAt = last;
  }
  // Pages can overlap by a game at their edge: one of each, newest first.
  const seen = new Set<string>();
  return out
    .filter((m) => (seen.has(m.id) ? false : (seen.add(m.id), true)))
    .sort((a, b) => b.at - a.at)
    .slice(0, want);
}

/** The player's live game from OP.GG, or null when they aren't in one. */
export async function browserOpggLive(id: RiotId, regionId: RegionId): Promise<LiveGame | null> {
  const region = regionById(regionId);
  if (region === null) throw new BrowserFetchError('unknown server');
  const sid = await summonerId(region, id);
  try {
    return toOpggLive((await getJson(opggSpectateUrl(region, sid))) as Record<string, unknown>, Date.now());
  } catch (error) {
    // OP.GG answers 404 when the player isn't in a game.
    if (error instanceof BrowserFetchError && error.status === 404) return null;
    throw error;
  }
}
