import type { MediaItem } from '../media/types';
import type { MadeKind } from '../settings/settings-rules';
import type { ForumAnchor, ForumThread } from './types';

/**
 * MADE rows (SPEC-forum-v3.md, M1A to M4A): one quiet board post per person per day, `SWEDEN MADE 3 THINGS TODAY`,
 * filed by the maker's own tab the first time they make something public that day with that kind's switch on. The post
 * stores nothing but its anchor, `made:<person>:<day>`: what it lists is read live from the things themselves
 * (`./made-things.ts`), the way a stream record is drawn from its room, so it grows without edits and a thing deleted
 * later drops out.
 *
 * A *board* anchor, so the one-thread-per-item rule (`forum_threads_anchor_key`, non-board anchors only) never applies
 * and no table changes. Two tabs racing may file two rows for one day: the board shows one (`dropDuplicateMade`).
 *
 * Pure, so `Temp/check-made-posts.cjs` asks the same questions the board does.
 */

const MADE_ANCHOR_PREFIX = 'made:';

/** A day as the row names it: the UTC date, as stream records name theirs, so every reader agrees which day it is. */
export function madeDay(at: Date | string | number = Date.now()): string {
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

export function madeAnchor(person: string, day: string): ForumAnchor {
  return { kind: 'board', id: `${MADE_ANCHOR_PREFIX}${person}:${day}`, label: 'MADE' };
}

/** Whose day a thread is the MADE row of, or null for every other thread. */
export function madeOf(anchor: ForumAnchor): { person: string; day: string } | null {
  if (anchor.kind !== 'board' || !anchor.id.startsWith(MADE_ANCHOR_PREFIX)) return null;
  const rest = anchor.id.slice(MADE_ANCHOR_PREFIX.length);
  const split = rest.lastIndexOf(':');
  if (split <= 0) return null;
  const person = rest.slice(0, split);
  const day = rest.slice(split + 1);
  return /^\d{4}-\d\d-\d\d$/.test(day) ? { person, day } : null;
}

export function isMadeThread(thread: Pick<ForumThread, 'anchor'>): boolean {
  return madeOf(thread.anchor) !== null;
}

/** What is stored as the title: never shown as it is (`madeHeading` is), but a search for the name still finds the row. */
export function madeThreadTitle(name: string, day: string): string {
  return `MADE :: ${name.toUpperCase()} :: ${day}`;
}

/**
 * The row's heading (M4A): `SWEDEN MADE 3 THINGS TODAY`, read live from how many things the day holds. While they are
 * being read it says `SWEDEN MADE THINGS TODAY`; on an earlier day, `ON 2026-11-17`.
 */
export function madeHeading(name: string, count: number | null, day: string, today: string = madeDay()): string {
  const what = count === null ? 'THINGS' : `${count} THING${count === 1 ? '' : 'S'}`;
  return `${name.toUpperCase()} MADE ${what} ${day === today ? 'TODAY' : `ON ${day}`}`;
}

/**
 * One row a person a day on the board: when two tabs raced and filed two, the first filed stands and the others are not
 * drawn, unless somebody replied to one (a MADE row with replies stays, like any post).
 */
export function dropDuplicateMade<T extends Pick<ForumThread, 'id' | 'anchor' | 'createdAt' | 'comments'>>(threads: T[]): T[] {
  const first = new Map<string, T>();
  for (const thread of threads) {
    if (!isMadeThread(thread)) continue;
    const held = first.get(thread.anchor.id);
    if (held === undefined || Date.parse(thread.createdAt) < Date.parse(held.createdAt)) first.set(thread.anchor.id, thread);
  }
  return threads.filter((thread) => !isMadeThread(thread) || first.get(thread.anchor.id) === thread || thread.comments.length > 0);
}

/** One thing a MADE row lists, read live from where it lives. */
export type MadeThing = {
  kind: MadeKind;
  id: string;
  title: string;
  /** When it was made public. */
  at: string;
  /** Where it opens. */
  href: string;
  /** A picture the site already holds (a drawing, a character's strip), shown when the row is opened. */
  picture?: string;
  /** A track's catalogue record, for the player. */
  track?: MediaItem;
};

/** The things of one day, newest first. */
export function thingsOfDay(things: readonly MadeThing[], day: string): MadeThing[] {
  return things.filter((thing) => madeDay(thing.at) === day).sort((left, right) => Date.parse(right.at) - Date.parse(left.at));
}

/** Whether the maker's tab should file a row now: signed in, that kind's switch on, and no row of theirs for today yet. */
export function shouldFileMade(input: {
  person: string | null;
  switchOn: boolean;
  day: string;
  threads: readonly Pick<ForumThread, 'anchor'>[];
}): boolean {
  if (input.person === null || !input.switchOn || input.day === '') return false;
  const anchorId = madeAnchor(input.person, input.day).id;
  return !input.threads.some((thread) => thread.anchor.kind === 'board' && thread.anchor.id === anchorId);
}
