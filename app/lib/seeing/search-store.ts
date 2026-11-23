/** The reader's search engines, remembered in this browser with BROWSER's other settings. */
import { CHOICES_AT_FIRST, choicesFrom, type SearchChoices } from './search';

const STORAGE_KEY = 'debaser-seeing-search-v1';
let held: SearchChoices | null = null;
const listeners = new Set<() => void>();

export function searchChoices(): SearchChoices {
  if (held === null) {
    held = CHOICES_AT_FIRST;
    try {
      held = choicesFrom(JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? 'null'));
    } catch {
      // No storage, or nothing readable in it.
    }
  }
  return held;
}
export const searchChoicesOnServer = (): SearchChoices => CHOICES_AT_FIRST;
export function subscribeToSearch(listener: () => void): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}
export function changeSearch(next: SearchChoices): void {
  held = next;
  for (const listener of listeners) listener();
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Full or refused: it lasts as long as the page.
  }
}
