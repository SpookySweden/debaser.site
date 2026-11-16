import { normaliseTagLabel, tagKey } from './tag-vocabulary';

/**
 * The small formatting a post's words may carry (Luke, 2026-11-16, "3A"): `**bold**`, `*italic*`,
 * clickable http/https links, and `#tag` words that are filed as the post's tags. Nothing else:
 * no strikethrough, quotes or headings.
 *
 * The words are read into plain pieces here and drawn as React elements by `PostText.tsx`; nothing
 * a poster writes is ever handed to the page as HTML. The rules are cautious on purpose, so a post
 * written before formatting existed reads as it always did:
 * - emphasis never crosses a line, needs a non-space just inside each star, and never starts or ends
 *   against a letter or digit (`5*3*2`, `a * b * c` and `snake_*case*` stay as written);
 * - a link is only `http://` or `https://`, and trailing punctuation (a full stop, a closing bracket
 *   with no opening one) stays outside it;
 * - a tag is `#` then a letter, at the start of a line or after a space, bracket or star (so `C#`, `issue #5`
 *   and the `#` in an address are left alone), at most 24 characters long.
 */

export type PostPiece =
  | { kind: 'text'; text: string }
  | { kind: 'bold'; pieces: PostPiece[] }
  | { kind: 'italic'; pieces: PostPiece[] }
  | { kind: 'link'; href: string; text: string }
  | { kind: 'tag'; label: string; key: string; text: string };

/** The most `#tag` words one post files as tags; the rest stay as words. */
export const MAX_HASH_TAGS = 6;

const TAG_MAX_LENGTH = 24;

/** A long post is read for links and tags only: emphasis matching is quadratic in the worst case. */
const EMPHASIS_LIMIT = 20000;

