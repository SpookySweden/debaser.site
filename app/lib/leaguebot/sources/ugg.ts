/**
 * U.GG's site API (SPEC-leaguebot.md): the GraphQL endpoint U.GG's own pages call, `POST https://u.gg/api`. Keyless and
 * unofficial: it can change or refuse us without warning, which is why every answer here has an OP.GG fallback (where one
 * exists) in `../pick-source.ts`. Server-side only; the browser never imports this.
 *
 * Used for: ranked match history (paged, 20 a page), past seasons' ranks, a profile refresh, the live game and a match's
 * timeline (phases 2 and 3). U.GG's paid-only answers (`not_premium`, e.g. a player's matchup records) are not asked for:
 * LEAGUEBOT works those out from the match history itself.
 */

import { safeFetchJson, type FetchLike } from '../../web/safe-fetch';
import type { Region } from '../regions';
import type { RiotId } from '../riot-id';
import type { Lane, LpPoint, MatchPlayer, MatchSummary, PastSeason, RankEntry } from '../types';

export const UGG_HOST = 'u.gg';
const ENDPOINT = 'https://u.gg/api';

export class UggError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UggError';
  }
}

type Json = Record<string, unknown>;

export async function uggQuery(query: string, variables: Json, fetchImpl?: FetchLike): Promise<Json> {
  const answer = (await safeFetchJson(ENDPOINT, { allowedHosts: [UGG_HOST], postJson: { query, variables }, fetchImpl, maxBytes: 4 * 1024 * 1024 })) as Json;
  const errors = Array.isArray(answer.errors) ? (answer.errors as Json[]) : [];
  if (errors.length > 0 && (answer.data === undefined || answer.data === null)) throw new UggError(String(errors[0]?.message ?? 'query refused'));
  return (answer.data ?? {}) as Json;
}

/** U.GG's role numbers. */
export function uggLane(role: unknown): Lane | null {
  switch (role) {
    case 1:
      return 'JUNGLE';
    case 2:
      return 'SUPPORT';
    case 3:
      return 'BOTTOM';
    case 4:
      return 'TOP';
    case 5:
      return 'MID';
    default:
      return null;
  }
}

const num = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) ? value : 0);
const nums = (value: unknown): number[] => (Array.isArray(value) ? value.filter((v): v is number => typeof v === 'number' && Number.isFinite(v)) : []);
const str = (value: unknown): string => (typeof value === 'string' ? value : '');

const TEAM_FIELDS = 'championId riotUserName riotTagLine role teamId';
export const SUMMARY_FIELDS = `matchId matchCreationTime matchDuration version win championId role kills deaths assists cs jungleCs gold damage visionScore killParticipation items summonerSpells runes primaryStyle subStyle teamA { ${TEAM_FIELDS} } teamB { ${TEAM_FIELDS} }`;

function toPlayers(list: unknown, team: 100 | 200): MatchPlayer[] {
  if (!Array.isArray(list)) return [];
  return (list as Json[]).map((p) => ({ championId: num(p.championId), name: str(p.riotUserName), tag: str(p.riotTagLine), lane: uggLane(p.role), team }));
}

/** One of U.GG's match summaries in LEAGUEBOT's shape. */
export function toMatchSummary(row: Json, me: RiotId): MatchSummary {
  const players = [...toPlayers(row.teamA, 100), ...toPlayers(row.teamB, 200)];
  const mine = players.find((p) => p.name.toLowerCase() === me.name.toLowerCase() && p.tag.toLowerCase() === me.tag.toLowerCase());
  const teamA = Array.isArray(row.teamA) ? (row.teamA as Json[]) : [];
  const team: 100 | 200 = mine?.team ?? (teamA.some((p) => p.championId === row.championId) ? 100 : 200);
  return {
    id: String(row.matchId ?? ''),
    version: str(row.version),
    at: num(row.matchCreationTime),
    durationSec: num(row.matchDuration),
    win: row.win === true,
    championId: num(row.championId),
    lane: uggLane(row.role),
    kills: num(row.kills),
    deaths: num(row.deaths),
    assists: num(row.assists),
    cs: num(row.cs) + num(row.jungleCs),
    gold: num(row.gold),
    damage: num(row.damage),
    vision: num(row.visionScore),
    killParticipation: num(row.killParticipation),
    items: nums(row.items),
    spells: nums(row.summonerSpells),
    runes: nums(row.runes),
    primaryStyle: typeof row.primaryStyle === 'number' ? row.primaryStyle : null,
    subStyle: typeof row.subStyle === 'number' ? row.subStyle : null,
    team,
    players,
  };
}

/** Seasons wide enough to cover "recent" for years: the list only filters, so a season that doesn't exist yet costs nothing. */
const SEASONS = Array.from({ length: 21 }, (_, i) => 20 + i);

