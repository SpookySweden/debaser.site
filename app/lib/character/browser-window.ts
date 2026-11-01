import { createWindowSlot } from '../ui/window-slot';

/**
 * The character browser as a window: the reader's saved figures, on a shelf.
 *
 * **The workbench was a place with no memory, and this is the door out of it.** A figure is built on the CHAR tab
 * and until now had nowhere to go - the unsaved prompt had to admit as much in words. The browser is the other
 * half of `app/lib/character/library.ts`: that module knows how to keep a figure, this knows when one is being
 * looked at, and the window itself (`app/components/CharacterBrowserWindow.tsx`) is what draws the shelf.
 *
 * **A slot and not a page, for the reason every other window here is one.** The browser is opened from the
 * workbench, and a reader in the middle of a figure must not lose it to a navigation - they are choosing what to
 * put on the bench, so the bench has to stay behind them. Drawn once in `layout.tsx`, like the arcade and the
 * archive, so no page re-renders when it opens.
 *
 * **No address, and that is a decision rather than an omission.** `/forum?arcade=1` exists because a *post* can
 * link to a game, and `/forum?music=1` because a plate can link to a track. Nothing links to somebody else's saved
 * figure: it is private to an account and lives in that account's own browser storage, so a URL naming one would
 * be a URL that works for exactly one person. A link that cannot be shared is not an address.
 */

/** The window's whole state: whether it is up, and which entry is mid-delete. */
export type CharacterBrowserState = {
  open: boolean;
  /**
   * The figure whose delete is being confirmed, or `null`.
   *
   * **Two presses to delete, held here rather than in the component**, so the confirmation survives a re-render of
   * the list. A shelf where REMOVE deletes on one press is a shelf that loses figures to a mis-aimed click, and
   * this is the same "two presses" rule the board's own destructive verbs follow.
   */
  confirmingId: string | null;
};

/** Shut, with nothing half-deleted. One shared object, so React can compare it by identity. */
const CLOSED: CharacterBrowserState = { open: false, confirmingId: null };

const slot = createWindowSlot<CharacterBrowserState>(CLOSED);

/** The window as it is now, for `useSyncExternalStore`. */
export const characterBrowserState = slot.state;

/** Draws from the window: the listener fires when it opens, closes, or arms a delete. */
export const subscribeToCharacterBrowser = slot.subscribe;

/** Opens the shelf. */
export function openCharacterBrowser(): void {
  slot.set({ open: true, confirmingId: null });
}

/** Closes it, disarming any half-pressed delete so the next open is clean. */
export function closeCharacterBrowser(): void {
  slot.set(CLOSED);
}

/** Arms the delete on one figure, or disarms it by passing `null`. */
export function confirmCharacterRemoval(id: string | null): void {
  const current = slot.state();
  if (!current.open) return;

  slot.set({ ...current, confirmingId: id });
}
