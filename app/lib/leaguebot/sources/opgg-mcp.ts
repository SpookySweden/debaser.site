/**
 * OP.GG's public app server (SPEC-leaguebot.md): `https://mcp-api.op.gg/mcp`, a JSON-RPC server OP.GG publishes for outside
 * apps. Keyless; it asks each caller to name itself (`client_app`), so we do. Server-side only.
 *
 * Used for: a player's profile (rank, LP history, past seasons), a fallback match history (20 games), and in phase 2 the
 * lane matchup guides and champion builds. Its answers come as JSON or in OP.GG's compact class text (`../opgg-decode.ts`).
 */

import { safeFetchText, type FetchLike } from '../../web/safe-fetch';
import { decodeOpggText, type Decoded } from '../opgg-decode';
import type { Region } from '../regions';
import type { RiotId } from '../riot-id';
import type { MatchupGuide } from '../live-types';
import type { Lane, LpPoint, MatchPlayer, MatchSummary, PastSeason, Profile, RankEntry } from '../types';

export const OPGG_MCP_HOST = 'mcp-api.op.gg';
const ENDPOINT = 'https://mcp-api.op.gg/mcp';
export const CLIENT_APP = 'DEBASER_OS LEAGUEBOT/1.0';

export class OpggNotFound extends Error {
  constructor() {
    super('not found');
    this.name = 'OpggNotFound';
  }
}

type Obj = { [field: string]: Decoded };
const obj = (value: Decoded | undefined): Obj => (value !== null && typeof value === 'object' && !Array.isArray(value) ? value : {});
const list = (value: Decoded | undefined): Decoded[] => (Array.isArray(value) ? value : []);
const num = (value: Decoded | undefined): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null);
const str = (value: Decoded | undefined): string => (typeof value === 'string' ? value : '');

let nextId = 1;

/** Calls one tool and returns its first text answer, decoded. */
export async function opggTool(name: string, args: Record<string, unknown>, fetchImpl?: FetchLike): Promise<Decoded> {
  const text = await safeFetchText(ENDPOINT, {
    allowedHosts: [OPGG_MCP_HOST],
    accept: 'application/json, text/event-stream',
    postJson: { jsonrpc: '2.0', id: nextId++, method: 'tools/call', params: { name, arguments: { client_app: CLIENT_APP, ...args } } },
    fetchImpl,
    maxBytes: 4 * 1024 * 1024,
  });
  // A streamed answer arrives as `data: {...}` lines; a plain one as the JSON itself.
  const body = text.trimStart().startsWith('{')
    ? text
    : text
        .split('\n')
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trim())
        .join('');
  const answer = JSON.parse(body) as { result?: { content?: { type: string; text: string }[]; isError?: boolean }; error?: { message?: string } };
  if (answer.error) {
    if (/not found/i.test(answer.error.message ?? '')) throw new OpggNotFound();
    throw new Error(answer.error.message ?? 'tool refused');
  }
  const first = answer.result?.content?.find((part) => part.type === 'text');
  if (!first) throw new Error('empty answer');
  if (answer.result?.isError) {
    if (/not found/i.test(first.text)) throw new OpggNotFound();
    throw new Error(first.text.slice(0, 200));
  }
  return decodeOpggText(first.text);
}

function tierInfo(value: Decoded | undefined): { tier: string | null; division: number | null; lp: number | null } {
  const info = obj(value);
  const tier = str(info.tier);
  return { tier: tier === '' ? null : tier.toUpperCase(), division: num(info.division), lp: num(info.lp) };
}

const PROFILE_FIELDS = [
  'data.summoner.{game_name,tagline,level,profile_image_url}',
  'data.summoner.league_stats[].tier_info.{division,lp,tier}',
  'data.summoner.league_stats[].{game_type,win,lose,is_hot_streak}',
  'data.summoner.lp_histories[].tier_info.{division,lp,tier}',
  'data.summoner.lp_histories[].{created_at,elo_point}',
  'data.summoner.previous_seasons[].tier_info.{division,lp,tier}',
  'data.summoner.previous_seasons[].season_id',
];

