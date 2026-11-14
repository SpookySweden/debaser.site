/**
 * The reader's own choice to have the site window fill the screen on every page (Luke, 2026-11-07). Remembered in this browser until they
 * collapse it. A page that fills the screen by itself (`SiteWindow`'s `fill`) never reads or writes this: the two are kept apart so that coming
 * out of such a page always finds what the reader chose. In its own small file, as the side panel's page fold is.
 *
 * The choice is also written on `<html>` as `data-site-fill="on"`, and that mark is what lays the window out (globals.css, beside
 * `.desktop-tile`). It is set by a line of script before the page's first paint (`siteFillBootScript`, run from app/layout.tsx), so a
 * reload draws the window filled from its first frame. Before 2026-11-14 the server's normal-sized window was painted first and jumped
 * to full size once the page's script had loaded, on every reload (Luke: "pretty buggy").
 */
const STORAGE_KEY = 'debaser.shell.fill.v1';
const ON = 'on';
/** The mark on `<html>`. */
const MARK = 'data-site-fill';

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

/** Writes the mark the stylesheet reads. Nothing to mark outside a browser (a check, the server). */
function mark(on: boolean): void {
  if (typeof document === 'undefined') return;
  if (on) document.documentElement.setAttribute(MARK, ON);
  else document.documentElement.removeAttribute(MARK);
}

// What this page knows, for a browser that won't keep anything: the key still works until the page is reloaded.
let chosen: boolean | null = null;

// Another tab changing it: this one follows, so a press here never does the opposite of what it shows.
function otherTabChanged(event: StorageEvent): void {
  if (event.key !== STORAGE_KEY && event.key !== null) return;
  chosen = read();
  mark(chosen);
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
  if (chosen === null) {
    chosen = read();
    // Agrees with the boot script; also covers a page that somehow ran without it.
    mark(chosen);
  }
  return chosen;
}

export function setChosenFill(next: boolean): void {
  chosen = next;
  mark(next);
  try {
    if (next) memory()?.setItem(STORAGE_KEY, ON);
    else memory()?.removeItem(STORAGE_KEY);
  } catch {
    // A browser that won't keep it only forgets it on the next reload.
  }
  for (const listener of listeners) listener();
}

/**
 * Run in `<head>`, before anything is painted: puts the mark on `<html>` if the reader chose to fill the window. It reads one key and
 * swallows every error, as the theme's boot script does; a browser with storage blocked gets the normal window.
 */
export function siteFillBootScript(): string {
  return `(function(){try{if(localStorage.getItem(${JSON.stringify(STORAGE_KEY)})===${JSON.stringify(ON)})document.documentElement.setAttribute(${JSON.stringify(MARK)},${JSON.stringify(ON)});}catch(e){}})();`;
}
