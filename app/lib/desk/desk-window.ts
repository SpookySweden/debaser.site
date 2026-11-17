import { createWindowSlot } from '../ui/window-slot';

/**
 * YOUR DESK's open-or-shut (SPEC-forum-v3.md, Luke's D1A+, 2026-11-17): a window over the forum, kept apart from every page
 * so opening it re-renders only the window, as HISTORY's store does (`app/lib/history/history-window.ts`). `?desk=1` on
 * any page opens it; it also opens by itself on a signed-in reader's first visit to the forum each day.
 */

export type DeskWindowState = { open: boolean };

const SHUT: DeskWindowState = { open: false };
const slot = createWindowSlot<DeskWindowState>(SHUT);

export const deskWindowState = slot.state;
export const deskWindowServerState = (): DeskWindowState => SHUT;
export const subscribeToDeskWindow = slot.subscribe;

export const DESK_HREF = '/forum?desk=1';

export function openDesk(): void {
  if (!slot.state().open) slot.set({ open: true });
}

export function closeDesk(): void {
  if (slot.state().open) slot.set(SHUT);
}

export function toggleDesk(): void {
  if (slot.state().open) closeDesk();
  else openDesk();
}

export function deskRequested(search: string): boolean {
  return new URLSearchParams(search).get('desk') !== null;
}

/** This browser's memory of the last day the desk opened by itself (D1A+): one key, the reader's local day. */
export const DESK_DAY_KEY = 'debaser.desk.opened-day.v1';
/** The sections a reader folded away (D3A), kept in this browser. */
export const DESK_FOLDS_KEY = 'debaser.desk.folds.v1';

/** The reader's local day, `2026-11-17`: "once a day" is the reader's day, not the server's. */
export function localDay(at: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
}

/** Whether the desk should open by itself now: a signed-in reader on the forum who has not had it today. */
export function opensByItself(input: { signedIn: boolean; onForum: boolean; lastDay: string | null; today: string }): boolean {
  return input.signedIn && input.onForum && input.lastDay !== input.today;
}
