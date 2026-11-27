import { EMPTY_BOOK, guessDeviceName, readBook, type DeviceBook } from './own-device-modes';

/**
 * This tab's device: its id, and its book of your other devices (own-device-modes.ts), kept in this browser's storage until you
 * change it. One per tab, shared by the room and the music bar.
 */

const IDS_KEY = 'debaser-own-device-ids';
const TAB_KEY = 'debaser-own-device-id';
const bookKey = (accountId: string, deviceId: string) => `debaser-own-device-book:${accountId}:${deviceId}`;
/** A reload lets go of its id as the page goes; the next page waits this long for it before taking another. */
const RELOAD_WAIT_MS = 1500;

let claimed: Promise<string> | null = null;

const newId = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`).slice(0, 12);

function readIds(): string[] {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(IDS_KEY) ?? '[]') as unknown;
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

/** Holds a lock named after the id for as long as this page lives; true when it got it. */
function hold(id: string, wait: boolean): Promise<boolean> {
  return new Promise((resolve) => {
    const options: LockOptions = wait ? { signal: AbortSignal.timeout(RELOAD_WAIT_MS) } : { ifAvailable: true };
    navigator.locks
      .request(`debaser-own-device:${id}`, options, (lock) => {
        if (lock === null) {
          resolve(false);
          return undefined;
        }
        resolve(true);
        // Never settles: the lock is this page's until it goes.
        return new Promise<void>(() => undefined);
      })
      .catch(() => resolve(false));
  });
}

async function claim(): Promise<string> {
  let mine: string | null = null;
  try {
    mine = window.sessionStorage.getItem(TAB_KEY);
  } catch {
    mine = null;
  }
  if (typeof navigator === 'undefined' || !('locks' in navigator)) {
    const id = mine ?? newId();
    try {
      window.sessionStorage.setItem(TAB_KEY, id);
    } catch {
      /* kept for this page only */
    }
    return id;
  }
  const ids = readIds();
  let id: string | null = null;
  // This tab's own id first (a reload), waiting a moment for the page before it to let go of it.
  if (mine !== null && (await hold(mine, true))) id = mine;
  for (const known of ids) {
    if (id !== null) break;
    if (known !== mine && (await hold(known, false))) id = known;
  }
  if (id === null) {
    id = newId();
    await hold(id, false);
  }
  try {
    window.sessionStorage.setItem(TAB_KEY, id);
    // Read again just before writing: another tab of this browser may have added its own id while this one waited for a lock.
    const now = readIds();
    if (!now.includes(id)) window.localStorage.setItem(IDS_KEY, JSON.stringify([...now, id].slice(-12)));
  } catch {
    /* kept for this page only */
  }
  return id;
}

/** This tab's device id: the same one through a reload, and a tab opened again takes one this browser had before. */
export function thisDevice(): Promise<string> {
  claimed ??= claim();
  return claimed;
}

const books = new Map<string, DeviceBook>();
const listeners = new Set<() => void>();

/** This device's book for an account (the empty one until the device is known). */
export function deviceBook(accountId: string, deviceId: string): DeviceBook {
  const key = bookKey(accountId, deviceId);
  let book = books.get(key);
  if (book === undefined) {
    try {
      book = readBook(window.localStorage.getItem(key));
    } catch {
      book = EMPTY_BOOK;
    }
    books.set(key, book);
  }
  return book;
}

/** Changes and keeps this device's book, and tells everything here that reads it. */
export function changeDeviceBook(accountId: string, deviceId: string, change: (book: DeviceBook) => DeviceBook): DeviceBook {
  const before = deviceBook(accountId, deviceId);
  const after = change(before);
  if (after === before) return before;
  const key = bookKey(accountId, deviceId);
  books.set(key, after);
  try {
    window.localStorage.setItem(key, JSON.stringify(after));
  } catch {
    /* kept for this page only */
  }
  for (const listener of listeners) listener();
  return after;
}

export function subscribeDeviceBook(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** What this device calls itself: the name it was given, else a guess from the browser. */
export function deviceName(book: DeviceBook): string {
  return book.name ?? (typeof navigator === 'undefined' ? 'DEVICE' : guessDeviceName(navigator.userAgent));
}
