import { cleanWork, type WorkMatch } from './copies';
import { ownHash } from './types';

/**
 * YOUR FILES (the READ module, Luke 2026-11-13): a reader's own PDFs and EPUBs kept in this browser's own storage
 * (IndexedDB), so a file opened once stays on the shelf and opens again without being chosen. Nothing here is ever sent:
 * not to the site, not to anyone. It lives only in this browser, and [ FORGET ] takes it out. The account holds only what
 * it always did (the file's fingerprint, its matched book, your place and highlights), so another device asks for the file
 * once and finds everything else there.
 *
 * Browsers cap what a site may keep; a file that doesn't fit isn't kept, and the card says so. Private windows and blocked
 * storage keep nothing, and the reader works the same without it.
 */

const DB_NAME = 'debaser-own-books';
const STORE = 'files';

/** A kept file: its ref (`own:<fingerprint>`), its own name (shown only in this browser), size, when kept, and its book. */
export type KeptFile = { ref: string; name: string; size: number; keptAt: string; match: WorkMatch | null; file: Blob };
export type KeptRow = Omit<KeptFile, 'file'>;

function opened(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') return reject(new Error('no storage'));
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE, { keyPath: 'ref' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('no storage'));
    request.onblocked = () => reject(new Error('storage busy'));
  });
}

async function withStore<T>(mode: IDBTransactionMode, act: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await opened();
  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = db.transaction(STORE, mode);
      const request = act(transaction.objectStore(STORE));
      let result: T;
      request.onsuccess = () => {
        result = request.result;
      };
      transaction.oncomplete = () => resolve(result);
      transaction.onerror = () => reject(transaction.error ?? request.error ?? new Error('not kept'));
      transaction.onabort = () => reject(transaction.error ?? new Error('not kept'));
    });
  } finally {
    db.close();
  }
}

/** A stored record read back through one door: anything odd is nothing. */
function keptFrom(value: unknown): KeptFile | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  if (typeof record.ref !== 'string' || !ownHash(record.ref) || !(record.file instanceof Blob)) return null;
  const match = record.match as Partial<WorkMatch> | null | undefined;
  const work = cleanWork(match?.work);
  return {
    ref: record.ref,
    name: typeof record.name === 'string' ? record.name.slice(0, 300) : '',
    size: typeof record.size === 'number' ? record.size : record.file.size,
    keptAt: typeof record.keptAt === 'string' ? record.keptAt : '',
    match:
      work && match
        ? { work, title: String(match.title ?? '').slice(0, 300), author: String(match.author ?? '').slice(0, 200), cover: typeof match.cover === 'number' ? match.cover : null, editions: typeof match.editions === 'number' ? match.editions : null }
        : null,
    file: record.file,
  };
}

/** Keeps a file in this browser. False when it couldn't be (no room, a private window, storage blocked). */
export async function keepFile(ref: string, file: File, match: WorkMatch | null): Promise<boolean> {
  if (!ownHash(ref)) return false;
  try {
    const record: KeptFile = { ref, name: file.name, size: file.size, keptAt: new Date().toISOString(), match, file };
    await withStore('readwrite', (store) => store.put(record));
    return true;
  } catch {
    return false;
  }
}

/** A kept file's book, changed ([ CHANGE ] or [ NOT LISTED ]); nothing when the file isn't kept here. */
export async function rematchKept(ref: string, match: WorkMatch | null): Promise<void> {
  const held = await keptFileOf(ref);
  if (!held) return;
  await withStore('readwrite', (store) => store.put({ ...held, match })).catch(() => undefined);
}

/** The kept file for a ref, or null. */
export async function keptFileOf(ref: string): Promise<KeptFile | null> {
  if (!ownHash(ref)) return null;
  try {
    return keptFrom(await withStore('readonly', (store) => store.get(ref)));
  } catch {
    return null;
  }
}

/** Every kept file, newest first, without their bytes (rows for YOUR FILES). */
export async function keptFiles(): Promise<KeptRow[]> {
  try {
    const all = (await withStore('readonly', (store) => store.getAll())) as unknown[];
    return all
      .map(keptFrom)
      .filter((each): each is KeptFile => each !== null)
      .map((each): KeptRow => ({ ref: each.ref, name: each.name, size: each.size, keptAt: each.keptAt, match: each.match }))
      .sort((a, b) => b.keptAt.localeCompare(a.keptAt));
  } catch {
    return [];
  }
}

/** [ FORGET ]: this browser's copy goes. Your place and highlights stay with the account. */
export async function forgetFile(ref: string): Promise<boolean> {
  try {
    await withStore('readwrite', (store) => store.delete(ref));
    return true;
  } catch {
    return false;
  }
}

/** Kept files open as `File`s again, with their own name (IndexedDB may hand a File back as a plain Blob). */
export function asFile(kept: KeptFile): File {
  if (kept.file instanceof File) return kept.file;
  const type = kept.file.type || (/\.epub$/i.test(kept.name) ? 'application/epub+zip' : 'application/pdf');
  return new File([kept.file], kept.name || (type === 'application/pdf' ? 'book.pdf' : 'book.epub'), { type });
}
