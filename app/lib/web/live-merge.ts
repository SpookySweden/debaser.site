import type { WebStreamItem } from './dedupe';
import { compareItems } from './paging';

/**
 * How results from several sources join one list while they arrive (SPEC-web-search.md, one live search).
 * Pure and client-safe, so `scripts/check-web-live-merge.cjs` holds every rule here.
 *
 * - Each item shows once: a result is dropped when its id (`platform:externalId`) is already listed, or is an
 *   ALSO ON copy of a listed stream row. Whichever source answers first keeps the row.
 * - Until the reader scrolls or presses anything, arrivals slot into the list newest first.
 * - After that (`frozen`), nothing moves under them: arrivals wait in `held`, behind a "N MORE RESULTS" key at
 *   the top; pressing it puts them at the top of the list, newest first.
 * - LOAD MORE is the reader asking for more, so its arrivals go at the end of the list, newest first among
 *   themselves, never above what is already there.
 */
export type LiveList = {
  shown: WebStreamItem[];
  held: WebStreamItem[];
  frozen: boolean;
  /** Every id listed or held, ALSO ON copies included. */
  seen: ReadonlySet<string>;
};

export const EMPTY_LIVE: LiveList = { shown: [], held: [], frozen: false, seen: new Set() };

function idsOf(item: WebStreamItem): string[] {
  return [item.id, ...item.alsoOn.map((copy) => copy.id)];
}

/** Adds what arrived. `end`: LOAD MORE's answers, appended below everything already shown. */
export function arrive(list: LiveList, items: readonly WebStreamItem[], end = false): LiveList {
  const seen = new Set(list.seen);
  const fresh: WebStreamItem[] = [];
  for (const item of items) {
    if (idsOf(item).some((id) => seen.has(id))) continue;
    for (const id of idsOf(item)) seen.add(id);
    fresh.push(item);
  }
  if (fresh.length === 0) return list;
  fresh.sort(compareItems);
  if (end) return { ...list, shown: [...list.shown, ...fresh], seen };
  if (list.frozen) return { ...list, held: [...list.held, ...fresh], seen };
  return { ...list, shown: [...list.shown, ...fresh].sort(compareItems), seen };
}

/** The reader scrolled or pressed something: from now on nothing slots in above them. */
export function freeze(list: LiveList): LiveList {
  return list.frozen ? list : { ...list, frozen: true };
}

/** "N MORE RESULTS" pressed: the held results go at the top, newest first. Still frozen. */
export function release(list: LiveList): LiveList {
  if (list.held.length === 0) return list;
  return { ...list, shown: [...[...list.held].sort(compareItems), ...list.shown], held: [] };
}
