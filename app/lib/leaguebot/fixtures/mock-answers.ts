/**
 * The mock site's LEAGUEBOT answers (SPEC-leaguebot.md): one real player's recorded answers from U.GG and OP.GG
 * (2026-11-17), every Riot ID renamed (`MOCK PLAYER#EUW`, `PLAYER 1#EUW`, ...). Any Riot ID gets them, except a name
 * starting `nobody`, which is "not found", `blocked`, which is U.GG turning the server away (the browser's OP.GG look-up then
 * fills in), `fresh`, with no LP history anywhere, and `broken`, where everything fails, so every state of the window can be seen.
 */

import type { RegionId } from '../regions';
import type { RiotId } from '../riot-id';
import type { LiveAnswer, LiveGame, MatchupGuide } from '../live-types';
import type { MatchReview } from '../review-types';
import type { ChampionGamesAnswer, Lane, LpPoint, MatchSummary, PlayerAnswer, Profile } from '../types';
import type { CcNote, NoteLine, PairAdvice } from '../advice-notes';
import liveGame from './live-game.json';
import lpOpgg from './lp-opgg.json';
import lpUgg from './lp-ugg.json';
import matchReview from './match-review.json';
import matchupGuide from './matchup-guide.json';
import matches from './player-matches.json';

/** OP.GG's app server's few LP points (what the server had before U.GG's snapshots, 2026-11-17). */
const OPGG_APP_LP: LpPoint[] = [
  { at: '2026-11-06T15:11:38.000Z', tier: 'MASTER', division: 1, lp: 1260 },
  { at: '2026-11-09T18:31:48.000Z', tier: 'MASTER', division: 1, lp: 1305 },
  { at: '2026-11-12T21:41:42.000Z', tier: 'MASTER', division: 1, lp: 1455 },
  { at: '2026-11-16T16:01:46.000Z', tier: 'MASTER', division: 1, lp: 1815 },
];

/** The server's answer when U.GG answers: its rank snapshot after every game (recorded, 101 of them). */
export const MOCK_PROFILE: Omit<Profile, 'riotId' | 'region'> = {
  level: 619,
  iconId: 6621,
  ranks: [{ queue: 'SOLO', tier: 'GRANDMASTER', division: 1, lp: 1837, wins: 1149, losses: 1084, hotStreak: true }],
  lpHistory: lpUgg as LpPoint[],
  lpFrom: 'U.GG',
  pastSeasons: [
    { season: 31, tier: 'MASTER', division: 1, lp: 471 },
    { season: 29, tier: 'EMERALD', division: 1, lp: 14 },
    { season: 27, tier: 'DIAMOND', division: 4, lp: 88 },
    { season: 25, tier: 'EMERALD', division: 3, lp: 0 },
  ],
};

export const MOCK_MATCHES = matches as MatchSummary[];

/** The recorded game with the looked-up player standing in MOCK PLAYER's place, so the window finds them in it. */
function mockGame(id: RiotId): LiveGame {
  const game = liveGame as LiveGame;
  const me = game.players.find((p) => p.name === 'MOCK PLAYER');
  const players = game.players.map((p) => (p === me ? { ...p, name: id.name, tag: id.tag } : p));
  return { ...game, players, fetchedAt: Date.now() };
}

/**
 * A recorded ranked game in progress (renamed). A name starting `idle` is not in a game; `blocked` is U.GG turning the
 * server away, as on the live site (2026-11-17), so the browser's own OP.GG look-up takes over (`mockBrowserLive`).
 */
export async function mockLive(id: RiotId): Promise<LiveAnswer> {
  await new Promise((resolve) => setTimeout(resolve, 250));
  const name = id.name.toLowerCase();
  if (name.startsWith('idle')) return { game: null, source: 'U.GG', notes: [], uggTrouble: null };
  if (name.startsWith('blocked')) return { game: null, source: 'OP.GG', notes: [], uggTrouble: 'HTTP 403' };
  return { game: mockGame(id), source: 'U.GG', notes: [], uggTrouble: null };
}

/** The browser's own OP.GG look-ups on the mock site: `blocked` answers (the games, the live game); `broken` fails too. */
export async function mockBrowserHistory(id: RiotId): Promise<MatchSummary[]> {
  await new Promise((resolve) => setTimeout(resolve, 250));
  if (id.name.toLowerCase().startsWith('broken')) throw new Error('OP.GG did not answer');
  return MOCK_MATCHES;
}

/** OP.GG's point a day of LP (recorded, 11 days) as the browser reads it; `fresh` has none, `broken` fails. */
export async function mockBrowserLp(id: RiotId): Promise<LpPoint[]> {
  await new Promise((resolve) => setTimeout(resolve, 150));
  const name = id.name.toLowerCase();
  if (name.startsWith('broken')) throw new Error('OP.GG did not answer');
  return name.startsWith('fresh') ? [] : (lpOpgg as LpPoint[]);
}

