/**
 * FIRSTVISIT (Luke, 2026-11-20: "Gentler first visits: replace the full-page 'HAD AN ACCOUNT?' pop-up with a short guided
 * tour of the desktop"). His answers: both a signed-out visitor's first visit and a brand-new account (after its PRIVACY
 * window); seven steps; "entirely visual tour with text" (the real thing outlined on screen, a few words beside it); every
 * step can SKIP, and a TOUR key in MODULOS plays it again.
 *
 * What this browser said, one key in its storage that follows the account (`settings-bus.ts`, `tour`), so an account that
 * finished on one computer is not toured on the next:
 *   (none)       never toured: a signed-out visitor is toured on the board;
 *   'due:<id>'   that new account owes the tour (set when its PRIVACY window closes, only if nothing was said before). It
 *                names the account, so a leftover in a shared browser never tours somebody else who signs in there;
 *   'done' / 'skipped'   never again, unless replayed.
 * An account that never saw PRIVACY before (one made before it existed) counts as new here: it is toured once too.
 * Kept free of React and the database: the check compiles it on its own.
 */

import { noteSettingChanged, subscribeToAccountSettings } from '../settings/settings-bus';

export const TOUR_KEY = 'debaser.tour.v1';

export type TourSaid = `due:${string}` | 'done' | 'skipped' | null;

/** The one page the tour plays on: the board is the desktop. */
export const TOUR_PAGE = '/forum';

export type TourStep = {
  id: string;
  /** What is outlined: the first visible match. A step whose thing is not on screen is left out. */
  target: string;
  title: string;
  line: string;
  /** Only for one kind of reader: the visitor's LOG IN, the account's DESK. */
  who?: 'visitor' | 'account';
};

/** The seven steps (Luke's C), in the order the eye meets them. Words kept to a few: the outline does the showing. */
export const TOUR_STEPS: readonly TourStep[] = [
  { id: 'board', target: '[data-tour="board"]', title: 'THE BOARD', line: 'THE DESKTOP. POSTS, PICTURES AND STREAMS.' },
  { id: 'modules', target: 'nav[aria-label="Modules"]', title: 'THE BAR', line: 'EACH WORD IS A PAGE: MEDIA, STREAM...' },
  { id: 'search', target: '[data-search-key]', title: '⌕ SEARCH', line: 'THE WHOLE SITE. CTRL+K.' },
  { id: 'login', target: '[data-tour="login"]', title: 'LOG IN', line: 'TO POST, TALK AND KEEP THINGS.', who: 'visitor' },
  { id: 'desk', target: '[data-desk-key]', title: 'DESK', line: 'WHAT IS WAITING FOR YOU.', who: 'account' },
  { id: 'modulos', target: '[data-tour="modulos"]', title: 'MODULOS', line: 'PICK THE PAGES ON YOUR BAR.' },
  { id: 'shelf', target: '[data-tour="shelf"]', title: 'THE SHELF', line: 'WINDOWS: MUSIC, QUEUE, HISTORY.' },
  { id: 'music', target: '[data-tour="music"]', title: 'THE MUSIC BAR', line: 'WHAT PLAYS FOLLOWS YOU ROUND THE SITE.' },
];

/** The steps for this reader, leaving out any whose thing is not on screen (`shown` says). Pure. */
export function stepsFor(signedIn: boolean, shown: (target: string) => boolean): TourStep[] {
  return TOUR_STEPS.filter((step) => (step.who === undefined || step.who === (signedIn ? 'account' : 'visitor')) && shown(step.target));
}

/** Whether the tour plays now. `userId` is the signed-in account, or null for a visitor. Pure. */
export function tourOwed(input: { said: TourSaid; userId: string | null; replaying: boolean; path: string | null }): boolean {
  if (input.path !== TOUR_PAGE) return false;
  if (input.replaying) return true;
  return input.userId === null ? input.said === null : input.said === `due:${input.userId}`;
}

export function parseTourSaid(raw: string | null): TourSaid {
  if (raw === 'done' || raw === 'skipped') return raw;
  return raw !== null && raw.startsWith('due:') && raw.length > 4 ? (raw as `due:${string}`) : null;
}

const listeners = new Set<() => void>();
const tell = () => listeners.forEach((listener) => listener());

/** Hears this file's changes and the account's choices arriving in this browser's storage after a sign-in. */
export function subscribeToTour(listener: () => void): () => void {
  listeners.add(listener);
  const unsubscribeAccount = subscribeToAccountSettings(listener);
  return () => {
    listeners.delete(listener);
    unsubscribeAccount();
  };
}

/** What this browser said. A browser whose storage refuses reads is treated as toured: nothing nags it on every page. */
export function readTourSaid(): TourSaid {
  try {
    return parseTourSaid(window.localStorage.getItem(TOUR_KEY));
  } catch {
    return 'done';
  }
}

export const serverTourSaid = (): TourSaid => 'done';

function writeTourSaid(said: Exclude<TourSaid, null>): void {
  try {
    window.localStorage.setItem(TOUR_KEY, said);
    noteSettingChanged('tour');
  } catch {
    // No storage: the tour still ends for this page (`replaying` and the component's own state).
  }
  tell();
}

/** Played by the MODULOS window's TOUR key; not stored, so a reload ends it. */
let replaying = false;

export const tourReplaying = (): boolean => replaying;
export const serverTourReplaying = (): boolean => false;

export function replayTour(): void {
  replaying = true;
  tell();
}

/** Finished (DONE) or skipped (SKIP, Esc): never again in this browser or account, unless replayed. */
export function endTour(how: 'done' | 'skipped'): void {
  replaying = false;
  writeTourSaid(how);
}

/** A new account's PRIVACY window closed: it owes the tour, unless this browser already saw or skipped it. */
export function owedAfterPrivacy(userId: string): void {
  if (readTourSaid() === null) writeTourSaid(`due:${userId}`);
}
