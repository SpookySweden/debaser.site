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

export function onCompanionPoke(listener: (kind: CompanionReaction) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
