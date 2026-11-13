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

export function onCompanionPoke(listener: (kind: CompanionReaction) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
