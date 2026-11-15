import { createWindowSlot } from '../ui/window-slot';

/**
 * The NEW LETTER window's own state (Luke, 2026-11-15: "turn the part where you make a new leetter on the profile page
 * into a simple expandable add button which then opens a window").
 *
 * A window's state lives in a small store that only that window reads (`../ui/window-slot`), so opening it redraws the
 * key and the window and nothing else on the profile.
 */
const slot = createWindowSlot<boolean>(false);

export const newLetterWindowOpen = slot.state;
export const subscribeToNewLetterWindow = slot.subscribe;

export function openNewLetter(): void {
  if (!slot.state()) slot.set(true);
}

export function closeNewLetter(): void {
  if (slot.state()) slot.set(false);
}
