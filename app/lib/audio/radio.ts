import { createWindowSlot } from '../ui/window-slot';
import type { AudioTrack } from './tracks';

/**
 * PLAY FOR YOU (SPEC-vanity.md step 7): an endless queue drawn from the reader's FOR YOU picks.
 *
 * VANITY's key starts it with the pool it scored (`for-you.ts`); `ForYouRadio`, drawn once by the shell,
 * keeps the player's up-next topped up from that pool for as long as it runs. It stops when the reader
 * presses the key again, or plays anything the radio did not hand the player (a song elsewhere, a
 * follow), which is the same "touch the controls and you are on your own" rule following has.
 *
 * A module-level slot, for the reason the follow state is one (`follow.ts`): the key, the radio and the
 * bar read it, and the radio must outlive the window being closed.
 */

export type RadioPick = { key: string; score: number; track: AudioTrack };

export type RadioState = {
  on: boolean;
  pool: RadioPick[];
  /** Every file the radio handed the player this run, newest last. */
  handed: string[];
};

const OFF: RadioState = { on: false, pool: [], handed: [] };

const slot = createWindowSlot<RadioState>(OFF);

export const radioState = slot.state;
export const subscribeToRadio = slot.subscribe;

/** How many of the newest handed songs are kept out of the next round. */
export const RADIO_MEMORY = 10;

export const RADIO_CONTEXT = 'PLAY FOR YOU';

/** `waiting` is what the reader had queued already: it plays first, and does not stop the radio. */
export function startRadio(pool: RadioPick[], first: string, waiting: string[] = []): void {
  slot.set({ on: true, pool, handed: [...waiting, first] });
}

export function stopRadio(): void {
  if (slot.state().on) slot.set(OFF);
}

export function noteHanded(srcs: string[]): void {
  const current = slot.state();
  if (!current.on || srcs.length === 0) return;
  slot.set({ ...current, handed: [...current.handed, ...srcs].slice(-200) });
}
