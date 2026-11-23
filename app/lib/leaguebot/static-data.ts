/**
 * Riot's own public game data for LEAGUEBOT (SPEC-leaguebot.md): champion, item, summoner-spell and rune names, and the
 * addresses of their icons, read in the browser from Data Dragon (Riot's public files; it answers any site) and kept per
 * patch in this tab. The icons are Riot's art, loaded straight from Riot's servers and never copied into `assets/` (the
 * named exception in core.md's Asset Rules, Luke's 7A). Nothing here needs a key.
 */

export const DDRAGON_HOST = 'ddragon.leagueoflegends.com';
export const CDRAGON_HOST = 'raw.communitydragon.org';
const DDRAGON = `https://${DDRAGON_HOST}`;

export type Named = { name: string; icon: string };

export type StaticData = {
  patch: string;
  champions: Map<number, Named & { alias: string }>;
  /** `completed`: a finished item worth naming in a build (nothing builds from it, 900 gold or more, not a consumable). */
  items: Map<number, Named & { completed: boolean; boots: boolean }>;
  spells: Map<number, Named>;
  runes: Map<number, Named>;
};

const LANG = 'en_GB';

type Json = Record<string, unknown>;

async function getJson(url: string): Promise<Json | Json[]> {
  const response = await fetch(url, { credentials: 'omit' });
  if (!response.ok) throw new Error(`Data Dragon answered ${response.status}`);
  return (await response.json()) as Json | Json[];
}

/** Riot's patch list, newest first, kept as `16.22.1`. */
async function latestPatch(): Promise<string> {
  const versions = (await getJson(`${DDRAGON}/api/versions.json`)) as unknown as string[];
  const first = versions.find((v) => /^\d+\.\d+\.\d+$/.test(v));
  if (!first) throw new Error('no patch');
  return first;
}

/** Turns Data Dragon's four files into LEAGUEBOT's maps. Exported for the checks. */
export function buildStaticData(patch: string, champion: Json, item: Json, summoner: Json, runesReforged: Json[]): StaticData {
  const champions = new Map<number, Named & { alias: string }>();
  for (const entry of Object.values((champion.data ?? {}) as Record<string, Json>)) {
    const id = Number(entry.key);
    const image = (entry.image as Json | undefined)?.full;
    if (Number.isFinite(id) && typeof entry.name === 'string' && typeof image === 'string') {
      champions.set(id, { name: entry.name, alias: String(entry.id), icon: `${DDRAGON}/cdn/${patch}/img/champion/${image}` });
    }
  }
  const items = new Map<number, Named & { completed: boolean; boots: boolean }>();
  for (const [key, entry] of Object.entries((item.data ?? {}) as Record<string, Json>)) {
    const image = (entry.image as Json | undefined)?.full;
    if (typeof entry.name === 'string' && typeof image === 'string') {
      const tags = Array.isArray(entry.tags) ? (entry.tags as unknown[]) : [];
      const into = Array.isArray(entry.into) ? entry.into : [];
      const gold = Number((entry.gold as Json | undefined)?.total ?? 0);
      const completed = into.length === 0 && gold >= 900 && !tags.includes('Consumable') && !tags.includes('Trinket');
      items.set(Number(key), { name: entry.name, icon: `${DDRAGON}/cdn/${patch}/img/item/${image}`, completed, boots: tags.includes('Boots') });
    }
  }
  const spells = new Map<number, Named>();
  for (const entry of Object.values((summoner.data ?? {}) as Record<string, Json>)) {
    const image = (entry.image as Json | undefined)?.full;
    if (typeof entry.name === 'string' && typeof image === 'string') spells.set(Number(entry.key), { name: entry.name, icon: `${DDRAGON}/cdn/${patch}/img/spell/${image}` });
  }
  const runes = new Map<number, Named>();
  for (const tree of runesReforged) {
    if (typeof tree.id === 'number' && typeof tree.name === 'string') runes.set(tree.id, { name: tree.name, icon: `${DDRAGON}/cdn/img/${String(tree.icon)}` });
    for (const slot of (tree.slots ?? []) as Json[]) {
      for (const rune of (slot.runes ?? []) as Json[]) {
        if (typeof rune.id === 'number' && typeof rune.name === 'string') runes.set(rune.id, { name: rune.name, icon: `${DDRAGON}/cdn/img/${String(rune.icon)}` });
      }
    }
  }
  return { patch, champions, items, spells, runes };
}

let loading: Promise<StaticData> | null = null;

/** The current patch's data, read once a tab. A failure is not kept, so the next call tries again. */
export function loadStaticData(): Promise<StaticData> {
  loading ??= (async () => {
    const patch = await latestPatch();
    const base = `${DDRAGON}/cdn/${patch}/data/${LANG}`;
    const [champion, item, summoner, runes] = await Promise.all([
      getJson(`${base}/champion.json`),
      getJson(`${base}/item.json`),
      getJson(`${base}/summoner.json`),
      getJson(`${base}/runesReforged.json`),
    ]);
    return buildStaticData(patch, champion as Json, item as Json, summoner as Json, runes as Json[]);
  })().catch((error: unknown) => {
    loading = null;
    throw error;
  });
  return loading;
}

/** A profile icon by Riot's number. */
export function profileIconUrl(patch: string, iconId: number): string {
  return `${DDRAGON}/cdn/${patch}/img/profileicon/${iconId}.png`;
}

/** A rank's emblem from Community Dragon (`emblem-gold.png`), or null while unranked. */
export function rankEmblemUrl(tier: string | null): string | null {
  if (tier === null) return null;
  return `https://${CDRAGON_HOST}/latest/plugins/rcp-fe-lol-static-assets/global/default/images/ranked-mini-crests/${tier.toLowerCase()}.png`;
}

/** A champion's name, or a plain stand-in when the data hasn't loaded (never a guess). */
export function championName(data: StaticData | null, id: number): string {
  return data?.champions.get(id)?.name ?? `CHAMPION ${id}`;
}
