import { goSiteHistory } from './site-history';
import { watchWindowSlots } from './window-slot';

/**
 * The undo trail: what the top bar's `◄ ►` step through (Luke, 2026-11-14: "make the back button in the top left not only go back
 * on to the last page you were on but act like a general undo button, for every function such as expanding even, with the other
 * button acting in reverse").
 *
 * A step is one press and everything it changed on screen. Recorded, in the order done:
 *   - a page change (the site's own history, as the arrows always walked);
 *   - anything that folds open or shut in place: every key that carries `aria-expanded` and every `<details>`, in any component,
 *     seen by one listener on the document, so no component records anything itself;
 *   - a window opening or closing, through the one store the windows are built on (`./window-slot.ts`).
 * Not recorded: anything that was sent or saved (a post, a message, a reply, a log-in). A form that sends leaves a marker instead,
 * and undoing onto it says CAN'T UNDO: SENT and steps past to the thing before. Typing is the text box's own business (the browser's
 * Ctrl+Z); settings and a panel's own picks are not in the trail (Luke, same day: "Not for now", "Second step").
 *
 * Undo presses the same control again, so a window that asks before it closes still asks, and nothing is set behind a component's
 * back. A control that is no longer on the page, or is already the way undo would leave it, is stepped past, not guessed at. The
 * trail lives in this tab's memory: a reload empties it and the arrows are plain back and forward again.
 *
 * The first half of this file is the trail itself, with no browser in it, so `Temp/check-undo-trail.cjs` can hold its rules.
 */

export type StepResult = 'done' | 'gone';

export type TrailStep = {
  kind: 'page' | 'view' | 'sent';
  /** What undoing it does, in the site's capitals: `CLOSE FILTERS`, `BACK TO MEDIA`. */
  undoWords: string;
  /** What doing it again does: `OPEN FILTERS`, `FORWARD TO FORUM`. */
  redoWords: string;
  undo: () => StepResult;
  redo: () => StepResult;
};

/** What the arrows draw from. Identity-stable between changes. */
export type TrailState = {
  /** Steps that can be undone, sent markers included. */
  steps: number;
  /** The words for the next undo, or null when the next thing down is a sent marker or nothing. */
  undoWords: string | null;
  undoKind: TrailStep['kind'] | null;
  redoWords: string | null;
  redoKind: TrailStep['kind'] | null;
  /** One line to show after a press that met something it could not undo. */
  notice: string | null;
};

export const TRAIL_LIMIT = 100;
export const SENT_NOTICE = "CAN'T UNDO: SENT";
const EMPTY: TrailState = { steps: 0, undoWords: null, undoKind: null, redoWords: null, redoKind: null, notice: null };

export type Trail = {
  state: () => TrailState;
  subscribe: (listener: () => void) => () => void;
  /** A new step: it goes on top, and whatever had been undone can no longer be redone, as in an editor. */
  record: (step: TrailStep) => void;
  /** Undoes the newest step that still can be. True when something was undone. */
  undo: () => boolean;
  redo: () => boolean;
  /** The reader went back a page by some other way (the browser's own key): the trail forgets back through its newest page step. */
  wentBackOutside: () => void;
  clearNotice: () => void;
};

