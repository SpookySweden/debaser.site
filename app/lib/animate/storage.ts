/**
 * Where a project lives in the browser (SPEC-animator.md: local only, nothing leaves): project data in IndexedDB, pictures in the Origin
 * Private File System. If private file storage isn't available, pictures go in IndexedDB too, which is slower but still keeps the work.
 */
import type { Drawing, Project } from './types';
import { startWorker } from './workers';

const DB_NAME = 'debaser-animate';
const DB_VERSION = 1;
const ROOT = 'animate';

export type ProjectListing = { id: string; name: string; savedAt: number };

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise !== null) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      db.createObjectStore('projects', { keyPath: 'id' });
      db.createObjectStore('drawings');
      db.createObjectStore('blobs');
      db.createObjectStore('meta');
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      dbPromise = null;
      reject(request.error);
    };
  });
  return dbPromise;
}

function done<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function finished(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export async function getMeta<T>(key: string): Promise<T | null> {
  const db = await openDb();
  const value = await done(db.transaction('meta').objectStore('meta').get(key));
  return (value as T | undefined) ?? null;
}

export async function setMeta(key: string, value: unknown): Promise<void> {
  const db = await openDb();
  const tx = db.transaction('meta', 'readwrite');
  tx.objectStore('meta').put(value, key);
  await finished(tx);
}

/** The project without its drawings, which are stored one by one so an autosave writes only what changed. */
export async function saveProjectData(project: Project, changed: Drawing[], savedAt: number): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(['projects', 'drawings'], 'readwrite');
  const head: Omit<Project, 'drawings'> & { drawings?: unknown; savedAt: number; drawingIds: string[] } = {
    ...project,
    drawings: undefined,
    savedAt,
    drawingIds: Object.keys(project.drawings),
  };
  tx.objectStore('projects').put(head);
  const store = tx.objectStore('drawings');
  for (const drawing of changed) store.put(drawing, `${project.id}/${drawing.id}`);
  await finished(tx);
}

export async function loadProjectData(id: string): Promise<Project | null> {
  const db = await openDb();
  const tx = db.transaction(['projects', 'drawings']);
  const head = (await done(tx.objectStore('projects').get(id))) as (Project & { drawingIds?: string[] }) | undefined;
  if (head === undefined) return null;
  const drawings: Record<string, Drawing> = {};
  const store = tx.objectStore('drawings');
  const ids = head.drawingIds ?? [];
  const rows = await Promise.all(ids.map((drawingId) => done(store.get(`${id}/${drawingId}`))));
  rows.forEach((row, i) => {
    if (row !== undefined) drawings[ids[i]] = row as Drawing;
  });
  return { ...head, drawings };
}

export async function listProjects(): Promise<ProjectListing[]> {
  const db = await openDb();
  const rows = (await done(db.transaction('projects').objectStore('projects').getAll())) as (Project & { savedAt?: number })[];
  return rows.map((row) => ({ id: row.id, name: row.name, savedAt: row.savedAt ?? 0 })).sort((a, b) => b.savedAt - a.savedAt);
}

export async function deleteProjectData(id: string): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(['projects', 'drawings', 'blobs'], 'readwrite');
  tx.objectStore('projects').delete(id);
  const range = IDBKeyRange.bound(`${id}/`, `${id}/￿`);
  tx.objectStore('drawings').delete(range);
  tx.objectStore('blobs').delete(range);
  await finished(tx);
  try {
    const root = await navigator.storage.getDirectory();
    const animate = await root.getDirectoryHandle(ROOT);
    await animate.removeEntry(id, { recursive: true });
  } catch {
    // Nothing stored there.
  }
}

// ── pictures and other files ─────────────────────────────────────────────────────────────

/** `file` is a project-relative name, such as `d_3.line.png` or `assets/a_4`. */
function opfsPath(projectId: string, file: string): string[] {
  return [ROOT, projectId, ...file.split('/')];
}

let saveWorker: Worker | null = null;
const pending = new Map<number, (ok: boolean) => void>();
let nextJob = 1;

function worker(): Worker | null {
  if (saveWorker !== null) return saveWorker;
  saveWorker = startWorker('save');
  if (saveWorker !== null) {
    saveWorker.onmessage = (event: MessageEvent<{ id: number; ok: boolean }>) => {
      pending.get(event.data.id)?.(event.data.ok);
      pending.delete(event.data.id);
    };
    // A worker that dies answers nothing: everything waiting on it falls back to IndexedDB, and the next write starts a new one.
    saveWorker.onerror = () => {
      for (const resolve of pending.values()) resolve(false);
      pending.clear();
      saveWorker?.terminate();
      saveWorker = null;
    };
  }
  return saveWorker;
}

/** A plane's picture to storage. The worker encodes it; if that fails, the page does, into IndexedDB. */
export async function writePlanePicture(projectId: string, file: string, canvas: OffscreenCanvas): Promise<boolean> {
  const bitmap = await createImageBitmap(canvas);
  const w = worker();
  if (w !== null) {
    const id = nextJob;
    nextJob += 1;
    const wrote = await new Promise<boolean>((resolve) => {
      pending.set(id, resolve);
      w.postMessage({ id, path: opfsPath(projectId, file), bitmap }, [bitmap]);
      // No answer in a minute: treated as failed, so a stuck worker can't stop every save after it.
      setTimeout(() => {
        if (pending.delete(id)) resolve(false);
      }, 60_000);
    });
    if (wrote) return true;
  } else {
    bitmap.close();
  }
  try {
    await writeBlobToDb(projectId, file, await canvas.convertToBlob({ type: 'image/png' }));
    return true;
  } catch {
    return false;
  }
}

async function writeBlobToDb(projectId: string, file: string, blob: Blob): Promise<void> {
  const db = await openDb();
  const tx = db.transaction('blobs', 'readwrite');
  tx.objectStore('blobs').put(blob, `${projectId}/${file}`);
  await finished(tx);
}

/** Any file to storage, from the page: a project file being opened, an imported picture, a sound. */
export async function writeFile(projectId: string, file: string, blob: Blob): Promise<void> {
  try {
    let dir = await navigator.storage.getDirectory();
    const path = opfsPath(projectId, file);
    for (const part of path.slice(0, -1)) dir = await dir.getDirectoryHandle(part, { create: true });
    const handle = await dir.getFileHandle(path[path.length - 1], { create: true });
    const writable = await handle.createWritable();
    await writable.write(blob);
    await writable.close();
  } catch {
    await writeBlobToDb(projectId, file, blob);
  }
}

export async function readFile(projectId: string, file: string): Promise<Blob | null> {
  try {
    let dir = await navigator.storage.getDirectory();
    const path = opfsPath(projectId, file);
    for (const part of path.slice(0, -1)) dir = await dir.getDirectoryHandle(part);
    const handle = await dir.getFileHandle(path[path.length - 1]);
    return await handle.getFile();
  } catch {
    // Not there: it may have gone to IndexedDB instead.
  }
  try {
    const db = await openDb();
    const blob = await done(db.transaction('blobs').objectStore('blobs').get(`${projectId}/${file}`));
    return (blob as Blob | undefined) ?? null;
  } catch {
    return null;
  }
}

/** Ask the browser not to clear this site's storage under pressure. It may say no; the work still saves. */
export async function askToKeepStorage(): Promise<void> {
  try {
    await navigator.storage?.persist?.();
  } catch {
    // Nothing to do.
  }
}
