/**
 * The REVIEW tab's shape (SPEC-leaguebot.md, phase 3): one finished game, minute by minute against the lane opponent, with
 * the build, the deaths and every player's scoreboard. Pure types.
 */

import type { Lane } from './types';

export type ReviewFrame = { minute: number; gold: [number, number]; cs: [number, number]; xp: [number, number] };

export type ReviewPlayer = {
  name: string;
  tag: string;
  championId: number;
  team: 100 | 200;
  lane: Lane | null;
  kills: number;
  deaths: number;
  assists: number;
  cs: number;
  gold: number;
  damage: number;
  damageTaken: number;
  vision: number;
  wards: number;
  level: number;
  items: number[];
  spells: number[];
  keystone: number | null;
};

export type ReviewTeam = { team: 100 | 200; kills: number; gold: number; towers: number; dragons: number; barons: number; heralds: number; bans: number[] };

export type ReviewEvent = { atSec: number; kind: 'death' | 'kill' | 'dragon' | 'grubs' | 'herald' | 'baron' | 'tower'; team: 100 | 200 | null; championId: number | null };

export type MatchReview = {
  id: string;
  win: boolean;
  durationSec: number;
  me: ReviewPlayer;
  opponent: ReviewPlayer | null;
  /** Each minute: [you, lane opponent]. */
  frames: ReviewFrame[];
  /** Bought items in order, with when (start items at 0). */
  buys: { itemId: number; atSec: number }[];
  /** Q W E R, level 1 onward. */
  skills: string[];
  runes: number[];
  primaryStyle: number | null;
  subStyle: number | null;
  players: ReviewPlayer[];
  teams: ReviewTeam[];
  /** Your deaths and kills, and the objectives, in time order. */
  events: ReviewEvent[];
  /** Wards you placed. */
  wardsPlaced: number;
};
