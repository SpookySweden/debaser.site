/**
 * The LIVE tab's shapes (SPEC-leaguebot.md, phase 2): the ten players of a game that has loaded, and a lane matchup guide.
 * Pure types.
 */

import type { Lane, SourceName } from './types';

export type LivePlayer = {
  team: 100 | 200;
  championId: number;
  name: string;
  tag: string;
  /** The lane the source thinks they're playing. */
  lane: Lane | null;
  /** False when that isn't the lane they usually play; null when unknown. */
  onRole: boolean | null;
  spells: number[];
  primaryStyle: number | null;
  subStyle: number | null;
  keystone: number | null;
  rank: { tier: string; division: number | null; lp: number | null; wins: number | null; losses: number | null } | null;
  /** This season, on this champion. Null when the source doesn't say. */
  championGames: number | null;
  championWins: number | null;
  /** Their lanes this season, most played first. */
  lanes: { lane: Lane; games: number; wins: number }[];
  /** Players with the same number queued together; null when solo or unknown. */
  party: number | null;
};

export type LiveGame = {
  queueId: number;
  /** How long the game had run when the source answered. */
  lengthSec: number;
  /** When the source answered (the server's clock, ms). The window counts on from it. */
  fetchedAt: number;
  players: LivePlayer[];
  /** Champions banned, when the source says. */
  bans: number[];
};

export type LiveAnswer = {
  /** Null when the player isn't in a game right now. */
  game: LiveGame | null;
  source: SourceName | null;
  notes: string[];
  /** Why U.GG failed (`HTTP 403`, `timed out`), or null when it answered. The window then asks OP.GG from the browser. */
  uggTrouble: string | null;
};

export type MatchupGuide = {
  lane: Lane;
  myChampionId: number;
  opponentChampionId: number;
  tip: string | null;
  /** `EVEN`, or the name of the champion favoured in lane. */
  laneAdvantage: string | null;
  soloKillAdvantage: string | null;
  /** OP.GG's word for how to play the lane (`defensive`, `aggressive`, ...). */
  playStyle: string | null;
  spells: number[];
  starter: number[];
  core: number[];
  boots: number | null;
  runes: { primaryStyle: number; primary: number[]; subStyle: number; secondary: number[]; shards: number[] } | null;
  /** Skill order, level 1 onward (`Q`, `W`, `E`, `R`). */
  skills: string[];
};

export const QUEUE_NAMES: Record<number, string> = {
  400: 'NORMAL DRAFT',
  420: 'RANKED SOLO/DUO',
  430: 'NORMAL BLIND',
  440: 'RANKED FLEX',
  450: 'ARAM',
  480: 'SWIFTPLAY',
  490: 'QUICKPLAY',
  700: 'CLASH',
  1700: 'ARENA',
};

/** Summoner's Rift games with the standard objective timers (not ARAM, Arena or Swiftplay). */
export function isRiftQueue(queueId: number): boolean {
  return [400, 420, 430, 440, 490, 700].includes(queueId);
}
