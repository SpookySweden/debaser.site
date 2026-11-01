/**
 * WEB's ingest: read each enabled source through its adapter and keep what it found. SERVER ONLY (it runs
 * the adapters, which fetch through `safe-fetch`); `app/api/web/ingest/route.ts` is the one caller.
 *
 * The storage is handed in (`IngestStore`), so a check can run a whole pass offline with fake sources, a
 * fake fetch and an in-memory table. The rules:
 * - at most `MAX_SOURCES_PER_RUN` sources a run, the longest-unchecked first, so every source gets its turn;
 * - no new source starts after `RUN_BUDGET_MS`, so a run never outlives the route (the rest go next run);
 * - sources run one after another (several share a host; no burst at anyone's API);
 * - one failing source never stops the others: its failure is recorded as `last_error` and the run goes on;
 * - every error kept or returned is a plain sentence of ours, never a stack trace or a database message;
 * - an item a feed sends twice in one batch is saved once (Postgres refuses an upsert that touches a row twice).
 *
 * Then, when saving opened items is on (SPEC-web-search.md), it resolves up to `MAX_REQUESTS_PER_RUN` pending
 * `web_requests` inside the same time budget: each item is read from its platform's own API by id (`fetchOne`),
 * saved like any other, and its request marked done, failed (the platform has nothing) or retried later.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { WebAdapter, WebAdapterDeps } from './adapters/types';
import type { SearchProvider } from './search/types';
import { itemToRow, rowToSource, type WebItemRow, type WebSourceRow } from './rows';
import { SafeFetchError } from './safe-fetch';
import { isSafeIdentifier } from './urls';
import type { WebItem, WebPlatform, WebSource } from './types';

export const MAX_SOURCES_PER_RUN = 5;
/**
 * No new source starts once a run is this old. The slowest single read is Openverse's 20s, so a run that
 * starts its last source at 30s still ends well inside the route's 60s (`maxDuration`), which would
 * otherwise cut it off mid-save.
 */
export const RUN_BUDGET_MS = 30_000;
/** Opened items saved per run, after the sources and inside the same budget. */
export const MAX_REQUESTS_PER_RUN = 5;

/** The `web_items_kind_values` CHECK in the migration; `scripts/check-web-db.cjs` keeps the three in step. */
const KINDS = ['audio', 'video', 'image', 'text', 'other'];

export type IngestStore = {
  /** Enabled sources, the longest-unchecked (never checked first), at most `limit`. */
  sourcesToCheck(limit: number): Promise<WebSource[]>;
  /** Insert or update on (platform, external_id). Throws on failure. */
  saveItems(rows: WebItemRow[]): Promise<void>;
  recordCheck(sourceId: string, checkedAt: string, error: string | null): Promise<void>;
  /** Pending requests to save an opened item, oldest first, at most `limit`. */
  requestsToResolve?(limit: number): Promise<WebRequest[]>;
  markRequest?(id: string, outcome: RequestOutcome): Promise<void>;
};

/** A request to save an item someone opened (`web_requests`): which platform, which id. */
export type WebRequest = { id: string; platform: string; externalId: string };
export type RequestOutcome = 'done' | 'failed' | 'retry';

export type IngestRequestResult = { requestId: string; outcome: RequestOutcome };

export type IngestSourceResult = { sourceId: string; label: string; saved: number; skipped: number; error: string | null };
export type IngestResult = { checked: number; results: IngestSourceResult[]; requests?: IngestRequestResult[] };

/** Saving opened items: the providers that fetch one item by id, and their server-only settings. */
export type RequestResolving = {
  providers: Partial<Record<WebPlatform, SearchProvider>>;
  env?: Readonly<Record<string, string | undefined>>;
};

const HTTPS = /^https:\/\//;
const fitsUrl = (value: string | undefined, required = false) =>
  value === undefined ? !required : HTTPS.test(value) && value.length <= 2048;

