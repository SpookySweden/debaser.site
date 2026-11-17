import { KEEP } from '../../../lib/leaguebot/cache';
import { regionById } from '../../../lib/leaguebot/regions';
import type { MatchReview } from '../../../lib/leaguebot/review-types';
import { riotIdFrom } from '../../../lib/leaguebot/riot-id';
import { json, keeper, visitorOf } from '../../../lib/leaguebot/route-helpers';
import { uggReview } from '../../../lib/leaguebot/sources/review';

/**
 * LEAGUEBOT's REVIEW tab (SPEC-leaguebot.md, phase 3):
 *
 *   GET /api/leaguebot/match?region=EUW&name=Posty&tag=Herta&match=8048667571&version=16_22  ->  MatchReview
 *
 * One finished game from U.GG, minute by minute against the lane opponent. A finished game never changes, so it is kept a
 * day. Nothing is stored.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 20;

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const region = regionById(url.searchParams.get('region'));
  const id = riotIdFrom(url.searchParams.get('name'), url.searchParams.get('tag'));
  const match = url.searchParams.get('match') ?? '';
  const version = url.searchParams.get('version') ?? '';
  if (region === null || id === null || !/^\d{1,20}$/.test(match) || !/^\d{1,2}_\d{1,2}$/.test(version)) return json(400, { error: 'That game is not one LEAGUEBOT can open.' });

  const key = `match:${region.id}:${match}:${id.name.toLowerCase()}#${id.tag.toLowerCase()}`;
  if (!keeper.has(key) && !keeper.allow(visitorOf(request))) return json(429, { error: 'Too many look-ups in a minute. Wait a moment and try again.' });
  try {
    const review = await keeper.get<MatchReview | null>(key, KEEP.match, () => uggReview(id, region, match, version));
    if (review === null) return json(404, { error: "U.GG doesn't have this game's details yet. Try again in a few minutes." });
    return json(200, review);
  } catch {
    return json(502, { error: "U.GG didn't answer, and only U.GG has the minute-by-minute detail. Try again in a minute." });
  }
}
