import { authorList, authorWords, matchesAuthor, MAX_AUTHORS } from './search';
import { isMediaServerId } from './media-servers';
import { PLATFORM_LABELS, STREAM_PLATFORMS, type WebItem, type WebItemKind, type WebPlatform } from './types';

// A media server's titles are saved rows too (SPEC-media-servers.md): read with the stream, never asked live.
const streamPlatform = (platform: string) => (STREAM_PLATFORMS as readonly string[]).includes(platform) || isMediaServerId(platform);

/**
 * The /web search's two filters (Luke, 2026-10-31: "a search filter that allows you to sort by all of the
 * current aggregates and another that lets you sort by file, similar to the search function in the forum.
 * combine the searches"). Pure and client-safe; `scripts/check-web-filters.cjs` holds it.
 *
 * The search box text is the one truth. The filters are typed in it the forum's way, `in:youtube` and
 * `type:audio`, and the SOURCE and TYPE keys only write those words into the box (`withFilter`), so the keys
 * and the typed words can never disagree. The address carries the same three things: `?q=&in=&type=`.
 *
 * The filters also decide which live sources are asked at all (`sourcesToAsk`): one that cannot match is
 * never called. YouTube is asked only when the filter allows YouTube and video, which saves its daily quota.
 *
 * A third filter, `from:` (Luke, 2026-10-31: "search by author ... similar to the 'from' discord kind of search
 * feature in the forum"): `from:prelinger` or `from:"rick prelinger"` keeps one creator's items (search.ts
 * `matchesAuthor`). Two are either creator, as on the forum; the saved stream reads them all, and a live source,
 * asked about one creator at a time, the first. A creator's name on a row writes it into the box (`withAuthor`).
 */

export type FilterKey = 'in' | 'type' | 'from';

/** `saved`: the hourly stream (rows read from the database rather than found live). */
export type SourceValue = 'all' | 'saved' | WebPlatform;
export type TypeValue = 'all' | Exclude<WebItemKind, 'other'>;

/**
 * Every live source and the kinds of item it can return. The client asks exactly these
 * (scripts/check-web-live-merge.cjs holds them against the server's SEARCH_PROVIDERS).
 */
export const LIVE_SOURCE_KINDS: Readonly<Partial<Record<WebPlatform, readonly WebItemKind[]>>> = {
  youtube: ['video'],
  internet_archive: ['video', 'audio', 'image', 'text', 'other'],
  wikimedia_commons: ['video', 'audio', 'image', 'text', 'other'],
  peertube: ['video'],
  openverse: ['image'],
};

export const LIVE_PROVIDERS = Object.keys(LIVE_SOURCE_KINDS) as WebPlatform[];

/** How many creators the `from:` suggestion list offers at once. */
const MAX_CREATOR_SUGGESTIONS = 8;

/** A platform as it is typed after `in:`: its id with hyphens, `internet-archive`. */
export function sourceWord(value: SourceValue): string {
  return value.replace(/_/g, '-');
}

/**
 * The SOURCE choices, from the registries: SAVED, then every platform the stream reads or a search asks, in
 * the labels' order. A new provider, stream adapter or media server (media-servers.ts) appears here by itself. (Vimeo, reached only by a pasted
 * link, is neither, so it is not offered.)
 */
export const SOURCE_OPTIONS: readonly { value: SourceValue; label: string }[] = [
  { value: 'all', label: 'ALL' },
  { value: 'saved', label: 'SAVED' },
  ...(Object.keys(PLATFORM_LABELS) as WebPlatform[])
    .filter((platform) => platform in LIVE_SOURCE_KINDS || streamPlatform(platform))
    .map((platform) => ({ value: platform, label: PLATFORM_LABELS[platform] })),
];

export const TYPE_OPTIONS: readonly { value: TypeValue; label: string }[] = [
  { value: 'all', label: 'ALL' },
  { value: 'video', label: 'VIDEO' },
  { value: 'audio', label: 'AUDIO' },
  { value: 'image', label: 'IMAGE' },
  { value: 'text', label: 'TEXT' },
];

/** Short words people will type, beside each platform's own (`in:archive`, `in:commons`). */
const SOURCE_ALIASES: Readonly<Record<string, SourceValue>> = {
  stream: 'saved',
  archive: 'internet_archive',
  ia: 'internet_archive',
  commons: 'wikimedia_commons',
  wikimedia: 'wikimedia_commons',
  yt: 'youtube',
};

