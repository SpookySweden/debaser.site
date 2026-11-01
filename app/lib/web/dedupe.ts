import { compareItems } from './paging';
import type { WebItem } from './types';

/**
 * WEB dedupe (Phase 4): the same work found on more than one platform (a LibriVox recording on the
 * Internet Archive and in a podcast feed) is shown as ONE row, with the other copies listed on it as
 * ALSO ON links. Nothing is ever deleted or merged in the table: every copy keeps its own row, and every
 * source stays one click away.
 *
 * **The rule, deliberately conservative** (a wrong merge hides a real item behind another's title; a
 * missed merge only shows a duplicate):
 * 1. Fingerprint = the title and the creator, tidied: accents dropped, lower case, punctuation to spaces,
 *    creators sorted (so "A; B" = "B; A"). Both must be present. Generic titles ("Episode 12",
 *    "Chapter 3", "Untitled") and very short ones get no fingerprint at all.
 * 2. Same fingerprint is not enough on its own. A group is shown as one row only when nothing contradicts
 *    it: every duration given agrees (within 3%, at least 10 seconds), and two copies on the SAME platform
 *    must both give a duration (two uploads with one title and creator on one platform are more often two
 *    different recordings than one).
 * 3. If any of that fails, or the group has more than MAX_GROUP_SIZE copies (a fingerprint that loose is
 *    more likely a series reusing a title), the whole group is shown ungrouped, as separate rows. The decision is made for
 *    the group, never pair by pair, so no copy can fall between two rows.
 * 4. The group's row is its newest member (stream order); the others ride on it as ALSO ON.
 *
 * `dedupe_key` (supabase/migrations/*_web_search_dedupe.sql) stores step 1, written by the ingest, so the
 * database can fetch a page's siblings. `scripts/check-web-dedupe.cjs` holds every step.
 */

/** Bumped if the fingerprint ever changes, so old and new keys never meet. */
const KEY_VERSION = 'tc1';

/** The `web_items_dedupe_key_shape` CHECK in the migration. */
export const DEDUPE_KEY_SHAPE = /^tc1:[0-9a-f]{14}$/;

/** Words that name a slot in a series rather than a work. A title made only of these and numbers is generic. */
const SLOT_WORDS = new Set(
  'episode ep chapter ch part pt track section volume vol no number issue show untitled unknown trailer intro introduction preface prologue epilogue'.split(' '),
);
const NUMBER = /^(?:\p{N}+|(?=[ivxlc])c{0,3}(?:xc|xl|l?x{0,3})(?:ix|iv|v?i{0,3}))$/u;

function isGeneric(tidiedTitle: string): boolean {
  return tidiedTitle.split(' ').every((word) => SLOT_WORDS.has(word) || NUMBER.test(word));
}

const MIN_TITLE_LENGTH = 4;

/** Accents off, lower case, anything but letters and digits to one space. */
export function tidy(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function tidyCreator(creator: string): string {
  return creator
    .split(/;|,|\/|&|\band\b/i)
    .map(tidy)
    .filter(Boolean)
    .sort()
    .join('|');
}

/** cyrb53: a small, stable 53-bit string hash. Not for secrecy; it only keeps the key short and safe. */
function hash53(text: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, '0');
}

/** Step 1: the fingerprint, or null when the item has too little to go on. */
export function dedupeKey(item: Pick<WebItem, 'title' | 'creator'>): string | null {
  const title = tidy(item.title ?? '');
  const creator = item.creator ? tidyCreator(item.creator) : '';
  if (title.length < MIN_TITLE_LENGTH || creator === '' || isGeneric(title)) return null;
  return `${KEY_VERSION}:${hash53(`${title}\u0000${creator}`)}`;
}

/**
 * More copies than this of one "work" is more likely a fingerprint that is too loose (a series reusing a
 * title) than one work: such a group is shown ungrouped. It also bounds the sibling read (Supabase: at most
 * `MAX_GROUP_SIZE + 1` rows per fingerprint are enough to decide).
 */
export const MAX_GROUP_SIZE = 10;

function durationsAgree(a: number, b: number): boolean {
  return Math.abs(a - b) <= Math.max(10, 0.03 * Math.max(a, b));
}

