import { mentionTokens } from './mentions';
import { pinForThread } from './pins';
import { displayTitle, postCredit } from './site-author';
import { tagKey } from './tag-vocabulary';
import type { ForumAnchorKind, ForumAuthor, ForumComment, ForumPreview, ForumTag, ForumThread, ForumTrack, ThreadPin } from './types';
import { isStreamThread } from '../watch/rules';

/**
 * The board's search (SPEC-forum-search.md, part 2): Discord's behaviour, read over the board the
 * browser already holds.
 *
 * What is typed is free words, `"quoted phrases"` and filters (`from:shade`, `from:"good morning"`).
 * Every post and every reply is tested on its own, so a hit in reply 40 is a result row of its own.
 * Different filters AND; the same filter twice ORs (`from:a from:b` is either), as in Discord. Free
 * words must all match.
 *
 * Pure: no storage, no clock unless one is passed, so the checks ask exactly what the box asks.
 */

export type SearchFilterKey = 'from' | 'mentions' | 'has' | 'before' | 'after' | 'during' | 'in' | 'tag' | 'pinned';

export type SearchFilter = { key: SearchFilterKey; value: string };

export type ParsedSearch = { filters: SearchFilter[]; terms: string[] };

/** Every filter, in the order the SEARCH OPTIONS list offers them, with its one-line example. */
export const SEARCH_FILTERS: { key: SearchFilterKey; example: string }[] = [
  { key: 'from', example: 'user' },
  { key: 'mentions', example: 'user' },
  { key: 'has', example: 'mp3, image, video or link' },
  { key: 'before', example: 'a date' },
  { key: 'after', example: 'a date' },
  { key: 'during', example: 'a date' },
  { key: 'in', example: 'board, asset, profile...' },
  { key: 'tag', example: 'a tag' },
  { key: 'pinned', example: 'true or false' },
];

const FILTER_KEYS = new Set<string>(SEARCH_FILTERS.map((filter) => filter.key));

/** Filters whose values are a closed list, compared in lower case. */
const CLOSED_KEYS = new Set<SearchFilterKey>(['has', 'in', 'pinned']);

export function isFilterKey(value: string): value is SearchFilterKey {
  return FILTER_KEYS.has(value);
}

export function isDateFilter(key: SearchFilterKey | null): key is 'before' | 'after' | 'during' {
  return key === 'before' || key === 'after' || key === 'during';
}

export type HasValue = 'mp3' | 'image' | 'video' | 'link';

export const HAS_VALUES: { value: HasValue; note: string }[] = [
  { value: 'mp3', note: 'a track filed' },
  { value: 'image', note: 'artwork attached' },
  // Posts cannot carry video files, so this is all it can find (the spec asks for it to be said).
  { value: 'video', note: 'stream records and video links only' },
  { value: 'link', note: 'any http link' },
];

export type InPlace = ForumAnchorKind | 'streams';

export const IN_PLACES: { value: InPlace; label: string }[] = [
  { value: 'board', label: 'BOARD THREADS' },
  { value: 'asset', label: 'ASSET THREADS' },
  { value: 'text-box', label: 'TEXT BOX THREADS' },
  { value: 'profile', label: 'PROFILE COMMENTS' },
  { value: 'track', label: 'TRACK THREADS' },
  { value: 'streams', label: 'STREAMS' },
];

export const PINNED_VALUES = ['true', 'false'] as const;

// --- reading what was typed -----------------------------------------------------------------------------

/** One piece of the box: `key:value`, `key:"a b"`, `"a phrase"` or a word. An open quote runs to the end. */
const TOKEN = /([A-Za-z]+):(?:"([^"]*)"?|([^\s"]*))|"([^"]*)"?|(\S+)/g;

type Token = { start: number; end: number; key: SearchFilterKey | null; value: string; raw: string };

function tokens(text: string): Token[] {
  const found: Token[] = [];

  for (const match of text.matchAll(TOKEN)) {
    const start = match.index ?? 0;
    const raw = match[0];
    const end = start + raw.length;
    const key = match[1]?.toLowerCase();

    if (key !== undefined && isFilterKey(key)) {
      found.push({ start, end, key, value: match[2] ?? match[3] ?? '', raw });
    } else if (match[4] !== undefined) {
      found.push({ start, end, key: null, value: match[4], raw });
    } else {
      found.push({ start, end, key: null, value: raw, raw });
    }
  }

  return found;
}

