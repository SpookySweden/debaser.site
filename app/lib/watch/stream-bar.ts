import { createWindowSlot } from '../ui/window-slot';

/**
 * The stream on the music bar (Luke, 2026-11-03): while a room is open, the bar along the foot of the screen
 * is the stream's (its title, host, time and keys), and the TV key at its left turns it back into the music
 * player for a while; the ♪ key there turns it back again.
 *
 * Two things live here. Which of the two this tab's bar shows - remembered per room, so walking into a new
 * room shows its stream first - and the box on the bar that the room draws its part into (`createPortal`
 * from ./WatchRoom.tsx), which the bar hands over while it shows the stream and takes back otherwise.
 * Only this tab's: never stored.
 */

type StreamBarState = {
  /** The room whose bar was turned to the music player, or null: every other room's bar shows the stream. */
  musicFor: string | null;
  /** The bar's box for the room's part, while the bar shows the stream. */
  target: HTMLElement | null;
};

const slot = createWindowSlot<StreamBarState>({ musicFor: null, target: null });

export const streamBarState = slot.state;
export const subscribeToStreamBar = slot.subscribe;

/** True while the bar shows the stream of this room rather than the music player. */
export function showsStream(state: StreamBarState, roomId: string): boolean {
  return state.musicFor !== roomId;
}

/** The TV key: the bar shows the music player while this room plays on. */
export function showMusicOnBar(roomId: string): void {
  const current = slot.state();
  if (current.musicFor !== roomId) slot.set({ ...current, musicFor: roomId });
}

/** The ♪ key, while a room is open: the bar shows the stream again. */
export function showStreamOnBar(): void {
  const current = slot.state();
  if (current.musicFor !== null) slot.set({ ...current, musicFor: null });
}

/** The bar hands over its box (or takes it back with null). */
export function setStreamBarTarget(target: HTMLElement | null): void {
  const current = slot.state();
  if (current.target !== target) slot.set({ ...current, target });
}
