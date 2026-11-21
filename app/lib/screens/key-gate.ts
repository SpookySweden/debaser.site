/**
 * The keyboard's first listener (SPEC-screens.md, CONTROL in a room).
 *
 * While a device holds control of the PC and the picture has the keyboard, every key is the PC's: Esc too. A key
 * listener can stop the listeners that come after it, never the ones before it, and the site has windows that
 * listen for Esc on the whole window (the room's queue, MEDIA's player, the character windows). A listener added
 * when control is taken comes after any of those already open, so an Esc typed to the PC also closed them.
 *
 * So the listening is done here, once, from the moment the site loads (`ScreenKeyGate` in the layout opens the gate
 * before any window exists), and does nothing at all until CONTROL hands it a taker. The taker decides: it stops
 * the keys it sends to the PC and leaves every other key exactly as it was.
 */

export type KeyTaker = (event: KeyboardEvent, down: boolean) => void;

let taker: KeyTaker | null = null;
let open = false;

/** Starts listening, once. In a browser only. */
export function openKeyGate(): void {
  if (open || typeof window === 'undefined') return;
  open = true;
  window.addEventListener('keydown', (event) => taker?.(event, true), true);
  window.addEventListener('keyup', (event) => taker?.(event, false), true);
}

/** Hands the keyboard's first listener to CONTROL. */
export function takeKeys(next: KeyTaker): void {
  openKeyGate();
  taker = next;
}

/** Gives it back, when it is still that taker's. */
export function leaveKeys(mine: KeyTaker): void {
  if (taker === mine) taker = null;
}
