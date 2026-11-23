/**
 * One player on one champion, for LEAGUEBOT's CHAMPION panel (SPEC-leaguebot-live-champs.md): their recent games on it
 * summed up (form, KDA, deaths, CS, kill participation, vision, short games against long ones, what they finish building,
 * their usual keystone and spells) and a few plain lines from rules about how they play it. Only what their public match
 * history shows; no score or rating of the player. Pure.
 */

import type { AdviceLine } from './advice';
import type { Lane, MatchSummary } from './types';

/** How many of a player's recent games on the champion the panel reads (Luke's answer, 2026-11-23: the recommended 20). */
export const CHAMPION_GAMES = 20;

/** A game under this many seconds counts as short. */
export const SHORT_GAME_SEC = 25 * 60;

export type Share = { id: number; games: number };

export type PlayerChampSummary = {
  games: number;
  wins: number;
  /** Newest first, up to ten. */
  form: boolean[];
  kills: number;
  deaths: number;
  assists: number;
  csPerMin: number;
  damagePerMin: number;
  /** 0 to 100; null when no game gave it. */
  killParticipation: number | null;
  /** Null when no game gave a vision score. */
  visionPerMin: number | null;
  short: { games: number; wins: number };
  long: { games: number; wins: number };
  lane: Lane | null;
  /** Finished items by how many games they were in, most first (boots apart). */
  items: Share[];
  boots: Share[];
  keystones: Share[];
  /** Summoner-spell pairs as `4,14` (lower number first). */
  spellPairs: { pair: number[]; games: number }[];
};

type ItemFacts = (id: number) => { completed: boolean; boots: boolean } | undefined;

function shares(values: number[]): Share[] {
  const counts = new Map<number, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts].map(([id, games]) => ({ id, games })).sort((a, b) => b.games - a.games || a.id - b.id);
}

const avg = (values: number[]) => (values.length === 0 ? 0 : values.reduce((s, v) => s + v, 0) / values.length);

/** The player's games on this champion summed up, or null when there are none. */
export function summarisePlayerChamp(matches: MatchSummary[], championId: number, items: ItemFacts): PlayerChampSummary | null {
  const games = matches.filter((m) => m.championId === championId).sort((a, b) => b.at - a.at).slice(0, CHAMPION_GAMES);
  if (games.length === 0) return null;
  const minutes = (m: MatchSummary) => Math.max(1, m.durationSec / 60);
  const kp = games.map((m) => m.killParticipation).filter((v): v is number => v !== null && v > 0);
  const vision = games.map((m) => (m.vision === null ? null : m.vision / minutes(m))).filter((v): v is number => v !== null);
  const short = games.filter((m) => m.durationSec < SHORT_GAME_SEC);
  const long = games.filter((m) => m.durationSec >= SHORT_GAME_SEC);
  const lanes = shares(games.map((m) => ['TOP', 'JUNGLE', 'MID', 'BOTTOM', 'SUPPORT'].indexOf(m.lane ?? '')).filter((i) => i >= 0));
  const finished = games.flatMap((m) => [...new Set(m.items)].filter((id) => items(id)?.completed === true));
  const pairs = new Map<string, number>();
  for (const m of games) {
    if (m.spells.length < 2) continue;
    const key = [...m.spells.slice(0, 2)].sort((a, b) => a - b).join(',');
    pairs.set(key, (pairs.get(key) ?? 0) + 1);
  }
  return {
    games: games.length,
    wins: games.filter((m) => m.win).length,
    form: games.slice(0, 10).map((m) => m.win),
    kills: avg(games.map((m) => m.kills)),
    deaths: avg(games.map((m) => m.deaths)),
    assists: avg(games.map((m) => m.assists)),
    csPerMin: avg(games.map((m) => m.cs / minutes(m))),
    damagePerMin: avg(games.map((m) => m.damage / minutes(m))),
    killParticipation: kp.length > 0 ? avg(kp) : null,
    visionPerMin: vision.length > 0 && vision.some((v) => v > 0) ? avg(vision) : null,
    short: { games: short.length, wins: short.filter((m) => m.win).length },
    long: { games: long.length, wins: long.filter((m) => m.win).length },
    lane: lanes[0] ? (['TOP', 'JUNGLE', 'MID', 'BOTTOM', 'SUPPORT'] as const)[lanes[0].id] : null,
    items: shares(finished.filter((id) => items(id)?.boots !== true)),
    boots: shares(finished.filter((id) => items(id)?.boots === true)),
    keystones: shares(games.map((m) => m.runes[0]).filter((id): id is number => typeof id === 'number' && id > 0)),
    spellPairs: [...pairs].map(([pair, n]) => ({ pair: pair.split(',').map(Number), games: n })).sort((a, b) => b.games - a.games),
  };
}

