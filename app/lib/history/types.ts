/**
 * HISTORY (SPEC-history.md, Luke 2026-11-17): one line per play, what it was, how it reached you, and when.
 *
 * Metadata only: an address, a title and maker as the site showed them, a hotlinked thumbnail. Never counts, likes,
 * views or ratings. Kept on the account (`user_plays`, owner only) or, for a visitor, in that browser only.
 */

export type PlayKind = 'song' | 'video' | 'book';

/** How a play reached you: the "how" line's first word (SPEC-history.md, "How it reached you"). */
export type PlayHow =
  | 'yourself'
  | 'own_queue'
  | 'room'
  | 'letter'
  | 'comment'
  | 'post'
  | 'profile'
  | 'playlist'
  | 'reader'
  | 'not_recorded';

export const PLAY_HOWS: readonly PlayHow[] = ['yourself', 'own_queue', 'room', 'letter', 'comment', 'post', 'profile', 'playlist', 'reader', 'not_recorded'];

/** What a page hands over when something starts playing. */
export type PlayNote = {
  kind: PlayKind;
  ref: string;
  title: string;
  maker: string;
  picture?: string | null;
  how: PlayHow;
  /** Where it was pressed, or the room's name: 'MEDIA', 'MIA'S ROOM'. */
  whereLabel: string;
  whereHref?: string | null;
  addedBy?: string | null;
  addedByName?: string;
  roomId?: string | null;
  queueEntryId?: string | null;
  letterId?: string | null;
  /** A comment's or post's id. */
  sourceRef?: string | null;
  lengthSeconds?: number | null;
};

/** One line of the log. */
export type Play = Required<Omit<PlayNote, 'lengthSeconds'>> & {
  id: string;
  playedAt: string;
  stoppedAt: string | null;
  leftAtSeconds: number | null;
  lengthSeconds: number | null;
};

export const MAX_REF = 2048;
export const MAX_TITLE = 200;
export const MAX_MAKER = 100;
export const MAX_WHERE = 100;
export const MAX_HREF = 300;
/** The same thing reached the same way within this long is the same play (a pause and play, a seek, a reload). */
export const SAME_PLAY_MS = 60_000;
/** The same room queue row seen again within this long is the same play (a reload or a return mid-play). */
export const SAME_ROW_MS = 6 * 60 * 60_000;
/** Plays in a row in the same room with less than this between them are one session. */
export const SESSION_GAP_MS = 30 * 60_000;
/** A visitor's browser keeps at most this many lines, the oldest going first. */
export const BROWSER_MAX = 500;
