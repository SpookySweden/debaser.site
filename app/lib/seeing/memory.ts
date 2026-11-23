/**
 * What is remembered for each site in this browser (SPEC-seeing-machine.md): its lens (idea xvi), what was ERASED from it (idea iv), and
 * the pages marked GOOD on a SCAN (idea vii). Kept here until Phase 5 moves tabs and history to the account. Nothing is sent anywhere.
 */
import { readAddress } from './address';
import { isSelector } from './frame';
import { isLensId, type LensId } from './lenses/names';
import { cleanTitle } from './tabs';
import { dialOf } from './time';

const LENSES = 'debaser-seeing-site-lens-v1';
const ERASED = 'debaser-seeing-erased-v1';
const GOOD = 'debaser-seeing-good-v1';
const SITES_MOST = 500;
const ERASED_MOST = 100;
const GOOD_MOST = 200;

export type GoodPage = { address: string; title: string };

type Memory = { lenses: Record<string, LensId>; erased: Record<string, readonly string[]>; good: readonly GoodPage[] };
const EMPTY: Memory = { lenses: {}, erased: {}, good: [] };

let held: Memory | null = null;
const listeners = new Set<() => void>();

const object = (value: unknown): [string, unknown][] => (typeof value === 'object' && value !== null && !Array.isArray(value) ? Object.entries(value) : []);
const isSite = (name: string): boolean => /^[a-z0-9.-]{1,253}$/.test(name);

function stored(key: string): unknown {
  try {
    return JSON.parse(window.localStorage.getItem(key) ?? 'null') as unknown;
  } catch {
    return null;
  }
}

/** Read back through one door: whatever isn't a site, a lens, a selector of our one shape or an address is dropped. */
export function memoryFrom(lenses: unknown, erased: unknown, good: unknown): Memory {
  const read: { lenses: Record<string, LensId>; erased: Record<string, readonly string[]>; good: GoodPage[] } = { lenses: {}, erased: {}, good: [] };
  for (const [site, lens] of object(lenses).slice(-SITES_MOST)) if (isSite(site) && isLensId(lens)) read.lenses[site] = lens;
  for (const [site, list] of object(erased).slice(-SITES_MOST)) {
    if (!isSite(site) || !Array.isArray(list)) continue;
    const kept = list.filter((each): each is string => typeof each === 'string' && isSelector(each)).slice(0, ERASED_MOST);
    if (kept.length > 0) read.erased[site] = kept;
  }
  for (const each of Array.isArray(good) ? good.slice(0, GOOD_MOST) : []) {
    const { address, title } = (typeof each === 'object' && each !== null ? each : {}) as Record<string, unknown>;
    const page = typeof address === 'string' ? readAddress(address) : null;
    if (page !== null && page.ok) read.good.push({ address: page.address, title: (typeof title === 'string' ? cleanTitle(title) : null) ?? page.address });
  }
  return read;
}

export function siteMemory(): Memory {
  held ??= memoryFrom(stored(LENSES), stored(ERASED), stored(GOOD));
  return held;
}
export const siteMemoryOnServer = (): Memory => EMPTY;

export function subscribeToMemory(listener: () => void): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

function keep(next: Memory, key: string, value: unknown): void {
  held = next;
  for (const listener of listeners) listener();
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // It lasts as long as the page.
  }
}

export function siteIn(address: string | null): string | null {
  if (address === null || !/^https?:/.test(address)) return address?.startsWith('see:') ? 'see.test' : null;
  try {
    // An old copy on the TIME DIAL is its own site, not the Archive.
    return new URL(dialOf(address).address).hostname;
  } catch {
    return null;
  }
}

export function rememberLens(address: string, lens: LensId): void {
  const site = siteIn(address);
  if (site === null) return;
  const lenses = { ...siteMemory().lenses };
  // Put last, so the oldest to be chosen are the ones let go.
  delete lenses[site];
  lenses[site] = lens;
  keep({ ...siteMemory(), lenses }, LENSES, lenses);
}

export function lensRemembered(address: string): LensId | null {
  const site = siteIn(address);
  return site === null ? null : (siteMemory().lenses[site] ?? null);
}

/** One list, so a site with nothing taken out is never a new one to dress for. */
const NOTHING: readonly string[] = [];

export function erasedOn(address: string | null): readonly string[] {
  const site = siteIn(address);
  return site === null ? NOTHING : (siteMemory().erased[site] ?? NOTHING);
}

export function erase(address: string, selector: string): void {
  const site = siteIn(address);
  if (site === null || !isSelector(selector)) return;
  const own = siteMemory().erased[site] ?? [];
  if (own.includes(selector) || own.length >= ERASED_MOST) return;
  const erased = { ...siteMemory().erased, [site]: [...own, selector] };
  keep({ ...siteMemory(), erased }, ERASED, erased);
}

/** One key brings everything back. */
export function bringBack(address: string): void {
  const site = siteIn(address);
  if (site === null) return;
  const erased = { ...siteMemory().erased };
  delete erased[site];
  keep({ ...siteMemory(), erased }, ERASED, erased);
}

export function markGood(address: string, title: string, good: boolean): void {
  const rest = siteMemory().good.filter((each) => each.address !== address);
  const next = good ? [{ address, title }, ...rest].slice(0, GOOD_MOST) : rest;
  keep({ ...siteMemory(), good: next }, GOOD, next);
}
