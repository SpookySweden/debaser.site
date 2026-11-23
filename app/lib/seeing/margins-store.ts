/** Whose notes and drawings they are, and where they are kept: this browser, under the account's own key. Nothing is sent anywhere. */
import { marginsFrom, NO_MARGINS, storedMargins, type Margins } from './margins';

const STORAGE_PREFIX = 'debaser-seeing-margins-v1:';
let held: { owner: string | null; margins: Margins } = { owner: null, margins: NO_MARGINS };
const listeners = new Set<() => void>();

export const margins = (): Margins => held.margins;
export const marginsOnServer = (): Margins => NO_MARGINS;
export function subscribeToMargins(listener: () => void): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

/** What is kept now: another tab of the site may have written since this one read. */
function readKept(owner: string | null): Margins | null {
  try {
    const text = owner === null ? null : window.localStorage.getItem(STORAGE_PREFIX + owner);
    return text === null ? null : marginsFrom(JSON.parse(text));
  } catch {
    return null;
  }
}

export function openMarginsOf(owner: string | null): void {
  if (held.owner === owner) return;
  held = { owner, margins: readKept(owner) ?? NO_MARGINS };
  for (const listener of listeners) listener();
}

export function changeMargins(change: (all: Margins) => Margins): void {
  if (held.owner === null) return;
  const { margins: next, text } = storedMargins(change(readKept(held.owner) ?? held.margins));
  held = { ...held, margins: next };
  for (const listener of listeners) listener();
  try {
    window.localStorage.setItem(STORAGE_PREFIX + held.owner, text);
  } catch {
    // Full or refused: they last as long as the page.
  }
}
