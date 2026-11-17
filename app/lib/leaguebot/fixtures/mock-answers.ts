/**
 * The mock site's LEAGUEBOT answers (SPEC-leaguebot.md): one real player's recorded answers from U.GG and OP.GG
 * (2026-11-17), every Riot ID renamed (`MOCK PLAYER#EUW`, `PLAYER 1#EUW`, ...). Any Riot ID gets them, except a name
 * starting `nobody`, which is "not found", and `broken`, which is a source failure, so every state of the window can be seen.
 */

import type { RegionId } from '../regions';
import type { RiotId } from '../riot-id';
import type { MatchSummary, PlayerAnswer, Profile } from '../types';
import matches from './player-matches.json';

export const MOCK_PROFILE: Omit<Profile, 'riotId' | 'region'> = {
  level: 619,
  iconId: 6621,
  ranks: [{ queue: 'SOLO', tier: 'GRANDMASTER', division: 1, lp: 1837, wins: 1149, losses: 1084, hotStreak: true }],
  lpHistory: [
    { at: '2026-11-06T15:11:38.000Z', tier: 'MASTER', division: 1, lp: 1260 },
    { at: '2026-11-09T18:31:48.000Z', tier: 'MASTER', division: 1, lp: 1305 },
    { at: '2026-11-12T21:41:42.000Z', tier: 'MASTER', division: 1, lp: 1455 },
    { at: '2026-11-16T16:01:46.000Z', tier: 'MASTER', division: 1, lp: 1815 },
  ],
  pastSeasons: [
    { season: 31, tier: 'MASTER', division: 1, lp: 471 },
    { season: 29, tier: 'EMERALD', division: 1, lp: 14 },
    { season: 27, tier: 'DIAMOND', division: 4, lp: 88 },
    { season: 25, tier: 'EMERALD', division: 3, lp: 0 },
  ],
};

export const MOCK_MATCHES = matches as MatchSummary[];

export async function mockPlayer(id: RiotId, region: RegionId): Promise<PlayerAnswer> {
  await new Promise((resolve) => setTimeout(resolve, 250));
  const name = id.name.toLowerCase();
  if (name.startsWith('nobody')) return { profile: null, profileSource: null, matches: null, matchesSource: null, notFound: true, notes: [] };
  if (name.startsWith('broken')) {
    return { profile: null, profileSource: null, matches: MOCK_MATCHES.slice(0, 20), matchesSource: 'OP.GG', notFound: false, notes: ["Neither OP.GG nor U.GG answered for the rank.", "U.GG didn't answer: the last 20 games from OP.GG instead of 100."] };
  }
  return { profile: { riotId: id, region, ...MOCK_PROFILE }, profileSource: 'OP.GG', matches: MOCK_MATCHES, matchesSource: 'U.GG', notFound: false, notes: [] };
}
