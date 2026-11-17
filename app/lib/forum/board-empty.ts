import type { TagMatchMode } from './board-query';
import type { BoardView } from './board-address';

/** A key the empty board offers, each undoing one thing that emptied it. */
export type EmptyClear = 'tags' | 'source' | 'music' | 'feed';

export type EmptyBoard = { line: string; clears: EmptyClear[] };

export type EmptyBoardInput = {
  view: BoardView;
  /** The picked tags' labels, as their chips say them. */
  tagLabels: string[];
  match: TagMatchMode;
  /** The source's label (`ASSET THREADS`), or null for ALL SOURCES. */
  sourceLabel: string | null;
  musicOnly: boolean;
  musicTagCount: number;
};

/**
 * What an empty board says, and the keys that clear what emptied it (SPEC-forum-v2.md, Luke's 11A: "NO THREADS MATCH."
 * left a reader guessing). Only called once the board has posts at all: an empty board says so elsewhere.
 * On STREAMS every filter is set aside (12A), so an empty list there only means there are no records.
 */
export function emptyBoardLine(input: EmptyBoardInput): EmptyBoard {
  if (input.view === 'streams') return { line: 'NO STREAMS ON RECORD.', clears: [] };

  const gallery = input.view === 'gallery';
  const clears: EmptyClear[] = [];
  let line = gallery ? 'NO PICTURES' : 'NOTHING';

  if (input.tagLabels.length > 0) {
    line += ` TAGGED ${input.tagLabels.join(input.match === 'all' ? ' AND ' : ' OR ')}`;
    clears.push('tags');
  }
  if (input.sourceLabel !== null) {
    line += ` IN ${input.sourceLabel}`;
    clears.push('source');
  }
  if (input.musicOnly || input.musicTagCount > 0) {
    line += input.musicTagCount > 0 ? ' WITH THOSE SOUNDS' : ' WITH MUSIC';
    clears.push('music');
  }
  if (gallery) clears.push('feed');

  if (clears.length === (gallery ? 1 : 0)) line = gallery ? 'NO PICTURES ON THE BOARD YET' : 'NO THREADS MATCH';
  return { line: `${line}.`, clears };
}
