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
import { romanToNumber, uggQuery } from './ugg';

export const OPGG_SITE_HOST = 'lol-api-summoner.op.gg';

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

function opggLane(position: unknown): Lane | null {
  switch (str(position).toUpperCase()) {
    case 'TOP':
      return 'TOP';
    case 'JUNGLE':
      return 'JUNGLE';
    case 'MID':
      return 'MID';
    case 'ADC':
      return 'BOTTOM';
    case 'SUPPORT':
      return 'SUPPORT';
    default:
      return null;
  }
}

/** OP.GG's spectate answer in LEAGUEBOT's shape. Exported for the checks. */
export function toOpggLive(data: Json, now: number): LiveGame | null {
  const game = data.data as Json | undefined;
  if (!game || !Array.isArray(game.participants)) return null;
  const created = Date.parse(str(game.created_at));
  const players: LivePlayer[] = (game.participants as Json[]).map((p) => {
    const summoner = (p.summoner ?? {}) as Json;
    const solo = (Array.isArray(summoner.league_stats) ? (summoner.league_stats as Json[]) : []).find((l) => l.game_type === 'SOLORANKED');
    const tierInfo = (solo?.tier_info ?? {}) as Json;
    const tier = str(tierInfo.tier).toUpperCase();
    const runes = (p.rune_build ?? {}) as Json;
    const most = (p.most_champion_stat ?? null) as Json | null;
    const sameChampion = most !== null && num(most.id) === num(p.champion_id);
    return {
      team: p.team_key === 'RED' ? 200 : 100,
      championId: num(p.champion_id) ?? 0,
      name: str(summoner.game_name),
      tag: str(summoner.tagline),
      lane: opggLane(p.position),
      onRole: null,
      spells: nums(p.spells),
      primaryStyle: num(runes.primary_page_id),
      subStyle: num(runes.secondary_page_id),
      keystone: nums(runes.primary_rune_ids)[0] ?? null,
      rank: tier === '' ? null : { tier, division: num(tierInfo.division), lp: num(tierInfo.lp), wins: num(solo?.win), losses: num(solo?.lose) },
      championGames: sameChampion ? num(most?.play) : null,
      championWins: sameChampion ? num(most?.win) : null,
      lanes: [],
      party: null,
    };
  });
  const bans = (Array.isArray(game.teams) ? (game.teams as Json[]) : []).flatMap((t) => nums(t.banned_champions));
  return {
    queueId: num(game.queue_id) ?? 0,
    lengthSec: Number.isFinite(created) ? Math.max(0, Math.round((now - created) / 1000)) : 0,
    fetchedAt: now,
    players,
    bans,
  };
}

export async function opggLive(id: RiotId, region: Region, fetchImpl?: FetchLike, now = Date.now()): Promise<LiveGame | null> {
  const lookup = (await safeFetchJson(`https://${OPGG_SITE_HOST}/api/v3/${region.opgg}/summoners?riot_id=${encodeURIComponent(`${id.name}#${id.tag}`)}&hl=en_US`, {
    allowedHosts: [OPGG_SITE_HOST],
    fetchImpl,
  })) as Json;
  const first = (Array.isArray(lookup.data) ? (lookup.data as Json[]) : [])[0];
  const summonerId = str(first?.summoner_id);
  if (!/^[A-Za-z0-9_-]{10,100}$/.test(summonerId)) throw new Error('not found');
  try {
    const data = (await safeFetchJson(`https://${OPGG_SITE_HOST}/api/${region.opgg}/spectates/${summonerId}?hl=en_US`, { allowedHosts: [OPGG_SITE_HOST], fetchImpl, maxBytes: 3 * 1024 * 1024 })) as Json;
    return toOpggLive(data, now);
  } catch (error) {
    // OP.GG answers 404 "data not found" when the player isn't in a game.
    if ((error as { status?: number }).status === 404) return null;
    throw error;
  }
}