export function readSource(word: unknown): SourceValue | null {
  if (typeof word !== 'string') return null;
  const wanted = word.trim().toLowerCase().replace(/-/g, '_');
  const alias = Object.prototype.hasOwnProperty.call(SOURCE_ALIASES, wanted) ? SOURCE_ALIASES[wanted] : undefined;
  if (alias !== undefined) return alias;
  // Without the hyphen is the same source: `in:server1` is `in:server-1` (Luke, 2026-11-01).
  const squashed = wanted.replace(/_/g, '');
  return (
    SOURCE_OPTIONS.find((option) => option.value === wanted)?.value ??
    SOURCE_OPTIONS.find((option) => option.value.replace(/_/g, '') === squashed)?.value ??
    null
  );
}

export function readType(word: unknown): TypeValue | null {
  if (typeof word !== 'string') return null;
  const wanted = word.trim().toLowerCase();
  return TYPE_OPTIONS.find((option) => option.value === wanted)?.value ?? null;
}

export type WebSearch = {
  /** What is left once the filters are taken out: the words of the search, or a pasted link. */
  text: string;
  source: SourceValue;
  type: TypeValue;
  /** `from:` creators as typed, at most MAX_AUTHORS, each with a letter or digit in it. Absent: anyone. */
  authors?: readonly string[];
};

const FILTER = /(^|\s)(in|type|from):("[^"]*"?|\S*)/gi;

/** The creators of a search, or none (an absent list and an empty one are the same search). */
export function authorsOf(search: Pick<WebSearch, 'authors'>): readonly string[] {
  return search.authors ?? [];
}

/**
 * What the box says. The last `in:` and `type:` win; every `from:` counts (the same creator once). A filter
 * with an unknown or empty value is simply dropped.
 */
export function parseWebSearch(box: string): WebSearch {
  let source: SourceValue = 'all';
  let type: TypeValue = 'all';
  const authors: string[] = [];
  const text = box
    .replace(FILTER, (_whole, space: string, key: string, raw: string) => {
      const value = raw.replace(/^"|"$/g, '');
      const filter = key.toLowerCase();
      if (filter === 'in') source = readSource(value) ?? source;
      else if (filter === 'type') type = readType(value) ?? type;
      else if (authorWords(value) !== null) authors.push(value.trim());
      return space;
    })
    .replace(/\s+/g, ' ')
    .trim();
  const kept = keptAuthors(authors);
  return kept.length > 0 ? { text, source, type, authors: kept } : { text, source, type };
}

