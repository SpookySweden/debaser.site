/**
 * Rank as one climbing number, so LP over time can be drawn across promotions (SPEC-leaguebot.md): each division is 100
 * LP, each tier four divisions, and Master and above count LP on from the bottom of Master. Only a drawing aid: it is never
 * shown as a score or used to rank players (Riot forbids alternative ladders). Pure.
 */

import { TIERS, hasDivisions, rankText } from './types';

const TIER_SPAN = 400;
const MASTER_INDEX = TIERS.indexOf('MASTER');

export function ladderValue(tier: string, division: number | null, lp: number): number {
  const index = TIERS.indexOf(tier as (typeof TIERS)[number]);
  if (index < 0) return lp;
  if (!hasDivisions(tier)) return MASTER_INDEX * TIER_SPAN + lp;
  return index * TIER_SPAN + (4 - (division ?? 4)) * 100 + lp;
}

/** The rank a climbing number stands for (`GOLD II 40 LP`, or `MASTER+ 1200`: LP above Master's floor). */
export function ladderText(value: number): string {
  const v = Math.max(0, Math.round(value));
  if (v >= MASTER_INDEX * TIER_SPAN) return `MASTER+ ${v - MASTER_INDEX * TIER_SPAN}`;
  const index = Math.floor(v / TIER_SPAN);
  const within = v - index * TIER_SPAN;
  const division = 4 - Math.floor(within / 100);
  return rankText(TIERS[index], division, within % 100);
}
