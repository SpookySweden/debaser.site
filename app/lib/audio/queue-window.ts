import { createWindowSlot } from '../ui/window-slot';

/**
 * The queue window: the things you can listen *along to*, in three tabs.
 *
 * A window rather than a page, for the reason the archive and the arcade are (`music-window.ts`): a
 * reader consulting a queue is standing in a thread, a board or a profile, and walking off it to look
 * would lose the thing they were reading. It is drawn once in `layout.tsx` and its state is a
 * module-level slot, so opening or switching a tab does not re-render the page underneath.
 *
 *   /forum?queues=1          the window, on RADI-OH
 *   /forum?queues=queues     the window, on the QUEUES tab
 *
 * The three tabs are deliberately *not* three addresses: an address names the window and which tab it
 * opened on, the way `?music=` names the archive or the personal screen, and a reader switching tabs
 * inside an open window should not push history entries for it.
 */

export type QueueWindowState = {
  open: boolean;
  tab: QueueTab;
};

/**
 * The three tabs.
 *
 * `radio` is RADI-OH: the places you have been, kept as loops you can return to. `queues` is the list
 * of people broadcasting what they are listening to. `third` is deliberately empty - the brief asks for
 * the tab to exist so the strip keeps its shape, and a tab that exists but draws nothing is honest
 * about being unbuilt in a way that hiding it would not be.
 */
export type QueueTab = 'radio' | 'queues' | 'third';

/** Shut, on RADI-OH. One shared object, so React can compare it by identity. */
const SHUT: QueueWindowState = { open: false, tab: 'radio' };

const slot = createWindowSlot<QueueWindowState>(SHUT);

/** The window as it is now, for `useSyncExternalStore`. */
export const queueWindowState = slot.state;

/** Draws from the window: the listener fires when it opens, closes or changes tab. */
export const subscribeToQueueWindow = slot.subscribe;

/** The window's address: the board, so a reader keeps the thread they were on. */
export const QUEUES_HREF = '/forum?queues=1';

/**
 * Opens the window, on a tab or the default one.
 *
 * The tab is a parameter rather than a separate opener because its the same window - a reader switching
 * between RADI-OH and QUEUES should not watch the frame close and reopen, which is what two openers
 * would give them.
 */
export function openQueues(tab: QueueTab = 'radio'): void {
  slot.set({ open: true, tab });
}

export function closeQueues(): void {
  if (slot.state().open) slot.set(SHUT);
}

/** Switches tabs while the window stays open. */
export function showQueueTab(tab: QueueTab): void {
  if (slot.state().open && slot.state().tab !== tab) slot.set({ open: true, tab });
}

/**
 * A press on the window's own key: opening when shut, closing when open.
 *
 * The panel and the bar both carry such a key, and both are *switches* - they sit on the screen the
 * window is drawn over, so a reader who has finished with it presses the same key again rather than
 * hunting for the window's `[ X CLOSE ]`. A *link* into the window keeps `openQueues`, which only ever
 * opens, for the reason `toggleMusic` gives: a link that closed what it was asked for would be a link
 * that sometimes does nothing.
 */
export function toggleQueues(): void {
  if (slot.state().open) closeQueues();
  else openQueues();
}

/** Whether an address asks for the window. A query about anything else opens nothing. */
export function queuesRequested(search: string): boolean {
  return new URLSearchParams(search).get('queues') !== null;
}

/**
 * Which tab an address asks for.
 *
 * `?queues=1` is RADI-OH, which is the default; `?queues=queues` is the list; anything else is still a
 * request - the presence of the parameter is what opens the window - and simply names no tab.
 */
export function queueTabRequested(search: string): QueueTab {
  const asked = new URLSearchParams(search).get('queues');

  return asked === 'queues' || asked === 'third' ? asked : 'radio';
}

/**
 * Whether the address still needs spending when the window closes.
 *
 * The panel's key opens it by *following the address*, so once the window is shut that address is a lie
 * - and worse, one the window's own effect would read again the next time anything re-ran it. Clearing
 * it is what keeps the same key working twice.
 */
export function queuesAddressSpentByClose(search: string): boolean {
  return queuesRequested(search);
}
