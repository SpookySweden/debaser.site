/**
 * What this reader has already read on the board, and what still counts as new.
 *
 * A post is read once it has been opened, and a reply is read once it was *there* the last time the
 * post was opened. One instant per post answers both questions - the marker is when the reader last
 * opened it, so a reply filed after that instant is still white while the post around it has gone
 * quiet. That is the classic "new since your last visit" reading of a forum, and it is why the two
 * states are independent: a post can be read while its newest replies are not, and a reply can only
 * count as read because the post it answers has been opened at least once.
 *
 * **`localStorage`, per account, and not a table.** A read marker is this browser's memory of what
 * this reader has looked at - it is not part of what was written, and nothing anybody else can see
 * depends on it. The character shelf (`app/lib/character/library.ts`) and the tag colours beside this
 * file are kept the same way, one browser and one account at a time; the same reader on a second
 * machine starts with nothing read, which is a smaller wrong than a write per post open. What is
 * *not* kept here is anything the archive has to agree about.
 *
 * Everything in the file is a plain function over the map, so the rules can be driven without React
 * and without a browser (`Temp/check-board-read.cjs` installs a fake `localStorage` and does exactly
 * that). The provider holds the map for the account that is signed in and writes through
 * `saveThreadRead`.
 */
import type { ForumAuthor } from './types';

/** The account a signed-out reader's marks belong to, so a guest is not "everybody". */
export const GUEST_ACCOUNT = 'guest';

/** Post id to the instant the reader last opened it. No entry at all means never opened. */
export type ReadMarks = Record<string, string>;

const STORAGE_KEY = 'debaser.forum.read.v1';

/**
 * How many posts one account remembers.
 *
 * A mark is a few dozen bytes and a board visitor collects one per post they open, so the list would
 * grow forever and every read would parse all of it. The newest few hundred are what a reader can
 * still recognise as "I read that"; older rows are old enough that "read" says nothing. The oldest go
 * first, so the newest reading survives the pruning.
 */
const MAX_MARKS = 300;

const LOOKS_LIKE_AN_INSTANT = /^\d{4}-\d\d-\d\d[T ]\d\d:\d\d/;

type StoredRead = { version: 1; accounts: Record<string, ReadMarks> };

let cache: StoredRead | null = null;

function hasStorage(): boolean {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

/** One instant, as a number, however the store spelled it; null when it is not a date at all. */
export function instantOf(value: string): number | null {
  const parsed = Date.parse(value.includes(' ') ? value.replace(' ', 'T') : value);

  return Number.isNaN(parsed) ? null : parsed;
}

/**
 * The stored marks, as they are, with anything unrecognisable dropped.
 *
 * `localStorage` is the one input this module cannot trust: a value in it is a value a user can edit,
 * so a row that is not a post id pointing at an instant is dropped rather than carried around. A
 * storage that cannot be read at all answers "nothing read yet", which is the honest answer.
 */
function readStore(): StoredRead {
  const empty: StoredRead = { version: 1, accounts: {} };
  if (cache !== null) return cache;
  if (!hasStorage()) {
    cache = empty;
    return cache;
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === null || raw.length === 0) {
      cache = empty;
      return cache;
    }

    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) {
      cache = empty;
      return cache;
    }

    const accounts: Record<string, ReadMarks> = {};
    const stored = (parsed as { accounts?: unknown }).accounts;

    if (typeof stored === 'object' && stored !== null) {
      for (const [accountId, marks] of Object.entries(stored as Record<string, unknown>)) {
        if (accountId.length === 0 || typeof marks !== 'object' || marks === null) continue;

        const clean: ReadMarks = {};
        for (const [threadId, at] of Object.entries(marks as Record<string, unknown>)) {
          if (threadId.length === 0 || typeof at !== 'string' || !LOOKS_LIKE_AN_INSTANT.test(at)) continue;
          clean[threadId] = at;
        }

        accounts[accountId] = clean;
      }
    }

    cache = { version: 1, accounts };
    return cache;
  } catch {
    cache = empty;
    return cache;
  }
}

function writeStore(store: StoredRead): void {
  cache = store;
  if (!hasStorage()) return;

  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    // Storage full or disabled: the marks still apply for this session.
  }
}

/** Drops the oldest marks once the list is over its cap, so a board visit does not cost forever. */
function prune(marks: ReadMarks): ReadMarks {
  const entries = Object.entries(marks);
  if (entries.length <= MAX_MARKS) return marks;

  const newest = entries
    .sort((left, right) => (instantOf(right[1]) ?? 0) - (instantOf(left[1]) ?? 0))
    .slice(0, MAX_MARKS);

  return Object.fromEntries(newest);
}

/** Everything one account has read. A fresh reader gets an empty map, never null. */
export function loadMarks(accountId: string): ReadMarks {
  return readStore().accounts[accountId] ?? {};
}

/**
 * Marks a post read as of `at`, and hands back the account's marks as they now stand.
 *
 * The caller keeps the returned map - it is what React re-renders from - so the store and the screen
 * cannot come out different: there is one write and one answer.
 */
export function saveThreadRead(accountId: string, threadId: string, at: string): ReadMarks {
  if (accountId.length === 0 || threadId.length === 0 || instantOf(at) === null) return loadMarks(accountId);

  const store = readStore();
  const marks = prune({ ...(store.accounts[accountId] ?? {}), [threadId]: at });
  writeStore({ version: 1, accounts: { ...store.accounts, [accountId]: marks } });

  return marks;
}

/** How the board's own copy of the marks is asked for: by account, from the signed-in author. */
export function accountOf(author: ForumAuthor): string {
  return author.id === null || author.id.length === 0 ? GUEST_ACCOUNT : author.id;
}

/** Whether the post has ever been opened by this reader. */
export function postIsRead(marks: ReadMarks, threadId: string): boolean {
  return marks[threadId] !== undefined;
}

/**
 * Whether a reply was already there the last time its post was opened.
 *
 * A reply with no readable date counts as unread: white is the state that says "there is something
 * here", and a row that is wrong about that is worse than one that is cautious.
 */
export function replyIsRead(marks: ReadMarks, threadId: string, createdAt: string): boolean {
  const seenAt = marks[threadId];
  if (seenAt === undefined) return false;

  const seen = instantOf(seenAt);
  const written = instantOf(createdAt);

  if (seen === null || written === null) return false;

  return written <= seen;
}
