/**
 * BROWSER's tabs (SPEC-seeing-machine.md, answer 4): up to eight, each with its own back and forward. Pure: every change takes the tabs
 * as they are and gives back the tabs as they become, or the same object when nothing changes.
 */
import { readAddress, shortName } from './address';
import { DEFAULT_LENS, isLensId, type LensId } from './lenses/names';

export const TABS_MOST = 8;
/** How far back one tab remembers. */
export const STOPS_MOST = 50;
const TITLE_MOST = 80;

/** One page a tab has been to. */
export type Stop = { address: string; title: string | null };

export type Tab = {
  id: string;
  /** Empty in a new tab. */
  stops: readonly Stop[];
  /** Which stop it is at; -1 in a new tab. */
  at: number;
  lens: LensId;
  /** Typed or brought by a link, not opened: the box shows it and waits for GO. Never stored. */
  draft: string | null;
};

export type Tabs = { tabs: readonly Tab[]; front: string };

export function newTab(id: string): Tab {
  return { id, stops: [], at: -1, lens: DEFAULT_LENS, draft: null };
}

export function freshTabs(id: string): Tabs {
  return { tabs: [newTab(id)], front: id };
}

export function frontTab(state: Tabs): Tab {
  return state.tabs.find((tab) => tab.id === state.front) ?? state.tabs[0];
}

export function stopOf(tab: Tab): Stop | null {
  return tab.stops[tab.at] ?? null;
}

export function tabName(tab: Tab): string {
  const stop = stopOf(tab);
  if (stop === null) return 'NEW TAB';
  return stop.title ?? shortName(stop.address);
}

export const canGoBack = (tab: Tab): boolean => tab.at > 0;
export const canGoForward = (tab: Tab): boolean => tab.at >= 0 && tab.at < tab.stops.length - 1;

function changed(state: Tabs, id: string, change: (tab: Tab) => Tab): Tabs {
  const tabs = state.tabs.map((tab) => (tab.id === id ? change(tab) : tab));
  return tabs.every((tab, index) => tab === state.tabs[index]) ? state : { ...state, tabs };
}

export function addTab(state: Tabs, id: string): Tabs {
  if (state.tabs.length >= TABS_MOST) return state;
  return { tabs: [...state.tabs, newTab(id)], front: id };
}

/** The tab to its right comes to the front, else the one to its left. Closing the last one leaves a new tab. */
export function closeTab(state: Tabs, id: string, freshId: string): Tabs {
  const at = state.tabs.findIndex((tab) => tab.id === id);
  if (at === -1) return state;
  const tabs = state.tabs.filter((tab) => tab.id !== id);
  if (tabs.length === 0) return freshTabs(freshId);
  return { tabs, front: state.front === id ? (tabs[at] ?? tabs[at - 1]).id : state.front };
}

export function showTab(state: Tabs, id: string): Tabs {
  return state.front === id || !state.tabs.some((tab) => tab.id === id) ? state : { ...state, front: id };
}

/** Goes to a page in this tab: what was ahead of it is forgotten, as in any browser. The page it is already at is not written twice. */
export function visit(state: Tabs, id: string, address: string): Tabs {
  return changed(state, id, (tab) => {
    if (stopOf(tab)?.address === address) return tab.draft === null ? tab : { ...tab, draft: null };
    const stops = [...tab.stops.slice(0, tab.at + 1), { address, title: null }].slice(-STOPS_MOST);
    return { ...tab, stops, at: stops.length - 1, draft: null };
  });
}

export function step(state: Tabs, id: string, by: -1 | 1): Tabs {
  return changed(state, id, (tab) => ((by === -1 ? canGoBack(tab) : canGoForward(tab)) ? { ...tab, at: tab.at + by, draft: null } : tab));
}

export function withDraft(state: Tabs, id: string, draft: string | null): Tabs {
  return changed(state, id, (tab) => (tab.draft === draft ? tab : { ...tab, draft }));
}

export function withLens(state: Tabs, id: string, lens: LensId): Tabs {
  return changed(state, id, (tab) => (tab.lens === lens ? tab : { ...tab, lens }));
}

/** A page's own title, as plain text: control characters out, one line, cut short. */
export function cleanTitle(text: string): string | null {
  const title = text.replace(/[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2066-\u2069]+/g, ' ').replace(/\s+/g, ' ').trim();
  return title.length === 0 ? null : title.slice(0, TITLE_MOST);
}

/** Only while the tab is still at the page the title came from. */
export function withTitle(state: Tabs, id: string, address: string, title: string): Tabs {
  return changed(state, id, (tab) => {
    const stop = stopOf(tab);
    const clean = cleanTitle(title);
    if (stop === null || stop.address !== address || stop.title === clean) return tab;
    return { ...tab, stops: tab.stops.map((each, index) => (index === tab.at ? { ...each, title: clean } : each)) };
  });
}

/** Where a page was sent on to: the stop is renamed, not added to, so back does not land on it again. */
export function withAddress(state: Tabs, id: string, from: string, to: string): Tabs {
  const read = readAddress(to);
  return changed(state, id, (tab) => {
    const stop = stopOf(tab);
    if (!read.ok || stop === null || stop.address !== from || read.address === from) return tab;
    return { ...tab, stops: tab.stops.map((each, index) => (index === tab.at ? { ...each, address: read.address } : each)) };
  });
}

/** What the browser keeps: no drafts. */
export function storedTabs(state: Tabs): string {
  return JSON.stringify({ front: state.front, tabs: state.tabs.map(({ id, stops, at, lens }) => ({ id, stops, at, lens })) });
}

const ID = /^[a-z0-9-]{1,40}$/i;

/** Read back through one door: whatever isn't a whole, sensible tab is dropped, and nothing left is nothing stored. */
export function tabsFromStored(raw: string | null): Tabs | null {
  if (raw === null) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null) return null;
  const { front, tabs } = value as { front?: unknown; tabs?: unknown };
  if (!Array.isArray(tabs)) return null;
  const read: Tab[] = [];
  for (const each of tabs) {
    if (read.length === TABS_MOST) break;
    if (typeof each !== 'object' || each === null) continue;
    const { id, stops, at, lens } = each as Record<string, unknown>;
    if (typeof id !== 'string' || !ID.test(id) || read.some((tab) => tab.id === id) || !Array.isArray(stops)) continue;
    const kept: Stop[] = [];
    let place = -1;
    for (const [index, stop] of stops.entries()) {
      if (typeof stop !== 'object' || stop === null) continue;
      const { address, title } = stop as Record<string, unknown>;
      const good = typeof address === 'string' ? readAddress(address) : null;
      if (good === null || !good.ok) continue;
      kept.push({ address: good.address, title: typeof title === 'string' ? cleanTitle(title) : null });
      if (typeof at === 'number' && index <= at) place = kept.length - 1;
    }
    const most = kept.slice(-STOPS_MOST);
    const dropped = kept.length - most.length;
    read.push({
      id,
      stops: most,
      at: most.length === 0 ? -1 : Math.min(Math.max(place - dropped, 0), most.length - 1),
      lens: isLensId(lens) ? lens : DEFAULT_LENS,
      draft: null,
    });
  }
  if (read.length === 0) return null;
  return { tabs: read, front: typeof front === 'string' && read.some((tab) => tab.id === front) ? front : read[0].id };
}
