/**
 * LEAGUEBOT's servers (SPEC-leaguebot.md): the name a player knows, and how each source spells it. Pure, so the page, the
 * routes and the checks share one list.
 */

export type RegionId =
  | 'EUW'
  | 'EUNE'
  | 'NA'
  | 'KR'
  | 'BR'
  | 'LAN'
  | 'LAS'
  | 'OCE'
  | 'TR'
  | 'RU'
  | 'JP'
  | 'PH'
  | 'SG'
  | 'TH'
  | 'TW'
  | 'VN'
  | 'ME';

export type Region = {
  id: RegionId;
  /** U.GG's region id (Riot's platform id, lower case). */
  ugg: string;
  /** OP.GG's site and app server spelling. */
  opgg: string;
};

export const REGIONS: readonly Region[] = [
  { id: 'EUW', ugg: 'euw1', opgg: 'euw' },
  { id: 'EUNE', ugg: 'eun1', opgg: 'eune' },
  { id: 'NA', ugg: 'na1', opgg: 'na' },
  { id: 'KR', ugg: 'kr', opgg: 'kr' },
  { id: 'BR', ugg: 'br1', opgg: 'br' },
  { id: 'LAN', ugg: 'la1', opgg: 'lan' },
  { id: 'LAS', ugg: 'la2', opgg: 'las' },
  { id: 'OCE', ugg: 'oc1', opgg: 'oce' },
  { id: 'TR', ugg: 'tr1', opgg: 'tr' },
  { id: 'RU', ugg: 'ru', opgg: 'ru' },
  { id: 'JP', ugg: 'jp1', opgg: 'jp' },
  { id: 'PH', ugg: 'ph2', opgg: 'ph' },
  { id: 'SG', ugg: 'sg2', opgg: 'sg' },
  { id: 'TH', ugg: 'th2', opgg: 'th' },
  { id: 'TW', ugg: 'tw2', opgg: 'tw' },
  { id: 'VN', ugg: 'vn2', opgg: 'vn' },
  { id: 'ME', ugg: 'me1', opgg: 'me' },
];

export const DEFAULT_REGION: RegionId = 'EUW';

export function regionById(id: unknown): Region | null {
  return REGIONS.find((region) => region.id === id) ?? null;
}
