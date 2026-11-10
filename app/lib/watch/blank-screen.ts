import { isQueueableWebLink, WATCH_KIND_BY_PLATFORM, watchLinkForItem } from '../web/bridges';
import type { WebItem, WebPlatform } from '../web/types';
import { isBarAudioPlatform, playsInBar } from '../web/web-audio';
import { authorsOf, formatWebSearch, LIVE_SOURCE_KINDS, parseWebSearch, SOURCE_OPTIONS, sortOf, withFilter, type FilterKey, type SourceValue } from '../web/web-filters';
import type { SortChoice } from '../web/web-sort';
import { nextToPlay } from './rules';
import type { WatchQueueEntry, WatchRoom } from './types';

/**
 * The blank screen of a CYTUBE room (SPEC-cytube.md): what a room shows with nothing playing, and the searches
 * its three keys open the queue window with. Pure and client-safe; `scripts/check-cytube.cjs` holds it.
 *
 * GO LIVE opens a room with an empty queue, so its screen is black with three keys in the middle - VIDEO,
 * MUSIC, BOOKS - each opening the queue window with its search pre-filled. When the queue runs out mid-stream
 * the screen goes back to black with the same keys (it used to loop the last file).
 */

export type BlankKey = 'video' | 'music' | 'books';

/** In Luke's order (2026-11-03: "Books green, video red, music pink"). */
export const BLANK_KEYS: readonly { key: BlankKey; label: string }[] = [
  { key: 'books', label: 'BOOKS' },
  { key: 'video', label: 'VIDEO' },
  { key: 'music', label: 'MUSIC' },
];

/**
 * What a key puts in the queue window's bar: the search's own filter word, written the archive's way
 * (`type:video`), so the person sees what was asked for and can change or delete it.
 */
export function blankPrefill(key: BlankKey): string {
  return `type:${key} `;
}

/** The kinds of archive row a search keeps (before the room's own "can this play here" test). */
export type KeepKinds = 'video' | 'audio' | 'both';

/** One request to the archive search: its words, the TYPE it asks for, and which rows it keeps. */
export type QueueAsk = { words: string; type: 'all' | 'video' | 'audio'; keep: KeepKinds };

export type QueueSearchPlan = {
  /** The words, with the filter words taken out. */
  words: string;
  preset: BlankKey | null;
  /** Which of the site's own files are listed first: its videos, its songs. */
  site: { videos: boolean; songs: boolean };
  /** The archive search to run, or null: nothing to look for, so only the site's own files (BOOKS always asks). */
  ask: QueueAsk | null;
  /** `in:`, one of `QUEUE_SOURCES` or `QUEUE_LOOKUP_SOURCE`; any other source a room cannot play from reads as ALL. */
  source: SourceValue;
  /** `from:` creators as typed (the live search asks about the first, as the archive page's does). */
  authors: readonly string[];
  /** `vibe:on`: mood and tag words. */
  vibe: boolean;
  /** `sort:`, in the archive page's terms. */
  sort: SortChoice;
};

/** `type:audio` is the archive page's word for what the queue calls MUSIC. */
const PRESET = /(^|\s)type:(video|music|audio|books)(?=\s|$)/gi;

/** A word that marks an audiobook, added to a BOOKS search so YouTube and the Archive find the read-aloud ones. */
export const AUDIOBOOK_WORD = 'audiobook';

/**
 * A live source a room can play from: a video its player or an official embed takes, or audio the music bar streams.
 * The others find nothing a room can use, and PODCAST is the saved stream's, which the queue search does not read.
 */
function roomPlays(platform: WebPlatform): boolean {
  const kinds = LIVE_SOURCE_KINDS[platform] ?? [];
  // An audiobook (SPEC-books.md) plays in the music bar, chapter by chapter: it's not something a room plays together.
  if (platform === 'audiobooks') return false;
  return (WATCH_KIND_BY_PLATFORM[platform] !== null && kinds.includes('video')) || (isBarAudioPlatform(platform) && kinds.includes('audio'));
}

/** The queue search's SOURCE keys (Luke, 2026-11-04: "similar search filters" to the archive's), from the registries. */
export const QUEUE_SOURCES: readonly { value: SourceValue; label: string }[] = SOURCE_OPTIONS.filter(
  (option) => option.value === 'all' || (option.value in LIVE_SOURCE_KINDS && roomPlays(option.value)),
);

/** The TYPE keys: the blank screen's three, in Luke's order, behind ALL. A room cannot play a picture or a text. */
export const QUEUE_TYPES: readonly { value: BlankKey | 'all'; label: string }[] = [
  { value: 'all', label: 'ALL' },
  ...BLANK_KEYS.map(({ key, label }) => ({ value: key, label })),
];

function isQueueSource(value: SourceValue): boolean {
  return QUEUE_SOURCES.some((option) => option.value === value);
}

/**
 * The IMDB key's source (Luke, 2026-11-05: posters and info inside the stream UI). KINO, TMDB's films and shows: a room
 * cannot play them, so it has no SOURCE key and its rows have no ADD. They are for looking a title up.
 */
export const QUEUE_LOOKUP_SOURCE: SourceValue = 'kino';

/** The bar's `type:` word (the last wins) and the rest of the bar. */
function takePreset(bar: string): { preset: BlankKey | null; rest: string } {
  let preset: BlankKey | null = null;
  const rest = bar
    .replace(PRESET, (_whole, space: string, word: string) => {
      const said = word.toLowerCase();
      preset = (said === 'audio' ? 'music' : said) as BlankKey;
      return space;
    })
    .replace(/\s+/g, ' ')
    .trim();
  return { preset: preset as BlankKey | null, rest };
}

