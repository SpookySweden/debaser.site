/**
 * Where kept pages are kept. `local` is this browser's own storage, for the account signed in here and nobody else, until Phase 5's tables
 * exist and Luke says so; then `NEXT_PUBLIC_SEEING_DATA_SOURCE=supabase` keeps them on the site (`./supabase-pages-repository.ts`).
 */
import { copyFrom, pageFrom, type MadeCopy, type SeenPage } from './pages';

export interface PagesRepository {
  /** Whether what is kept is seen by everyone. */
  readonly shared: boolean;
  list(owner: string | null): Promise<SeenPage[]>;
  copyOf(id: string, owner: string | null): Promise<MadeCopy | null>;
  keep(page: SeenPage, copy: MadeCopy | null): Promise<void>;
  remove(page: SeenPage): Promise<void>;
}

const DB_NAME = 'debaser-seeing';
const PAGES = 'pages';
const COPIES = 'copies';

function opened(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') return reject(new Error('NOTHING CAN BE KEPT IN THIS BROWSER'));
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      for (const name of [PAGES, COPIES]) if (!request.result.objectStoreNames.contains(name)) request.result.createObjectStore(name, { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error('NOTHING CAN BE KEPT IN THIS BROWSER'));
    request.onblocked = () => reject(new Error('NOTHING CAN BE KEPT IN THIS BROWSER'));
  });
}

async function within<T>(mode: IDBTransactionMode, act: (pages: IDBObjectStore, copies: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await opened();
  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = db.transaction([PAGES, COPIES], mode);
      const request = act(transaction.objectStore(PAGES), transaction.objectStore(COPIES));
      transaction.oncomplete = () => resolve(request.result);
      transaction.onerror = transaction.onabort = () => reject(new Error('NOT KEPT: NO ROOM IN THIS BROWSER'));
    });
  } finally {
    db.close();
  }
}

export const localPages: PagesRepository = {
  shared: false,
  async list(owner) {
    if (owner === null) return [];
    const rows = await within('readonly', (pages) => pages.getAll() as IDBRequest<unknown[]>);
    return rows.map(pageFrom).filter((page): page is SeenPage => page !== null && page.ownerId === owner).sort((a, b) => b.at - a.at);
  },
  async copyOf(id, owner) {
    const row = pageFrom(await within('readonly', (pages) => pages.get(id) as IDBRequest<unknown>));
    if (row === null || row.ownerId !== owner) return null;
    return copyFrom(await within('readonly', (_, copies) => copies.get(id) as IDBRequest<unknown>));
  },
  async keep(page, copy) {
    await within('readwrite', (pages, copies) => {
      if (copy !== null) copies.put({ id: page.id, ...copy });
      return pages.put(page);
    });
  },
  async remove(page) {
    await within('readwrite', (pages, copies) => {
      copies.delete(page.id);
      return pages.delete(page.id);
    });
  },
};