const pct = (wins: number, games: number) => Math.round((wins / Math.max(1, games)) * 100);
const one = (value: number) => value.toFixed(1);

/**
 * Plain lines about how this player plays the champion, most useful first, at most five. `side` decides whose good news it
 * is: a player who dies a lot is a chance against an enemy and a worry beside an ally.
 */
export function playerChampAdvice(s: PlayerChampSummary, champion: string, side: 'enemy' | 'ally' | 'self'): AdviceLine[] {
  const lines: AdviceLine[] = [];
  const enemy = side === 'enemy';
  const good = enemy ? '!' : '+';
  const bad = enemy ? '+' : '!';
  const sample = `last ${s.games} game${s.games === 1 ? '' : 's'} on ${champion}`;

  if (s.games < 5) lines.push({ key: 'few', mark: '>', text: `Only ${s.games} recent game${s.games === 1 ? '' : 's'} on ${champion}: read these numbers loosely.`, weight: 95 });

  const wr = pct(s.wins, s.games);
  if (s.games >= 8 && wr >= 60) lines.push({ key: 'form-hot', mark: good, text: `Won ${s.wins} of their ${sample} (${wr}%): in form on it.`, weight: 80 });
  if (s.games >= 8 && wr <= 35) lines.push({ key: 'form-cold', mark: bad, text: `Won ${s.wins} of their ${sample} (${wr}%): struggling on it.`, weight: 78 });

  if (s.deaths >= 7) {
    lines.push({ key: 'deaths-high', mark: bad, text: enemy ? `Dies ${one(s.deaths)} times a game on ${champion}: bait their all-in, they overcommit.` : `Dies ${one(s.deaths)} times a game on ${champion}: stay near them and ward their side.`, weight: 75 });
  } else if (s.deaths <= 3.5 && s.games >= 5) {
    lines.push({ key: 'deaths-low', mark: good, text: `Rarely dies on ${champion} (${one(s.deaths)} a game): don't count on a throw.`, weight: 55 });
  }

  if (s.short.games >= 4 && s.long.games >= 4) {
    const shortWr = pct(s.short.wins, s.short.games);
    const longWr = pct(s.long.wins, s.long.games);
    if (Math.abs(shortWr - longWr) >= 25) {
      const lateBetter = longWr > shortWr;
      const tail = enemy ? (lateBetter ? 'end the game early.' : 'drag the game long.') : lateBetter ? 'play for the late game.' : 'push your lead early.';
      lines.push({ key: 'length', mark: '>', text: `Wins ${lateBetter ? longWr : shortWr}% of games ${lateBetter ? 'over' : 'under'} 25 minutes and ${lateBetter ? shortWr : longWr}% of the rest: ${tail}`, weight: 70 });
    }
  }

  const laner = s.lane !== null && s.lane !== 'JUNGLE' && s.lane !== 'SUPPORT';
  if (laner && s.csPerMin >= 8.5) lines.push({ key: 'cs-high', mark: good, text: `Farms ${one(s.csPerMin)} CS a minute on ${champion}: they'll out-scale a passive lane.`, weight: 50 });
  if (laner && s.csPerMin > 0 && s.csPerMin <= 6) lines.push({ key: 'cs-low', mark: bad, text: `Farms only ${one(s.csPerMin)} CS a minute on ${champion}: they fall behind if the lane goes even.`, weight: 50 });

  if (s.killParticipation !== null && s.killParticipation >= 65) {
    lines.push({ key: 'kp-high', mark: '>', text: `In ${Math.round(s.killParticipation)}% of their team's kills: expect them wherever the fight is.`, weight: 45 });
  } else if (s.killParticipation !== null && s.killParticipation <= 40) {
    lines.push({ key: 'kp-low', mark: '>', text: `In only ${Math.round(s.killParticipation)}% of their team's kills: they play alone, often off to the side.`, weight: 45 });
  }

  if (s.visionPerMin !== null && s.visionPerMin <= 0.6 && s.lane !== 'SUPPORT') {
    lines.push({ key: 'vision-low', mark: bad, text: enemy ? `Little vision (${one(s.visionPerMin)} a minute): flanks and deep ganks go unseen.` : `Little vision (${one(s.visionPerMin)} a minute): ward for them.`, weight: 40 });
  }

  return lines.sort((a, b) => b.weight - a.weight).slice(0, 5);
}