export async function mockBrowserLive(id: RiotId): Promise<LiveGame | null> {
  await new Promise((resolve) => setTimeout(resolve, 250));
  if (id.name.toLowerCase().startsWith('broken')) throw new Error('OP.GG did not answer');
  const game = mockGame(id);
  // OP.GG's spectate answer carries no roles or duos.
  return { ...game, players: game.players.map((p) => ({ ...p, onRole: null, lanes: [], party: null })) };
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
  if (name.startsWith('nobody')) return { profile: null, profileSource: null, matches: null, matchesSource: null, notFound: true, notes: [], uggTrouble: null };
  const twenty = "Only your last 20 games: U.GG isn't answering LEAGUEBOT's server right now.";
  if (name.startsWith('broken')) {
    return { profile: null, profileSource: null, matches: MOCK_MATCHES.slice(0, 20), matchesSource: 'OP.GG', notFound: false, notes: ['Neither OP.GG nor U.GG answered for the rank.', twenty], uggTrouble: 'timed out' };
  }
  if (name.startsWith('blocked')) {
    // As the live site answered on 2026-11-17: U.GG turns the server away; OP.GG's app server gives 20.
    return { profile: { riotId: id, region, ...MOCK_PROFILE, lpHistory: OPGG_APP_LP, lpFrom: 'OP.GG' }, profileSource: 'OP.GG', matches: MOCK_MATCHES.slice(0, 20), matchesSource: 'OP.GG', notFound: false, notes: [twenty], uggTrouble: 'HTTP 403' };
  }
  if (name.startsWith('fresh')) {
    // A player nobody has kept LP for yet: the chart's empty state.
    return { profile: { riotId: id, region, ...MOCK_PROFILE, lpHistory: [], lpFrom: null }, profileSource: 'OP.GG', matches: MOCK_MATCHES, matchesSource: 'U.GG', notFound: false, notes: [], uggTrouble: null };
  }
  return { profile: { riotId: id, region, ...MOCK_PROFILE }, profileSource: 'OP.GG', matches: MOCK_MATCHES, matchesSource: 'U.GG', notFound: false, notes: [], uggTrouble: null };
}

/**
 * A player's games on one champion on the mock site: the recorded games relabelled, a different slice per player so the
 * numbers differ. A name ending `3` has only three games (the "read loosely" line), one ending `7` none (the empty state).
 */
export async function mockChampionGames(id: RiotId, championId: number): Promise<ChampionGamesAnswer> {
  await new Promise((resolve) => setTimeout(resolve, 250));
  const name = id.name.toLowerCase();
  const offset = [...name].reduce((sum, ch) => sum + ch.charCodeAt(0), 0) % 60;
  const want = name.endsWith('7') ? 0 : name.endsWith('3') ? 3 : 20;
  const games = MOCK_MATCHES.slice(offset, offset + want).map((m) => ({ ...m, championId, players: [] }));
  return { matches: games, source: 'U.GG', notes: [], uggTrouble: null };
}

/**
 * The Claude-written notes on the mock site: plainly marked samples (the real ones live in a folder on SERVER). The
 * mock player's own champion has a note against or with everyone; a picked champion whose alias starts with `Z` has no
 * file yet (the "not written yet" state).
 */
export async function mockAdvice(mine: string, theirs: string, side: PairAdvice['side']): Promise<PairAdvice> {
  await new Promise((resolve) => setTimeout(resolve, 150));
  if (theirs.startsWith('Z')) return { side, lines: null, cc: null, model: null, patch: null, deep: false };
  const cc: CcNote[] = [
    { key: 'Q', type: 'slow', dodge: `Sample dodge line for ${theirs}'s Q on the mock site: step out of the line it is aimed along.` },
    { key: 'E', type: 'stun', dodge: `Sample dodge line for ${theirs}'s E: keep a minion between you, it stops on the first one hit.` },
  ];
  if (side === 'self') return { side, lines: null, cc, model: 'claude-opus-5-5', patch: '16.22.1', deep: true };
  const lines: NoteLine[] =
    side === 'with'
      ? [
          { mark: '+', text: `Sample note on the mock site: how ${mine} and ${theirs} work together shows here.` },
          { mark: '>', text: 'A second sample line: when to group, and who starts the fight.' },
        ]
      : [
          { mark: '!', text: `Sample note on the mock site: what ${theirs} threatens against ${mine} shows here.` },
          { mark: '+', text: 'A second sample line: the window where you are stronger.' },
          { mark: '>', text: 'A third sample line: one thing to try in this matchup.' },
        ];
  return { side, lines, cc, model: 'claude-opus-5-5', patch: '16.22.1', deep: side === 'against' };
}
