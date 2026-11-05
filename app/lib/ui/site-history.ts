/**
 * The site's own back and forward (SPEC-floating-player.md), for `[ ◄ ] [ ► ]` in the nav, and your place on each page.
 *
 * The Navigation API lists the history entries of this site in this tab, contiguous with where you are, and nothing from
 * another site: so the arrows can go quiet at the edge of the site, where `history.back()` would leave it. It also names
 * each entry with a key, which is what a saved place hangs from. Two visits to one address are two entries, each with
 * its own place. A browser without it (older Safari and Firefox) gets arrows that are always lit, and places saved by
 * address. Places live in this tab only: `sessionStorage`, never the server.
 */

/** Which ways there is somewhere to go. A string, so `useSyncExternalStore` can compare it. */
export type SiteHistoryWays = 'none' | 'back' | 'forward' | 'both';

type EntryLike = { key: string; index: number };
/** The part of the Navigation API this uses. */
export type NavigationLike = {
  currentEntry: EntryLike | null;
  entries(): EntryLike[];
  traverseTo(key: string): { committed: Promise<unknown>; finished: Promise<unknown> };
  addEventListener(type: 'currententrychange', listener: () => void): void;
  removeEventListener(type: 'currententrychange', listener: () => void): void;
};

function navigationNow(): NavigationLike | null {
  if (typeof window === 'undefined') return null;
  const found = (window as unknown as { navigation?: NavigationLike }).navigation;
  return found === undefined ? null : found;
}

export function waysFrom(index: number, count: number): SiteHistoryWays {
  const back = index > 0;
  const forward = index >= 0 && index < count - 1;
  return back && forward ? 'both' : back ? 'back' : forward ? 'forward' : 'none';
}

export function siteHistoryWays(): SiteHistoryWays {
  const navigation = navigationNow();
  if (navigation === null) return typeof window === 'undefined' ? 'none' : 'both';
  return waysFrom(navigation.currentEntry?.index ?? -1, navigation.entries().length);
}

/** What the server drew: quiet arrows. */
export const siteHistoryServerWays = (): SiteHistoryWays => 'none';

export function subscribeToSiteHistory(listener: () => void): () => void {
  const navigation = navigationNow();
  if (navigation === null) return () => undefined;
  navigation.addEventListener('currententrychange', listener);
  return () => navigation.removeEventListener('currententrychange', listener);
}

/**
 * One step along the site's entries. To an entry by its key rather than `history.back()`, because a player that moved
 * inside its own frame adds entries to the tab's history, and one press here must not go back inside the player.
 */
export function goSiteHistory(step: -1 | 1): void {
  const navigation = navigationNow();
  if (navigation === null) {
    window.history.go(step);
    return;
  }
  const to = navigation.entries()[(navigation.currentEntry?.index ?? -1) + step];
  if (to === undefined) return;
  const trip = navigation.traverseTo(to.key);
  // Refused or overtaken by another navigation: nothing to tell the reader, they are still where they were.
  trip.committed.catch(() => undefined);
  trip.finished.catch(() => undefined);
}

/** The key the current entry's place is saved under. */
export function currentEntryKey(): string {
  return navigationNow()?.currentEntry?.key ?? `${window.location.pathname}${window.location.search}`;
}

/** This page came from a press of the browser's back or forward, or a reload, so it has a place to go back to. */
export function arrivedWithPlace(): boolean {
  const activation = (window as unknown as { navigation?: { activation?: { navigationType?: string } } }).navigation?.activation;
  return activation?.navigationType === 'traverse' || activation?.navigationType === 'reload';
}

/* --- the saved places ------------------------------------------------------------------------------------------- */

/** A place: how far each pane on the page was scrolled. */
export type PanePlaces = Record<string, number>;

const STORE_KEY = 'debaser-site-places';
/** Enough for any walk through the site; the oldest go first. */
const KEPT_ENTRIES = 60;

let places: Map<string, PanePlaces> | null = null;

function readAll(): Map<string, PanePlaces> {
  if (places !== null) return places;
  places = new Map();
  try {
    const stored = JSON.parse(window.sessionStorage.getItem(STORE_KEY) ?? '[]') as [string, PanePlaces][];
    if (Array.isArray(stored)) for (const [key, value] of stored) places.set(key, value);
  } catch {
    // Blocked or corrupt: places last only until the next reload.
  }
  return places;
}

export function placeFor(key: string): PanePlaces | null {
  return readAll().get(key) ?? null;
}

export function savePlace(key: string, pane: string, top: number): void {
  const all = readAll();
  const kept = all.get(key) ?? {};
  kept[pane] = top;
  // Last touched goes last, so the trim below takes the entry walked away from longest ago.
  all.delete(key);
  all.set(key, kept);
  while (all.size > KEPT_ENTRIES) all.delete(all.keys().next().value as string);
}

export function writePlaces(): void {
  if (places === null) return;
  try {
    window.sessionStorage.setItem(STORE_KEY, JSON.stringify([...places]));
  } catch {
    // Full or blocked: they stay in memory.
  }
}

/* --- which pane -------------------------------------------------------------------------------------------------- */

/** The window's own scroll, in a place. */
export const WINDOW_PANE = 'window';

/**
 * A scrolling pane's name in a place. The page's pane is marked in `SiteWindow.tsx`, because rows and banners come and go
 * above everything inside it. Any other pane on the page is named by its steps down from there, which is stable for the
 * same page. Only panes in the page count: a docked window is not part of a page, and keeps its own scroll.
 */
export function paneName(pane: Element): string | null {
  const marked = pane.getAttribute('data-scroll-pane');
  if (marked !== null) return marked;
  const steps: number[] = [];
  let node: Element = pane;
  while (true) {
    const parent = node.parentElement;
    if (parent === null) return null;
    steps.unshift([...parent.children].indexOf(node));
    if (parent.hasAttribute('data-scroll-pane')) return `${parent.getAttribute('data-scroll-pane')}/${steps.join('/')}`;
    if (parent.tagName === 'MAIN') return `main/${steps.join('/')}`;
    node = parent;
  }
}

/** Finds a pane by the name `paneName` gave it, on the page as it is now. */
export function paneNamed(name: string, root: ParentNode = document): Element | null {
  const [head, ...steps] = name.split('/');
  let node: Element | null = root.querySelector(head === 'main' ? 'main' : `main [data-scroll-pane="${head}"]`);
  for (const step of steps) {
    if (node === null) return null;
    node = node.children[Number(step)] ?? null;
  }
  return node;
}
