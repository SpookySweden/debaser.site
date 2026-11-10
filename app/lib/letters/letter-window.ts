import { createWindowSlot } from '../ui/window-slot';

/**
 * One letter's window (SPEC-letters.md): which letter is open, if any. Drawn once in `layout.tsx`
 * (./components/LetterWindow.tsx), over whatever page it was opened from, like the arcade.
 * The address is the other way in: `?letter=<id>` on any page opens that letter.
 */
export type LetterWindowState = { open: boolean; letterId: string | null };

const CLOSED: LetterWindowState = { open: false, letterId: null };

const slot = createWindowSlot<LetterWindowState>(CLOSED);

export const letterWindowState = slot.state;
export const subscribeToLetterWindow = slot.subscribe;

export function openLetter(letterId: string): void {
  slot.set({ open: true, letterId });
}

export function closeLetter(): void {
  if (letterWindowState().open) slot.set(CLOSED);
}

/** A link that opens a letter, from the page it's on. */
export function letterHref(pathname: string, letterId: string): string {
  return `${pathname}?letter=${encodeURIComponent(letterId)}`;
}

/** The letter an address asks for, or null. */
export function letterIdFromSearch(search: string): string | null {
  const id = new URLSearchParams(search).get('letter');
  return id !== null && /^[A-Za-z0-9-]{1,64}$/.test(id) ? id : null;
}
