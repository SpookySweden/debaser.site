/**
 * One champion's abilities for LEAGUEBOT's CHAMPION panel (SPEC-leaguebot-live-champs.md), read in the browser from
 * Data Dragon's per-champion file for the current patch: passive, Q, W, E, R with Riot's own icons, descriptions,
 * cooldowns, costs and ranges at every rank, and the crowd control named in Riot's own text. The icons load straight from
 * Riot's servers (core.md's fourth art exception). These are fixed numbers for the patch, never timers: nothing from
 * inside a match is known here. The builder is pure, for the checks.
 */

import { DDRAGON_HOST } from './static-data';

const DDRAGON = `https://${DDRAGON_HOST}`;
const LANG = 'en_GB';

export type AbilityKey = 'P' | 'Q' | 'W' | 'E' | 'R';

export type KitAbility = {
  key: AbilityKey;
  name: string;
  /** Riot's description as plain text (its markup removed). */
  description: string;
  icon: string;
  /** Seconds at each rank; empty for the passive. */
  cooldowns: number[];
  costs: number[];
  /** `MANA`, `ENERGY`, `HEALTH`, ... or null when it costs nothing. */
  costWord: string | null;
  /** Units at each rank; empty when global or not given. */
  ranges: number[];
  /** Crowd control named in Riot's text, plain words (`stun`, `knock-up`). */
  cc: string[];
};

export type ChampionKit = {
  alias: string;
  id: number;
  name: string;
  title: string;
  patch: string;
  abilities: KitAbility[];
};

type Json = Record<string, unknown>;

const ENTITIES: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&nbsp;': ' ' };

