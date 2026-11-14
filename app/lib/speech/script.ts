import { boardCommentHref, boardThreadHref } from '../forum/anchors';
import { mentionTokens, mentionToken } from '../forum/mentions';
import { isItemOwnedThread } from '../forum/site-author';
import type { ForumThread } from '../forum/types';
import type { ProfileComment } from '../profile/types';

/**
 * What a character may say, and how it is cut into bubbles (SPEC-character-speech.md; Luke, 2026-11-14).
 *
 * **A character only ever says what its own person wrote, and only what this reader may already read.** Everything here
 * is worked out from two things the page already holds: the profile's comments as this reader may see them, and the
 * board as this reader's browser holds it. Nothing is fetched, nothing is stored, and nothing is invented.
 *
 * Pure on purpose (the dice are handed in), so `Temp/check-character-speech.cjs` can hold every rule in it.
 */

/** Where a pressed bubble leads: a comment on this very profile (opened here), or a place on the board. */
export type SpeechTarget = { kind: 'here'; commentId: string } | { kind: 'board'; href: string };

export type SpeechLine = {
  /** Unique among one speaker's lines. */
  id: string;
  speakerId: string;
  /** The words as written, on one line. */
  text: string;
  target: SpeechTarget;
};

/** Somebody whose character is in the room. */
export type SpeechPerson = { id: string; name: string };

export type SpeechMaterial = {
  /** Whose profile this is. */
  owner: SpeechPerson;
  /** Whose character is speaking. */
  speakerId: string;
  /** Everybody whose character is in the room (the owner's replies to them are what the owner's character says). */
  present: SpeechPerson[];
  /** The profile's comments, already narrowed to what this reader may see. */
  comments: ProfileComment[];
  /** The board as this reader's browser holds it. */
  threads: ForumThread[];
};

/** How a comment left on a profile is named among the board's comments (`../forum/profile-threads`). */
const boardIdOf = (commentId: string) => `profile-comment:${commentId}`;

const oneLine = (words: string) => words.replace(/\s+/g, ' ').trim();

/** Whether `body` names `person` with an `@name` (the board's own way of answering somebody). */
function names(body: string, person: SpeechPerson): boolean {
  const wanted = mentionToken(person.name).slice(1).toLowerCase();
  return wanted.length > 0 && mentionTokens(body).some((token) => token.toLowerCase() === wanted);
}

/**
 * Everything `speaker` wrote on the board to, or about, `other`: a reply under a post `other` filed, a reply to one of
 * `other`'s own replies, and a post or reply that names them. A reply on an item's own thread (`COMMENTS ON ...`) is a
 * remark on the item, not an answer to whoever commented first, so only a direct answer or a name counts there.
 */
function repliesTo(threads: ForumThread[], speakerId: string, other: SpeechPerson, seen: Set<string>): SpeechLine[] {
  const lines: SpeechLine[] = [];

  for (const thread of threads) {
    if (thread.privateRecord !== undefined) continue;
    const theirs = thread.author.id === other.id && !isItemOwnedThread(thread);

    if (thread.author.id === speakerId && !isItemOwnedThread(thread) && names(`${thread.title} ${thread.body}`, other)) {
      const id = `post:${thread.id}`;
      const text = oneLine(thread.body.length > 0 ? thread.body : thread.title);
      if (!seen.has(id) && text.length > 0) {
        seen.add(id);
        lines.push({ id, speakerId, text, target: { kind: 'board', href: boardThreadHref(thread.id) } });
      }
    }

    for (const comment of thread.comments) {
      if (comment.author.id !== speakerId || seen.has(comment.id)) continue;
      const parent = comment.parentId === undefined ? undefined : thread.comments.find((one) => one.id === comment.parentId);
      const answersThem = parent === undefined ? theirs : parent.author.id === other.id;
      if (!answersThem && !names(comment.body, other)) continue;

      const text = oneLine(comment.body);
      if (text.length === 0) continue;
      seen.add(comment.id);
      lines.push({ id: comment.id, speakerId, text, target: { kind: 'board', href: boardCommentHref(comment.id) } });
    }
  }

  return lines;
}

/**
 * The lines one character may say on this profile.
 *
 * - Anybody but the owner (a commenter visiting, or the reader's own companion): their comments on this profile, and
 *   their replies anywhere on the board to something the owner said or posted (Luke: "any general replies theyve made
 *   to anything that user said or posted").
 * - The owner's character: the owner's own remarks on their own profile, and the owner's replies to the people whose
 *   characters are in the room.
 */
