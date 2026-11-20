import type { AppNotification } from './types';

/**
 * The balloon's rules (SPEC-notifications.md, answer 4A), as a plain function so a check can hold them.
 *
 * - The feed's first answer after sign-in is history: nothing in it pops up.
 * - After that, a row is balloon news once: when it first arrives unread, while the page is being looked at.
 *   A row that arrives while the tab is hidden is waiting on the bell instead, never a stale balloon later.
 * - Newest first, one at a time; the rest read `+N MORE`. A row read elsewhere meanwhile leaves the queue.
 */
export type BalloonState = { primed: boolean; seen: ReadonlySet<string>; queue: readonly string[] };

export const BALLOON_START: BalloonState = { primed: false, seen: new Set(), queue: [] };

/** How long a balloon stays, unless the pointer is on it. */
export const BALLOON_MS = 6_000;

export function balloonStep(state: BalloonState, items: readonly AppNotification[], visible: boolean, enabled: boolean): BalloonState {
  const seen = new Set(state.seen);
  const arrived: string[] = [];
  for (const item of items) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    if (state.primed && visible && enabled && item.readAt === null) arrived.push(item.id);
  }

  const unread = new Set(items.filter((item) => item.readAt === null).map((item) => item.id));
  const queue = [...arrived, ...state.queue.filter((id) => !arrived.includes(id))].filter((id) => enabled && unread.has(id));

  return { primed: true, seen, queue };
}

/** The balloon showing now, and how many wait behind it. */
export function balloonNow(state: BalloonState, items: readonly AppNotification[]): { item: AppNotification | null; more: number } {
  const first = state.queue[0];
  const item = first === undefined ? null : (items.find((one) => one.id === first) ?? null);
  return { item, more: Math.max(0, state.queue.length - 1) };
}

/** The shown balloon is closed or opened: the next one (if any) takes its place. */
export function balloonDismiss(state: BalloonState): BalloonState {
  return { ...state, queue: state.queue.slice(1) };
}

/** `+2 MORE` opens the bell's menu, which shows them all: the queue is spent. */
export function balloonClear(state: BalloonState): BalloonState {
  return { ...state, queue: [] };
}