/**
 * How the queue window searches for what is in its bar.
 *
 * - No `type:` word: as before - the site's videos and songs, and (with words) every archive row the room can play.
 * - `type:video`: the site's videos; the archive asked for videos only.
 * - `type:music`: the site's songs; the archive's audio, and its videos too - a song or an album uploaded as a
 *   video (YouTube) is music the room plays in the picture.
 * - `type:books`: audiobooks, as audio and as video (read-aloud books on YouTube), found by adding the word
 *   "audiobook" to the words; with no words it lists audiobooks at large. A book's text cannot play in a room,
 *   so text rows are never listed.
 * - `in:`, `from:`, `vibe:` and `sort:` read as on the archive page (web-filters.ts). As there, the site's own files
 *   are for a search with SOURCE ALL; one source is about that source.
 */
export function queueSearchPlan(bar: string): QueueSearchPlan {
  const { preset, rest } = takePreset(bar);
  const typed = parseWebSearch(rest);
  const words = typed.text;
  const authors = authorsOf(typed);
  const lookup = typed.source === QUEUE_LOOKUP_SOURCE;
  const source = isQueueSource(typed.source) || lookup ? typed.source : 'all';
  const anywhere = source === 'all';
  const filters = { source, authors, vibe: typed.vibe === true, sort: sortOf(typed) };
  // Films and shows, whatever TYPE was typed: nothing of the site's, and words are the only thing TMDB can look for.
  if (lookup) return { words, preset: null, site: { videos: false, songs: false }, ask: words.length === 0 ? null : { words, type: 'video', keep: 'video' }, ...filters };
  // A creator is something to look for, with no words at all.
  const empty = words.length === 0 && authors.length === 0;
  if (preset === 'video') return { words, preset, site: { videos: anywhere, songs: false }, ask: empty ? null : { words, type: 'video', keep: 'video' }, ...filters };
  if (preset === 'music') return { words, preset, site: { videos: false, songs: anywhere }, ask: empty ? null : { words, type: 'all', keep: 'both' }, ...filters };
  if (preset === 'books') {
    const asked = words.length === 0 ? AUDIOBOOK_WORD : `${words} ${AUDIOBOOK_WORD}`;
    return { words, preset, site: { videos: false, songs: false }, ask: { words: asked, type: 'all', keep: 'both' }, ...filters };
  }
  return { words, preset: null, site: { videos: anywhere, songs: anywhere }, ask: empty ? null : { words, type: 'all', keep: 'both' }, ...filters };
}

/**
 * A filter key pressed: the bar with that filter set (or taken out, for ALL and the defaults), its words untouched,
 * and any filter the queue does not read (`type:image`, `in:podcast`) tidied away. The bar stays the one truth, as on the
 * archive page. `type:` goes first, where a blank screen's key puts it. IMDB's lookup has no TYPE: pressing IMDB drops
 * the TYPE, and pressing a TYPE leaves the lookup for a search of what a room can play.
 */
export function withQueueFilter(bar: string, key: FilterKey, value: string): string {
  const { preset, rest } = takePreset(bar);
  const typed = parseWebSearch(key === 'type' ? rest : withFilter(rest, key, value));
  const lookup = typed.source === QUEUE_LOOKUP_SOURCE && key !== 'type';
  const typeKey = key === 'type' ? (QUEUE_TYPES.find((option) => option.value === value && option.value !== 'all')?.value as BlankKey | undefined) ?? null : preset;
  const chosen = lookup ? null : typeKey;
  const others = formatWebSearch({ ...typed, type: 'all', source: isQueueSource(typed.source) || lookup ? typed.source : 'all' });
  return [chosen === null ? '' : `type:${chosen}`, others].filter((part) => part.length > 0).join(' ');
}

/** Whether a row of one of the plan's searches is kept. */
export function keepsKind(keep: KeepKinds, kind: string): boolean {
  if (keep === 'video') return kind === 'video';
  if (keep === 'audio') return kind === 'audio';
  return kind === 'video' || kind === 'audio';
}

/**
 * Whether a search result is listed in a room's queue browser: of a kind the search keeps, and something a room can play, or a
 * KINO lookup (looked up, not added). A title on a friend's media server plays in a room from that server (its WATCH ON row);
 * it has no platform player, so until 2026-11-08 it was dropped from every search but a KINO one.
 */
export function roomListable(
  item: WebItem,
  keep: KeepKinds,
  lookingUp: boolean,
): boolean {
  if (!keepsKind(keep, item.kind)) return false;
  if (lookingUp) return true;
  if (playsInBar(item)) return true;
  if (item.media !== undefined && item.media.copies.length > 0) return true;
  const link = watchLinkForItem(item);
  return link !== null && isQueueableWebLink(link);
}

/** Black: nothing on screen - no current play, or one the queue no longer holds. */
export function screenIsBlank(room: Pick<WatchRoom, 'currentEntryId'>, queue: readonly WatchQueueEntry[]): boolean {
  return room.currentEntryId === null || !queue.some((entry) => entry.id === room.currentEntryId);
}

/**
 * What the host's player does when a file ends (or SKIP is pressed): the next thing queued, or, with nothing
 * left, back to black. A live stream never ends, so it never gets here.
 */
export function afterFile(queue: WatchQueueEntry[]): { kind: 'next'; entry: WatchQueueEntry } | { kind: 'black' } {
  const next = nextToPlay(queue);
  return next === undefined ? { kind: 'black' } : { kind: 'next', entry: next };
}

/** A black screen with something now in the queue: the host starts it. Null while there is nothing, or a file is on. */
export function blankStart(room: Pick<WatchRoom, 'currentEntryId'>, queue: WatchQueueEntry[]): WatchQueueEntry | null {
  if (!screenIsBlank(room, queue)) return null;
  return nextToPlay(queue) ?? null;
}
