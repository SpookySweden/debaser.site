import { looksLikeLink } from '../web/link-shape';
import { PLATFORM_LABELS, type WebItemKind, type WebPlatform } from '../web/types';
import { cleanWord, eraOf } from './words';

/**
 * Everything a TAG STATION search is, and its address (SPEC-tag-station.md): the whole state lives in the page's address, so
 * any search can be shared. Pure and client-safe. An address is other people's text, so everything in it is checked here
 * and anything wrong is simply dropped.
 */
export type Strict = 'all' | 'most' | 'any';
export type Niche = 'all' | 'main' | 'mid' | 'rare';
export type Near = 'near' | 'wider' | 'far';
export type WordSourceFilter = 'both' | 'claude' | 'platform';
export type Sort = 'close' | 'rare' | 'new' | 'tagged';
export type View = 'map' | 'list';

export type Recipe = {
  /** What was chosen: one word, one saved item, or one pasted link. */
  tag: string | null;
  item: string | null;
  link: string | null;
  must: string[];
  any: string[];
  not: string[];
  strict: Strict;
  niche: Niche;
  near: Near;
  src: WordSourceFilter;
  era: string | null;
  kind: WebItemKind | null;
  site: WebPlatform | null;
  from: number | null;
  to: number | null;
  sort: Sort;
  view: View;
};

export const EMPTY_RECIPE: Recipe = {
  tag: null,
  item: null,
  link: null,
  must: [],
  any: [],
  not: [],
  strict: 'all',
  niche: 'all',
  near: 'wider',
  src: 'both',
  era: null,
  kind: null,
  site: null,
  from: null,
  to: null,
  sort: 'close',
  view: 'map',
};

const MAX_WORDS_IN_A_LIST = 12;
const MAX_ITEM_ID = 300;
const KINDS: readonly WebItemKind[] = ['audio', 'video', 'image', 'text', 'other'];

type Params = { get(name: string): string | null; getAll(name: string): string[] };

const oneOf = <T extends string>(value: string | null, allowed: readonly T[], fallback: T): T => (allowed.includes(value as T) ? (value as T) : fallback);

function wordList(values: string[]): string[] {
  const words = values.map(cleanWord).filter((word): word is string => word !== null);
  return [...new Set(words)].slice(0, MAX_WORDS_IN_A_LIST);
}

function year(value: string | null): number | null {
  if (value === null || !/^[0-9]{4}$/.test(value)) return null;
  const number = Number(value);
  return number >= 1000 && number <= 2100 ? number : null;
}

export function parseRecipe(params: Params): Recipe {
  const item = params.get('item');
  const link = params.get('link');
  const era = cleanWord(params.get('era'));
  const kind = params.get('kind');
  const site = params.get('site');
  return {
    tag: cleanWord(params.get('tag')),
    item: item !== null && item.length > 0 && item.length <= MAX_ITEM_ID ? item : null,
    link: looksLikeLink(link) ? link.trim() : null,
    must: wordList(params.getAll('must')),
    any: wordList(params.getAll('any')),
    not: wordList(params.getAll('not')),
    strict: oneOf(params.get('strict'), ['all', 'most', 'any'], 'all'),
    niche: oneOf(params.get('niche'), ['all', 'main', 'mid', 'rare'], 'all'),
    near: oneOf(params.get('near'), ['near', 'wider', 'far'], 'wider'),
    src: oneOf(params.get('src'), ['both', 'claude', 'platform'], 'both'),
    era: era !== null && eraOf(era) !== null ? eraOf(era) : null,
    kind: KINDS.includes(kind as WebItemKind) ? (kind as WebItemKind) : null,
    site: site !== null && Object.prototype.hasOwnProperty.call(PLATFORM_LABELS, site) ? (site as WebPlatform) : null,
    from: year(params.get('from')),
    to: year(params.get('to')),
    sort: oneOf(params.get('sort'), ['close', 'rare', 'new', 'tagged'], 'close'),
    view: oneOf(params.get('view'), ['map', 'list'], 'map'),
  };
}

/** The address's query for a recipe, leaving out whatever is at its default, so a plain search has a short link. */
export function recipeQuery(recipe: Recipe): string {
  const query = new URLSearchParams();
  const single = (['tag', 'item', 'link'] as const).filter((name) => recipe[name] !== null);
  for (const name of single) query.set(name, recipe[name] as string);
  for (const name of ['must', 'any', 'not'] as const) for (const word of recipe[name]) query.append(name, word);
  for (const name of ['strict', 'niche', 'near', 'src', 'sort', 'view'] as const) {
    if (recipe[name] !== EMPTY_RECIPE[name]) query.set(name, recipe[name]);
  }
  for (const name of ['era', 'kind', 'site'] as const) {
    const value = recipe[name];
    if (value !== null) query.set(name, value);
  }
  if (recipe.from !== null) query.set('from', String(recipe.from));
  if (recipe.to !== null) query.set('to', String(recipe.to));
  return query.toString();
}

/** Whether anything narrows the results: the page opens the filters and offers CLEAR when so. */
export function hasFilters(recipe: Recipe): boolean {
  return (
    recipe.must.length > 0 ||
    recipe.any.length > 0 ||
    recipe.not.length > 0 ||
    recipe.strict !== 'all' ||
    recipe.niche !== 'all' ||
    recipe.near !== 'wider' ||
    recipe.src !== 'both' ||
    recipe.era !== null ||
    recipe.kind !== null ||
    recipe.site !== null ||
    recipe.from !== null ||
    recipe.to !== null
  );
}

/** A word's place in the recipe, or null; a word sits in one list at a time. */
export function listOf(recipe: Recipe, word: string): 'must' | 'any' | 'not' | null {
  if (recipe.must.includes(word)) return 'must';
  if (recipe.any.includes(word)) return 'any';
  return recipe.not.includes(word) ? 'not' : null;
}

/** The recipe with `word` in `list`, or in no list when `list` is null. */
export function withWordIn(recipe: Recipe, word: string, list: 'must' | 'any' | 'not' | null): Recipe {
  const without = (words: string[]) => words.filter((one) => one !== word);
  const next = { ...recipe, must: without(recipe.must), any: without(recipe.any), not: without(recipe.not) };
  if (list !== null && next[list].length < MAX_WORDS_IN_A_LIST) next[list] = [...next[list], word];
  return next;
}
