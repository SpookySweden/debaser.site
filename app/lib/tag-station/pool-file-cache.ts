import type { PoolFileRow } from '../web/pool-files';

/**
 * A pool file never changes once written, so it's kept in the server's memory while there's room: about 80,000 rows at most. SERVER ONLY. The route has
 * checked the reader's session before anything here is asked for.
 */
const FILES_HELD = 40;
const heldFiles = new Map<string, Promise<PoolFileRow[]>>();

/** Which files hold what was asked: the rarest part first, then the rest. And how many items each asked word is on. */
export type HeldOrder = { order: readonly (readonly string[])[]; counted: readonly { word: string; items: number }[] };

const ORDERS_HELD = 60;
const ORDER_MS = 10 * 60_000;
const heldOrders = new Map<string, { at: number; order: Promise<HeldOrder> }>();

/** The list of files for one ask, kept a few minutes, since each press of [ MORE ] needs it and the database reads it for a tenth of a second or more. */
export function heldOrder(key: string, read: () => Promise<HeldOrder>, now = Date.now()): Promise<HeldOrder> {
  const known = heldOrders.get(key);
  if (known && now - known.at < ORDER_MS) return known.order;
  const order = read().catch((problem) => {
    heldOrders.delete(key);
    throw problem;
  });
  heldOrders.delete(key);
  heldOrders.set(key, { at: now, order });
  for (const oldest of heldOrders.keys()) {
    if (heldOrders.size <= ORDERS_HELD) break;
    heldOrders.delete(oldest);
  }
  return order;
}

/** Each part in an order only this seed gives, so a reader's list is steady for a visit and differs next time, with no file read twice. Pure. */
export function seededOrder(order: readonly (readonly string[])[], seed: string): string[] {
  const place = (path: string) => {
    let hash = 2166136261;
    for (const letter of `${seed}|${path}`) hash = Math.imul(hash ^ letter.charCodeAt(0), 16777619) >>> 0;
    return hash;
  };
  return order.flatMap((part) => [...part].sort((a, b) => place(a) - place(b) || (a < b ? -1 : 1)));
}

export function heldFile(path: string, read: () => Promise<PoolFileRow[]>): Promise<PoolFileRow[]> {
  const known = heldFiles.get(path);
  if (known) return known;
  const load = read().catch((problem) => {
    heldFiles.delete(path);
    throw problem;
  });
  heldFiles.set(path, load);
  for (const oldest of heldFiles.keys()) {
    if (heldFiles.size <= FILES_HELD) break;
    heldFiles.delete(oldest);
  }
  return load;
}
