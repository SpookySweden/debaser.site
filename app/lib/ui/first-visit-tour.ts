/**
 * FIRSTVISIT (Luke, 2026-11-20: "Gentler first visits: replace the full-page 'HAD AN ACCOUNT?' pop-up with a short guided
 * tour of the desktop"). His answers: both a signed-out visitor's first visit and a brand-new account (after its PRIVACY
 * window); seven steps; "entirely visual tour with text" (the real thing outlined on screen, a few words beside it); every
 * step can SKIP, and a TOUR key in MODULOS plays it again.
 *
 * Everyone, once more (Luke, 2026-11-20, the same day: "make it so the tutorial plays for any user who returns to the site again
 * for the first time starting now"): the key went to `.v2` and its name in the account's saved settings to `tour2`, so no
 * mark from before counts, in a browser or on an account, and no database row had to change. Every reader not toured under
 * v2 is toured once on the board, signed in or not; a new account's PRIVACY window holds it until it closes (`holdTour`).
 *
 * What this browser said, one key in its storage that follows the account (`settings-bus.ts`, `tour2`), so an account that
 * finished on one computer is not toured on the next:
 *   (none)               not toured since v2: toured on the board;
 *   'done' / 'skipped'   never again, unless replayed.
 * Kept free of React and the database: the check compiles it on its own.
 */

import { noteSettingChanged, subscribeToAccountSettings } from '../settings/settings-bus';

/** `.v1` (the first day's marks) no longer counts: Luke's "everyone once more". A later "again" is `.v3` here and a new synced name. */
export const TOUR_KEY = 'debaser.tour.v2';

export type TourSaid = 'done' | 'skipped' | null;

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
  { id: 'modulos', target: '[data-tour="modulos"]', title: 'MODULOS', line: 'PICK THE PAGES ON YOUR BAR.' },
  { id: 'shelf', target: '[data-tour="shelf"]', title: 'THE SHELF', line: 'WINDOWS: MUSIC, QUEUE, HISTORY.' },
  // DESK after the shelf since 2026-11-21: its key is the shelf's last, above the bell (it was on the top bar).
  { id: 'desk', target: '[data-desk-key]', title: 'DESK', line: 'WHAT IS WAITING FOR YOU.', who: 'account' },
  { id: 'music', target: '[data-tour="music"]', title: 'THE MUSIC BAR', line: 'WHAT PLAYS FOLLOWS YOU ROUND THE SITE.' },
];

/** The steps for this reader, leaving out any whose thing is not on screen (`shown` says). Pure. */
export function stepsFor(signedIn: boolean, shown: (target: string) => boolean): TourStep[] {
  return TOUR_STEPS.filter((step) => (step.who === undefined || step.who === (signedIn ? 'account' : 'visitor')) && shown(step.target));
}

/** Whether the tour plays now: on the board, nothing holding it, and replayed or not yet toured since v2. Pure. */
export function tourOwed(input: { said: TourSaid; held: boolean; replaying: boolean; path: string | null }): boolean {
  if (input.path !== TOUR_PAGE || input.held) return false;
  return input.replaying || input.said === null;
}

export function parseTourSaid(raw: string | null): TourSaid {
  return raw === 'done' || raw === 'skipped' ? raw : null;
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
    noteSettingChanged('tour2');
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

/** An automated browser's way in: the tour drive (scripts/drive-first-visit.cjs) and `npm run shot -- --tour` set it. */
export const TOUR_DRIVE_KEY = 'debaser.tour.drive';

/**
 * A browser driven by a script (drives, checks, screenshots: `navigator.webdriver`) is not toured unless it asks, so the
 * tour never holds the board in front of a test that is about something else. A person's browser never says webdriver.
 */
export function automatedWithoutTour(): boolean {
  try {
    return window.navigator.webdriver === true && window.localStorage.getItem(TOUR_DRIVE_KEY) === null;
  } catch {
    return false;
  }
}

/** Windows that come first (a new account's PRIVACY window) hold the tour while they are open. */
let holds = 0;

export const tourHeld = (): boolean => holds > 0;
export const serverTourHeld = (): boolean => false;

/** Hold the tour; the returned function lets it go. */
export function holdTour(): () => void {
  holds += 1;
  tell();
  return () => {
    holds -= 1;
    tell();
  };
}
