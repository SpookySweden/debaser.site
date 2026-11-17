import { KEEP } from '../../../lib/leaguebot/cache';
import type { LiveAnswer } from '../../../lib/leaguebot/live-types';
import { readLive } from '../../../lib/leaguebot/pick-source';
import { regionById } from '../../../lib/leaguebot/regions';
import { riotIdFrom } from '../../../lib/leaguebot/riot-id';
import { json, keeper, visitorOf } from '../../../lib/leaguebot/route-helpers';
import { opggLive, uggLive } from '../../../lib/leaguebot/sources/live';

/**
 * LEAGUEBOT's LIVE tab (SPEC-leaguebot.md, phase 2):
 *
 *   GET /api/leaguebot/live?region=EUW&name=Posty&tag=Herta  ->  LiveAnswer
 *
 * Whether the player is in a game that has loaded, and if so its ten players as the loading screen shows them, from U.GG
 * (OP.GG's site as the fallback). Kept in memory for a minute: the window asks once a minute while LIVE is open. Nothing
 * from inside the match exists here, and nothing is stored.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 20;

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const region = regionById(url.searchParams.get('region'));
  const id = riotIdFrom(url.searchParams.get('name'), url.searchParams.get('tag'));
  if (region === null) return json(400, { error: 'Pick a server.' });
  if (id === null) return json(400, { error: 'That is not a Riot ID: write it as Name#TAG.' });

  const key = `live:${region.id}:${id.name.toLowerCase()}#${id.tag.toLowerCase()}`;
  if (!keeper.has(key) && !keeper.allow(visitorOf(request))) {
    return json(429, { error: 'Too many look-ups in a minute. Wait a moment and try again.' });
  }
  try {
    const answer = await keeper.get<LiveAnswer>(key, KEEP.live, () => readLive(id, region, { uggLive: (i, r) => uggLive(i, r), opggLive: (i, r) => opggLive(i, r) }));
    return json(200, answer);
  } catch {
    return json(502, { error: "The stats sites didn't answer. Try again in a minute." });
  }
}