/** Riot's markup (`<br>`, `<magicDamage>`, `{{ e1 }}`) removed, entities read, spaces tidied. */
export function plainText(html: unknown): string {
  if (typeof html !== 'string') return '';
  return html
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]*>/g, '')
    .replace(/\{\{[^}]*\}\}/g, '')
    .replace(/&[a-z#0-9]+;/gi, (e) => ENTITIES[e] ?? ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Crowd-control words and the plain name each one is shown under. Order is the order they're listed. */
const CC_WORDS: [RegExp, string][] = [
  [/\bsuppress/i, 'suppression'],
  [/\bstun/i, 'stun'],
  [/\b(?:root|snare|immobiliz)/i, 'root'],
  // Riot writes "knocks up", "knock-up" and "knocks them up": up to two words may come between.
  [/\bknock(?:s|ing|ed)?(?:[- ]\w+){0,2}?[- ]up\b|\bairborne/i, 'knock-up'],
  [/\bknock(?:s|ing|ed)?(?:[- ]\w+){0,2}?[- ](?:back|aside|away)\b|\bknockback|\bdisplac/i, 'knockback'],
  [/\bpull(?:s|ing|ed)? (?:the |an |all |nearby |enemies|enemy|them|target)/i, 'pull'],
  [/\bcharm/i, 'charm'],
  [/\b(?:fear|flee|terrif)/i, 'fear'],
  [/\btaunt/i, 'taunt'],
  [/\bsilenc/i, 'silence'],
  [/\b(?:sleep|asleep|drows)/i, 'sleep'],
  [/\bpolymorph/i, 'polymorph'],
  [/\bground(?:ed|s)\b/i, 'grounded'],
  [/\bberserk/i, 'berserk'],
  [/\bblind/i, 'blind'],
  [/\bnearsight/i, 'nearsight'],
  [/\bdisarm/i, 'disarm'],
  [/\bslow/i, 'slow'],
];

/** The crowd control Riot's own text names. Exported for the checks. */
export function ccIn(text: string): string[] {
  const found = CC_WORDS.filter(([word]) => word.test(text)).map(([, name]) => name);
  // Any other knock ("knocking enemies in a direction", Taliyah's W) still moves them: a knockback.
  if (/\bknock/i.test(text) && !found.includes('knock-up') && !found.includes('knockback')) found.splice(Math.max(0, found.indexOf('pull')), 0, 'knockback');
  return found;
}

const nums = (value: unknown): number[] => (Array.isArray(value) ? value.filter((v): v is number => typeof v === 'number' && Number.isFinite(v)) : []);

function costWordOf(spell: Json): string | null {
  const said = `${String(spell.costType ?? '')} ${String(spell.resource ?? '')}`;
  if (/no cost/i.test(said)) return null;
  for (const word of ['Mana', 'Energy', 'Health', 'Fury', 'Rage', 'Heat', 'Ferocity', 'Flow', 'Grit', 'Shield', 'Courage', 'Bloodthirst']) {
    if (new RegExp(word, 'i').test(said)) return word.toUpperCase();
  }
  return null;
}

/** Data Dragon's per-champion file as LEAGUEBOT's kit. Exported for the checks. */
export function buildChampionKit(patch: string, file: Json): ChampionKit | null {
  const entry = Object.values((file.data ?? {}) as Record<string, Json>)[0];
  if (!entry || typeof entry.id !== 'string' || typeof entry.name !== 'string') return null;
  const passive = (entry.passive ?? {}) as Json;
  const passiveText = plainText(passive.description);
  const abilities: KitAbility[] = [
    {
      key: 'P',
      name: String(passive.name ?? 'Passive'),
      description: passiveText,
      icon: `${DDRAGON}/cdn/${patch}/img/passive/${String((passive.image as Json | undefined)?.full ?? '')}`,
      cooldowns: [],
      costs: [],
      costWord: null,
      ranges: [],
      cc: ccIn(passiveText),
    },
  ];
  const keys: AbilityKey[] = ['Q', 'W', 'E', 'R'];
  ((entry.spells ?? []) as Json[]).slice(0, 4).forEach((spell, i) => {
    const description = plainText(spell.description);
    const costWord = costWordOf(spell);
    const costs = nums(spell.cost);
    const ranges = nums(spell.range);
    abilities.push({
      key: keys[i],
      name: String(spell.name ?? keys[i]),
      description,
      icon: `${DDRAGON}/cdn/${patch}/img/spell/${String((spell.image as Json | undefined)?.full ?? '')}`,
      cooldowns: nums(spell.cooldown),
      costs: costWord && costs.some((c) => c > 0) ? costs : [],
      costWord: costWord && costs.some((c) => c > 0) ? costWord : null,
      ranges: ranges.every((r) => r > 0 && r < 25000) ? ranges : [],
      // The tooltip names effects the short description leaves out; its number placeholders are removed first.
      cc: [...new Set([...ccIn(description), ...ccIn(plainText(spell.tooltip))])],
    });
  });
  return { alias: entry.id, id: Number(entry.key), name: entry.name, title: String(entry.title ?? ''), patch, abilities };
}

/** `14 / 13 / 12 / 11 / 10`, or the one number when every rank is the same. */
export function perRank(values: number[]): string {
  if (values.length === 0) return '';
  if (values.every((v) => v === values[0])) return String(values[0]);
  return values.join(' / ');
}

const kits = new Map<string, Promise<ChampionKit>>();

/** A champion's kit for the patch, read once a tab. A failure is not kept, so picking again tries again. */
export function loadChampionKit(patch: string, alias: string): Promise<ChampionKit> {
  const key = `${patch}:${alias}`;
  let loading = kits.get(key);
  if (!loading) {
    loading = (async () => {
      if (!/^[A-Za-z]{2,24}$/.test(alias) || !/^\d+\.\d+\.\d+$/.test(patch)) throw new Error('not a champion');
      const response = await fetch(`${DDRAGON}/cdn/${patch}/data/${LANG}/champion/${alias}.json`, { credentials: 'omit' });
      if (!response.ok) throw new Error(`Data Dragon answered ${response.status}`);
      const kit = buildChampionKit(patch, (await response.json()) as Json);
      if (kit === null) throw new Error('Data Dragon sent no champion');
      return kit;
    })();
    loading.catch(() => kits.delete(key));
    kits.set(key, loading);
  }
  return loading;
}
