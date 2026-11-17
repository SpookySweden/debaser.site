import { KEEP } from '../../../lib/leaguebot/cache';
import { readPlayer, type PlayerSources } from '../../../lib/leaguebot/pick-source';
import { regionById } from '../../../lib/leaguebot/regions';
import { riotIdFrom, type RiotId } from '../../../lib/leaguebot/riot-id';
import { opggMatches, opggProfile } from '../../../lib/leaguebot/sources/opgg-mcp';
import { uggMatches, uggRanks, uggRefresh } from '../../../lib/leaguebot/sources/ugg';
import type { PlayerAnswer } from '../../../lib/leaguebot/types';
import { keeper, visitorOf, json } from '../../../lib/leaguebot/route-helpers';

/**
 * LEAGUEBOT's STATS tab (SPEC-leaguebot.md):
 *
 *   GET /api/leaguebot/player?region=EUW&name=Posty&tag=Herta[&refresh=1]  ->  PlayerAnswer
 *
 * A player's rank, LP history and last 100 ranked solo games, read live from OP.GG's app server and U.GG's site API (each
 * the other's fallback) and kept in this server's memory for ten minutes. Open to everyone, signed in or not (Luke's 2A).
 * Nothing is stored. `refresh=1` first asks U.GG to re-read the player's games from Riot, at most every two minutes per
 * Riot ID. Errors are plain words.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const SOURCES: PlayerSources = {
  opggProfile: (id, region) => opggProfile(id, region),
  uggRanks: (id, region) => uggRanks(id, region),
  uggMatches: (id, region, want) => uggMatches(id, region, want),
  opggMatches: (id, region) => opggMatches(id, region),
};

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const region = regionById(url.searchParams.get('region'));
  const id: RiotId | null = riotIdFrom(url.searchParams.get('name'), url.searchParams.get('tag'));
  if (region === null) return json(400, { error: 'Pick a server.' });
  if (id === null) return json(400, { error: 'That is not a Riot ID: write it as Name#TAG.' });

  const key = `player:${region.id}:${id.name.toLowerCase()}#${id.tag.toLowerCase()}`;
  let fresh = url.searchParams.get('refresh') === '1';
  let refreshRefused = false;
  if (fresh && !keeper.mayRefresh(key)) {
    fresh = false;
    refreshRefused = true;
  }
  if ((fresh || !keeper.has(key)) && !keeper.allow(visitorOf(request))) {
    return json(429, { error: 'Too many look-ups in a minute. Wait a moment and try again.' });
  }

  try {
    const answer = await keeper.get<PlayerAnswer>(
      key,
      KEEP.player,
      async () => {
        if (fresh) await uggRefresh(id, region).catch(() => false);
        const read = await readPlayer(id, region, SOURCES);
        // What U.GG said when it failed goes in the server's log (Vercel's runtime logs), never a Riot ID.
        if (read.uggTrouble !== null) console.warn(`[leaguebot] U.GG failed for the game list on ${region.id}: ${read.uggTrouble}`);
        return read;
      },
      fresh,
      // An answer that only says both sources broke is not kept: the next look-up asks again.
      (kept) => kept.notFound || kept.profile !== null || kept.matches !== null,
    );
    return json(200, refreshRefused ? { ...answer, notes: [...answer.notes, 'Refreshed less than two minutes ago: showing that answer.'] } : answer);
  } catch {
    return json(502, { error: "The stats sites didn't answer. Try again in a minute." });
  }
}
