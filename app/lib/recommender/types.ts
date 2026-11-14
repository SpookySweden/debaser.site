/**
 * FOR YOU's history (SPEC-recommender.md; Luke's OK 2026-11-13). Pure types, shared by the browser's history store, the
 * engine and the checks.
 */

/** `maker`: a channel or creator by name, the row SHOW LESS FROM THIS CHANNEL writes (Luke, 2026-11-14). */
export const HISTORY_KINDS = ['media', 'song', 'book', 'thread', 'room', 'letter', 'lore', 'person', 'maker'] as const;
export type HistoryKind = (typeof HISTORY_KINDS)[number];

/**
 * What was done. A stronger one replaces a weaker one (opened < played = read < skipped < finished). The three a person
 * presses themselves (`more`, `less`, `not_for_me`) replace anything and are replaced only by another press.
 * `skipped`: a video started and closed within `SKIP_SECONDS`. `more`: MORE LIKE THIS. `less`: SHOW LESS FROM THIS CHANNEL.
 */
export type HistoryAction = 'opened' | 'played' | 'read' | 'finished' | 'not_for_me' | 'skipped' | 'more' | 'less';

/** The actions a person presses on the feedback key: the newest press wins, and nothing they merely do replaces it. */
export const PRESSED_ACTIONS: readonly HistoryAction[] = ['more', 'less', 'not_for_me'];

/** How the weaker actions rank; a higher one replaces a lower one. */
export const ACTION_RANK: Readonly<Record<HistoryAction, number>> = { opened: 1, played: 2, read: 2, skipped: 3, finished: 4, more: 9, less: 9, not_for_me: 9 };

/** What the row becomes when `next` is noted on a row that says `before` (the database's `history_note` does the same). */
export function actionAfter(before: HistoryAction | null, next: HistoryAction): HistoryAction {
  if (before === null || PRESSED_ACTIONS.includes(next)) return next;
  if (PRESSED_ACTIONS.includes(before)) return before;
  return ACTION_RANK[next] > ACTION_RANK[before] ? next : before;
}

/** One thing a person opened, played or read: its site address, its title and maker as shown, and its words. */
export type HistoryRow = {
  kind: HistoryKind;
  ref: string;
  title: string;
  maker: string;
  words: string[];
  action: HistoryAction;
  firstAt: string;
  lastAt: string;
};

/** What a page hands `noteHistory`: everything but the times, which the database keeps. */
export type HistoryNote = Omit<HistoryRow, 'firstAt' | 'lastAt' | 'action'> & { action: Exclude<HistoryAction, 'not_for_me' | 'more' | 'less'> };

/** What the feedback key writes: one of the three presses. */
export type HistoryPress = Omit<HistoryRow, 'firstAt' | 'lastAt'>;

export const MAX_REF = 300;
export const MAX_TITLE = 200;
export const MAX_MAKER = 100;
export const MAX_WORDS = 12;
/** Rows are kept this long after they were last touched (the hourly MEDIA fetch deletes older ones). */
export const KEEP_DAYS = 90;
/** A video closed or replaced within this long of PLAY was skipped. */
export const SKIP_SECONDS = 30;

/** The row SHOW LESS FROM THIS CHANNEL keeps: one per channel name, whatever the letters' case. */
export function makerRef(maker: string): string {
  return maker.replace(/\s+/g, ' ').trim().toLowerCase().slice(0, MAX_REF);
}