/** The profile from OP.GG's decoded answer. Exported for the checks, which feed it recorded answers. */
export function toProfile(decoded: Decoded, id: RiotId, region: Region): Profile {
  const summoner = obj(obj(obj(decoded).data).summoner);
  const ranks: RankEntry[] = list(summoner.league_stats)
    .map(obj)
    .filter((row) => row.game_type === 'SOLORANKED' || row.game_type === 'FLEXRANKED')
    .map((row) => ({
      queue: row.game_type === 'SOLORANKED' ? ('SOLO' as const) : ('FLEX' as const),
      ...tierInfo(row.tier_info),
      wins: num(row.win),
      losses: num(row.lose),
      hotStreak: row.is_hot_streak === true,
    }));
  const lpHistory: LpPoint[] = list(summoner.lp_histories)
    .map(obj)
    .map((row) => ({ at: str(row.created_at), ...tierInfo(row.tier_info) }))
    .filter((row): row is LpPoint & { tier: string } => row.at !== '' && row.tier !== null && row.lp !== null)
    .map((row) => ({ at: new Date(row.at).toISOString(), tier: row.tier, division: row.division, lp: row.lp as number }))
    .sort((a, b) => a.at.localeCompare(b.at));
  const pastSeasons: PastSeason[] = list(summoner.previous_seasons)
    .map(obj)
    .map((row) => ({ season: num(row.season_id) ?? 0, ...tierInfo(row.tier_info) }))
    .filter((row): row is PastSeason => row.tier !== null)
    .sort((a, b) => b.season - a.season);
  const icon = /profileIcon(\d+)/.exec(str(summoner.profile_image_url));
  return {
    riotId: { name: str(summoner.game_name) || id.name, tag: str(summoner.tagline) || id.tag },
    region: region.id,
    level: num(summoner.level),
    iconId: icon ? Number(icon[1]) : null,
    ranks,
    lpHistory,
    lpFrom: lpHistory.length > 0 ? 'OP.GG' : null,
    pastSeasons,
  };
}

export async function opggProfile(id: RiotId, region: Region, fetchImpl?: FetchLike): Promise<Profile> {
  const decoded = await opggTool('lol_get_summoner_profile', { game_name: id.name, tag_line: id.tag, region: region.opgg.toUpperCase(), desired_output_fields: PROFILE_FIELDS }, fetchImpl);
  return toProfile(decoded, id, region);
}

function opggLane(position: string): Lane | null {
  switch (position.toUpperCase()) {
    case 'TOP':
      return 'TOP';
    case 'JUNGLE':
      return 'JUNGLE';
    case 'MID':
      return 'MID';
    case 'ADC':
    case 'BOTTOM':
      return 'BOTTOM';
    case 'SUPPORT':
      return 'SUPPORT';
    default:
      return null;
  }
}

const MATCH_FIELDS = [
  'data.game_history[].{created_at,game_length_second,game_type,id}',
  'data.game_history[].participants[].{champion_id,position,team_key,items[],spells[]}',
  'data.game_history[].participants[].summoner.{game_name,tagline}',
  'data.game_history[].participants[].rune.{primary_page_id,primary_rune_id,secondary_page_id}',
  'data.game_history[].participants[].stats.{kill,death,assist,minion_kill,neutral_minion_kill,gold_earned,total_damage_dealt_to_champions,result}',
  'data.game_history[].teams[].{key}',
  'data.game_history[].teams[].game_stat.{champion_kill}',
];

/** OP.GG's history in LEAGUEBOT's shape (ranked solo only). Exported for the checks. */
export function toOpggMatches(decoded: Decoded, id: RiotId): MatchSummary[] {
  const games = list(obj(obj(decoded).data).game_history).map(obj);
  const out: MatchSummary[] = [];
  for (const game of games) {
    if (game.game_type !== 'SOLORANKED') continue;
    const parts = list(game.participants).map(obj);
    const players: MatchPlayer[] = parts.map((p) => {
      const summoner = obj(p.summoner);
      return { championId: num(p.champion_id) ?? 0, name: str(summoner.game_name), tag: str(summoner.tagline), lane: opggLane(str(p.position)), team: p.team_key === 'RED' ? 200 : 100 };
    });
    const index = players.findIndex((p) => p.name.toLowerCase() === id.name.toLowerCase() && p.tag.toLowerCase() === id.tag.toLowerCase());
    if (index < 0) continue;
    const me = parts[index];
    const stats = obj(me.stats);
    const rune = obj(me.rune);
    const team = players[index].team;
    const teamKills = num(obj(list(game.teams).map(obj).find((t) => (t.key === 'RED' ? 200 : 100) === team)?.game_stat).champion_kill);
    const kills = num(stats.kill) ?? 0;
    const assists = num(stats.assist) ?? 0;
    out.push({
      id: str(game.id),
      version: '',
      at: Date.parse(str(game.created_at)) || 0,
      durationSec: num(game.game_length_second) ?? 0,
      win: stats.result === 'WIN',
      championId: players[index].championId,
      lane: players[index].lane,
      kills,
      deaths: num(stats.death) ?? 0,
      assists,
      cs: (num(stats.minion_kill) ?? 0) + (num(stats.neutral_minion_kill) ?? 0),
      gold: num(stats.gold_earned) ?? 0,
      damage: num(stats.total_damage_dealt_to_champions) ?? 0,
      vision: null,
      killParticipation: teamKills && teamKills > 0 ? Math.round(((kills + assists) / teamKills) * 100) : null,
      items: list(me.items).filter((v): v is number => typeof v === 'number'),
      spells: list(me.spells).filter((v): v is number => typeof v === 'number'),
      runes: [num(rune.primary_rune_id)].filter((v): v is number => v !== null),
      primaryStyle: num(rune.primary_page_id),
      subStyle: num(rune.secondary_page_id),
      team,
      players,
    });
  }
  return out;
}

