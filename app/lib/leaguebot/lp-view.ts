/**
 * What the STATS tab's LP OVER TIME says about its own line (SPEC-leaguebot.md; Luke, 2026-11-17: "the lp over time graph
 * also seems non functional lets get it working"): who kept the points, how often and how far back, or, with too few to
 * draw, why. Pure, so the check can hold the words.
 */

import type { LpPoint, SourceName } from './types';

const DAY = 24 * 60 * 60 * 1000;

/** The caption over the line: `ranked solo, last 15 days, a point after every game, from U.GG`. */
export function lpCaption(points: LpPoint[], from: SourceName | null): string {
  if (points.length === 0) return 'ranked solo';
  const span = Date.parse(points[points.length - 1].at) - Date.parse(points[0].at);
  const days = Math.max(1, Math.round(span / DAY));
  const how = from === 'U.GG' ? 'a point after every game' : 'a point a day';
  return `ranked solo, last ${days} day${days === 1 ? '' : 's'}, ${how}${from ? `, from ${from}` : ''}`;
}

/** Too few points to draw a line: said plainly, never a blank space. */
export function lpEmpty(points: LpPoint[]): string {
  if (points.length === 1) return 'Only one LP point so far: the line starts once there is a second. U.GG adds one after every ranked game, OP.GG one a day.';
  return 'No LP history for this player yet: U.GG adds a point after every ranked solo game and OP.GG one a day, so the line appears after their next ranked game.';
}
