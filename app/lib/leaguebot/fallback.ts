/**
 * When U.GG turns LEAGUEBOT's server away (the live site, 2026-11-17), the window fills in from the visitor's own browser
 * (SPEC-leaguebot.md): the game list out to 100 from OP.GG's site, and the live game from OP.GG directly. These two decide
 * when to ask and how the answers combine. Pure, apart from the look-up they are handed, so a check can drive them.
 */

import type { LiveAnswer, LiveGame } from './live-types';
import { STATS_GAMES, type LpPoint, type MatchSummary, type PlayerAnswer } from './types';

/** The server's "only 20 games" line starts so; it goes once the browser has the rest. */
export const ONLY_SOME_GAMES = 'Only your last ';

/** The game list, filled out from the browser when the server said U.GG failed and it got fewer than 100 games. */
export async function withBrowserHistory(answer: PlayerAnswer, history: () => Promise<MatchSummary[]>): Promise<PlayerAnswer> {
  const have = answer.matches?.length ?? 0;
  if (answer.notFound || answer.uggTrouble === null || have >= STATS_GAMES) return answer;
  try {
    const games = await history();
    if (games.length <= have) return answer;
    return { ...answer, matches: games, matchesSource: 'OP.GG', notes: answer.notes.filter((note) => !note.startsWith(ONLY_SOME_GAMES)) };
  } catch {
    // The server's 20 (or nothing) stands, with its note.
    return answer;
  }
}

/** Fewer LP points than this from the server, and the browser asks OP.GG for its point a day. */
export const LP_POINTS_WANTED = 5;

export function wantsBrowserLp(answer: PlayerAnswer): boolean {
  return answer.profile !== null && answer.profile.lpHistory.length < LP_POINTS_WANTED;
}

/** LP over time, filled from OP.GG's point a day when the server had few or none (U.GG turned it away, or nobody had any). */
export async function withBrowserLp(answer: PlayerAnswer, lp: () => Promise<LpPoint[]>): Promise<PlayerAnswer> {
  if (!wantsBrowserLp(answer) || answer.profile === null) return answer;
  try {
    const points = await lp();
    if (points.length <= answer.profile.lpHistory.length) return answer;
    return { ...answer, profile: { ...answer.profile, lpHistory: points, lpFrom: 'OP.GG' } };
  } catch {
    return answer;
  }
}

export const LIVE_FROM_BROWSER = "U.GG isn't answering LEAGUEBOT's server: your browser read this game from OP.GG, without roles or duos.";

/** The live game, asked of OP.GG from the browser when the server's answer didn't come from U.GG. */
export async function withBrowserLive(answer: LiveAnswer, live: () => Promise<LiveGame | null>): Promise<LiveAnswer> {
  if (answer.uggTrouble === null || answer.source === 'U.GG') return answer;
  try {
    const game = await live();
    return { game, source: 'OP.GG', notes: game ? [LIVE_FROM_BROWSER] : [], uggTrouble: answer.uggTrouble };
  } catch {
    return answer;
  }
}
