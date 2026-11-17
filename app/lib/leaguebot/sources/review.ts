/**
 * One finished game in detail (SPEC-leaguebot.md, phase 3), from U.GG's site API: gold, CS and XP against the lane opponent
 * each minute, the items bought and the skill order, every kill and objective, and all ten scoreboards. U.GG alone has the
 * minute-by-minute frames, so there is no fallback: the window says so when it doesn't answer. Server-side only.
 */

import type { FetchLike } from '../../web/safe-fetch';
import type { Region } from '../regions';
import { sameRiotId, type RiotId } from '../riot-id';
import type { MatchReview, ReviewEvent, ReviewFrame, ReviewPlayer, ReviewTeam } from '../review-types';
import { uggLane, uggQuery } from './ugg';

type Json = Record<string, unknown>;
const num = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) ? value : 0);
const str = (value: unknown): string => (typeof value === 'string' ? value : '');
const arr = (value: unknown): Json[] => (Array.isArray(value) ? (value as Json[]) : []);
const nums = (value: unknown): number[] => (Array.isArray(value) ? value.filter((v): v is number => typeof v === 'number') : []);

const FRAME = 'timestamp youValue oppValue';
const QUERY = `query($r:String!,$n:String!,$t:String!,$id:String!,$v:String!){ match(regionId:$r,riotUserName:$n,riotTagLine:$t,matchId:$id,version:$v){ winningTeam
 matchSummary { matchDuration }
 historicalData { csDifferenceFrames { ${FRAME} } goldDifferenceFrames { ${FRAME} } xpDifferenceFrames { ${FRAME} }
  itemPath { itemId timestamp type } skillPath runes primaryStyle subStyle
  teamOneOverview { kills gold towerKills dragonKills baronKills riftHeraldKills bans } teamTwoOverview { kills gold towerKills dragonKills baronKills riftHeraldKills bans }
  postGameData { riotUserName riotTagLine championId teamId role kills deaths assists cs jungleCs gold damage damageTaken visionScore wardsPlaced level items summonerSpells keystone }
  timelineData { eventType timestamp riotUserName riotTagLine victimRiotUserName victimRiotTagLine monsterType buildingType teamId }
 } } }`;

const SKILL = ['', 'Q', 'W', 'E', 'R'];
const MONSTER: Record<string, ReviewEvent['kind']> = { dragon: 'dragon', horde: 'grubs', riftherald: 'herald', baron_nashor: 'baron', baron: 'baron' };

function toPlayer(p: Json): ReviewPlayer {
  return {
    name: str(p.riotUserName),
    tag: str(p.riotTagLine),
    championId: num(p.championId),
    team: num(p.teamId) === 200 ? 200 : 100,
    lane: uggLane(p.role),
    kills: num(p.kills),
    deaths: num(p.deaths),
    assists: num(p.assists),
    cs: num(p.cs) + num(p.jungleCs),
    gold: num(p.gold),
    damage: num(p.damage),
    damageTaken: num(p.damageTaken),
    vision: num(p.visionScore),
    wards: num(p.wardsPlaced),
    level: num(p.level),
    items: nums(p.items),
    spells: nums(p.summonerSpells),
    keystone: typeof p.keystone === 'number' ? p.keystone : null,
  };
}

function toTeam(t: Json, team: 100 | 200): ReviewTeam {
  return { team, kills: num(t.kills), gold: num(t.gold), towers: num(t.towerKills), dragons: num(t.dragonKills), barons: num(t.baronKills), heralds: num(t.riftHeraldKills), bans: nums(t.bans) };
}