/** Steps 2 and 3: may these copies (one fingerprint) be shown as one row? */
export function groupHolds(members: readonly WebItem[]): boolean {
  if (members.length < 2 || members.length > MAX_GROUP_SIZE) return false;
  for (let i = 0; i < members.length; i += 1) {
    for (let j = i + 1; j < members.length; j += 1) {
      const a = members[i];
      const b = members[j];
      const da = a.durationSeconds;
      const db = b.durationSeconds;
      if (a.platform === b.platform && (da === undefined || db === undefined)) return false;
      if (da !== undefined && db !== undefined && !durationsAgree(da, db)) return false;
    }
  }
  return true;
}

/** A row of the stream: an item, plus the other copies of the same work on other rows' sources. */
export type WebStreamItem = WebItem & { alsoOn: WebItem[] };

/**
 * Step 4, for one page. `siblings` are every readable copy sharing a fingerprint with a page item;
 * `rivals` are the copies allowed to lead a row (under a search, the ones that match it; otherwise the
 * same as `siblings`). A page item that a rival leads is left off this page: it is on the rival's row.
 * Pure, so the mock and the Supabase repository give the same rows.
 *
 * Groups are built from `siblings` alone, and a page item the sibling read did not return is shown on its
 * own. That is what keeps every copy on a row: a copy is only left off when the same read that would list
 * it on the leader's row found it (a row whose stored `dedupe_key` is still empty is found by nobody, so it
 * keeps its own row instead of riding on a row that cannot see it).
 */
export function collapsePage(
  page: readonly WebItem[],
  siblings: readonly WebItem[],
  rivals: readonly WebItem[] = siblings,
): WebStreamItem[] {
  const byKey = new Map<string, Map<string, WebItem>>();
  for (const item of siblings) {
    const key = dedupeKey(item);
    if (!key) continue;
    const group = byKey.get(key) ?? new Map<string, WebItem>();
    group.set(item.id, item);
    byKey.set(key, group);
  }

  const rivalIds = new Set([...rivals.map((item) => item.id), ...page.map((item) => item.id)]);
  const rows: WebStreamItem[] = [];
  for (const item of page) {
    const key = dedupeKey(item);
    const group = key ? byKey.get(key) : undefined;
    const members = group?.has(item.id) ? [...group.values()].sort(compareItems) : [];
    if (!groupHolds(members)) {
      rows.push({ ...item, alsoOn: [] });
      continue;
    }
    const leader = members.find((member) => rivalIds.has(member.id));
    if (leader && leader.id !== item.id) continue;
    rows.push({ ...item, alsoOn: members.filter((member) => member.id !== item.id) });
  }
  return rows;
}

export type WebStreamPage = { items: WebStreamItem[]; nextCursor: string | null };

/** The copies sharing a fingerprint with a page, and which of them may lead (see `collapsePage`). */
export type WebGroupRead = { siblings: WebItem[]; rivals: WebItem[] };

/** How many raw pages one call may read when every item on a page rides on an earlier row. */
const MAX_READS_PER_PAGE = 4;

/**
 * One page of rows, for either repository: reads a raw keyset page, its siblings, and collapses them. A
 * page whose items all ride on earlier rows reads on (a few times at most), so LOAD MORE never adds
 * nothing while more remains. A failed sibling read shows the page ungrouped rather than not at all.
 */
export async function readStreamPage(
  readRaw: (cursor: string | null) => Promise<{ items: WebItem[]; nextCursor: string | null }>,
  readGroup: (keys: string[]) => Promise<WebGroupRead>,
  cursor: string | null,
): Promise<WebStreamPage> {
  let at = cursor;
  for (let read = 1; ; read += 1) {
    const raw = await readRaw(at);
    const keys = [...new Set(raw.items.map((item) => dedupeKey(item)).filter((key): key is string => key !== null))];
    let rows: WebStreamItem[];
    if (keys.length === 0) {
      rows = raw.items.map((item) => ({ ...item, alsoOn: [] }));
    } else {
      try {
        const group = await readGroup(keys);
        rows = collapsePage(raw.items, group.siblings, group.rivals);
      } catch {
        rows = raw.items.map((item) => ({ ...item, alsoOn: [] }));
      }
    }
    if (rows.length > 0 || raw.nextCursor === null || read >= MAX_READS_PER_PAGE) {
      return { items: rows, nextCursor: raw.nextCursor };
    }
    at = raw.nextCursor;
  }
}
