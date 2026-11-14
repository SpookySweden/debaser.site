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

/* --- somebody's character catching something handed to it --------------------------------------------------------- */

const catchers = new Set<(userId: string) => void>();

/**
 * Makes `userId`'s character play its catch, once, wherever it is drawn on this screen (Luke, 2026-11-14: "drag and drop
 * letters ... directly to a users character ... the character plays a cute animation when grabbing it"): their companion
 * on the strip (yours, or theirs in a stream room you share) and their character in a profile's ROOM. A person with no
 * character on screen: nothing happens. Nothing is sent or stored: it is a picture on this screen only, so the thing
 * that was dropped still has to be delivered by whoever calls this.
 *
 * To find whose character is under a drop, every drawn figure carries its owner's id: `data-companion-of="<user id>"`
 * on a companion on the strip, `data-character-of="<user id>"` on a character in a profile's ROOM. Use the element's box
 * (`getBoundingClientRect`), not `elementFromPoint`: a companion standing over a key lets presses through it.
 */
export function companionCatches(userId: string): void {
  for (const listener of catchers) listener(userId);
}

export function onCompanionCatch(listener: (userId: string) => void): () => void {
  catchers.add(listener);
  return () => {
    catchers.delete(listener);
  };
}

export function onCompanionPoke(listener: (kind: CompanionReaction) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