/** The `web_items` CHECK constraints, asked first, so one odd item is skipped rather than failing the batch. */
export function fitsTable(item: WebItem, platform: WebPlatform): boolean {
  return (
    item.platform === platform &&
    isSafeIdentifier(item.externalId) &&
    item.id === `${item.platform}:${item.externalId}` &&
    KINDS.includes(item.kind) &&
    fitsUrl(item.url, true) &&
    fitsUrl(item.canonicalUrl, true) &&
    fitsUrl(item.thumbnailUrl) &&
    fitsUrl(item.embedUrl) &&
    fitsUrl(item.licenseUrl) &&
    item.title.length >= 1 &&
    item.title.length <= 500 &&
    (item.creator === undefined || item.creator.length <= 300) &&
    (item.description === undefined || item.description.length <= 1000) &&
    (item.durationSeconds === undefined ||
      (Number.isInteger(item.durationSeconds) && item.durationSeconds >= 0 && item.durationSeconds <= 864000)) &&
    (item.tags === undefined || (item.tags.length <= 30 && item.tags.join(' ').length <= 1000)) &&
    Number.isFinite(Date.parse(item.publishedAt)) &&
    Number.isFinite(Date.parse(item.fetchedAt))
  );
}

/** A failure, in words fit for `last_error` and for the caller. */
function plainError(error: unknown, stage: 'read' | 'save'): string {
  if (stage === 'save') return 'The items were read but could not be saved.';
  if (error instanceof SafeFetchError) return `The source could not be read (${error.message}).`.slice(0, 300);
  return 'The source could not be read.';
}

export async function runIngest(
  store: IngestStore,
  adapters: Partial<Record<WebPlatform, WebAdapter>>,
  deps: WebAdapterDeps = {},
  resolving: RequestResolving | null = null,
): Promise<IngestResult> {
  const now = deps.now ?? (() => new Date());
  const sources = await store.sourcesToCheck(MAX_SOURCES_PER_RUN);
  const results: IngestSourceResult[] = [];
  const startedAt = now().getTime();

  for (const source of sources.slice(0, MAX_SOURCES_PER_RUN)) {
    // Past the budget, the rest wait: they stay the longest-unchecked, so the next run takes them first.
    if (now().getTime() - startedAt >= RUN_BUDGET_MS) break;
    const result: IngestSourceResult = { sourceId: source.id, label: source.label, saved: 0, skipped: 0, error: null };
    const adapter = adapters[source.platform];
    if (!adapter) {
      result.error = 'WEB has no reader for this platform.';
    } else {
      let items: WebItem[] | null = null;
      try {
        items = await adapter.fetchItems(source, deps);
      } catch (error) {
        result.error = plainError(error, 'read');
      }
      if (items) {
        // Keyed by id, the last copy winning: one row per item in the batch.
        const fit = [...new Map(items.filter((item) => fitsTable(item, source.platform)).map((item) => [item.id, item])).values()];
        result.skipped = items.length - fit.length;
        if (fit.length > 0) {
          try {
            await store.saveItems(fit.map(itemToRow));
            result.saved = fit.length;
          } catch (error) {
            result.error = plainError(error, 'save');
          }
        }
      }
    }

    try {
      await store.recordCheck(source.id, now().toISOString(), result.error);
    } catch {
      result.error ??= 'The check time could not be recorded.';
    }
    results.push(result);
  }

  const { requestsToResolve, markRequest } = store;
  if (resolving === null || !requestsToResolve || !markRequest || now().getTime() - startedAt >= RUN_BUDGET_MS) {
    return { checked: results.length, results };
  }
  const requestStore = {
    requestsToResolve: requestsToResolve.bind(store),
    markRequest: markRequest.bind(store),
    saveItems: store.saveItems.bind(store),
  };
  return { checked: results.length, results, requests: await resolveRequests(requestStore, resolving, deps, startedAt) };
}

/**
 * Saves up to `MAX_REQUESTS_PER_RUN` opened items. A request the store cannot read (the table not there yet)
 * ends this part quietly; one item failing never stops the others. Never throws.
 */
