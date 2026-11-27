'use client';

/**
 * Whether the extension is in this browser, which version, and whether this is the one the site has (SPEC-seeing-machine.md, D1). Silence is
 * "not here". Held once for the EXTENSION window, BROWSER's OWN EYE key and the keeper that updates it.
 */
import { isItsFolder, judgeVersion, listFrom, writeUpdate, type ExtensionList, type Folder } from './extension';
import type { ExtensionFrom } from './extension-ids';
import { extensionFound, extensionVersion, newestToOwnEye, ownEyeSettings, reloadOwnEye, type OwnEyeSettings } from './own-eye';

export type ExtensionState = {
  /** `unable`: a browser that can't have it. */
  kind: 'asking' | 'unable' | 'missing' | 'old' | 'current';
  version: string | null;
  newest: string | null;
  /** The folder it was loaded from: not picked, picked but the browser asks again before it is written to, or writable now. */
  folder: 'none' | 'ask' | 'granted';
  settings: OwnEyeSettings | null;
  said: string | null;
  busy: boolean;
  /** Where the copy that answered came from, and how many copies answered (a store's and the zip's both in: two). */
  from?: ExtensionFrom | null;
  copies?: number;
  /** A store's copy exactly one version behind the site's: the store is still checking the new one, and updates it by itself. */
  checking?: boolean;
  /** The folder the site has just put it into for the first time, to be loaded in the extensions page. */
  wroteInto?: string | null;
};

const FIRST: ExtensionState = { kind: 'asking', version: null, newest: null, folder: 'none', settings: null, said: null, busy: false, from: null, copies: 0, checking: false, wroteInto: null };
let state = FIRST;
const listeners = new Set<() => void>();
const set = (next: Partial<ExtensionState>): void => {
  state = { ...state, ...next };
  for (const listener of listeners) listener();
};
export const extensionState = (): ExtensionState => state;
export const extensionStateOnServer = (): ExtensionState => FIRST;
export function subscribeToExtension(listener: () => void): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

/* The picked folder, kept where the browser keeps such things. */
type Kept = Folder & { queryPermission?: (how: { mode: 'readwrite' }) => Promise<PermissionState>; requestPermission?: (how: { mode: 'readwrite' }) => Promise<PermissionState> };
const DB = 'debaser-extension';
function shelf<T>(mode: IDBTransactionMode, act: (store: IDBObjectStore) => IDBRequest<T>): Promise<T | null> {
  return new Promise((done) => {
    const request = typeof indexedDB === 'undefined' ? null : indexedDB.open(DB, 1);
    if (request === null) return done(null);
    request.onupgradeneeded = () => request.result.createObjectStore('folder');
    request.onerror = request.onblocked = () => done(null);
    request.onsuccess = () => {
      const transaction = request.result.transaction('folder', mode);
      const asked = act(transaction.objectStore('folder'));
      transaction.oncomplete = () => {
        request.result.close();
        done(asked.result ?? null);
      };
      transaction.onerror = transaction.onabort = () => {
        request.result.close();
        done(null);
      };
    };
  });
}
const keptFolder = (): Promise<Kept | null> => shelf('readonly', (store) => store.get('it') as IDBRequest<Kept>);
export const folderCanBePicked = (): boolean => typeof window !== 'undefined' && 'showDirectoryPicker' in window;

async function listNow(): Promise<ExtensionList | null> {
  try {
    const response = await fetch('/api/extension/list', { cache: 'no-store', signal: AbortSignal.timeout(3000) });
    return response.ok ? listFrom(await response.json()) : null;
  } catch {
    return null;
  }
}

async function fileNow(name: string, sha256: string): Promise<Uint8Array | null> {
  // Asked for by its fingerprint: whatever stands between keeps files by their whole address, and an old one is never handed over for a new one.
  const response = await fetch(`/api/extension/file/${encodeURIComponent(name)}?v=${sha256}`, { cache: 'no-store' });
  return response.ok ? new Uint8Array(await response.arrayBuffer()) : null;
}

/** Asked again each time it matters: it may have been put in, taken out or updated since. */
let looks = 0;
export async function lookForExtension(): Promise<ExtensionState> {
  looks += 1;
  const look = looks;
  if (typeof window === 'undefined' || !('chrome' in window)) {
    set({ kind: 'unable' });
    return state;
  }
  const [found, list, folder] = await Promise.all([extensionFound(), listNow(), keptFolder()]);
  const version = found?.version ?? null;
  const permission = folder === null ? null : await folder.queryPermission?.({ mode: 'readwrite' }).catch(() => null);
  const { kind, checking } = judgeVersion(found, list);
  const settings = kind === 'current' ? await ownEyeSettings() : null;
  // An earlier look that answers late is old news.
  if (look !== looks) return state;
  set({ kind, version, newest: list?.version ?? null, folder: folder === null ? 'none' : permission === 'granted' ? 'granted' : 'ask', settings, from: found?.from ?? null, copies: found?.copies ?? 0, checking });
  if (version !== null && list !== null) void newestToOwnEye(list.version);
  return state;
}

