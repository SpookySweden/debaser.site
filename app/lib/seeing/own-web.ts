'use client';

/**
 * OWN WEB (Luke, 2026-11-27: "Yes, change it", to keeping every page he opens): the pages the owner opens through the server's eye, kept on his
 * account, private, each as KEEP PAGE keeps a copy, made by the server's own look again; never a sign-in, a page that wasn't the page itself,
 * or a form: the server says which may be kept (`ownWeb`). Kept once a day per address. A page a person's own browser shows (OWN EYE) is kept
 * only by `keepFromOwnEye`, below, from words the extension hands over while that person has switched it on there.
 */
import type { SeenDocument } from './engine';
import type { OwnEyeWords } from './own-eye';
import { copyFrom, pageFrom, type SeenPage } from './pages';
import { keepPage, keptPages, removePage } from './pages-store';
import { makeCopy } from './server-engine';

export const OWN_WEB_TAG = 'OWN WEB';
export const isOwnWeb = (page: SeenPage): boolean => page.tags.includes(OWN_WEB_TAG);

const SWITCH_KEY = 'debaser-seeing-own-web-v1';
const listeners = new Set<() => void>();
let on: boolean | null = null;
export function ownWebOn(): boolean {
  if (on === null) {
    on = true;
    try {
      on = window.localStorage.getItem(SWITCH_KEY) !== 'off';
    } catch {
      // No storage: on.
    }
  }
  return on;
}
export const ownWebOnServer = (): boolean => true;
export function subscribeToOwnWeb(listener: () => void): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}
export function setOwnWeb(next: boolean): void {
  on = next;
  try {
    window.localStorage.setItem(SWITCH_KEY, next ? 'on' : 'off');
  } catch {
    // It lasts as long as the page.
  }
  for (const listener of listeners) listener();
}

const DAY_MS = 86_400_000;
const asking = new Set<string>();

/** The page just shown, kept if it may be and isn't already from today. Quiet: what can't be kept is simply not kept. */
export async function keepInOwnWeb(document: SeenDocument, owner: { id: string; label: string }): Promise<'kept' | 'skipped' | 'refused'> {
  if (document.ownWeb !== true || !ownWebOn() || !/^https?:/.test(document.address)) return 'skipped';
  const address = document.address.split('#')[0];
  const now = Date.now();
  if (asking.has(address) || keptPages().some((page) => isOwnWeb(page) && page.address.split('#')[0] === address && now - page.at < DAY_MS)) return 'skipped';
  asking.add(address);
  try {
    const made = await makeCopy(address);
    if (typeof made === 'string') return 'refused';
    const copy = copyFrom(made.copy);
    if (copy === null) return 'refused';
    const page = pageFrom({ id: window.crypto.randomUUID(), ownerId: owner.id, ownerLabel: owner.label, address: made.address, ...made.card, at: now, tags: [OWN_WEB_TAG], note: '', quotes: [], hasCopy: true, private: true });
    if (page === null) return 'refused';
    await keepPage(page, copy);
    return 'kept';
  } catch {
    return 'refused';
  } finally {
    asking.delete(address);
  }
}

/** A page OWN EYE showed says so on its card. */
export const OWN_EYE_TAG = 'OWN EYE';
const written = (text: string): string => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * A page OWN EYE showed inside BROWSER, kept from the words the extension read (Luke, 2026-11-27: "Keep every page"; never-keep list, 2026-11-28:
 * "none"): the words a reader could see and nothing else, written here as plain headings and paragraphs, private, on this person's own account.
 * The extension gives words only while its own switch is on; this asks nothing of the server's eye. Kept once a day per address.
 */
export async function keepFromOwnEye(read: OwnEyeWords, owner: { id: string; label: string }): Promise<'kept' | 'skipped' | 'refused'> {
  const address = read.href.split('#')[0];
  const now = Date.now();
  if (asking.has(address) || keptPages().some((page) => isOwnWeb(page) && page.address.split('#')[0] === address && now - page.at < DAY_MS)) return 'skipped';
  const body = read.paragraphs.map((each) => (each.heading ? `<h2>${written(each.words)}</h2>` : `<p>${written(each.words)}</p>`)).join('');
  if (body === '') return 'skipped';
  asking.add(address);
  try {
    const reading = `<h1>${written(read.title || address)}</h1>${body}`;
    const copy = copyFrom({ html: reading, reading, title: read.title });
    const page = pageFrom({ id: window.crypto.randomUUID(), ownerId: owner.id, ownerLabel: owner.label, address, title: read.title, description: read.description, picture: null, language: read.language, date: '', at: now, tags: [OWN_WEB_TAG, OWN_EYE_TAG], note: '', quotes: [], hasCopy: true, private: true });
    if (copy === null || page === null) return 'refused';
    await keepPage(page, copy);
    return 'kept';
  } catch {
    return 'refused';
  } finally {
    asking.delete(address);
  }
}

export const siteOfPage = (page: SeenPage): string => page.site;

/** Every page of a site, or every page there is. */
export async function forgetOwnWeb(which: (page: SeenPage) => boolean): Promise<number> {
  let gone = 0;
  for (const page of keptPages().filter((each) => isOwnWeb(each) && which(each))) {
    await removePage(page).then(() => (gone += 1)).catch(() => undefined);
  }
  return gone;
}
