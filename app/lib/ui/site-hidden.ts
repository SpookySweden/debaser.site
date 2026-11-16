/**
 * The reader's choice to put the site window away, so the background shows (Luke, 2026-11-16: "a button to the left of the fill
 * window button that collapses the main site window"). `[ HIDE WINDOW ]` beside FILL WINDOW puts it away; `[ ▲ WINDOW ]` in the
 * corner above the player (CornerShelf.tsx) brings it back. Remembered in this browser until it is brought back, on every page, the
 * same way FILL WINDOW is (./site-fill.ts): written on `<html>` as `data-site-hidden="on"` before the first paint, and the
 * stylesheet hides the window from that mark (globals.css), so a reload never flashes the window first.
 */
const STORAGE_KEY = 'debaser.shell.hidden.v1';
const ON = 'on';
/** The mark on `<html>`. */
const MARK = 'data-site-hidden';

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

function mark(on: boolean): void {
  if (typeof document === 'undefined') return;
  if (on) document.documentElement.setAttribute(MARK, ON);
  else document.documentElement.removeAttribute(MARK);
}

// What this page knows, for a browser that won't keep anything: the keys still work until the page is reloaded.
let hidden: boolean | null = null;

// Another tab changing it: this one follows.
function otherTabChanged(event: StorageEvent): void {
  if (event.key !== STORAGE_KEY && event.key !== null) return;
  hidden = read();
  mark(hidden);
  for (const listener of listeners) listener();
}

export function subscribeToSiteHidden(listener: () => void): () => void {
  if (listeners.size === 0) window.addEventListener('storage', otherTabChanged);
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) window.removeEventListener('storage', otherTabChanged);
  };
}

export function siteHidden(): boolean {
  if (hidden === null) {
    hidden = read();
    mark(hidden);
  }
  return hidden;
}

export const siteHiddenOnServer = (): boolean => false;

export function setSiteHidden(next: boolean): void {
  hidden = next;
  mark(next);
  try {
    if (next) memory()?.setItem(STORAGE_KEY, ON);
    else memory()?.removeItem(STORAGE_KEY);
  } catch {
    // A browser that won't keep it only forgets it on the next reload.
  }
  for (const listener of listeners) listener();
}

/** Run in `<head>`, before anything is painted: puts the mark on `<html>` if the reader put the window away. */
export function siteHiddenBootScript(): string {
  return `(function(){try{if(localStorage.getItem(${JSON.stringify(STORAGE_KEY)})===${JSON.stringify(ON)})document.documentElement.setAttribute(${JSON.stringify(MARK)},${JSON.stringify(ON)});}catch(e){}})();`;
}
