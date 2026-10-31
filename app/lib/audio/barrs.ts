import { createWindowSlot } from '../ui/window-slot';

/**
 * BARR (SPEC-vanity.md): a personal mark on a song, by its file address. Nobody else sees it.
 *
 * The reader's barred files live in a small store rather than only in `MusicLibraryProvider`, because
 * the player that has to stop a barred song (`MusicPlayerProvider`) is drawn *outside* that provider:
 * the library writes the set here as it reads it, and the player reads it from here.
 */

const slot = createWindowSlot<ReadonlySet<string>>(new Set());

export const barredSrcs = slot.state;
export const subscribeToBarrs = slot.subscribe;

/** Replaces the set (the library provider, after each read). */
export function setBarredSrcs(srcs: ReadonlySet<string>): void {
  slot.set(srcs);
}

/**
 * What the player does with the track it is about to sound.
 *
 *   play  not barred, or the reader already said PLAY / LISTEN ANYWAY for this file
 *   ask   barred, on the reader's own player: stop before it starts and ask PLAY ANYWAY?
 *   mute  barred, while following somebody's broadcast: keep in step with them, silence only this
 *         speaker, and offer LISTEN ANYWAY. Nobody else is told.
 */
export type BarrGate = 'play' | 'ask' | 'mute';

export function barrGate(src: string | undefined, barred: ReadonlySet<string>, allowedSrc: string | null, following: boolean): BarrGate {
  if (src === undefined || !barred.has(src) || allowedSrc === src) return 'play';
  return following ? 'mute' : 'ask';
}

/**
 * Where SKIP goes from a barred song nobody wanted: the hand-made queue's next song if there is one
 * (the caller tries that first), otherwise the shelf's next file - or nowhere at the end of the shelf,
 * which stops the player (SPEC-vanity.md: "if there is none, stop").
 */
export function skipIndex(index: number, length: number): number | null {
  return index + 1 < length ? index + 1 : null;
}
