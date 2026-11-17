import type { TagMatchMode } from './board-query';

/**
 * Where a reader stands on the board: which of its three tabs, and which tags narrow it (SPEC-forum-v2.md, Luke's 1A and
 * 2A, 2026-11-17). Kept in the address (`/forum?view=gallery&tags=user%3Alore`) so a copied link opens the same board,
 * remembered in this browser so a reload or a later visit comes back to it, and stepped through by Back and Forward.
 * FEED, no tags and ANY are the defaults and are never written, so a plain `/forum` is the plain board.
 *
 * Pure, like the sort's own `board-sort.ts`, so the address can be checked without a browser.
 */

/** The board's three tabs: one row, exactly one lit. STREAMS is the list of stream records (Luke's 1A). */
export type BoardView = 'feed' | 'gallery' | 'streams';

export const BOARD_VIEWS: readonly BoardView[] = ['feed', 'gallery', 'streams'];

export type BoardPlace = { view: BoardView; tags: string[]; match: TagMatchMode };

export const DEFAULT_PLACE: BoardPlace = { view: 'feed', tags: [], match: 'any' };

/** This browser's memory of the place (the sort keeps its own key). */
export const BOARD_STORAGE_KEY = 'debaser.forum.board.v1';

/** More than this many tags in one address is not a reader's pick: the rest are dropped. */
const MAX_TAGS = 20;
const MAX_TAG_LENGTH = 80;

function isView(value: unknown): value is BoardView {
  return typeof value === 'string' && (BOARD_VIEWS as readonly string[]).includes(value);
}

function cleanTags(values: unknown[]): string[] {
  const out: string[] = [];
  for (const value of values) {
    if (typeof value !== 'string') continue;
    const tag = value.trim();
    if (tag.length === 0 || tag.length > MAX_TAG_LENGTH || out.includes(tag)) continue;
    out.push(tag);
    if (out.length === MAX_TAGS) break;
  }
  return out;
}

/** The place an address names, or null when it names none of it (then this browser's memory may fill in). */
export function readBoardPlace(params: URLSearchParams): BoardPlace | null {
  const view = params.get('view');
  const tags = params.get('tags');
  const match = params.get('match');
  if (view === null && tags === null && match === null) return null;

  return {
    view: isView(view) ? view : 'feed',
    tags: tags === null ? [] : cleanTags(tags.split(',')),
    match: match === 'all' ? 'all' : 'any',
  };
}

/** Writes the place into the params, leaving out what is the default and every other param as it was. */
export function writeBoardPlace(params: URLSearchParams, place: BoardPlace): void {
  if (place.view === 'feed') params.delete('view');
  else params.set('view', place.view);

  if (place.tags.length === 0) params.delete('tags');
  else params.set('tags', place.tags.join(','));

  if (place.match === 'all' && place.tags.length > 0) params.set('match', 'all');
  else params.delete('match');
}

/** This browser's memory, read defensively: anything that is not a place is no place. */
export function parseStoredPlace(raw: string | null): BoardPlace | null {
  if (raw === null || raw.length === 0) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const row = parsed as Partial<Record<keyof BoardPlace, unknown>>;
    if (!isView(row.view)) return null;
    return {
      view: row.view,
      tags: Array.isArray(row.tags) ? cleanTags(row.tags) : [],
      match: row.match === 'all' ? 'all' : 'any',
    };
  } catch {
    return null;
  }
}
