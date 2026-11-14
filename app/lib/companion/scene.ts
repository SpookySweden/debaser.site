/**
 * What you are doing on the site just now, as far as your companion cares (Luke, 2026-11-14: "more ways that the
 * companion can interactive with the site"): reading a book, playing a game in the arcade, or watching a video. It sits
 * down and joins in (`brain.ts`): reads along, or looks up at the screen.
 *
 * A part of the site holds a scene while it is on (`useCompanionScene`, one line there) and lets go when it ends. Plain
 * module state, read by the companion on its own ten-a-second clock: nothing subscribes, nothing re-renders, and nothing
 * is sent anywhere. Typing is not held here: the companion hears the keys itself.
 */
export type CompanionScene = 'game' | 'read' | 'watch';

/** Which wins when several are on at once: the one that most has your attention. */
const ORDER: readonly CompanionScene[] = ['game', 'read', 'watch'];

const held = new Map<symbol, CompanionScene>();

/** Holds a scene until the function it hands back is called. */
export function holdCompanionScene(scene: CompanionScene): () => void {
  const key = Symbol(scene);
  held.set(key, scene);
  return () => {
    held.delete(key);
  };
}

export function companionScene(): CompanionScene | null {
  if (held.size === 0) return null;
  const on = new Set(held.values());
  return ORDER.find((scene) => on.has(scene)) ?? null;
}
