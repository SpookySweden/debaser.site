/**
 * LEAGUEBOT's advice (SPEC-leaguebot.md, Luke's 9A): rules written from the numbers, no AI. Each rule looks at the stats and
 * may say one line: `!` a problem, `+` a strength, `>` a thing to try, always with the number behind it and how many games
 * it rests on. The window shows the five weightiest. Pure: the checks feed it stats and read the lines.
 *
 * Small samples say nothing: a rule needs enough games before it speaks (the `MIN_*` numbers).
 */

import type { Stats } from './stats';
import type { Lane } from './types';

export type AdviceMark = '!' | '+' | '>';
export type AdviceLine = { key: string; mark: AdviceMark; text: string; weight: number };

const MIN_CHAMPION = 5;
const MIN_LANE = 5;
const MIN_AFTER_LOSSES = 8;
const MIN_OPPONENT = 3;
const SHOWN = 5;

const pct = (rate: number) => `${Math.round(rate * 100)}%`;
const games = (n: number) => `${n} game${n === 1 ? '' : 's'}`;

export const LANE_WORDS: Record<Lane, string> = { TOP: 'top', JUNGLE: 'jungle', MID: 'mid', BOTTOM: 'bot lane', SUPPORT: 'support' };

export function statsAdvice(stats: Stats, name: (championId: number) => string): AdviceLine[] {
  const lines: AdviceLine[] = [];
  const { all } = stats;
  if (all.games < 5) return lines;

  // Tilt: worse straight after two losses in a row.
  const after = stats.afterTwoLosses;
  if (after && after.games >= MIN_AFTER_LOSSES && after.winRate <= all.winRate - 0.1) {
    lines.push({
      key: 'tilt',
      mark: '!',
      text: `After two losses in a row you win ${pct(after.winRate)} (${games(after.games)}), against ${pct(all.winRate)} overall. Take a break after the second loss.`,
      weight: 90 + Math.round((all.winRate - after.winRate) * 100),
    });
  }

  // Off-role: a lane well below the main one.
  const main = stats.lanes.find((l) => l.lane === stats.mainLane);
  if (main && main.games >= MIN_LANE) {
    for (const lane of stats.lanes) {
      if (lane.lane === main.lane || lane.games < MIN_LANE) continue;
      if (lane.winRate <= main.winRate - 0.12) {
        lines.push({
          key: `lane:${lane.lane}`,
          mark: '!',
          text: `On ${LANE_WORDS[lane.lane]} you win ${pct(lane.winRate)} over ${games(lane.games)}, ${pct(main.winRate)} on ${LANE_WORDS[main.lane]}. Queue ${LANE_WORDS[main.lane]} first.`,
          weight: 70 + lane.games,
        });
      }
    }
  }

  // Strongest and weakest champions.
  const solid = stats.champions.filter((c) => c.games >= MIN_CHAMPION);
  const best = [...solid].sort((a, b) => b.winRate - a.winRate)[0];
  if (best && best.winRate >= 0.55) {
    lines.push({ key: `best:${best.championId}`, mark: '+', text: `${name(best.championId)}: ${pct(best.winRate)} over ${games(best.games)}, ${best.kda} KDA. Your strongest pick.`, weight: 60 + best.games });
  }
  const worst = [...solid].sort((a, b) => a.winRate - b.winRate)[0];
  if (worst && worst !== best && worst.winRate <= 0.4) {
    lines.push({ key: `worst:${worst.championId}`, mark: '!', text: `${name(worst.championId)}: ${pct(worst.winRate)} over ${games(worst.games)}. Leave it out of ranked for now.`, weight: 65 + worst.games });
  }

  // Too many champions lately.
  if (stats.recent.games >= 15 && stats.recentPool >= 8) {
    const pick = best ? ` Your best is ${name(best.championId)}.` : '';
    lines.push({ key: 'pool', mark: '>', text: `${stats.recentPool} different champions in your last ${games(stats.recent.games)}. Two or three climb faster.${pick}`, weight: 55 + stats.recentPool });
  }

  // Better or worse lately.
  if (stats.before && stats.recent.games >= 15) {
    const change = stats.recent.winRate - stats.before.winRate;
    if (change >= 0.1) {
      lines.push({ key: 'trend', mark: '+', text: `Up: ${pct(stats.recent.winRate)} in your last ${games(stats.recent.games)}, ${pct(stats.before.winRate)} in the ${stats.before.games} before.`, weight: 50 + Math.round(change * 100) });
    } else if (change <= -0.1) {
      lines.push({ key: 'trend', mark: '!', text: `Down: ${pct(stats.recent.winRate)} in your last ${games(stats.recent.games)}, ${pct(stats.before.winRate)} in the ${stats.before.games} before.`, weight: 60 + Math.round(-change * 100) });
    }
  }

  // Farming, for players who mostly lane (not jungle or support).
  const laner = main && (main.lane === 'TOP' || main.lane === 'MID' || main.lane === 'BOTTOM');
  if (laner && main.games >= MIN_LANE) {
    if (main.csPerMin < 6.5) {
      lines.push({ key: 'cs', mark: '>', text: `CS ${main.csPerMin}/min on ${LANE_WORDS[main.lane]} (${games(main.games)}). 7 a minute is a common target: last hits come before trades.`, weight: 50 + Math.round((6.5 - main.csPerMin) * 10) });
    } else if (main.csPerMin >= 8.5) {
      lines.push({ key: 'cs', mark: '+', text: `CS ${main.csPerMin}/min on ${LANE_WORDS[main.lane]}: farming is a strength.`, weight: 30 });
    }
  }

  // Dying a lot.
  if (all.deaths >= 7) {
    lines.push({ key: 'deaths', mark: '!', text: `${all.deaths} deaths a game over ${games(all.games)}. Most games are lost by dying, not by missing kills: back off when the enemy jungler isn't on the map.`, weight: 55 + Math.round(all.deaths) });
  }

  // Vision, measured against the lane: supports carry the wards.
  if (main && main.visionPerMin !== null && main.games >= MIN_LANE) {
    const floor = main.lane === 'SUPPORT' ? 1.8 : main.lane === 'JUNGLE' ? 1.0 : 0.7;
    if (main.visionPerMin < floor) {
      lines.push({ key: 'vision', mark: '>', text: `Vision ${main.visionPerMin}/min on ${LANE_WORDS[main.lane]}. Buy a control ward every back and use your trinket on cooldown.`, weight: 40 });
    }
  }

  // Kill participation, for everyone but top lane, where splitting off is the job.
  if (main && main.lane !== 'TOP' && main.killParticipation !== null && main.games >= MIN_LANE && main.killParticipation < 45) {
    lines.push({ key: 'kp', mark: '>', text: `In ${main.killParticipation}% of your team's kills on ${LANE_WORDS[main.lane]}. Move with your jungler when your wave is pushed.`, weight: 38 });
  }

  // A lane opponent you can't beat.
  const nemesis = stats.opponents.find((o) => o.games >= MIN_OPPONENT && o.wins / o.games <= 0.34);
  if (nemesis) {
    lines.push({
      key: `opp:${nemesis.championId}`,
      mark: '!',
      text: `Against ${name(nemesis.championId)} on ${LANE_WORDS[nemesis.lane]} you've won ${nemesis.wins} of ${nemesis.games}. Read up on that matchup before you meet it again.`,
      weight: 58 + nemesis.games,
    });
  }

  return lines.sort((a, b) => b.weight - a.weight).slice(0, SHOWN);
}
