/**
 * FOR YOU's history (SPEC-recommender.md; Luke's OK 2026-11-13). Pure types, shared by the browser's history store, the
 * engine and the checks.
 */

export const HISTORY_KINDS = ['media', 'song', 'book', 'thread', 'room', 'letter', 'lore', 'person'] as const;
export type HistoryKind = (typeof HISTORY_KINDS)[number];

/** What was done. A stronger one replaces a weaker one; NOT FOR ME stays until the row is deleted. */
export type HistoryAction = 'opened' | 'played' | 'read' | 'finished' | 'not_for_me';

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
export type HistoryNote = Omit<HistoryRow, 'firstAt' | 'lastAt' | 'action'> & { action: Exclude<HistoryAction, 'not_for_me'> };

export const MAX_REF = 300;
export const MAX_TITLE = 200;
export const MAX_MAKER = 100;
export const MAX_WORDS = 12;
/** Rows are kept this long after they were last touched (the hourly MEDIA fetch deletes older ones). */
export const KEEP_DAYS = 90;
