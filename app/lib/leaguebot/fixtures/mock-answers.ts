/**
 * The mock site's LEAGUEBOT answers (SPEC-leaguebot.md): one real player's recorded answers from U.GG and OP.GG
 * (2026-11-17), every Riot ID renamed (`MOCK PLAYER#EUW`, `PLAYER 1#EUW`, ...). Any Riot ID gets them, except a name
 * starting `nobody`, which is "not found", and `broken`, which is a source failure, so every state of the window can be seen.
 */

import type { RegionId } from '../regions';
import type { RiotId } from '../riot-id';
import type { LiveAnswer, LiveGame, MatchupGuide } from '../live-types';
import type { MatchReview } from '../review-types';
import type { Lane, MatchSummary, PlayerAnswer, Profile } from '../types';
import liveGame from './live-game.json';
import matchReview from './match-review.json';
import matchupGuide from './matchup-guide.json';
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

/** A recorded ranked game in progress (renamed); `MOCK PLAYER` is in it. A name starting `idle` is not in a game. */
export async function mockLive(id: RiotId): Promise<LiveAnswer> {
  await new Promise((resolve) => setTimeout(resolve, 250));
  if (id.name.toLowerCase().startsWith('idle')) return { game: null, source: 'U.GG', notes: [] };
  const game = liveGame as LiveGame;
  const me = game.players.find((p) => p.name === 'MOCK PLAYER');
  // The looked-up player stands in MOCK PLAYER's place, so the window finds them in the game.
  const players = game.players.map((p) => (p === me ? { ...p, name: id.name, tag: id.tag } : p));
  return { game: { ...game, players, fetchedAt: Date.now() }, source: 'U.GG', notes: [] };
}

/** A real OP.GG guide (Lee Sin against Ambessa in the jungle), answered for any matchup on the mock site. */
export async function mockMatchup(lane: Lane, mine: number, theirs: number): Promise<MatchupGuide> {
  await new Promise((resolve) => setTimeout(resolve, 200));
  return { ...(matchupGuide as MatchupGuide), lane, myChampionId: mine, opponentChampionId: theirs };
}

/** A recorded game in full (renamed), opened for any game on the mock site. */
export async function mockReview(id: RiotId, matchId: string): Promise<MatchReview> {
  await new Promise((resolve) => setTimeout(resolve, 250));
  const review = matchReview as MatchReview;
  const swap = <T extends { name: string; tag: string }>(p: T): T => (p.name === 'MOCK PLAYER' ? { ...p, name: id.name, tag: id.tag } : p);
  return { ...review, id: matchId, me: swap(review.me), players: review.players.map(swap) };
}

export async function mockPlayer(id: RiotId, region: RegionId): Promise<PlayerAnswer> {
  await new Promise((resolve) => setTimeout(resolve, 250));
  const name = id.name.toLowerCase();
  if (name.startsWith('nobody')) return { profile: null, profileSource: null, matches: null, matchesSource: null, notFound: true, notes: [] };
  if (name.startsWith('broken')) {
    return { profile: null, profileSource: null, matches: MOCK_MATCHES.slice(0, 20), matchesSource: 'OP.GG', notFound: false, notes: ["Neither OP.GG nor U.GG answered for the rank.", "U.GG didn't answer: the last 20 games from OP.GG instead of 100."] };
  }
  return { profile: { riotId: id, region, ...MOCK_PROFILE }, profileSource: 'OP.GG', matches: MOCK_MATCHES, matchesSource: 'U.GG', notFound: false, notes: [] };
}