/** The player's last `want` ranked solo games, newest first, read 20 at a time. */
export async function uggMatches(id: RiotId, region: Region, want: number, fetchImpl?: FetchLike): Promise<MatchSummary[]> {
  const out: MatchSummary[] = [];
  for (let page = 1; out.length < want && page <= 10; page += 1) {
    const data = await uggQuery(
      `query($r:String!,$n:String!,$t:String!,$p:Int,$s:[Int]){ fetchPlayerMatchSummaries(regionId:$r,riotUserName:$n,riotTagLine:$t,queueType:[420],seasonIds:$s,page:$p,role:[],championId:[],duoRiotUserName:"",duoRiotTagLine:""){ matchSummaries { ${SUMMARY_FIELDS} } } }`,
      { r: region.ugg, n: id.name, t: id.tag, p: page, s: SEASONS },
      fetchImpl,
    );
    const rows = ((data.fetchPlayerMatchSummaries as Json | null)?.matchSummaries ?? []) as Json[];
    out.push(...rows.map((row) => toMatchSummary(row, id)));
    if (rows.length < 20) break;
  }
  return out.slice(0, want);
}

/** Current solo rank and past seasons, U.GG's way (the fallback for OP.GG's profile). */
export async function uggRanks(id: RiotId, region: Region, fetchImpl?: FetchLike): Promise<{ ranks: RankEntry[]; pastSeasons: PastSeason[] }> {
  const v = { r: region.ugg, n: id.name, t: id.tag };
  const history = await uggQuery(`query($r:String!,$n:String!,$t:String!){ getHistoricRanks(regionId:$r,riotUserName:$n,riotTagLine:$t,queueType:420){ season tier rank lp } }`, v, fetchImpl);
  const past = ((history.getHistoricRanks ?? []) as Json[])
    .map((row) => ({ season: num(row.season), tier: str(row.tier).toUpperCase(), division: romanToNumber(str(row.rank)), lp: typeof row.lp === 'number' ? row.lp : null }))
    .filter((row) => row.tier !== '')
    .sort((a, b) => b.season - a.season);
  const current = past.length > 0 ? past[0].season + 1 : 26;
  const now = await uggQuery(
    `query($r:String!,$n:String!,$t:String!,$s:Int!){ fetchProfileRanks(regionId:$r,riotUserName:$n,riotTagLine:$t,seasonId:$s){ rankScores { queueType tier rank lp wins losses } } }`,
    { ...v, s: current },
    fetchImpl,
  );
  const scores = (((now.fetchProfileRanks as Json | null)?.rankScores ?? []) as Json[]).filter((row) => str(row.tier) !== '');
  const ranks: RankEntry[] = scores
    .filter((row) => row.queueType === 'ranked_solo_5x5' || row.queueType === 'ranked_flex_sr')
    .map((row) => ({
      queue: row.queueType === 'ranked_solo_5x5' ? 'SOLO' : 'FLEX',
      tier: str(row.tier).toUpperCase(),
      division: romanToNumber(str(row.rank)),
      lp: typeof row.lp === 'number' ? row.lp : null,
      wins: typeof row.wins === 'number' ? row.wins : null,
      losses: typeof row.losses === 'number' ? row.losses : null,
      hotStreak: false,
    }));
  return { ranks, pastSeasons: past };
}

/** U.GG's rank snapshots (one after every ranked solo game it has read) as LP over time, oldest first. Exported for the checks. */
export function toUggLpHistory(data: Json): LpPoint[] {
  const rows = (Array.isArray(data.getSummonerRankSnapshots) ? data.getSummonerRankSnapshots : []) as Json[];
  const points = rows
    .map((row) => ({ at: num(row.insertedAt), tier: str(row.tier).toUpperCase(), division: romanToNumber(str(row.rank)), lp: typeof row.lp === 'number' ? row.lp : null }))
    .filter((p): p is { at: number; tier: string; division: number | null; lp: number } => p.at > 0 && p.tier !== '' && p.lp !== null)
    .sort((a, b) => a.at - b.at)
    .map((p) => ({ at: new Date(p.at * 1000).toISOString(), tier: p.tier, division: p.division, lp: p.lp }));
  // One point per change: the same rank and LP twice in a row says nothing new.
  return points.filter((p, i) => i === 0 || p.tier !== points[i - 1].tier || p.division !== points[i - 1].division || p.lp !== points[i - 1].lp);
}

export async function uggLpHistory(id: RiotId, region: Region, fetchImpl?: FetchLike): Promise<LpPoint[]> {
  const data = await uggQuery(
    `query($r:String!,$n:String!,$t:String!){ getSummonerRankSnapshots(regionId:$r,riotUserName:$n,riotTagLine:$t,queueType:420){ insertedAt lp rank tier } }`,
    { r: region.ugg, n: id.name, t: id.tag },
    fetchImpl,
  );
  return toUggLpHistory(data);
}

/** Asks U.GG to read the player's newest games from Riot now (the [ REFRESH ] key). */
export async function uggRefresh(id: RiotId, region: Region, fetchImpl?: FetchLike): Promise<boolean> {
  // A query on U.GG's schema (2026-11-17), not a mutation.
  const data = await uggQuery(
    `query($r:String!,$n:String!,$t:String!){ updatePlayerProfile(regionId:$r,riotUserName:$n,riotTagLine:$t){ success errorReason } }`,
    { r: region.ugg, n: id.name, t: id.tag },
    fetchImpl,
  );
  return (data.updatePlayerProfile as Json | null)?.success === true;
}

export function romanToNumber(text: string): number | null {
  const value = { I: 1, II: 2, III: 3, IV: 4 }[text.toUpperCase()];
  return value ?? null;
}
