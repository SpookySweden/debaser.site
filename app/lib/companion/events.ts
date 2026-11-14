import type { CompanionReaction } from './wire';

/**
 * Something the companion should react to (SPEC-companion.md, decision 3): a reply, a message, someone coming online.
 * They come from what the site already hears (the notifications feed, comms, presence; `CompanionReactions.tsx`), never
 * from new listening. A plain listener list rather than a slot: a reaction is an event, not a state to draw.
 */
const listeners = new Set<(kind: CompanionReaction) => void>();

export function pokeCompanion(kind: CompanionReaction): void {
  for (const listener of listeners) listener(kind);
}

/**
 * For the end of a promise that has just succeeded (a post filed on the board): your companion cheers, and the value
 * passes straight through, so it is one `.then(cheerCompanion)` where the thing is done.
 */
export function cheerCompanion<T>(value: T): T {
  pokeCompanion('cheer');
  return value;
}

/* --- somebody speaking in a stream room's chat ------------------------------------------------------------------ */

/** A line of chat counts as just said for this long: an old line read back in is nobody speaking. */
const SPOKE_FRESH_MS = 15_000;

const speakers = new Set<(userId: string) => void>();

/**
 * A line of chat arrived in the stream room this tab is in (`use-watch-room.ts`, one line there): the companion of whoever
 * said it hops with `...` over its head. Every browser in the room has the line already, so each works this out for
 * itself and nothing extra is sent. `saidAt` is the line's own time.
 */
export function companionSpoke(userId: string, saidAt: string): void {
  const at = Date.parse(saidAt);
  if (!Number.isFinite(at) || Math.abs(Date.now() - at) > SPOKE_FRESH_MS) return;
  for (const listener of speakers) listener(userId);
}

export function onCompanionSpoke(listener: (userId: string) => void): () => void {
  speakers.add(listener);
  return () => {
    speakers.delete(listener);
  };
}

export function onCompanionPoke(listener: (kind: CompanionReaction) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
