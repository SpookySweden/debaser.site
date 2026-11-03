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

export const BLANK_KEYS: readonly { key: BlankKey; label: string }[] = [
  { key: 'video', label: 'VIDEO' },
  { key: 'music', label: 'MUSIC' },
  { key: 'books', label: 'BOOKS' },
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
  /** The words, with the filter word taken out. */
  words: string;
  preset: BlankKey | null;
  /** Which of the site's own files are listed first: its videos, its songs. */
  site: { videos: boolean; songs: boolean };
  /** The archive search to run, or null: no words, so only the site's own files (BOOKS always asks). */
  ask: QueueAsk | null;
};

const PRESET = /(^|\s)type:(video|music|books)(?=\s|$)/gi;

/** A word that marks an audiobook, added to a BOOKS search so YouTube and the Archive find the read-aloud ones. */
export const AUDIOBOOK_WORD = 'audiobook';

/**
 * How the queue window searches for what is in its bar.
 *
 * - No filter word: as before - the site's videos and songs, and (with words) every archive row the room can play.
 * - `type:video`: the site's videos; the archive asked for videos only.
 * - `type:music`: the site's songs; the archive's audio, and its videos too - a song or an album uploaded as a
 *   video (YouTube) is music the room plays in the picture.
 * - `type:books`: audiobooks, as audio and as video (read-aloud books on YouTube), found by adding the word
 *   "audiobook" to the words; with no words it lists audiobooks at large. A book's text cannot play in a room,
 *   so text rows are never listed.
 */
export function queueSearchPlan(bar: string): QueueSearchPlan {
  let preset: BlankKey | null = null;
  const words = bar
    .replace(PRESET, (_whole, space: string, word: string) => {
      preset = word.toLowerCase() as BlankKey;
      return space;
    })
    .replace(/\s+/g, ' ')
    .trim();
  const chosen = preset as BlankKey | null;
  if (chosen === 'video') return { words, preset: chosen, site: { videos: true, songs: false }, ask: words.length === 0 ? null : { words, type: 'video', keep: 'video' } };
  if (chosen === 'music') return { words, preset: chosen, site: { videos: false, songs: true }, ask: words.length === 0 ? null : { words, type: 'all', keep: 'both' } };
  if (chosen === 'books') {
    const asked = words.length === 0 ? AUDIOBOOK_WORD : `${words} ${AUDIOBOOK_WORD}`;
    return { words, preset: chosen, site: { videos: false, songs: false }, ask: { words: asked, type: 'all', keep: 'both' } };
  }
  return { words, preset: null, site: { videos: true, songs: true }, ask: words.length === 0 ? null : { words, type: 'all', keep: 'both' } };
}

/** Whether a row of one of the plan's searches is kept. */
export function keepsKind(keep: KeepKinds, kind: string): boolean {
  if (keep === 'video') return kind === 'video';
  if (keep === 'audio') return kind === 'audio';
  return kind === 'video' || kind === 'audio';
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