/** What the box says, as filters and free words. A filter with no value yet is still being typed. */
export function parseSearch(text: string): ParsedSearch {
  const filters: SearchFilter[] = [];
  const terms: string[] = [];

  for (const token of tokens(text)) {
    const value = token.value.trim();
    if (value.length === 0) continue;

    if (token.key === null) terms.push(value);
    else filters.push({ key: token.key, value: CLOSED_KEYS.has(token.key) ? value.toLowerCase() : value });
  }

  return { filters, terms };
}

function quote(value: string): string {
  return /\s/.test(value) ? `"${value}"` : value;
}

/** One filter as it is written in the box. */
export function formatFilter(filter: SearchFilter): string {
  return `${filter.key}:${quote(filter.value)}`;
}

/** The search written back as text: filters first, then the words. */
export function formatSearch(search: ParsedSearch): string {
  return [...search.filters.map(formatFilter), ...search.terms.map(quote)].join(' ');
}

export function isSearchEmpty(search: ParsedSearch): boolean {
  return search.filters.length === 0 && search.terms.length === 0;
}

/**
 * The piece of the box the caret is in: which filter is being typed (null for a plain word) and what
 * has been typed of its value, with where it sits so a picked suggestion can replace it.
 */
export function activeToken(text: string, caret: number): { key: SearchFilterKey | null; partial: string; start: number; end: number } {
  for (const token of tokens(text)) {
    if (token.start <= caret && caret <= token.end && caret > token.start) {
      return { key: token.key, partial: token.value, start: token.start, end: token.end };
    }
  }

  return { key: null, partial: '', start: caret, end: caret };
}

// --- days ----------------------------------------------------------------------------------------------

const pad = (value: number) => String(value).padStart(2, '0');

