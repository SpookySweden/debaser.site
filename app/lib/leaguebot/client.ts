/**
 * The window's door to LEAGUEBOT's routes (SPEC-leaguebot.md). On the mock site (`LEAGUEBOT_DATA_SOURCE` is mock) it answers
 * from recorded, renamed answers in `./fixtures/` instead, so the whole window can be built and proved with no network and
 * no live source. Browser-side; it never imports the server's fetching code.
 */

import { browserOpggHistory, browserOpggLive, browserOpggLpHistory } from './browser-opgg';
import { wantsBrowserLp, withBrowserHistory, withBrowserLive, withBrowserLp } from './fallback';
import { LEAGUEBOT_DATA_SOURCE } from './riot-id-store';
import type { RegionId } from './regions';
import type { RiotId } from './riot-id';
import type { LiveAnswer, MatchupGuide } from './live-types';
import type { MatchReview } from './review-types';
import type { PairAdvice } from './advice-notes';
import { STATS_GAMES, type ChampionGamesAnswer, type Lane, type PlayerAnswer } from './types';

export class LookupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LookupError';
  }
}

async function getAnswer<T>(path: string, query: Record<string, string>): Promise<T> {
  const params = new URLSearchParams(query);
  let response: Response;
  try {
    response = await fetch(`${path}?${params.toString()}`, { cache: 'no-store' });
  } catch {
    throw new LookupError("Couldn't reach the site. Check your connection.");
  }
  const body = (await response.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!response.ok || body === null) throw new LookupError(body?.error ?? 'Something went wrong. Try again in a minute.');
  return body;
}

export async function lookUpLive(id: RiotId, region: RegionId): Promise<LiveAnswer> {
  if (LEAGUEBOT_DATA_SOURCE === 'mock') {
    const { mockLive, mockBrowserLive } = await import('./fixtures/mock-answers');
    return withBrowserLive(await mockLive(id), () => mockBrowserLive(id));
  }
  const answer = await getAnswer<LiveAnswer>('/api/leaguebot/live', { region, name: id.name, tag: id.tag });
  return withBrowserLive(answer, () => browserOpggLive(id, region));
}

export async function lookUpMatchup(lane: Lane, mine: number, theirs: number): Promise<MatchupGuide> {
  if (LEAGUEBOT_DATA_SOURCE === 'mock') {
    const { mockMatchup } = await import('./fixtures/mock-answers');
    return mockMatchup(lane, mine, theirs);
  }
  return getAnswer<MatchupGuide>('/api/leaguebot/matchup', { lane, mine: String(mine), theirs: String(theirs) });
}

export async function lookUpReview(id: RiotId, region: RegionId, matchId: string, version: string): Promise<MatchReview> {
  if (LEAGUEBOT_DATA_SOURCE === 'mock') {
    const { mockReview } = await import('./fixtures/mock-answers');
    return mockReview(id, matchId);
  }
  return getAnswer<MatchReview>('/api/leaguebot/match', { region, name: id.name, tag: id.tag, match: matchId, version });
}

export async function lookUpPlayer(id: RiotId, region: RegionId, refresh = false): Promise<PlayerAnswer> {
  if (LEAGUEBOT_DATA_SOURCE === 'mock') {
    const { mockPlayer } = await import('./fixtures/mock-answers');
    return mockPlayer(id, region);
  }
  return getAnswer<PlayerAnswer>('/api/leaguebot/player', { region, name: id.name, tag: id.tag, ...(refresh ? { refresh: '1' } : {}) });
}

/**
 * One player's recent games on one champion (the CHAMPION panel). When U.GG turns the server away, this browser reads the
 * player's last 60 ranked solo games from OP.GG itself and keeps that champion's: fewer, and solo queue only, so it says so.
 */
export async function lookUpChampionGames(id: RiotId, region: RegionId, championId: number): Promise<ChampionGamesAnswer> {
  if (LEAGUEBOT_DATA_SOURCE === 'mock') {
    const { mockChampionGames } = await import('./fixtures/mock-answers');
    return mockChampionGames(id, championId);
  }
  const answer = await getAnswer<ChampionGamesAnswer>('/api/leaguebot/champion', { region, name: id.name, tag: id.tag, champion: String(championId) });
  if (answer.matches !== null) return answer;
  try {
    const games = (await browserOpggHistory(id, region, 60)).filter((m) => m.championId === championId);
    return { matches: games, source: 'OP.GG', notes: [`U.GG didn't answer: their ranked solo games on it from OP.GG's last 60 instead.`], uggTrouble: answer.uggTrouble };
  } catch {
    return { ...answer, notes: ["Neither U.GG nor OP.GG answered for this player's games."] };
  }
}

/** The Claude-written notes for your champion and the picked one, by Data Dragon's aliases. */
export async function lookUpAdvice(mine: string, theirs: string, side: PairAdvice['side']): Promise<PairAdvice> {
  if (LEAGUEBOT_DATA_SOURCE === 'mock') {
    const { mockAdvice } = await import('./fixtures/mock-answers');
    return mockAdvice(mine, theirs, side);
  }
  return getAnswer<PairAdvice>('/api/leaguebot/advice', { mine, theirs, side });
}

/** True when the window should fill the game list out from the browser (U.GG turned the server away). */
export function wantsBrowserHistory(answer: PlayerAnswer): boolean {
  return !answer.notFound && answer.uggTrouble !== null && (answer.matches?.length ?? 0) < STATS_GAMES;
}

/** True when the window should fill anything in from this browser: the game list, or LP over time. */
export function wantsBrowserFill(answer: PlayerAnswer): boolean {
  return wantsBrowserHistory(answer) || wantsBrowserLp(answer);
}

/**
 * The game list filled out to 100, and LP over time filled from OP.GG's point a day, by this browser. The window shows the
 * server's answer first and swaps this in when it arrives (five pages of games take several seconds).
 */
export async function fillHistory(answer: PlayerAnswer, id: RiotId, region: RegionId): Promise<PlayerAnswer> {
  if (LEAGUEBOT_DATA_SOURCE === 'mock') {
    const { mockBrowserHistory, mockBrowserLp } = await import('./fixtures/mock-answers');
    const games = wantsBrowserHistory(answer) ? await withBrowserHistory(answer, () => mockBrowserHistory(id)) : answer;
    return withBrowserLp(games, () => mockBrowserLp(id));
  }
  const games = wantsBrowserHistory(answer) ? await withBrowserHistory(answer, () => browserOpggHistory(id, region)) : answer;
  return withBrowserLp(games, () => browserOpggLpHistory(id, region));
}
