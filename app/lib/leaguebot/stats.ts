/**
 * The STATS tab's arithmetic (SPEC-leaguebot.md, phase 1): from a player's recent ranked games, their totals, each
 * champion and lane, the last 20 against the games before, the lane opponents they lose to, and how they do after two
 * losses in a row. Pure: the window and the advice rules (`./advice.ts`) read it, and the checks hold it.
 */

import type { Lane, MatchSummary } from './types';

export type Line = {
  games: number;
  wins: number;
  /** 0 to 1. */
  winRate: number;
  kills: number;
  deaths: number;
  assists: number;
  /** (kills + assists) / deaths, with deaths counted as at least 1. */
  kda: number;
  csPerMin: number;
  goldPerMin: number;
  /** Null when no game in the line has a vision score. */
  visionPerMin: number | null;
  /** 0 to 100, or null when unknown. */
  killParticipation: number | null;
  avgMinutes: number;
};

export type ChampionLine = Line & { championId: number };
export type LaneLine = Line & { lane: Lane };
export type OpponentLine = { championId: number; lane: Lane; games: number; wins: number };

export type Stats = {
  all: Line;
  champions: ChampionLine[];
  lanes: LaneLine[];
  /** The newest 20 games. */
  recent: Line;
  /** The games before the newest 20 (null under 10 of them). */
  before: Line | null;
  /** Lane opponents met at least twice, the hardest first. */
  opponents: OpponentLine[];
  /** Games played straight after two or more losses in a row. */
  afterTwoLosses: Line | null;
  /** The lane played most. */
  mainLane: Lane | null;
  /** Different champions in the newest 20 games. */
  recentPool: number;
  /** Wins (true) and losses, newest first. */
  form: boolean[];
};

export const RECENT = 20;
const SITTING_GAP_MS = 3 * 60 * 60 * 1000;

function round(value: number, places: number): number {
  const f = 10 ** places;
  return Math.round(value * f) / f;
}

export function line(games: readonly MatchSummary[]): Line {
  const n = games.length;
  const sum = (pick: (m: MatchSummary) => number) => games.reduce((total, m) => total + pick(m), 0);
  const minutes = sum((m) => m.durationSec) / 60;
  const kills = sum((m) => m.kills);
  const deaths = sum((m) => m.deaths);
  const assists = sum((m) => m.assists);
  const wins = games.filter((m) => m.win).length;
  const withVision = games.filter((m) => m.vision !== null);
  const visionMinutes = withVision.reduce((t, m) => t + m.durationSec, 0) / 60;
  const withKp = games.filter((m) => m.killParticipation !== null);
  return {
    games: n,
    wins,
    winRate: n === 0 ? 0 : wins / n,
    kills: n === 0 ? 0 : round(kills / n, 1),
    deaths: n === 0 ? 0 : round(deaths / n, 1),
    assists: n === 0 ? 0 : round(assists / n, 1),
    kda: n === 0 ? 0 : round((kills + assists) / Math.max(1, deaths), 2),
    csPerMin: minutes === 0 ? 0 : round(sum((m) => m.cs) / minutes, 1),
    goldPerMin: minutes === 0 ? 0 : Math.round(sum((m) => m.gold) / minutes),
    visionPerMin: visionMinutes === 0 ? null : round(withVision.reduce((t, m) => t + (m.vision ?? 0), 0) / visionMinutes, 2),
    killParticipation: withKp.length === 0 ? null : Math.round(withKp.reduce((t, m) => t + (m.killParticipation ?? 0), 0) / withKp.length),
    avgMinutes: n === 0 ? 0 : round(minutes / n, 1),
  };
}

/** The enemy who played the same lane, when the source says who that was. */
export function laneOpponent(game: MatchSummary): { championId: number; lane: Lane } | null {
  if (game.lane === null) return null;
  const enemy = game.players.find((p) => p.team !== game.team && p.lane === game.lane);
  return enemy ? { championId: enemy.championId, lane: game.lane } : null;
}

function groupBy<K>(games: readonly MatchSummary[], key: (m: MatchSummary) => K | null): Map<K, MatchSummary[]> {
  const groups = new Map<K, MatchSummary[]>();
  for (const game of games) {
    const k = key(game);
    if (k === null) continue;
    const list = groups.get(k) ?? [];
    list.push(game);
    groups.set(k, list);
  }
  return groups;
}

/** Everything the STATS tab shows. `games` may come in any order; newest first is worked out here. */
export function computeStats(input: readonly MatchSummary[]): Stats {
  const games = [...input].filter((m) => m.durationSec >= 300).sort((a, b) => b.at - a.at);
  const champions = [...groupBy(games, (m) => m.championId)].map(([championId, list]) => ({ championId, ...line(list) }));
  champions.sort((a, b) => b.games - a.games || b.winRate - a.winRate);
  const lanes = [...groupBy(games, (m) => m.lane)].map(([lane, list]) => ({ lane, ...line(list) }));
  lanes.sort((a, b) => b.games - a.games);

  const opponents: OpponentLine[] = [];
  const met = new Map<string, OpponentLine>();
  for (const game of games) {
    const opp = laneOpponent(game);
    if (!opp) continue;
    const key = `${opp.championId}:${opp.lane}`;
    const entry = met.get(key) ?? { championId: opp.championId, lane: opp.lane, games: 0, wins: 0 };
    entry.games += 1;
    if (game.win) entry.wins += 1;
    met.set(key, entry);
  }
  for (const entry of met.values()) if (entry.games >= 2) opponents.push(entry);
  // Hardest first: most losses, then the lower win rate.
  opponents.sort((a, b) => b.games - b.wins - (a.games - a.wins) || a.wins / a.games - b.wins / b.games);

  // After two losses in a row, oldest to newest.
  const chronological = [...games].reverse();
  const afterTwo: MatchSummary[] = [];
  let lossRun = 0;
  let lastEnd = 0;
  for (const game of chronological) {
    // A game more than three hours after the last one ended starts a fresh sitting, not a run.
    if (lastEnd > 0 && game.at - lastEnd > SITTING_GAP_MS) lossRun = 0;
    if (lossRun >= 2) afterTwo.push(game);
    lossRun = game.win ? 0 : lossRun + 1;
    lastEnd = game.at + game.durationSec * 1000;
  }

  const recentGames = games.slice(0, RECENT);
  const beforeGames = games.slice(RECENT);
  return {
    all: line(games),
    champions,
    lanes,
    recent: line(recentGames),
    before: beforeGames.length >= 10 ? line(beforeGames) : null,
    opponents,
    afterTwoLosses: afterTwo.length > 0 ? line(afterTwo) : null,
    mainLane: lanes[0]?.lane ?? null,
    recentPool: new Set(recentGames.map((m) => m.championId)).size,
    form: games.slice(0, RECENT).map((m) => m.win),
  };
}