/** U.GG's match answer in LEAGUEBOT's shape. Exported for the checks. */
export function toReview(data: Json, id: RiotId, matchId: string): MatchReview | null {
  const match = data.match as Json | null;
  const h = match?.historicalData as Json | null;
  if (!match || !h) return null;
  const players = arr(h.postGameData).map(toPlayer);
  const me = players.find((p) => sameRiotId(p, id));
  if (!me) return null;
  const opponent = me.lane === null ? null : (players.find((p) => p.team !== me.team && p.lane === me.lane) ?? null);
  const teamOf = (name: string, tag: string) => players.find((p) => sameRiotId(p, { name, tag }))?.team ?? null;
  const championOf = (name: string, tag: string) => players.find((p) => sameRiotId(p, { name, tag }))?.championId ?? null;

  const byMinute = new Map<number, ReviewFrame>();
  const take = (list: unknown, key: 'gold' | 'cs' | 'xp') => {
    for (const f of arr(list)) {
      const minute = num(f.timestamp);
      const frame = byMinute.get(minute) ?? { minute, gold: [0, 0], cs: [0, 0], xp: [0, 0] };
      frame[key] = [num(f.youValue), num(f.oppValue)];
      byMinute.set(minute, frame);
    }
  };
  take(h.goldDifferenceFrames, 'gold');
  take(h.csDifferenceFrames, 'cs');
  take(h.xpDifferenceFrames, 'xp');

  const events: ReviewEvent[] = [];
  let wardsPlaced = 0;
  for (const e of arr(h.timelineData)) {
    const at = Math.round(num(e.timestamp) / 1000);
    const type = str(e.eventType);
    const actor = { name: str(e.riotUserName), tag: str(e.riotTagLine) };
    if (type === 'ward_placed' && sameRiotId(actor, id)) wardsPlaced += 1;
    else if (type === 'champion_kill') {
      const victim = { name: str(e.victimRiotUserName), tag: str(e.victimRiotTagLine) };
      if (sameRiotId(victim, id)) events.push({ atSec: at, kind: 'death', team: teamOf(actor.name, actor.tag), championId: championOf(actor.name, actor.tag) });
      else if (sameRiotId(actor, id)) events.push({ atSec: at, kind: 'kill', team: me.team, championId: championOf(victim.name, victim.tag) });
    } else if (type === 'monster_kill') {
      const kind = MONSTER[str(e.monsterType).toLowerCase()];
      if (kind) events.push({ atSec: at, kind, team: teamOf(actor.name, actor.tag), championId: null });
    } else if (type === 'building_kill' && /tower/i.test(str(e.buildingType))) {
      events.push({ atSec: at, kind: 'tower', team: teamOf(actor.name, actor.tag), championId: null });
    }
  }
  // Void grubs come as one event each: keep the first of each group.
  const kept = events
    .sort((a, b) => a.atSec - b.atSec)
    .filter((e, i, list) => !(e.kind === 'grubs' && list.slice(0, i).some((x) => x.kind === 'grubs' && e.atSec - x.atSec < 90)));

  return {
    id: matchId,
    win: num(match.winningTeam) === me.team,
    durationSec: num((match.matchSummary as Json | null)?.matchDuration),
    me,
    opponent,
    frames: [...byMinute.values()].sort((a, b) => a.minute - b.minute),
    buys: arr(h.itemPath)
      .filter((i) => num(i.type) === 1)
      .map((i) => ({ itemId: num(i.itemId), atSec: Math.round(num(i.timestamp) / 1000) })),
    skills: nums(h.skillPath).map((s) => SKILL[s] ?? '').filter((s) => s !== ''),
    runes: nums(h.runes),
    primaryStyle: typeof h.primaryStyle === 'number' ? h.primaryStyle : null,
    subStyle: typeof h.subStyle === 'number' ? h.subStyle : null,
    players,
    teams: [toTeam((h.teamOneOverview ?? {}) as Json, 100), toTeam((h.teamTwoOverview ?? {}) as Json, 200)],
    events: kept,
    wardsPlaced,
  };
}

export async function uggReview(id: RiotId, region: Region, matchId: string, version: string, fetchImpl?: FetchLike): Promise<MatchReview | null> {
  const data = await uggQuery(QUERY, { r: region.ugg, n: id.name, t: id.tag, id: matchId, v: version }, fetchImpl);
  return toReview(data, id, matchId);
}