async function resolveRequests(
  store: Required<Pick<IngestStore, 'requestsToResolve' | 'markRequest' | 'saveItems'>>,
  resolving: RequestResolving, deps: WebAdapterDeps, startedAt: number): Promise<IngestRequestResult[]> {
  const now = deps.now ?? (() => new Date());
  let pending: WebRequest[];
  try {
    pending = (await store.requestsToResolve(MAX_REQUESTS_PER_RUN)).slice(0, MAX_REQUESTS_PER_RUN);
  } catch {
    return [];
  }
  const done: IngestRequestResult[] = [];
  for (const request of pending) {
    if (now().getTime() - startedAt >= RUN_BUDGET_MS) break;
    const provider = Object.hasOwn(resolving.providers, request.platform) ? resolving.providers[request.platform as WebPlatform] : undefined;
    let outcome: RequestOutcome;
    if (!provider || !isSafeIdentifier(request.externalId)) {
      outcome = 'failed';
    } else {
      try {
        const item = await provider.fetchOne(request.externalId, { fetch: deps.fetch, now, env: resolving.env });
        if (item === null || item.externalId !== request.externalId || !fitsTable(item, provider.platform)) {
          outcome = 'failed';
        } else {
          await store.saveItems([itemToRow(item)]);
          outcome = 'done';
        }
      } catch {
        // No answer from the platform, or the save failed: tried again next run (failed after five tries).
        outcome = 'retry';
      }
    }
    try {
      await store.markRequest(request.id, outcome);
    } catch {
      // Left pending; the next run reads it again.
    }
    done.push({ requestId: request.id, outcome });
  }
  return done;
}

/** The caller's lock was wrong (SQLSTATE 28000 from the database); the route answers 401. */
export class IngestLockError extends Error {}

const LOCK_REFUSED = '28000';
/** The `jsonb_array_length(p_rows) > 100` cap in web_ingest_save; `scripts/check-web-supabase.cjs` holds it. */
export const SAVE_BATCH = 100;

/**
 * The store on the real tables, through the three lock-checking database functions
 * (supabase/migrations/20261031190000_web_ingest_lock.sql). `db` is a public-key client: Row Level Security
 * still refuses it every write, and each function refuses everything unless `lock` matches the secret the
 * database keeps in Vault. The save never writes `enabled`, so a re-read cannot bring back an item that was
 * taken down. No server key exists anywhere in this path.
 */
export function makeIngestStore(db: SupabaseClient, lock: string): IngestStore {
  return {
    async sourcesToCheck(limit) {
      const { data, error } = await db.rpc('web_ingest_sources', { p_secret: lock, p_limit: limit });
      if (error) throw error.code === LOCK_REFUSED ? new IngestLockError('lock') : new Error('sources');
      return ((data ?? []) as WebSourceRow[]).map(rowToSource);
    },
    async saveItems(rows) {
      // web_ingest_save takes at most SAVE_BATCH rows a call.
      for (let at = 0; at < rows.length; at += SAVE_BATCH) {
        const { error } = await db.rpc('web_ingest_save', { p_secret: lock, p_rows: rows.slice(at, at + SAVE_BATCH) });
        if (error) throw new Error('save');
      }
    },
    async recordCheck(sourceId, checkedAt, lastError) {
      const { error } = await db.rpc('web_ingest_record', {
        p_secret: lock,
        p_source_id: sourceId,
        p_checked_at: checkedAt,
        p_error: lastError,
      });
      if (error) throw new Error('record');
    },
    async requestsToResolve(limit) {
      const { data, error } = await db.rpc('web_ingest_requests', { p_secret: lock, p_limit: limit });
      if (error) throw new Error('requests');
      return ((data ?? []) as { id: string; platform: string; external_id: string }[]).map((row) => ({
        id: row.id,
        platform: row.platform,
        externalId: row.external_id,
      }));
    },
    async markRequest(id, outcome) {
      const { error } = await db.rpc('web_ingest_request_done', { p_secret: lock, p_id: id, p_outcome: outcome });
      if (error) throw new Error('mark');
    },
  };
}