const LINK = /https?:\/\/[^\s<>"'`]+/g;
const HASH_TAG = /#([A-Za-z][A-Za-z0-9]*(?:[_-][A-Za-z0-9]+)*)(?![A-Za-z0-9_-])/g;
/** What may stand just before a tag's `#`: nothing (start of a line), a space, an opening bracket or a star. */
const BEFORE_TAG = /[\s([{*]/;
const WORD = /[A-Za-z0-9_]/;

type Atom = { start: number; end: number; piece: PostPiece };

/** A link as written, with any trailing punctuation left outside it; null if it is not a safe web address. */
function readLink(raw: string): string | null {
  let text = raw.replace(/[.,;:!?*]+$/, '');
  // A closing bracket belongs to the link only when the link opened one.
  while (text.endsWith(')') && (text.match(/\(/g) ?? []).length < (text.match(/\)/g) ?? []).length) {
    text = text.slice(0, -1).replace(/[.,;:!?*]+$/, '');
  }
  try {
    const url = new URL(text);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    if (url.hostname.length === 0) return null;
  } catch {
    return null;
  }
  return text;
}

/** The links and tags in one line, in order, never overlapping. */
function atomsIn(line: string): Atom[] {
  const atoms: Atom[] = [];

  for (const match of line.matchAll(LINK)) {
    const start = match.index ?? 0;
    const text = readLink(match[0]);
    if (text === null) continue;
    atoms.push({ start, end: start + text.length, piece: { kind: 'link', href: text, text } });
  }

  for (const match of line.matchAll(HASH_TAG)) {
    const start = match.index ?? 0;
    if (start > 0 && !BEFORE_TAG.test(line[start - 1])) continue;
    if (match[1].length > TAG_MAX_LENGTH) continue;
    if (atoms.some((atom) => start < atom.end && start + match[0].length > atom.start)) continue;
    const label = normaliseTagLabel(match[1]);
    if (label.length === 0) continue;
    atoms.push({ start, end: start + match[0].length, piece: { kind: 'tag', label, key: tagKey(label), text: match[0] } });
  }

  return atoms.sort((a, b) => a.start - b.start);
}

/** Plain words between `start` and `end`, with the links and tags among them as their own pieces. */
function plainPieces(line: string, start: number, end: number, atoms: Atom[]): PostPiece[] {
  const pieces: PostPiece[] = [];
  let at = start;
  for (const atom of atoms) {
    if (atom.start < start || atom.end > end) continue;
    if (atom.start > at) pieces.push({ kind: 'text', text: line.slice(at, atom.start) });
    pieces.push(atom.piece);
    at = atom.end;
  }
  if (at < end) pieces.push({ kind: 'text', text: line.slice(at, end) });
  return pieces;
}

function insideAtom(position: number, atoms: Atom[]): boolean {
  return atoms.some((atom) => position >= atom.start && position < atom.end);
}

/** How many stars a delimiter at `position` is (1 or 2), counting a run of exactly that many. */
function runAt(line: string, position: number): number {
  let length = 0;
  while (line[position + length] === '*') length += 1;
  return length;
}

function canOpen(line: string, position: number, size: number, atoms: Atom[]): boolean {
  const before = position > 0 ? line[position - 1] : '';
  const after = line[position + size] ?? '';
  return (
    !insideAtom(position, atoms) &&
    before !== '*' &&
    !WORD.test(before) &&
    after !== '' &&
    after !== '*' &&
    !/\s/.test(after)
  );
}

function canClose(line: string, position: number, size: number, atoms: Atom[]): boolean {
  const before = position > 0 ? line[position - 1] : '';
  const after = line[position + size] ?? '';
  return (
    !insideAtom(position, atoms) &&
    before !== '' &&
    before !== '*' &&
    !/\s/.test(before) &&
    after !== '*' &&
    !WORD.test(after)
  );
}

/** The pieces of `line` between `start` and `end`, emphasis matched left to right. */
function inlinePieces(line: string, start: number, end: number, atoms: Atom[]): PostPiece[] {
  const pieces: PostPiece[] = [];
  let plainFrom = start;
  let at = start;

  while (at < end) {
    const star = line.indexOf('*', at);
    if (star < 0 || star >= end) break;
    const size = runAt(line, star);
    if ((size !== 1 && size !== 2) || star + size > end || !canOpen(line, star, size, atoms)) {
      at = star + Math.max(size, 1);
      continue;
    }

    // The nearest closing run of the same size, still inside this range.
    let close = -1;
    let look = star + size;
    while (look < end) {
      const next = line.indexOf('*', look);
      if (next < 0 || next + size > end) break;
      const nextSize = runAt(line, next);
      if (nextSize === size && next > star + size && canClose(line, next, size, atoms)) {
        close = next;
        break;
      }
      look = next + Math.max(nextSize, 1);
    }

    if (close < 0) {
      at = star + size;
      continue;
    }

    if (star > plainFrom) pieces.push(...plainPieces(line, plainFrom, star, atoms));
    const inner = inlinePieces(line, star + size, close, atoms);
    pieces.push(size === 2 ? { kind: 'bold', pieces: inner } : { kind: 'italic', pieces: inner });
    at = close + size;
    plainFrom = at;
  }

  if (plainFrom < end) pieces.push(...plainPieces(line, plainFrom, end, atoms));
  return pieces;
}

/** A post's words read into pieces; the line breaks stay in the text pieces, as written. */
export function parsePost(body: string): PostPiece[] {
  const lines = body.split('\n');
  const pieces: PostPiece[] = [];
  const emphasis = body.length <= EMPHASIS_LIMIT;

  lines.forEach((line, index) => {
    if (index > 0) pieces.push({ kind: 'text', text: '\n' });
    const atoms = atomsIn(line);
    pieces.push(...(emphasis ? inlinePieces(line, 0, line.length, atoms) : plainPieces(line, 0, line.length, atoms)));
  });

  return pieces;
}

function piecesWords(pieces: PostPiece[]): string {
  return pieces
    .map((piece) => (piece.kind === 'bold' || piece.kind === 'italic' ? piecesWords(piece.pieces) : piece.text))
    .join('');
}

/** A post's words with the formatting stars taken out: what a preview or a one-line clip shows. */
export function postWords(body: string): string {
  return piecesWords(parsePost(body));
}

function collectTags(pieces: PostPiece[], into: string[]): void {
  for (const piece of pieces) {
    if (piece.kind === 'tag') into.push(piece.label);
    else if (piece.kind === 'bold' || piece.kind === 'italic') collectTags(piece.pieces, into);
  }
}

/** The `#tag` words of a post, as tag labels, deduplicated by key, at most `MAX_HASH_TAGS`. */
export function hashTagsIn(body: string): string[] {
  const labels: string[] = [];
  collectTags(parsePost(body), labels);
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const label of labels) {
    const key = tagKey(label);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(label);
  }
  return unique.slice(0, MAX_HASH_TAGS);
}
