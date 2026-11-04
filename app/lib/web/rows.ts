import { dedupeKey } from './dedupe';
import { normaliseLanguage } from './language';
import type { WebItem, WebItemKind, WebPlatform, WebSource } from './types';

/**
 * The `web_items` / `web_sources` rows (supabase/migrations/*_web_items.sql) and their mapping to the WEB
 * types. Client-safe: the repository reads with it in the browser, the ingest route writes with it.
 *
 * The column lists are the whole of what is ever selected: metadata only, no engagement field
 * (`scripts/check-web-db.cjs` holds that line).
 */

export const WEB_ITEMS_TABLE = 'web_items';
export const WEB_SOURCES_TABLE = 'web_sources';

/** Claude's words for an item (`web_item_tags`): only ever orders a list. */
export const WEB_ITEM_TAG_COLUMNS = 'item_id, words';

export const WEB_ITEM_COLUMNS =
  'id, platform, external_id, kind, url, canonical_url, title, creator, description, thumbnail_url, embed_url, license_url, duration_seconds, tags, published_at, fetched_at, language';

export const WEB_SOURCE_COLUMNS = 'id, platform, ref, label, enabled, last_checked_at, last_error';

export type WebItemRow = {
  id: string;
  platform: string;
  external_id: string;
  kind: string;
  url: string;
  canonical_url: string;
  title: string;
  creator: string | null;
  description: string | null;
  thumbnail_url: string | null;
  embed_url: string | null;
  license_url: string | null;
  duration_seconds: number | null;
  tags: string[] | null;
  published_at: string;
  fetched_at: string;
  /** The platform's language for the item (`normaliseLanguage`), when it said one (20261103094322). */
  language: string | null;
  /**
   * Written by the ingest (`dedupeKey`, dedupe.ts) and never selected: the page recomputes it from the
   * title and creator. Only the database's sibling lookup filters on it.
   */
  dedupe_key?: string | null;
};

export type WebSourceRow = {
  id: string;
  platform: string;
  ref: string;
  label: string;
  enabled: boolean;
  last_checked_at: string | null;
  last_error: string | null;
};

const KINDS: readonly WebItemKind[] = ['audio', 'video', 'image', 'text', 'other'];

/** Postgres answers `2026-10-31T12:00:00+00:00`; the cursor and the page compare canonical ISO strings. */
export function canonicalIso(value: string): string {
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toISOString() : value;
}

export function rowToItem(row: WebItemRow): WebItem {
  const language = normaliseLanguage(row.language);
  return {
    id: row.id,
    platform: row.platform as WebPlatform,
    externalId: row.external_id,
    kind: KINDS.includes(row.kind as WebItemKind) ? (row.kind as WebItemKind) : 'other',
    url: row.url,
    canonicalUrl: row.canonical_url,
    title: row.title,
    creator: row.creator ?? undefined,
    description: row.description ?? undefined,
    thumbnailUrl: row.thumbnail_url ?? undefined,
    embedUrl: row.embed_url ?? undefined,
    licenseUrl: row.license_url ?? undefined,
    durationSeconds: row.duration_seconds ?? undefined,
    tags: row.tags ?? undefined,
    publishedAt: canonicalIso(row.published_at),
    fetchedAt: canonicalIso(row.fetched_at),
    ...(language ? { language } : {}),
  };
}

/** For the ingest's upsert. `enabled` is left out on purpose, so a re-read never undoes a takedown. */
export function itemToRow(item: WebItem): WebItemRow {
  return {
    id: item.id,
    platform: item.platform,
    external_id: item.externalId,
    kind: item.kind,
    url: item.url,
    canonical_url: item.canonicalUrl,
    title: item.title,
    creator: item.creator ?? null,
    description: item.description ?? null,
    thumbnail_url: item.thumbnailUrl ?? null,
    embed_url: item.embedUrl ?? null,
    license_url: item.licenseUrl ?? null,
    duration_seconds: item.durationSeconds ?? null,
    tags: item.tags ?? null,
    published_at: item.publishedAt,
    fetched_at: item.fetchedAt,
    language: normaliseLanguage(item.language),
    dedupe_key: dedupeKey(item),
  };
}

export function rowToSource(row: WebSourceRow): WebSource {
  return {
    id: row.id,
    platform: row.platform as WebPlatform,
    ref: row.ref,
    label: row.label,
    enabled: row.enabled,
    lastCheckedAt: row.last_checked_at ? canonicalIso(row.last_checked_at) : undefined,
    lastError: row.last_error ?? undefined,
  };
}