export function createTrail(limit: number = TRAIL_LIMIT): Trail {
  let done: TrailStep[] = [];
  let undone: TrailStep[] = [];
  let notice: string | null = null;
  let snapshot: TrailState = EMPTY;
  const listeners = new Set<() => void>();

  const publish = () => {
    const next = done[done.length - 1];
    const again = undone[undone.length - 1];
    snapshot = {
      steps: done.length,
      undoWords: next === undefined || next.kind === 'sent' ? null : next.undoWords,
      undoKind: next?.kind ?? null,
      redoWords: again?.redoWords ?? null,
      redoKind: again?.kind ?? null,
      notice,
    };
    for (const listener of listeners) listener();
  };

  return {
    state: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    record: (step) => {
      done.push(step);
      if (done.length > limit) done = done.slice(done.length - limit);
      undone = [];
      notice = null;
      publish();
    },
    undo: () => {
      notice = null;
      let undid = false;
      while (done.length > 0 && !undid) {
        const step = done.pop() as TrailStep;
        if (step.kind === 'sent') {
          // Said once, and stepped past: the thing before it is what this press undoes.
          notice = SENT_NOTICE;
          continue;
        }
        if (step.undo() === 'done') {
          undone.push(step);
          undid = true;
        }
      }
      publish();
      return undid;
    },
    redo: () => {
      notice = null;
      let redid = false;
      while (undone.length > 0 && !redid) {
        const step = undone.pop() as TrailStep;
        if (step.redo() === 'done') {
          done.push(step);
          redid = true;
        }
      }
      publish();
      return redid;
    },
    wentBackOutside: () => {
      let at = done.length - 1;
      while (at >= 0 && done[at].kind !== 'page') at -= 1;
      done = at < 0 ? [] : done.slice(0, at);
      undone = [];
      notice = null;
      publish();
    },
    clearNotice: () => {
      if (notice === null) return;
      notice = null;
      publish();
    },
  };
}

/** A control's name for a step, from its label or its words: capitals, letters and digits only, a few words long. */
export function trailWords(text: string, most: number = 24): string {
  const words = text.toUpperCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim().split(' ').filter((word) => word.length > 0);
  let name = '';
  for (const word of words) {
    if (name.length > 0 && name.length + 1 + word.length > most) break;
    name = name.length === 0 ? word.slice(0, most) : `${name} ${word}`;
  }
  return name.length === 0 ? 'THIS' : name;
}

