/**
 * One window's state, as a store outside React.
 *
 * The utility windows are drawn once in `layout.tsx`, above every page, and a page never asks
 * whether one of them is open: a plate that opens the arcade or the music archive calls a plain
 * function and goes back to what it was rendering. That is the whole reason this is a module-level
 * store rather than a context - a provider's value changing re-renders every consumer under it, and
 * the thing that must *not* re-render here is the board the reader is standing on. The window's own
 * component reads the store with `useSyncExternalStore`, so opening the music archive re-renders the
 * music archive and nothing else.
 *
 * A slot holds the state and hands out three things: the current value (the same object until
 * something changes, which `useSyncExternalStore` requires), a subscription, and a write.
 */
export type WindowSlot<State> = {
  /** The state as it stands. Identity-stable between writes, because React compares it. */
  state: () => State;
  /** Draws from the window: the listener fires on every write. */
  subscribe: (listener: () => void) => () => void;
  /** Replaces the state and wakes everybody drawing from it. */
  set: (next: State) => void;
};

/**
 * Somebody who wants to hear of every write to every slot: the undo trail (`./undo-trail.ts`), which asks for this when it starts
 * in a browser. Kept as a hook here, not an import of the trail, so this file stays the small plain store everything can load.
 * `current` reads what the slot holds now; `restore` writes a state back without the watcher hearing of it again.
 */
export type SlotWatcher = (before: unknown, after: unknown, current: () => unknown, restore: (state: unknown) => void) => void;

let watcher: SlotWatcher | null = null;

export function watchWindowSlots(next: SlotWatcher | null): void {
  watcher = next;
}

export function createWindowSlot<State>(initial: State): WindowSlot<State> {
  let state = initial;
  const listeners = new Set<() => void>();

  return {
    state: () => state,
    subscribe: (listener) => {
      listeners.add(listener);

      return () => {
        listeners.delete(listener);
      };
    },
    set: (next) => {
      const before = state;
      state = next;
      for (const listener of listeners) listener();
      // A window opened or closed by a press is a step the top bar's arrows can undo. Undoing writes the old state straight
      // back, without coming through here again.
      watcher?.(before, next, () => state, (restored) => {
        state = restored as State;
        for (const listener of listeners) listener();
      });
    },
  };
}
