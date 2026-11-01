import type { WebItem } from './types';

/**
 * Keyset paging for the stream: newest first by `publishedAt`, ties broken by `id` (descending).
 *
 * A cursor is the last item's `(publishedAt, id)`, base64url-encoded so callers treat it as opaque. Keyset
 * rather than offset, so an item arriving at the top while someone reads does not shift the next page
 * under them, and so Phase 2's `web_items` query is an index range instead of a growing OFFSET.
 */

export const DEFAULT_PAGE_SIZE = 10;
export const MAX_PAGE_SIZE = 50;

export type WebCursor = { publishedAt: string; id: string };

/** An item id: `platform:identifier`, the identifier by the `isSafeIdentifier` rule. */
const CURSOR_ID = /^[a-z][a-z0-9_]{0,40}:[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/;

export type WebPage = { items: WebItem[]; nextCursor: string | null };

function toBase64Url(text: string): string {
  return btoa(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(text: string): string {
  const padded = text.replace(/-/g, '+').replace(/_/g, '/');
  return atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
}

export function encodeCursor(cursor: WebCursor): string {
  // Both parts are ASCII (ISO dates, validated ids), which is all btoa takes.
  return toBase64Url(`${cursor.publishedAt}|${cursor.id}`);
}

/** The cursor, or null when it is not one this module made. */
export function decodeCursor(value: unknown): WebCursor | null {
  if (typeof value !== 'string' || value.length === 0 || value.length > 400) return null;
  let text: string;
  try {
    text = fromBase64Url(value);
  } catch {
    return null;
  }
  const bar = text.indexOf('|');
  if (bar <= 0) return null;
  const publishedAt = text.slice(0, bar);
  const id = text.slice(bar + 1);
  // Exactly what this module writes: a canonical ISO date and a `platform:identifier` id. Anything else
  // is refused rather than passed on, so a cursor can never carry text into a database filter.
  if (!CURSOR_ID.test(id)) return null;
  const time = Date.parse(publishedAt);
  if (!Number.isFinite(time) || new Date(time).toISOString() !== publishedAt) return null;
  return { publishedAt, id };
}

/** Newest first, then id descending. */
export function compareItems(a: WebItem, b: WebItem): number {
  if (a.publishedAt !== b.publishedAt) return a.publishedAt < b.publishedAt ? 1 : -1;
  if (a.id === b.id) return 0;
  return a.id < b.id ? 1 : -1;
}

/** True when `item` comes after the cursor in stream order. */
function isAfter(item: WebItem, cursor: WebCursor): boolean {
  return item.publishedAt < cursor.publishedAt || (item.publishedAt === cursor.publishedAt && item.id < cursor.id);
}

export function clampLimit(limit: unknown): number {
  const n = typeof limit === 'number' && Number.isFinite(limit) ? Math.floor(limit) : DEFAULT_PAGE_SIZE;
  return Math.min(Math.max(n, 1), MAX_PAGE_SIZE);
}

/**
 * One page from the database's two keyset reads (the Supabase repository): `sameMoment` is the rows at the
 * cursor's `publishedAt` with a smaller id, `older` the rows before it, each already in stream order and
 * each asked for `size + 1` rows. Every `sameMoment` row comes before every `older` row, so the page is
 * the two joined; the extra row only says whether there is a next page.
 */
export function assemblePage(sameMoment: readonly WebItem[], older: readonly WebItem[], limit: unknown): WebPage {
  const size = clampLimit(limit);
  const rest = [...sameMoment, ...older];
  const items = rest.slice(0, size);
  const last = items[items.length - 1];
  const nextCursor = rest.length > size && last ? encodeCursor({ publishedAt: last.publishedAt, id: last.id }) : null;
  return { items, nextCursor };
}

/** One page of an in-memory list (the mock repository). An unreadable cursor yields an empty page. */
export function pageOf(all: readonly WebItem[], cursor: string | null | undefined, limit: unknown): WebPage {
  const size = clampLimit(limit);
  let rest = [...all].sort(compareItems);
  if (cursor != null) {
    const at = decodeCursor(cursor);
    if (!at) return { items: [], nextCursor: null };
    rest = rest.filter((item) => isAfter(item, at));
  }
  const items = rest.slice(0, size);
  const last = items[items.length - 1];
  const nextCursor = rest.length > size && last ? encodeCursor({ publishedAt: last.publishedAt, id: last.id }) : null;
  return { items, nextCursor };
}
