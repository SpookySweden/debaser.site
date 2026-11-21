import { noteSettingChanged, subscribeToAccountSettings } from '../settings/settings-bus';
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

/**
 * Whether the desk should open by itself now: a signed-in reader on the forum, with AUTO POP-UP on, who has not had it
 * today. `auto` left out counts as on (the setting's default).
 */
export function opensByItself(input: { signedIn: boolean; onForum: boolean; lastDay: string | null; today: string; auto?: boolean }): boolean {
  return input.auto !== false && input.signedIn && input.onForum && input.lastDay !== input.today;
}

/*
 * AUTO POP-UP (Luke, 2026-11-21: "in the top right include an auto pop up toggle"): the switch in the DESK's title line. Off,
 * the desk never opens by itself; it still opens from its keys. One key in this browser's storage, `0` for off (missing is
 * on), that follows the account like the site's other settings (`deskAuto` in `../settings/settings-bus.ts`).
 */
export const DESK_AUTO_KEY = 'debaser.desk.auto.v1';

/** The stored text read as the switch: only `0` is off, so a missing or junk value keeps the default, on. */
export function deskAutoFrom(stored: string | null): boolean {
  return stored !== '0';
}

const autoListeners = new Set<() => void>();
/** The switch for this visit only, when this browser's storage can't be written (a private window that refuses it). */
let held: boolean | null = null;

/**
 * Read from storage every time, never cached, so a switch turned in another tab, or the account's choice written in after
 * sign-in, is what the next first visit of the day asks.
 */
export function deskAutoOn(): boolean {
  try {
    const stored = window.localStorage.getItem(DESK_AUTO_KEY);
    return stored === null && held !== null ? held : deskAutoFrom(stored);
  } catch {
    return held ?? true;
  }
}

export const deskAutoServer = (): boolean => true;

export function subscribeToDeskAuto(listener: () => void): () => void {
  autoListeners.add(listener);
  // The account's choice written into this browser after sign-in, and a switch turned in another tab: read the key again.
  const stop = subscribeToAccountSettings(listener);
  const fromTab = (event: StorageEvent) => {
    if (event.key === DESK_AUTO_KEY) listener();
  };
  window.addEventListener('storage', fromTab);
  return () => {
    autoListeners.delete(listener);
    stop();
    window.removeEventListener('storage', fromTab);
  };
}

export function setDeskAuto(on: boolean): void {
  try {
    window.localStorage.setItem(DESK_AUTO_KEY, on ? '1' : '0');
    held = null;
  } catch {
    held = on;
  }
  noteSettingChanged('deskAuto');
  for (const listener of autoListeners) listener();
}
