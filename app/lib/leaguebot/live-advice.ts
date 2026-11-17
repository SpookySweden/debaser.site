/**
 * The LIVE tab's reading of a loaded game (SPEC-leaguebot.md, phase 2): who you are in it, who you face in lane, notes on
 * the enemy team from their public records, and the match clock's fixed spawn times. Rules, no AI (Luke's 9A). Only what
 * the loading screen shows anyone; never an enemy's cooldowns or anything from inside the match. Pure.
 */

import type { AdviceLine } from './advice';
import { LANE_WORDS } from './advice';
import { isRiftQueue, type LiveGame, type LivePlayer } from './live-types';
import { sameRiotId, type RiotId } from './riot-id';
import { rankText, type Lane } from './types';

export function findMe(game: LiveGame, id: RiotId): LivePlayer | null {
  return game.players.find((p) => sameRiotId(p, id)) ?? null;
}

export function laneOpponentOf(game: LiveGame, me: LivePlayer): LivePlayer | null {
  if (me.lane === null) return null;
  return game.players.find((p) => p.team !== me.team && p.lane === me.lane) ?? null;
}

const ROLE_NOUNS: Record<Lane, string> = { TOP: 'top laner', JUNGLE: 'jungler', MID: 'mid laner', BOTTOM: 'bot laner', SUPPORT: 'support' };

const pct = (wins: number, games: number) => `${Math.round((wins / Math.max(1, games)) * 100)}%`;

export function liveAdvice(game: LiveGame, me: LivePlayer | null, name: (championId: number) => string): AdviceLine[] {
  const lines: AdviceLine[] = [];
  const myTeam = me?.team ?? 100;
  const enemies = game.players.filter((p) => p.team !== myTeam);
  const opponent = me ? laneOpponentOf(game, me) : null;
  const who = (p: LivePlayer) => `Their ${p.lane ? ROLE_NOUNS[p.lane] : ''} ${name(p.championId)}`.replace(/\s+/g, ' ');

  for (const enemy of enemies) {
    const games = enemy.championGames;
    const wins = enemy.championWins;
    const isOpponent = enemy === opponent;
    if (games !== null && wins !== null && games >= 30 && wins / games >= 0.52) {
      lines.push({ key: `otp:${enemy.championId}`, mark: '!', text: `${who(enemy)} has ${games} games on it this season (${pct(wins, games)} won). Expect them to know every trade.`, weight: (isOpponent ? 90 : 60) + Math.min(20, Math.round(games / 10)) });
    } else if (games !== null && games <= 2) {
      lines.push({ key: `new:${enemy.championId}`, mark: '+', text: `${who(enemy)} has played it ${games === 0 ? 'no' : games} time${games === 1 ? '' : 's'} this season. Punish early mistakes.`, weight: isOpponent ? 85 : 50 });
    }
    if (enemy.onRole === false && enemy.lanes[0]) {
      lines.push({ key: `off:${enemy.championId}`, mark: '+', text: `${who(enemy)} is off their main role: they mostly play ${LANE_WORDS[enemy.lanes[0].lane]} (${enemy.lanes[0].games} games).`, weight: isOpponent ? 80 : 45 });
    }
  }

  // Duos on the enemy team.
  const parties = new Map<number, LivePlayer[]>();
  for (const enemy of enemies) if (enemy.party !== null && enemy.party > 0) parties.set(enemy.party, [...(parties.get(enemy.party) ?? []), enemy]);
  for (const [party, members] of parties) {
    if (members.length >= 2) {
      lines.push({ key: `duo:${party}`, mark: '>', text: `${members.map((m) => name(m.championId)).join(' and ')} queued together: expect them to move as one.`, weight: 55 });
    }
  }

  // The enemy jungler's first clear.
  const jungler = enemies.find((p) => p.lane === 'JUNGLE');
  if (jungler && me && me.lane !== 'JUNGLE' && isRiftQueue(game.queueId)) {
    lines.push({ key: 'jungle', mark: '>', text: `Their jungler is ${name(jungler.championId)}. A first clear ends around 3:00 to 3:30: ward the river before then.`, weight: 40 });
  }

  // The strongest enemy by rank, when ranks differ.
  const ranked = enemies.filter((p) => p.rank !== null);
  if (ranked.length >= 3) {
    const order = ['IRON', 'BRONZE', 'SILVER', 'GOLD', 'PLATINUM', 'EMERALD', 'DIAMOND', 'MASTER', 'GRANDMASTER', 'CHALLENGER'];
    const top = [...ranked].sort((a, b) => order.indexOf(b.rank!.tier) - order.indexOf(a.rank!.tier) || (a.rank!.division ?? 0) - (b.rank!.division ?? 0))[0];
    const lowest = Math.min(...ranked.map((p) => order.indexOf(p.rank!.tier)));
    if (order.indexOf(top.rank!.tier) > lowest) {
      lines.push({ key: 'strongest', mark: '>', text: `Highest rank on their team: ${name(top.championId)}, ${rankText(top.rank!.tier, top.rank!.division, top.rank!.lp)}.`, weight: 35 });
    }
  }

  return lines.sort((a, b) => b.weight - a.weight).slice(0, 6);
}

/** The match clock's fixed spawns on Summoner's Rift (patch 26.1 onward: Baron at 20:00, Atakhan removed). Checked 2026-11-17. */
export const RIFT_SPAWNS: { at: number; label: string }[] = [
  { at: 5 * 60, label: 'First dragon' },
  { at: 8 * 60, label: 'Void grubs (leave at 14:45)' },
  { at: 15 * 60, label: 'Rift Herald (leaves at 19:45)' },
  { at: 20 * 60, label: 'Baron Nashor' },
];

/** `12:05`. */
export function clockText(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Where the match clock stands now, counting on from when the source answered. */
export function gameSeconds(game: LiveGame, now: number): number {
  return game.lengthSec + Math.max(0, Math.floor((now - game.fetchedAt) / 1000));
}
