/**
 * An address the reader has just pressed `[ SEE ]` for, on this site (SPEC-seeing-machine.md, idea viii). Held in the page for the moment
 * between the press and BROWSER opening, so a press here opens it at once, where a link from anywhere else waits for GO.
 */
let asked: { address: string; at: number } | null = null;
const listeners = new Set<() => void>();
const FRESH_MS = 15_000;

export function askToSee(address: string): void {
  asked = { address, at: Date.now() };
  for (const listener of listeners) listener();
}

/** The address asked for, once, if the press was just now. */
export function takeAsked(): string | null {
  const held = asked;
  asked = null;
  return held !== null && Date.now() - held.at < FRESH_MS ? held.address : null;
}

export function subscribeToAsked(listener: () => void): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}