export function linesFor(material: SpeechMaterial): SpeechLine[] {
  const { owner, speakerId, present, comments, threads } = material;
  const seen = new Set<string>();
  const lines: SpeechLine[] = [];

  for (const comment of comments) {
    if (comment.author.id !== speakerId) continue;
    const text = oneLine(comment.body);
    if (text.length === 0) continue;
    // The same comment is on the board too, in the profile's own thread: said once.
    seen.add(boardIdOf(comment.id));
    lines.push({
      id: boardIdOf(comment.id),
      speakerId,
      text,
      target:
        comment.kind === 'profile'
          ? { kind: 'here', commentId: comment.id }
          : { kind: 'board', href: boardCommentHref(boardIdOf(comment.id)) },
    });
  }

  if (speakerId === owner.id) {
    for (const person of present) {
      if (person.id !== owner.id) lines.push(...repliesTo(threads, speakerId, person, seen));
    }
  } else {
    lines.push(...repliesTo(threads, speakerId, owner, seen));
  }

  return lines;
}

/**
 * The people whose characters may come to visit: whoever commented on this profile, most recent first, each once,
 * never the owner and never the reader (whose own companion is already the one that visits). The caller looks up who
 * of these has a character to show, and draws the first few that do.
 */
export function guestCandidates(comments: ProfileComment[], ownerId: string, viewerId: string | null, limit: number): SpeechPerson[] {
  const newestFirst = [...comments].sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));
  const people: SpeechPerson[] = [];

  for (const comment of newestFirst) {
    const id = comment.author.id;
    if (id === null || id === ownerId || id === viewerId || people.some((person) => person.id === id)) continue;
    people.push({ id, name: comment.author.displayName });
    if (people.length === limit) break;
  }

  return people;
}

/**
 * The next line out of a speaker's bag: picked at random (Luke: "random selection of all"), and not picked again until
 * every other line has had its turn. `said` is what has been said since the bag was last emptied; the answer carries
 * the bag as it stands afterwards. Null when there is nothing to say.
 */
export function nextLine(
  lines: SpeechLine[],
  said: string[],
  random: () => number,
): { line: SpeechLine; said: string[] } | null {
  if (lines.length === 0) return null;

  let unsaid = lines.filter((line) => !said.includes(line.id));
  let kept = said;
  if (unsaid.length === 0) {
    // Everything has been said: the bag is refilled, without starting on the line that was said last.
    const last = said[said.length - 1];
    unsaid = lines.length > 1 ? lines.filter((line) => line.id !== last) : lines;
    kept = [];
  }

  const line = unsaid[Math.min(unsaid.length - 1, Math.floor(random() * unsaid.length))];
  return { line, said: [...kept, line.id] };
}

/** How many letters fit on a bubble's line, and how many lines a bubble shows at once (Luke: "Two-line pages"). */
export const BUBBLE_LINE = 28;
export const BUBBLE_LINES = 2;

/**
 * The words cut into bubbles: each page is at most `lines` lines of at most `perLine` letters, broken between words (a
 * word longer than a line is cut). Nothing is dropped: the pages joined back together are the words as written. The
 * bubble draws each line without wrapping, so two lines is a promise rather than a hope.
 */
export function pagesOf(text: string, perLine: number = BUBBLE_LINE, lines: number = BUBBLE_LINES): string[][] {
  const width = Math.max(1, Math.floor(perLine));
  const rows: string[] = [];
  let row = '';

  for (let word of oneLine(text).split(' ')) {
    while (word.length > width) {
      // A word that cannot fit on any line: what is left of this line is filled, and it runs on.
      const room = row.length === 0 ? width : width - row.length - 1;
      if (room < 1) {
        rows.push(row);
        row = '';
        continue;
      }
      rows.push(row.length === 0 ? word.slice(0, room) : `${row} ${word.slice(0, room)}`);
      row = '';
      word = word.slice(room);
    }
    if (word.length === 0) continue;

    if (row.length === 0) row = word;
    else if (row.length + 1 + word.length <= width) row = `${row} ${word}`;
    else {
      rows.push(row);
      row = word;
    }
  }
  if (row.length > 0) rows.push(row);

  const pages: string[][] = [];
  const perPage = Math.max(1, Math.floor(lines));
  for (let at = 0; at < rows.length; at += perPage) pages.push(rows.slice(at, at + perPage));
  return pages;
}

/** The pace of a bubble, as numbers to tune once Luke has watched it. */
export const SPEECH_PACE = {
  /** One letter appears this often: about 25 a second. */
  letterMs: 40,
  /** The extra stop after `, . ! ?`. */
  pauseMs: 160,
  /** A page stays this long after its last letter. */
  pageMs: 2500,
  /** The first bubble opens this long after the room comes into view. */
  firstMs: [2000, 4000],
  /** The gap between one bubble closing and the next opening (Luke: "randomly semi frequently"). */
  gapMs: [6000, 16000],
} as const;

/** A length of time picked at random inside a range. */
export function waitWithin(range: readonly [number, number], random: () => number): number {
  return Math.round(range[0] + random() * (range[1] - range[0]));
}

/** Where a letter is followed by its stop. */
export function pausesAfter(letter: string): boolean {
  return letter === ',' || letter === '.' || letter === '!' || letter === '?';
}