/** A page's name for a step, from its address: `/media?q=x` is MEDIA, `/` is HOME. */
export function pageWords(path: string): string {
  const first = path.split(/[?#]/)[0].split('/').filter((part) => part.length > 0)[0];
  return first === undefined ? 'HOME' : trailWords(decodeURIComponent(first));
}

/* --- the browser's side ----------------------------------------------------------------------------------------- */

const trail = createTrail();

export const subscribeToUndoTrail = trail.subscribe;
export const undoTrailState = trail.state;
export const undoTrailServerState = (): TrailState => EMPTY;

/** Anything that folds open in place: the same things the one "this is open" look reads (globals.css). */
const TOGGLES = 'button[aria-expanded], [role="button"][aria-expanded], summary';
/** A key that is a switch: pressing it again undoes it (the side panel's shelf keys). */
const SWITCHES = 'button[aria-pressed]';
/** Tools that keep an undo of their own are left to it. */
const OWN_UNDO = '.debaser-beatbox, [data-own-undo]';
/** How long after a press its effects are still counted as that press's. */
const PRESS_WINDOW_MS = 400;
/** How long a press is given to finish changing things before its step is written down. */
const SETTLE_MS = 90;

type Part = { kind: 'fold' | 'window'; undoWords: string; redoWords: string; undo: () => StepResult; redo: () => StepResult };
type Gesture = { parts: Part[]; sent: boolean; pending: number; places: [string, number][]; timer: ReturnType<typeof setTimeout> | null };

let started = false;
/** While the trail itself is pressing things, nothing is recorded. */
let replaying = 0;
let gesture: Gesture | null = null;
let lastPress: { target: Element | null; at: number } = { target: null, at: 0 };
let noticeTimer: ReturnType<typeof setTimeout> | null = null;

const isOpen = (control: Element): boolean =>
  control.tagName === 'SUMMARY' ? (control.parentElement as HTMLDetailsElement | null)?.open === true : control.getAttribute('aria-expanded') === 'true';

const nameOf = (control: Element): string => trailWords(control.getAttribute('aria-label') ?? control.textContent ?? '');

/** Where each scrolling pane stood, so undoing a step puts the reader back where they made it. */
function placesNow(): [string, number][] {
  return [...document.querySelectorAll<HTMLElement>('[data-scroll-pane]')].map((pane) => [pane.dataset.scrollPane ?? '', pane.scrollTop]);
}

function restorePlaces(places: [string, number][]): void {
  requestAnimationFrame(() => {
    for (const [name, top] of places) {
      const pane = document.querySelector<HTMLElement>(`[data-scroll-pane="${CSS.escape(name)}"]`);
      if (pane !== null) pane.scrollTop = top;
    }
  });
}

/** Presses made by the trail are not steps: muted while it presses, and for a moment after, while the press settles. */
function whileReplaying(press: () => void): void {
  replaying += 1;
  try {
    press();
  } finally {
    setTimeout(() => {
      replaying -= 1;
    }, PRESS_WINDOW_MS);
  }
}

/** A control found again later: the same element if it is still on the page, else the one that answers to the same description. */
function finder(control: Element, among: string = TOGGLES): () => Element | null {
  // Asked for by name on the global, not as the type, so this file needs nothing newer than the rest of the site to compile;
  // a browser without WeakRef simply keeps hold of the element.
  const Weak = (globalThis as { WeakRef?: new (target: Element) => { deref: () => Element | undefined } }).WeakRef;
  const ref = Weak === undefined ? { deref: (): Element | undefined => control } : new Weak(control);
  const id = control.id;
  const controls = control.getAttribute('aria-controls') ?? '';
  const tag = control.tagName;
  const name = nameOf(control);
  const alike = () => [...document.querySelectorAll(among)].filter((other) => other.tagName === tag && nameOf(other) === name);
  const nth = alike().indexOf(control);
  return () => {
    const same = ref.deref();
    if (same !== undefined && same.isConnected) return same;
    if (id.length > 0) return document.getElementById(id);
    if (controls.length > 0) return document.querySelector(`[aria-controls="${CSS.escape(controls)}"]`);
    return alike()[nth] ?? null;
  };
}

function togglePart(control: Element, wasOpen: boolean): Part {
  const find = finder(control);
  const name = nameOf(control);
  const set = (open: boolean): StepResult => {
    const found = find();
    // Gone from the page, or already the way this would leave it: stepped past.
    if (!(found instanceof HTMLElement) || isOpen(found) === open) return 'gone';
    whileReplaying(() => found.click());
    return 'done';
  };
  const [shut, opened] = [`CLOSE ${name}`, `OPEN ${name}`];
  return { kind: 'fold', undoWords: wasOpen ? opened : shut, redoWords: wasOpen ? shut : opened, undo: () => set(wasOpen), redo: () => set(!wasOpen) };
}

/** Writes a finished press down as one step. */
function writeDown(mine: Gesture): void {
  if (mine.sent) {
    trail.record({ kind: 'sent', undoWords: SENT_NOTICE, redoWords: SENT_NOTICE, undo: () => 'gone', redo: () => 'gone' });
    return;
  }
  // A press that folded something open and opened a window through it is undone by pressing the fold again: the window follows
  // its own control, and is not also written back from here.
  const folds = mine.parts.filter((part) => part.kind === 'fold');
  const parts = folds.length > 0 ? folds : mine.parts;
  if (parts.length === 0) return;
  const each = (run: (part: Part) => StepResult, order: Part[]): StepResult => {
    const results = order.map(run);
    restorePlaces(mine.places);
    return results.includes('done') ? 'done' : 'gone';
  };
  trail.record({
    kind: 'view',
    undoWords: parts[0].undoWords,
    redoWords: parts[0].redoWords,
    undo: () => each((part) => part.undo(), [...parts].reverse()),
    redo: () => each((part) => part.redo(), parts),
  });
}

function settle(mine: Gesture): void {
  if (mine.timer !== null) clearTimeout(mine.timer);
  mine.timer = setTimeout(() => {
    // A fold pressed but not yet read back (a slow frame): the press is given longer, so it stays one step.
    if (mine.pending > 0) {
      settle(mine);
      return;
    }
    if (gesture === mine) gesture = null;
    writeDown(mine);
  }, SETTLE_MS);
}

function gestureNow(): Gesture {
  gesture ??= { parts: [], sent: false, pending: 0, places: placesNow(), timer: null };
  settle(gesture);
  return gesture;
}

const pressed = (event: Event) => {
  lastPress = { target: event.target instanceof Element ? event.target : null, at: Date.now() };
};

function onClick(event: MouseEvent): void {
  pressed(event);
  if (replaying > 0 || !(event.target instanceof Element)) return;
  const control = event.target.closest(TOGGLES);
  if (control === null || control.closest(OWN_UNDO) !== null || control.closest('[data-undo-arrow]') !== null) return;
  // A key that sends is never pressed again by the trail, whatever else it folds.
  if (control.matches('[type="submit"]')) return;
  const before = isOpen(control);
  const find = finder(control);
  const mine = gestureNow();
  mine.pending += 1;
  // Asked once the press has done its work: React has drawn, and a <details> has flipped.
  requestAnimationFrame(() =>
    setTimeout(() => {
      mine.pending -= 1;
      const after = find();
      if (replaying > 0 || after === null || isOpen(after) === before) return;
      mine.parts.push(togglePart(after, before));
    }, 0),
  );
}

/** A form that sends: one whose key is the screen's main action, or that carries writing. A search box's form is not one. */
function onSubmit(event: SubmitEvent): void {
  if (replaying > 0 || !(event.target instanceof HTMLFormElement)) return;
  const form = event.target;
  const main = event.submitter instanceof HTMLElement && event.submitter.classList.contains('key-fill');
  if (form.getAttribute('role') === 'search' || (!main && form.querySelector('textarea, [contenteditable="true"]') === null)) return;
  gestureNow().sent = true;
}

function typingIn(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || target.closest('input, textarea, select, [contenteditable="true"]') !== null);
}

/** Ctrl+Z and Ctrl+Y (Luke, 2026-11-14: "Yes, keys too"), when not typing in a box and no tool on the page has taken the key for itself. */
function onKeyDown(event: KeyboardEvent): void {
  pressed(event);
  if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
  const key = event.key.toLowerCase();
  const way = key === 'z' ? (event.shiftKey ? 'redo' : 'undo') : key === 'y' ? 'redo' : null;
  if (way === null || typingIn(event.target)) return;
  // Asked a moment later, so a tool with its own undo, wherever it listens, has had the chance to claim the key first.
  setTimeout(() => {
    if (event.defaultPrevented || document.querySelector(OWN_UNDO) !== null) return;
    if (way === 'undo') undoStep();
    else redoStep();
  }, 0);
}

/** Whether a window's state is about a stream room (`../watch/watch-window.ts` keeps the room in `focus`). */
function inRoom(state: unknown): boolean {
  const focus = (state as { focus?: unknown } | null)?.focus;
  return typeof focus === 'object' && focus !== null && 'roomId' in focus;
}

const openOf = (state: unknown): boolean | null => {
  const open = (state as { open?: unknown } | null)?.open;
  return typeof open === 'boolean' ? open : null;
};

/**
 * A window's store changed (`./window-slot.ts`). Counted only when it is the window opening or closing, and only as part of a press
 * just made: a window that an address opens belongs to that page change.
 *
 * Undoing goes through the window's own controls wherever it has them, so the window's own opening and closing run (an address
 * spent, a question asked): the switch that was pressed is pressed again, or the window's own close key. Only bringing back a
 * window that was closed by its own key writes the store, with the state it had as it closed. Whatever the store holds by then is
 * looked at first: a window already the way the step would leave it, or one that has since become a stream room, is stepped past.
 */
export function windowSlotChanged(before: unknown, after: unknown, current: () => unknown, restore: (state: unknown) => void): void {
  if (!started || replaying > 0 || Date.now() - lastPress.at > PRESS_WINDOW_MS) return;
  const [wasOpen, nowOpen] = [openOf(before), openOf(after)];
  if (wasOpen === null || nowOpen === null || wasOpen === nowOpen) return;
  // A stream room's window is not a view: leaving it and coming back is seen by the other people in the room, so the arrows
  // leave it alone (the same line as anything sent: never put back behind the reader's back).
  if (inRoom(before) || inRoom(after)) return;
  const from = lastPress.target;
  const frame = from?.closest('[data-dock-window]') ?? null;
  const frameId = frame?.getAttribute('data-dock-window') ?? null;
  const key = from?.closest('button, a') ?? null;
  const findSwitch = frame === null && key !== null && key.matches(SWITCHES) ? finder(key, SWITCHES) : null;
  const name = trailWords(frame?.getAttribute('aria-label') ?? key?.getAttribute('aria-label') ?? key?.textContent ?? 'WINDOW');
  const set = (target: unknown): StepResult => {
    const now = current();
    const wantOpen = openOf(target);
    if (wantOpen === null || openOf(now) === null || openOf(now) === wantOpen || inRoom(now)) return 'gone';
    const again = findSwitch?.() ?? null;
    const close = wantOpen || frameId === null ? null : document.querySelector<HTMLElement>(`[data-dock-window="${CSS.escape(frameId)}"] button[aria-label^="Close"]`);
    if (again instanceof HTMLElement) whileReplaying(() => again.click());
    else if (close !== null) whileReplaying(() => close.click());
    else whileReplaying(() => restore(target));
    return 'done';
  };
  const [shut, opened] = [`CLOSE ${name}`, `OPEN ${name}`];
  gestureNow().parts.push({ kind: 'window', undoWords: wasOpen ? opened : shut, redoWords: wasOpen ? shut : opened, undo: () => set(before), redo: () => set(after) });
}

/* Pages: the site's own entries (`./site-history.ts`). A step forward is recorded; the trail's own trips are not. */
type NavigationEntries = {
  currentEntry: { index: number } | null;
  entries: () => unknown[];
  addEventListener: (type: 'currententrychange', listener: () => void) => void;
};
const navigationNow = (): NavigationEntries | null => (window as unknown as { navigation?: NavigationEntries }).navigation ?? null;
const pathNow = () => `${window.location.pathname}${window.location.search}`;
let lastIndex = -1;
let lastPath = '';
let ownTrip = false;

function pageStep(from: string, to: string): TrailStep {
  const go = (step: -1 | 1): StepResult => {
    const navigation = navigationNow();
    // Nowhere to go that way (the entry has gone): stepped past, and nothing is waited for.
    if (navigation === null || navigation.entries()[(navigation.currentEntry?.index ?? -1) + step] === undefined) return 'gone';
    ownTrip = true;
    // If the trip is refused all the same, the next real change must still be seen.
    setTimeout(() => {
      ownTrip = false;
    }, 1500);
    goSiteHistory(step);
    return 'done';
  };
  return { kind: 'page', undoWords: `BACK TO ${pageWords(from)}`, redoWords: `FORWARD TO ${pageWords(to)}`, undo: () => go(-1), redo: () => go(1) };
}

function onEntryChange(): void {
  const index = navigationNow()?.currentEntry?.index ?? -1;
  const path = pathNow();
  const [was, from] = [lastIndex, lastPath];
  lastIndex = index;
  lastPath = path;
  if (ownTrip) {
    ownTrip = false;
    return;
  }
  // A new entry is a step. The same entry with a new address is a window's query being spent, not a page change. An entry
  // further back, reached some other way (the browser's own key), means the trail's newer steps no longer follow from here.
  if (index > was && was >= 0 && path !== from) trail.record(pageStep(from, path));
  else if (index < was) trail.wentBackOutside();
}

function showNoticeBriefly(): void {
  if (noticeTimer !== null) clearTimeout(noticeTimer);
  if (trail.state().notice !== null) noticeTimer = setTimeout(() => trail.clearNotice(), 4000);
}

export function undoStep(): boolean {
  const undid = trail.undo();
  showNoticeBriefly();
  return undid;
}

export function redoStep(): boolean {
  const redid = trail.redo();
  showNoticeBriefly();
  return redid;
}

/**
 * Starts the listening, once, for the life of the tab: the arrows are redrawn with every page, and a page change made while
 * none is on screen is still a step.
 */
export function startUndoTrail(): void {
  if (started || typeof window === 'undefined') return;
  started = true;
  lastIndex = navigationNow()?.currentEntry?.index ?? -1;
  lastPath = pathNow();
  document.addEventListener('pointerdown', pressed, true);
  document.addEventListener('click', onClick, true);
  document.addEventListener('submit', onSubmit, true);
  window.addEventListener('keydown', onKeyDown);
  navigationNow()?.addEventListener('currententrychange', onEntryChange);
  watchWindowSlots(windowSlotChanged);
}