/** Names whose words are the same are one creator; at most MAX_AUTHORS, in the order typed. */
function keptAuthors(names: readonly string[]): string[] {
  const seen = new Set<string>();
  return names
    .filter((name) => {
      const key = authorWords(name)?.join(' ');
      if (key === undefined || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, MAX_AUTHORS);
}

/** A creator as it is typed after `from:`: quoted when it has a space; a quote inside it is dropped. */
export function authorWord(name: string): string {
  const plain = name.replace(/"/g, '').trim();
  return /\s/.test(plain) ? `"${plain}"` : plain;
}

/** The box text for a search: the words first, then the filters that are not ALL. */
export function formatWebSearch(search: WebSearch): string {
  return [
    search.text,
    search.source === 'all' ? '' : `in:${sourceWord(search.source)}`,
    search.type === 'all' ? '' : `type:${search.type}`,
    ...authorsOf(search).map((name) => `from:${authorWord(name)}`),
  ]
    .filter((part) => part.length > 0)
    .join(' ');
}

/** A creator's name pressed on a row: everything from them, under the same SOURCE and TYPE, words dropped. */
export function withAuthor(box: string, name: string): string {
  const search = parseWebSearch(box);
  return formatWebSearch({ source: search.source, type: search.type, text: '', authors: keptAuthors([name]) });
}

/** A SOURCE or TYPE key pressed: the box with that filter set (or taken out, for ALL), words untouched. */
export function withFilter(box: string, key: FilterKey, value: string): string {
  const search = parseWebSearch(box);
  if (key === 'in') search.source = readSource(value) ?? 'all';
  else search.type = readType(value) ?? 'all';
  return formatWebSearch(search);
}

/** The address for a search, so it can be shared: `/web?q=&in=&type=` with only what is set. */
export function searchAddress(search: WebSearch): string {
  const params = new URLSearchParams();
  if (search.text.length > 0) params.set('q', search.text);
  if (search.source !== 'all') params.set('in', sourceWord(search.source));
  if (search.type !== 'all') params.set('type', search.type);
  for (const name of authorsOf(search)) params.append('from', name);
  const query = params.toString();
  return query.length > 0 ? `/web?${query}` : '/web';
}

/** The box text an address stands for (the reverse of `searchAddress`). Unknown values are dropped. */
export function boxFromAddress(params: { get(name: string): string | null; getAll?(name: string): string[] }): string {
  return formatWebSearch({
    text: (params.get('q') ?? '').slice(0, 600),
    source: readSource(params.get('in')) ?? 'all',
    type: readType(params.get('type')) ?? 'all',
    authors: keptAuthors((params.getAll?.('from') ?? []).map((name) => name.slice(0, 100))),
  });
}

/**
 * Which sources a search asks: the saved stream when it could match, and only the live sources whose
 * platform the SOURCE filter allows and which can return the TYPE asked for. Nothing is asked of the rest.
 */
export function sourcesToAsk(search: Pick<WebSearch, 'source' | 'type'>): { stream: boolean; live: WebPlatform[] } {
  const typeOk = (kinds: readonly WebItemKind[]) => search.type === 'all' || kinds.includes(search.type);
  const live = LIVE_PROVIDERS.filter(
    (platform) => (search.source === 'all' || search.source === platform) && typeOk(LIVE_SOURCE_KINDS[platform] ?? []),
  );
  const stream = search.source === 'all' || search.source === 'saved' || streamPlatform(search.source);
  return { stream, live };
}

/** Whether a row belongs in the list under the filters. `saved`: it came from the stream, not a live search. */
export function matchesFilters(
  item: Pick<WebItem, 'platform' | 'kind' | 'creator' | 'media'>,
  search: Pick<WebSearch, 'source' | 'type' | 'authors'>,
  fromStream: boolean,
): boolean {
  if (search.type !== 'all' && item.kind !== search.type) return false;
  const authors = authorList(authorsOf(search));
  if (authors !== null && !matchesAuthor(item, authors)) return false;
  if (search.source === 'all') return true;
  if (search.source === 'saved') return fromStream;
  // A media-server title is one row for every server holding it: `in:server-2` keeps it when server 2 has a copy.
  return item.platform === search.source || (item.media?.copies.some((copy) => copy.server === search.source) ?? false);
}

/**
 * What the suggestion list offers while a filter's value is being typed, narrowed by what was typed. For `from:`,
 * the creators of the rows on the page (`creators`), like the forum offering the people on the board.
 */
export function suggestFilterValues(key: FilterKey, partial: string, creators: readonly string[] = []): { word: string; label: string }[] {
  const wanted = partial.trim().toLowerCase();
  if (key === 'from') {
    const typed = wanted.replace(/"/g, '');
    const seen = new Set<string>();
    return creators
      .filter((name) => {
        const key = authorWords(name)?.join(' ');
        if (key === undefined || seen.has(key) || !name.toLowerCase().includes(typed)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, MAX_CREATOR_SUGGESTIONS)
      .map((name) => ({ word: authorWord(name), label: 'CREATOR' }));
  }
  const all = key === 'in' ? SOURCE_OPTIONS : TYPE_OPTIONS;
  return all
    .filter((option) => option.value !== 'all')
    .map((option) => ({ word: key === 'in' ? sourceWord(option.value as SourceValue) : option.value, label: option.label }))
    .filter((option) => wanted.length === 0 || option.word.startsWith(wanted) || option.label.toLowerCase().includes(wanted));
}

/** The filter whose value the caret is in (`in:you|`), with where that value sits, or null. */
export function activeFilter(box: string, caret: number): { key: FilterKey; partial: string; start: number; end: number } | null {
  // A creator may be quoted with spaces in it (`from:"rick pre|`); the other values are one word.
  const pattern = /(?:^|\s)(in|type|from):("[^"]*"?|\S*)/gi;
  for (let match = pattern.exec(box); match !== null; match = pattern.exec(box)) {
    const start = match.index + match[0].indexOf(':') + 1;
    const end = start + match[2].length;
    if (caret >= start && caret <= end) return { key: match[1].toLowerCase() as FilterKey, partial: match[2], start, end };
  }
  return null;
}