/** The folder, picked by the reader, once. Only one that already holds the extension is kept. */
export async function pickExtensionFolder(): Promise<void> {
  const pick = (window as typeof window & { showDirectoryPicker?: (how: { id: string; mode: 'readwrite' }) => Promise<Kept> }).showDirectoryPicker;
  if (pick === undefined) return;
  let folder: Kept;
  try {
    folder = await pick.call(window, { id: 'debaser-extension', mode: 'readwrite' });
  } catch {
    // Closed without picking.
    return;
  }
  if (!(await isItsFolder(folder))) {
    set({ said: "THAT ISN'T THE EXTENSION'S FOLDER" });
    return;
  }
  await shelf('readwrite', (store) => store.put(folder, 'it'));
  set({ said: null, folder: 'granted' });
  if (state.kind === 'old') await updateExtension();
}

/**
 * The first time, without a download: the reader picks a new, empty folder, and the site writes the extension into it, each file proved first
 * (writeUpdate, `first`). A folder with anything of the reader's in it is refused, and nothing is written. The folder is kept, so later
 * versions are written into the same one.
 */
export async function installIntoFolder(): Promise<void> {
  const pick = (window as typeof window & { showDirectoryPicker?: (how: { id: string; mode: 'readwrite' }) => Promise<Kept> }).showDirectoryPicker;
  if (pick === undefined || state.busy) return;
  let folder: Kept;
  try {
    folder = await pick.call(window, { id: 'debaser-extension', mode: 'readwrite' });
  } catch {
    return;
  }
  set({ busy: true, said: 'WRITING', wroteInto: null });
  try {
    const list = await listNow();
    const done = list === null ? { ok: false as const, reason: 'THE LIST DID NOT COME. NOTHING WAS WRITTEN' } : await writeUpdate(folder, list, fileNow, true);
    if (!done.ok) {
      set({ said: done.reason });
      return;
    }
    await shelf('readwrite', (store) => store.put(folder, 'it'));
    set({ said: null, folder: 'granted', wroteInto: folder.name });
  } finally {
    set({ busy: false });
  }
}

export async function forgetExtensionFolder(): Promise<void> {
  await shelf('readwrite', (store) => store.delete('it'));
  set({ folder: 'none', said: null });
}

/** The new version into the picked folder, and the extension asked to read itself again. `pressed`: the browser may ask the reader for leave. */
export async function updateExtension(pressed = true): Promise<void> {
  // Two pages of the site open at once do not write to the one folder at once.
  await navigator.locks.request('debaser-extension-update', { ifAvailable: true }, async (lock) => {
    if (lock !== null) await update(pressed);
  });
}

/** The version that was written and not read again (a permission to say yes to, or a ↻ to press): not written over and over, only said. */
const WRITTEN_KEY = 'debaser-extension-written-v1';
function writtenBefore(version: string): boolean {
  try {
    return window.sessionStorage.getItem(WRITTEN_KEY) === version;
  } catch {
    return false;
  }
}

async function update(pressed: boolean): Promise<void> {
  if (state.busy) return;
  const folder = await keptFolder();
  if (folder === null) return;
  let permission = await folder.queryPermission?.({ mode: 'readwrite' }).catch(() => null);
  if (permission !== 'granted' && pressed) permission = await folder.requestPermission?.({ mode: 'readwrite' }).catch(() => null);
  if (permission !== 'granted') {
    set({ folder: 'ask', said: pressed ? "THE BROWSER DIDN'T LET THE SITE WRITE THERE" : state.said });
    return;
  }
  set({ busy: true, said: 'UPDATING' });
  try {
    const list = await listNow();
    if (list !== null && !pressed && writtenBefore(list.version)) {
      set({ said: null });
      return;
    }
    const done = list === null ? { ok: false as const, reason: 'THE LIST DID NOT COME. NOTHING WAS CHANGED' } : await writeUpdate(folder, list, fileNow);
    if (!done.ok || list === null) {
      set({ said: done.ok ? null : done.reason });
      return;
    }
    // Asked to read itself again; one from before 0.2.0 doesn't know the word.
    const heard = await reloadOwnEye();
    try {
      window.sessionStorage.setItem(WRITTEN_KEY, list.version);
    } catch {
      // No storage: it may be written again on the next page.
    }
    let now: string | null = null;
    for (let tries = 0; tries < 5 && now !== list.version; tries += 1) {
      await new Promise((go) => window.setTimeout(go, 1200));
      now = await extensionVersion();
    }
    if (now === null) {
      // It is in, and silent: a browser turns an extension off until its reader agrees to what a new version asks.
      set({ kind: 'old', said: 'WRITTEN. TURN IT ON AGAIN IN THE EXTENSIONS PAGE: THE BROWSER MAY ASK YOU TO AGREE TO SOMETHING' });
      return;
    }
    await lookForExtension();
    set({ said: now === list.version ? `UPDATED TO ${list.version}` : heard ? "WRITTEN, BUT THE BROWSER HASN'T READ IT: PRESS ↻ ON IT IN THE EXTENSIONS PAGE" : 'WRITTEN. PRESS ↻ ON IT IN THE EXTENSIONS PAGE, THIS ONCE' });
  } finally {
    set({ busy: false });
  }
}

export async function changeExtensionSettings(settings: OwnEyeSettings): Promise<void> {
  set({ settings: (await ownEyeSettings(settings)) ?? state.settings });
}
