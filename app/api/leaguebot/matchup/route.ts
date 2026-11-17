import { KEEP } from '../../../lib/leaguebot/cache';
import type { MatchupGuide } from '../../../lib/leaguebot/live-types';
import { json, keeper, visitorOf } from '../../../lib/leaguebot/route-helpers';
import { opggChampionWords, opggMatchup } from '../../../lib/leaguebot/sources/opgg-mcp';
import { LANES, type Lane } from '../../../lib/leaguebot/types';

/**
 * A lane matchup guide for the LIVE tab (SPEC-leaguebot.md, phase 2):
 *
 *   GET /api/leaguebot/matchup?lane=MID&mine=103&theirs=517  ->  MatchupGuide
 *
 * From OP.GG's public app server: a tip for the matchup, who is favoured, how to play it, and the build, runes and skill
 * order most played. Champions by Riot's number. Kept six hours; it doesn't depend on who asks.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 20;

const champion = (value: string | null): number | null => (value !== null && /^\d{1,4}$/.test(value) ? Number(value) : null);

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const lane = url.searchParams.get('lane') as Lane | null;
  const mine = champion(url.searchParams.get('mine'));
  const theirs = champion(url.searchParams.get('theirs'));
  if (lane === null || !LANES.includes(lane) || mine === null || theirs === null) return json(400, { error: 'That matchup is not one LEAGUEBOT can read.' });

  const key = `guide:${lane}:${mine}:${theirs}`;
  if (!keeper.has(key) && !keeper.allow(visitorOf(request))) return json(429, { error: 'Too many look-ups in a minute. Wait a moment and try again.' });
  try {
    const guide = await keeper.get<MatchupGuide>(key, KEEP.guide, async () => {
      const words = await keeper.get('opgg:champion-words', KEEP.match, () => opggChampionWords());
      const a = words.get(mine);
      const b = words.get(theirs);
      if (!a || !b) throw new Error('unknown champion');
      return opggMatchup(lane, a, b, mine, theirs);
    });
    return json(200, guide);
  } catch {
    return json(502, { error: "OP.GG has no guide for this matchup right now." });
  }
}