/** OP.GG's spelling of a champion for its guides: the display name in capitals, words joined by `_`, marks dropped. */
export function opggChampionWord(displayName: string): string {
  return displayName
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/['.&]/g, '')
    .trim()
    .split(/\s+/)
    .join('_')
    .toUpperCase();
}

/** Champion number -> OP.GG's spelling, from OP.GG's own list. */
export async function opggChampionWords(fetchImpl?: FetchLike): Promise<Map<number, string>> {
  const decoded = await opggTool('lol_list_champions', { desired_output_fields: [] }, fetchImpl);
  const words = new Map<number, string>();
  for (const champion of list(obj(obj(decoded).data).champions).map(obj)) {
    const id = num(champion.champion_id);
    const name = str(champion.name);
    if (id !== null && name !== '') words.set(id, opggChampionWord(name));
  }
  return words;
}

const GUIDE_POSITION: Record<Lane, string> = { TOP: 'top', JUNGLE: 'jungle', MID: 'mid', BOTTOM: 'adc', SUPPORT: 'support' };

const firstIds = (value: Decoded | undefined): number[] =>
  list(obj(list(value)[0]).ids).filter((v): v is number => typeof v === 'number');

/** OP.GG's lane matchup guide in LEAGUEBOT's shape. Exported for the checks. */
export function toMatchupGuide(decoded: Decoded, lane: Lane, myChampionId: number, opponentChampionId: number): MatchupGuide {
  const data = obj(obj(decoded).data);
  const rune = obj(list(data.runes)[0]);
  const ids = (value: Decoded | undefined) => list(value).filter((v): v is number => typeof v === 'number');
  const tip = str(data.opponent_champion_tip).trim();
  const skills = list(obj(list(data.skills)[0]).order).filter((v): v is string => typeof v === 'string' && /^[QWER]$/.test(v));
  return {
    lane,
    myChampionId,
    opponentChampionId,
    tip: tip === '' ? null : tip.slice(0, 600),
    laneAdvantage: str(data.lane_advantage_champion) || null,
    soloKillAdvantage: str(data.lane_solo_kill_advantage_champion) || null,
    playStyle: str(data.recommended_play_style) || null,
    spells: firstIds(data.summoner_spells),
    starter: firstIds(data.starter_items),
    core: firstIds(data.core_items),
    boots: firstIds(data.boots)[0] ?? null,
    runes:
      num(rune.primary_page_id) !== null && num(rune.secondary_page_id) !== null
        ? { primaryStyle: num(rune.primary_page_id) as number, primary: ids(rune.primary_rune_ids), subStyle: num(rune.secondary_page_id) as number, secondary: ids(rune.secondary_rune_ids), shards: ids(rune.stat_mod_ids) }
        : null,
    skills: skills.slice(0, 18),
  };
}

export async function opggMatchup(lane: Lane, mine: string, theirs: string, myChampionId: number, opponentChampionId: number, fetchImpl?: FetchLike): Promise<MatchupGuide> {
  const decoded = await opggTool('lol_get_lane_matchup_guide', { position: GUIDE_POSITION[lane], my_champion: mine, opponent_champion: theirs }, fetchImpl);
  return toMatchupGuide(decoded, lane, myChampionId, opponentChampionId);
}

export async function opggMatches(id: RiotId, region: Region, fetchImpl?: FetchLike): Promise<MatchSummary[]> {
  const decoded = await opggTool('lol_list_summoner_matches', { game_name: id.name, tag_line: id.tag, region: region.opgg.toUpperCase(), limit: 20, desired_output_fields: MATCH_FIELDS }, fetchImpl);
  return toOpggMatches(decoded, id);
}
