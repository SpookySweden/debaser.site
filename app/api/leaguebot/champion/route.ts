import { KEEP } from '../../../lib/leaguebot/cache';
import { CHAMPION_GAMES } from '../../../lib/leaguebot/player-champ';
import { troubleOf } from '../../../lib/leaguebot/pick-source';
import { regionById } from '../../../lib/leaguebot/regions';
import { riotIdFrom } from '../../../lib/leaguebot/riot-id';
import { json, keeper, visitorOf } from '../../../lib/leaguebot/route-helpers';
import { uggChampionMatches } from '../../../lib/leaguebot/sources/ugg';
import type { ChampionGamesAnswer } from '../../../lib/leaguebot/types';

/**
 * LEAGUEBOT's CHAMPION panel (SPEC-leaguebot-live-champs.md): one player's recent games on one champion.
 *
 *   GET /api/leaguebot/champion?region=EUW&name=Posty&tag=Herta&champion=28  ->  ChampionGamesAnswer
 *
 * Their last 20 Summoner's Rift games on it from U.GG, which filters by champion itself. When U.GG turns the server away,
 * the answer says why and the window reads OP.GG from the visitor's own browser instead. Asked only when someone picks that
 * player, kept 10 minutes, stored nowhere.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 20;

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const region = regionById(url.searchParams.get('region'));
  const id = riotIdFrom(url.searchParams.get('name'), url.searchParams.get('tag'));
  const raw = url.searchParams.get('champion');
  const championId = raw !== null && /^\d{1,4}$/.test(raw) ? Number(raw) : null;
  if (region === null) return json(400, { error: 'Pick a server.' });
  if (id === null) return json(400, { error: 'That is not a Riot ID: write it as Name#TAG.' });
  if (championId === null) return json(400, { error: 'That is not a champion LEAGUEBOT knows.' });

  const key = `champion:${region.id}:${id.name.toLowerCase()}#${id.tag.toLowerCase()}:${championId}`;
  if (!keeper.has(key) && !keeper.allow(visitorOf(request))) return json(429, { error: 'Too many look-ups in a minute. Wait a moment and try again.' });
  try {
    const answer = await keeper.get<ChampionGamesAnswer>(
      key,
      KEEP.player,
      async () => {
        try {
          const matches = await uggChampionMatches(id, region, championId, CHAMPION_GAMES);
          // The ten players of each game aren't needed here: they'd only make the answer bigger.
          return { matches: matches.map((m) => ({ ...m, players: [] })), source: 'U.GG', notes: [], uggTrouble: null };
        } catch (error) {
          const trouble = troubleOf(error);
          console.warn(`[leaguebot] U.GG failed for a champion's games on ${region.id}: ${trouble}`);
          return { matches: null, source: null, notes: [], uggTrouble: trouble };
        }
      },
      false,
      // A U.GG failure is not kept: the next pick asks again.
      (kept) => kept.uggTrouble === null,
    );
    return json(200, answer);
  } catch {
    return json(502, { error: "U.GG didn't answer. Try again in a minute." });
  }
}
