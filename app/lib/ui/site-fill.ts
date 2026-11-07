/**
 * The reader's own choice to have the site window fill the screen on every page (Luke, 2026-11-07). Remembered in this browser until they
 * collapse it. A page that fills the screen by itself (`SiteWindow`'s `fill`) never reads or writes this: the two are kept apart so that coming
 * out of such a page always finds what the reader chose. In its own small file, as the side panel's page fold is.
 */
const STORAGE_KEY = 'debaser.shell.fill.v1';
const ON = 'on';

type Memory = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

const listeners = new Set<() => void>();

function memory(): Memory | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

function read(): boolean {
  try {
    return memory()?.getItem(STORAGE_KEY) === ON;
  } catch {
    return false;
  }
}

// What this page knows, for a browser that won't keep anything: the key still works until the page is reloaded.
let chosen: boolean | null = null;

// Another tab changing it: this one follows, so a press here never does the opposite of what it shows.
function otherTabChanged(event: StorageEvent): void {
  if (event.key !== STORAGE_KEY && event.key !== null) return;
  chosen = read();
  for (const listener of listeners) listener();
}

export function subscribeToChosenFill(listener: () => void): () => void {
  if (listeners.size === 0) window.addEventListener('storage', otherTabChanged);
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) window.removeEventListener('storage', otherTabChanged);
  };
}

export function chosenFill(): boolean {
  chosen ??= read();
  return chosen;
}

export function setChosenFill(next: boolean): void {
  chosen = next;
  try {
    if (next) memory()?.setItem(STORAGE_KEY, ON);
    else memory()?.removeItem(STORAGE_KEY);
  } catch {
    // A browser that won't keep it only forgets it on the next reload.
  }
  for (const listener of listeners) listener();
}
