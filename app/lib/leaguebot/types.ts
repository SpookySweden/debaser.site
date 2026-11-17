/**
 * LEAGUEBOT's one shape for each thing (SPEC-leaguebot.md). Every source's answer is turned into these on the server, so the
 * window, the advice rules and the checks never see a source's own spelling. Pure types and a few constants.
 */

import type { RegionId } from './regions';
import type { RiotId } from './riot-id';

export type SourceName = 'U.GG' | 'OP.GG';

export type Lane = 'TOP' | 'JUNGLE' | 'MID' | 'BOTTOM' | 'SUPPORT';
export const LANES: readonly Lane[] = ['TOP', 'JUNGLE', 'MID', 'BOTTOM', 'SUPPORT'];

export type RankEntry = {
  queue: 'SOLO' | 'FLEX';
  /** IRON .. CHALLENGER, or null while unranked. */
  tier: string | null;
  /** 1 to 4 (I to IV); null above Diamond's divisions or unranked. */
  division: number | null;
  lp: number | null;
  wins: number | null;
  losses: number | null;
  hotStreak: boolean;
};

export type LpPoint = { at: string; tier: string; division: number | null; lp: number };

export type PastSeason = { season: number; tier: string; division: number | null; lp: number | null };

export type Profile = {
  riotId: RiotId;
  region: RegionId;
  level: number | null;
  /** Riot's profile icon number (drawn from Data Dragon), or null. */
  iconId: number | null;
  ranks: RankEntry[];
  lpHistory: LpPoint[];
  pastSeasons: PastSeason[];
};

export type MatchPlayer = { championId: number; name: string; tag: string; lane: Lane | null; team: 100 | 200 };

export type MatchSummary = {
  id: string;
  /** U.GG's patch spelling, `16_22`: needed to open the match again. */
  version: string;
  /** When it started, ms since 1970. */
  at: number;
  durationSec: number;
  win: boolean;
  championId: number;
  lane: Lane | null;
  kills: number;
  deaths: number;
  assists: number;
  /** Lane minions and jungle monsters together, as the game's scoreboard counts CS. */
  cs: number;
  gold: number;
  damage: number;
  /** Null when the source doesn't give it (OP.GG's fallback history has no vision score). */
  vision: number | null;
  /** 0 to 100, or null when unknown. */
  killParticipation: number | null;
  items: number[];
  spells: number[];
  runes: number[];
  primaryStyle: number | null;
  subStyle: number | null;
  team: 100 | 200;
  players: MatchPlayer[];
};

/** What one look-up of a player gives the window. Each half may be missing while the other came back. */
export type PlayerAnswer = {
  profile: Profile | null;
  profileSource: SourceName | null;
  matches: MatchSummary[] | null;
  matchesSource: SourceName | null;
  /** Neither source knows this Riot ID on this server. */
  notFound: boolean;
  /** Plain-English notes for the window: a source that didn't answer, a fallback taken. */
  notes: string[];
  /**
   * Why U.GG failed for the game list, in a few words (`HTTP 403`, `timed out`), or null when it answered. The window's
   * browser then reads the 100 games from OP.GG itself (./browser-opgg.ts).
   */
  uggTrouble: string | null;
};

/** How many ranked solo games the STATS tab reads (five pages of U.GG's twenty). */
export const STATS_GAMES = 100;

export const TIERS = ['IRON', 'BRONZE', 'SILVER', 'GOLD', 'PLATINUM', 'EMERALD', 'DIAMOND', 'MASTER', 'GRANDMASTER', 'CHALLENGER'] as const;

/** Above Diamond there are no divisions: LP alone. */
export function hasDivisions(tier: string | null): boolean {
  return tier !== null && !['MASTER', 'GRANDMASTER', 'CHALLENGER'].includes(tier);
}

const ROMAN = ['', 'I', 'II', 'III', 'IV'];

/** `EMERALD II 45 LP`, `MASTER 1837 LP`, or `UNRANKED`. */
export function rankText(tier: string | null, division: number | null, lp: number | null): string {
  if (tier === null) return 'UNRANKED';
  const parts = [tier];
  if (hasDivisions(tier) && division !== null) parts.push(ROMAN[division] ?? String(division));
  if (lp !== null) parts.push(`${lp} LP`);
  return parts.join(' ');
}
