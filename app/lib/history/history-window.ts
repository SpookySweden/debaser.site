import { createWindowSlot } from '../ui/window-slot';

/**
 * The HISTORY window's open-or-shut (SPEC-history.md), kept apart from every page so opening it re-renders only the
 * window, as the QUEUE window's store does (`app/lib/audio/queue-window.ts`). `?history=1` on any page opens it.
 */

export type HistoryWindowState = { open: boolean };

const SHUT: HistoryWindowState = { open: false };
const slot = createWindowSlot<HistoryWindowState>(SHUT);

export const historyWindowState = slot.state;
export const historyWindowServerState = (): HistoryWindowState => SHUT;
export const subscribeToHistoryWindow = slot.subscribe;

export const HISTORY_HREF = '/forum?history=1';

export function openHistory(): void {
  if (!slot.state().open) slot.set({ open: true });
}

export function closeHistory(): void {
  if (slot.state().open) slot.set(SHUT);
}

export function toggleHistory(): void {
  if (slot.state().open) closeHistory();
  else openHistory();
}

export function historyRequested(search: string): boolean {
  return new URLSearchParams(search).get('history') !== null;
}

/** Shutting the window spends `?history=1`, so the window does not open straight back up from the address. */
export function historyAddressSpentByClose(search: string): boolean {
  return historyRequested(search);
}
