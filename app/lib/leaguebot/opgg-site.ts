/**
 * OP.GG's site API (`lol-api-summoner.op.gg`, SPEC-leaguebot.md): the JSON OP.GG's own pages read. It answers any browser
 * (CORS `*`), so when U.GG turns LEAGUEBOT's server away the visitor's own browser can read a player's games and live game
 * from here over their own connection (`./browser-opgg.ts`); the server uses the same shaping (`./sources/live.ts`).
 * Pure: addresses built from validated values, and answers turned into LEAGUEBOT's shapes. No fetching here.
 *
 * Said once (SPEC-leaguebot.md, "The terms"): OP.GG's terms forbid scraping and republishing; Luke accepted the risk (8A).
 */

import type { LiveGame, LivePlayer } from './live-types';
import type { Region } from './regions';
import { sameRiotId, type RiotId } from './riot-id';
import type { Lane, MatchPlayer, MatchSummary } from './types';

export const OPGG_SITE_HOST = 'lol-api-summoner.op.gg';
const SITE = `https://${OPGG_SITE_HOST}`;
/** OP.GG's own summoner ids: base64-ish, never anything that could leave the path. */
const SUMMONER_ID = /^[A-Za-z0-9_-]{10,100}$/;

type Json = Record<string, unknown>;
const num = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null);
const str = (value: unknown): string => (typeof value === 'string' ? value : '');
const nums = (value: unknown): number[] => (Array.isArray(value) ? value.filter((v): v is number => typeof v === 'number' && v > 0) : []);
const arr = (value: unknown): Json[] => (Array.isArray(value) ? (value as Json[]) : []);

export function opggLane(position: unknown): Lane | null {
  switch (str(position).toUpperCase()) {
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

export function isOpggSummonerId(value: unknown): value is string {
  return typeof value === 'string' && SUMMONER_ID.test(value);
}

/** The look-up of a Riot ID: its answer's first `summoner_id`. */
export function opggSummonerUrl(region: Region, id: RiotId): string {
  return `${SITE}/api/v3/${region.opgg}/summoners?riot_id=${encodeURIComponent(`${id.name}#${id.tag}`)}&hl=en_US`;
}

/** Twenty ranked solo games, the newest first; `endedAt` (a game's `created_at`) asks for the twenty before it. */
export function opggGamesUrl(region: Region, summonerId: string, endedAt?: string): string {
  if (!isOpggSummonerId(summonerId)) throw new Error('not an OP.GG summoner id');
  const ended = endedAt && !Number.isNaN(Date.parse(endedAt)) ? `&ended_at=${encodeURIComponent(endedAt)}` : '';
  return `${SITE}/api/${region.opgg}/summoners/${summonerId}/games?limit=20&hl=en_US&game_type=soloranked${ended}`;
}

export function opggSpectateUrl(region: Region, summonerId: string): string {
  if (!isOpggSummonerId(summonerId)) throw new Error('not an OP.GG summoner id');
  return `${SITE}/api/${region.opgg}/spectates/${summonerId}?hl=en_US`;
}

/** The summoner id from a look-up answer, or null. */
export function summonerIdOf(answer: unknown): string | null {
  const first = arr((answer as Json | null)?.data)[0];
  const id = str(first?.summoner_id);
  return isOpggSummonerId(id) ? id : null;
}

/** One page of OP.GG's game list in LEAGUEBOT's shape (remakes and games the player isn't in are left out). */
export function toOpggSiteMatches(answer: unknown, id: RiotId): MatchSummary[] {
  const out: MatchSummary[] = [];
  for (const game of arr((answer as Json | null)?.data)) {
    if (game.is_remake === true) continue;
    const parts = arr(game.participants);
    const players: MatchPlayer[] = parts.map((p) => {
      const summoner = (p.summoner ?? {}) as Json;
      return { championId: num(p.champion_id) ?? 0, name: str(summoner.game_name), tag: str(summoner.tagline), lane: opggLane(p.position), team: p.team_key === 'RED' ? 200 : 100 };
    });
    const index = players.findIndex((p) => sameRiotId(p, id));
    if (index < 0) continue;
    const me = parts[index];
    const stats = (me.stats ?? {}) as Json;
    const rune = (me.rune ?? {}) as Json;
    const team = players[index].team;
    const teamStat = (arr(game.teams).find((t) => (t.key === 'RED' ? 200 : 100) === team)?.game_stat ?? {}) as Json;
    const teamKills = num(teamStat.champion_kill);
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
      vision: num(stats.vision_score),
      killParticipation: teamKills && teamKills > 0 ? Math.round(((kills + assists) / teamKills) * 100) : null,
      items: nums(me.items),
      spells: nums(me.spells),
      runes: [num(rune.primary_rune_id)].filter((v): v is number => v !== null),
      primaryStyle: num(rune.primary_page_id),
      subStyle: num(rune.secondary_page_id),
      team,
      players,
    });
  }
  return out;
}

/** OP.GG's spectate answer in LEAGUEBOT's shape. */
export function toOpggLive(data: Json, now: number): LiveGame | null {
  const game = data.data as Json | undefined;
  if (!game || !Array.isArray(game.participants)) return null;
  const created = Date.parse(str(game.created_at));
  const players: LivePlayer[] = (game.participants as Json[]).map((p) => {
    const summoner = (p.summoner ?? {}) as Json;
    const solo = arr(summoner.league_stats).find((l) => l.game_type === 'SOLORANKED');
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
  const bans = arr(game.teams).flatMap((t) => nums(t.banned_champions));
  return {
    queueId: num(game.queue_id) ?? 0,
    lengthSec: Number.isFinite(created) ? Math.max(0, Math.round((now - created) / 1000)) : 0,
    fetchedAt: now,
    players,
    bans,
  };
}
