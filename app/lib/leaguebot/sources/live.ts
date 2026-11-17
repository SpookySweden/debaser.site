/**
 * The live game (SPEC-leaguebot.md, phase 2): the ten players once a game has loaded, from U.GG's site API, with OP.GG's
 * site API (`lol-api-summoner.op.gg`) as the fallback. Both keyless and unofficial. Server-side only.
 *
 * Only what the loading screen shows anyone: champions, spells, runes, ranks, and each player's public record. Nothing
 * from inside the match (gold, items, cooldowns) exists here, and nothing is stored.
 */

import { safeFetchJson, type FetchLike } from '../../web/safe-fetch';
import type { LiveGame, LivePlayer } from '../live-types';
import type { Region } from '../regions';
import type { RiotId } from '../riot-id';
import type { Lane } from '../types';
import { OPGG_SITE_HOST, opggSpectateUrl, opggSummonerUrl, summonerIdOf, toOpggLive } from '../opgg-site';
import { romanToNumber, uggQuery } from './ugg';

export { OPGG_SITE_HOST };

type Json = Record<string, unknown>;
const num = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null);
const str = (value: unknown): string => (typeof value === 'string' ? value : '');
const nums = (value: unknown): number[] => (Array.isArray(value) ? value.filter((v): v is number => typeof v === 'number') : []);

/** U.GG's live-game role words. */
export function uggRoleWord(word: unknown): Lane | null {
  switch (word) {
    case 'top':
      return 'TOP';
    case 'jungle':
      return 'JUNGLE';
    case 'mid':
      return 'MID';
    case 'adc':
      return 'BOTTOM';
    case 'supp':
      return 'SUPPORT';
    default:
      return null;
  }
}

const PART = `championId riotUserName riotTagLine currentRole onRole partyNumber summonerSpellA summonerSpellB summonerRuneA summonerRuneB summonerRuneData banId championWins championLosses currentSeasonRankScore { queueType tier rank lp wins losses } roleDatas { roleName games wins }`;

function uggPlayer(p: Json, team: 100 | 200): LivePlayer {
  const rank = p.currentSeasonRankScore as Json | null;
  const tier = str(rank?.tier).toUpperCase();
  const wins = num(p.championWins);
  const losses = num(p.championLosses);
  const runeData = nums(p.summonerRuneData);
  const lanes = (Array.isArray(p.roleDatas) ? (p.roleDatas as Json[]) : [])
    .map((r) => ({ lane: uggRoleWord(r.roleName), games: num(r.games) ?? 0, wins: num(r.wins) ?? 0 }))
    .filter((r): r is { lane: Lane; games: number; wins: number } => r.lane !== null && r.games > 0)
    .sort((a, b) => b.games - a.games);
  return {
    team,
    championId: num(p.championId) ?? 0,
    name: str(p.riotUserName),
    tag: str(p.riotTagLine),
    lane: uggRoleWord(p.currentRole),
    onRole: typeof p.onRole === 'boolean' ? p.onRole : null,
    spells: [num(p.summonerSpellA), num(p.summonerSpellB)].filter((v): v is number => v !== null && v > 0),
    primaryStyle: num(p.summonerRuneA),
    subStyle: num(p.summonerRuneB),
    keystone: runeData[0] ?? null,
    rank: tier === '' ? null : { tier, division: romanToNumber(str(rank?.rank)), lp: num(rank?.lp), wins: num(rank?.wins), losses: num(rank?.losses) },
    // U.GG sometimes answers -1 for a record it hasn't worked out: unknown, not a number to show.
    championGames: wins !== null && losses !== null && wins >= 0 && losses >= 0 ? wins + losses : null,
    championWins: wins !== null && wins >= 0 ? wins : null,
    lanes,
    party: num(p.partyNumber),
  };
}

/** U.GG's live game, or null when the player isn't in one. Exported shaping for the checks. */
export function toUggLive(data: Json, now: number): LiveGame | null {
  const game = data.getLiveGame as Json | null;
  if (!game) return null;
  const teamA = Array.isArray(game.teamA) ? (game.teamA as Json[]) : [];
  const teamB = Array.isArray(game.teamB) ? (game.teamB as Json[]) : [];
  if (teamA.length + teamB.length === 0) return null;
  return {
    queueId: num(game.queueId) ?? 0,
    lengthSec: Math.max(0, num(game.gameLengthSeconds) ?? 0),
    fetchedAt: now,
    players: [...teamA.map((p) => uggPlayer(p, 100)), ...teamB.map((p) => uggPlayer(p, 200))],
    bans: [...teamA, ...teamB].map((p) => num(p.banId)).filter((v): v is number => v !== null && v > 0),
  };
}

export async function uggLive(id: RiotId, region: Region, fetchImpl?: FetchLike, now = Date.now()): Promise<LiveGame | null> {
  const v = { r: region.ugg, n: id.name, t: id.tag };
  const exists = await uggQuery(`query($r:String!,$n:String!,$t:String!){ liveGameExists(regionId:$r,riotUserName:$n,riotTagLine:$t) }`, v, fetchImpl);
  if (exists.liveGameExists !== true) return null;
  const data = await uggQuery(`query($r:String!,$n:String!,$t:String!){ getLiveGame(regionId:$r,riotUserName:$n,riotTagLine:$t){ gameLengthSeconds queueId teamA { ${PART} } teamB { ${PART} } } }`, v, fetchImpl);
  return toUggLive(data, now);
}

// The OP.GG shaping is shared with the browser fallback (../opgg-site.ts).
export { toOpggLive };

export async function opggLive(id: RiotId, region: Region, fetchImpl?: FetchLike, now = Date.now()): Promise<LiveGame | null> {
  const lookup = await safeFetchJson(opggSummonerUrl(region, id), { allowedHosts: [OPGG_SITE_HOST], fetchImpl });
  const summonerId = summonerIdOf(lookup);
  if (summonerId === null) throw new Error('not found');
  try {
    const data = (await safeFetchJson(opggSpectateUrl(region, summonerId), { allowedHosts: [OPGG_SITE_HOST], fetchImpl, maxBytes: 3 * 1024 * 1024 })) as Json;
    return toOpggLive(data, now);
  } catch (error) {
    // OP.GG answers 404 "data not found" when the player isn't in a game.
    if ((error as { status?: number }).status === 404) return null;
    throw error;
  }
}