/** A moment as the reader's own calendar day, `2026-10-31`. */
export function dayKey(iso: string | Date): string {
  const date = typeof iso === 'string' ? new Date(iso) : iso;

  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** True for a real day written `yyyy-mm-dd`. */
export function isValidDay(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (match === null) return false;

  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return dayKey(date) === value;
}

// --- matching ------------------------------------------------------------------------------------------

/** One post or one reply: what a result row is. */
type Unit = {
  thread: ForumThread;
  comment?: ForumComment;
  author: ForumAuthor;
  body: string;
  /** The title, for a post; empty for a reply. */
  title: string;
  at: string;
  tags: ForumTag[];
  media?: ForumPreview;
  track?: ForumTrack;
  /** Everything free words are looked for in. */
  fields: string[];
};

function units(thread: ForumThread): Unit[] {
  const credit = postCredit(thread);
  const title = displayTitle(thread);
  const post: Unit = {
    thread,
    author: credit,
    body: thread.body,
    title,
    at: thread.createdAt,
    tags: thread.tags,
    media: thread.media,
    track: thread.track,
    fields: [title, thread.body, thread.anchor.label, credit.displayName, ...thread.tags.map((tag) => tag.label)],
  };

  return [
    post,
    ...thread.comments.map((comment) => ({
      thread,
      comment,
      author: comment.author,
      body: comment.body,
      title: '',
      at: comment.createdAt,
      tags: comment.tags,
      media: comment.media,
      track: comment.track,
      fields: [comment.body, comment.author.displayName, ...comment.tags.map((tag) => tag.label)],
    })),
  ];
}

/** An account name as compared: case, spare spaces and the underscore of a mention ignored. */
function nameKey(name: string): string {
  return name.trim().toLowerCase().replace(/_/g, ' ').replace(/\s+/g, ' ');
}

const LINK = /https?:\/\/\S+/i;
const VIDEO_LINK =
  /https?:\/\/(?:[\w-]+\.)*(?:youtube\.com|youtu\.be|youtube-nocookie\.com|vimeo\.com|dailymotion\.com|dai\.ly|twitch\.tv)\/\S*|https?:\/\/\S+\.(?:mp4|webm|mov|ogv|m3u8|mpd)(?:[?#]\S*)?(?=\s|$)/i;

export type SearchContext = {
  /** The pins, for `pinned:`. */
  pins?: ThreadPin[];
  /** The clock a pin's expiry is read against. */
  now?: number;
};

function matchesFilter(unit: Unit, filter: SearchFilter, context: SearchContext): boolean {
  const value = filter.value;

  switch (filter.key) {
    case 'from':
      return nameKey(unit.author.displayName) === nameKey(value);
    case 'mentions':
      return mentionTokens(unit.body).some((token) => nameKey(token) === nameKey(value));
    case 'has':
      if (value === 'mp3') return unit.track !== undefined;
      if (value === 'image') return unit.media !== undefined;
      if (value === 'link') return LINK.test(unit.body);
      if (value === 'video') return (unit.comment === undefined && isStreamThread(unit.thread)) || VIDEO_LINK.test(unit.body);
      return false;
    case 'before':
    case 'after':
    case 'during': {
      if (!isValidDay(value)) return false;
      const day = dayKey(unit.at);
      return filter.key === 'before' ? day < value : filter.key === 'after' ? day > value : day === value;
    }
    case 'in':
      return value === 'streams' ? isStreamThread(unit.thread) : unit.thread.anchor.kind === value;
    case 'tag':
      return unit.tags.some((tag) => tagKey(tag.label) === tagKey(value));
    case 'pinned': {
      const pinned = pinForThread(context.pins, unit.thread.id, new Date(context.now ?? Date.now())) !== undefined;
      return value === 'true' ? pinned : value === 'false' ? !pinned : false;
    }
    default:
      return false;
  }
}

function occurrences(haystack: string, needle: string): number {
  if (needle.length === 0) return 0;

  let count = 0;
  for (let at = haystack.indexOf(needle); at !== -1; at = haystack.indexOf(needle, at + needle.length)) count += 1;
  return count;
}

/**
 * How well a unit matches the words, or null when a word is missing. A word in the title counts
 * three times over: a post *about* the thing is the likelier answer.
 */
function termScore(unit: Unit, terms: string[]): number | null {
  const fields = unit.fields.map((field) => field.toLowerCase());
  const tagKeys = unit.tags.map((tag) => tagKey(tag.label));
  let score = 0;

  for (const term of terms) {
    const needle = term.toLowerCase();
    const hits = fields.reduce((total, field) => total + occurrences(field, needle), 0);
    const tagHit = tagKeys.some((key) => key.includes(tagKey(term)) && tagKey(term).length > 0);
    if (hits === 0 && !tagHit) return null;

    score += hits + (tagHit ? 1 : 0) + (occurrences(unit.title.toLowerCase(), needle) > 0 ? 3 : 0);
  }

  return score;
}

/** One result row: a post, or one reply on it. */
export type SearchHit = {
  thread: ForumThread;
  /** Set when the row is a reply. */
  comment?: ForumComment;
  author: ForumAuthor;
  /** When it was written. */
  at: string;
  body: string;
  /** For MOST RELEVANT. */
  score: number;
};

/** Every post and reply the search matches, in board order (sort them with `sortHits`). */
export function searchBoard(threads: ForumThread[], search: ParsedSearch, context: SearchContext = {}): SearchHit[] {
  if (isSearchEmpty(search)) return [];

  // Same key ORs, different keys AND: group the filters by key.
  const groups = new Map<SearchFilterKey, SearchFilter[]>();
  for (const filter of search.filters) groups.set(filter.key, [...(groups.get(filter.key) ?? []), filter]);

  const hits: SearchHit[] = [];

  for (const thread of threads) {
    for (const unit of units(thread)) {
      const passes = [...groups.values()].every((group) => group.some((filter) => matchesFilter(unit, filter, context)));
      if (!passes) continue;

      const score = termScore(unit, search.terms);
      if (score === null) continue;

      hits.push({ thread, comment: unit.comment, author: unit.author, at: unit.at, body: unit.body, score });
    }
  }

  return hits;
}

export type ResultSort = 'newest' | 'oldest' | 'relevance';

export const RESULT_SORTS: { value: ResultSort; label: string }[] = [
  { value: 'newest', label: 'NEWEST' },
  { value: 'oldest', label: 'OLDEST' },
  { value: 'relevance', label: 'MOST RELEVANT' },
];

export const DEFAULT_RESULT_SORT: ResultSort = 'newest';

export function sortHits(hits: SearchHit[], sort: ResultSort): SearchHit[] {
  const time = (hit: SearchHit) => Date.parse(hit.at);

  return [...hits].sort((left, right) => {
    if (sort === 'oldest') return time(left) - time(right);
    if (sort === 'relevance') return right.score - left.score || time(right) - time(left);
    return time(right) - time(left);
  });
}

/**
 * A short stretch of the words with the matched ones marked: cut around the first hit when the words
 * are longer than `max`, with `…` where it was cut.
 */
export function excerpt(text: string, terms: string[], max = 140): { text: string; hit: boolean }[] {
  const needles = terms.map((term) => term.toLowerCase()).filter((term) => term.length > 0);
  const lower = text.toLowerCase();

  let start = 0;
  let end = text.length;
  if (text.length > max) {
    const first = needles.map((needle) => lower.indexOf(needle)).filter((at) => at >= 0).sort((a, b) => a - b)[0] ?? 0;
    start = Math.max(0, Math.min(first - Math.floor(max / 3), text.length - max));
    end = start + max;
  }

  const slice = text.slice(start, end);
  const sliceLower = slice.toLowerCase();
  const parts: { text: string; hit: boolean }[] = [];
  let cursor = 0;

  while (cursor < slice.length) {
    let next = -1;
    let length = 0;
    for (const needle of needles) {
      const at = sliceLower.indexOf(needle, cursor);
      if (at !== -1 && (next === -1 || at < next || (at === next && needle.length > length))) {
        next = at;
        length = needle.length;
      }
    }

    if (next === -1) {
      parts.push({ text: slice.slice(cursor), hit: false });
      break;
    }
    if (next > cursor) parts.push({ text: slice.slice(cursor, next), hit: false });
    parts.push({ text: slice.slice(next, next + length), hit: true });
    cursor = next + length;
  }

  if (start > 0 && parts.length > 0) parts[0] = { ...parts[0], text: `…${parts[0].text}` };
  if (end < text.length && parts.length > 0) {
    const last = parts.length - 1;
    parts[last] = { ...parts[last], text: `${parts[last].text}…` };
  }

  return parts;
}

// --- suggestions ---------------------------------------------------------------------------------------

export type Suggestion = { value: string; label: string; note?: string };

export type SuggestContext = {
  threads: ForumThread[];
  /** Names from the account directory, beside those on the board. */
  directory: string[];
  /** The tag vocabulary, with counts. */
  tagVocabulary: { key: string; label: string; count: number }[];
};

/** Prefix matches first, then anything containing what was typed. */
function narrow(suggestions: Suggestion[], partial: string): Suggestion[] {
  const wanted = partial.trim().toLowerCase();
  if (wanted.length === 0) return suggestions;

  const score = (suggestion: Suggestion) => {
    const words = [suggestion.value, suggestion.label].map((word) => word.toLowerCase());
    if (words.some((word) => word.startsWith(wanted))) return 0;
    if (words.some((word) => word.includes(wanted))) return 1;
    return 2;
  };

  return suggestions
    .map((suggestion, index) => ({ suggestion, index, rank: score(suggestion) }))
    .filter((entry) => entry.rank < 2)
    .sort((left, right) => left.rank - right.rank || left.index - right.index)
    .map((entry) => entry.suggestion);
}

/** Every account name on the board (credits and repliers) and in the directory, once each, A-Z. */
export function accountNames(threads: ForumThread[], directory: string[]): string[] {
  const names = new Map<string, string>();
  const add = (name: string) => {
    const key = nameKey(name);
    if (key.length > 0 && !names.has(key)) names.set(key, name.trim());
  };

  for (const thread of threads) {
    add(postCredit(thread).displayName);
    for (const comment of thread.comments) add(comment.author.displayName);
  }
  for (const name of directory) add(name);

  return [...names.values()].sort((left, right) => left.localeCompare(right, 'en', { sensitivity: 'base' }));
}

/** What the list offers for one filter, narrowed by what has been typed of its value. */
export function suggestValues(key: SearchFilterKey, partial: string, context: SuggestContext): Suggestion[] {
  switch (key) {
    case 'from':
    case 'mentions':
      return narrow(accountNames(context.threads, context.directory).map((name) => ({ value: name, label: name })), partial);
    case 'has':
      return narrow(HAS_VALUES.map((entry) => ({ value: entry.value, label: entry.value.toUpperCase(), note: entry.note })), partial);
    case 'in':
      return narrow(IN_PLACES.map((entry) => ({ value: entry.value, label: entry.label })), partial);
    case 'tag':
      return narrow(context.tagVocabulary.map((entry) => ({ value: entry.key, label: entry.label, note: String(entry.count) })), partial);
    case 'pinned':
      return narrow(PINNED_VALUES.map((value) => ({ value, label: value.toUpperCase() })), partial);
    default:
      return [];
  }
}
