import { createWindowSlot } from './window-slot';

/**
 * The one video playing on the site, outside React (SPEC-floating-player.md).
 *
 * A cross-origin iframe restarts if it moves in the page, so a video is never drawn in its row. It lives in one layer
 * in `layout.tsx` (`FloatingPlayer.tsx`) that outlives every page. A row keeps a reserved box (`PlayerBox.tsx`), and the
 * layer sits exactly over the box while it is on screen, or floats in a corner when the box goes away, scrolls out of
 * view or the reader presses `[ PIP ]`. Only the layer's position changes; the iframe stays the same element with the
 * same address, which is what "never reloaded" means. A second PLAY replaces the video.
 *
 * Module state rather than a context, for the reason `window-slot.ts` gives: a row asks one question of it, and playing
 * a video must not re-render the page. Nothing here is sent anywhere or kept past the visit.
 */

/** A platform's own player, in a frame. `timeFrom`: the player that tells us where it is (`app/lib/web/embed-time.ts`). */
export type FramePlayer = {
  kind: 'frame';
  src: string;
  frameTitle: string;
  referrerPolicy: 'no-referrer' | 'strict-origin';
  /** Undefined only for a media server marked `unsandboxed` (media-servers.ts). */
  sandbox: string | undefined;
  allow: string;
  allowFullScreen: boolean;
  timeFrom: 'youtube' | 'vimeo' | null;
};

/** One of the site's own files, in a plain `<video>`: what was uploaded is what plays. */
export type FilePlayer = { kind: 'file'; src: string };

export type FloatingEntry = {
  /** Which row it belongs to: the same id finds its box again when the row comes back. */
  id: string;
  /** Bumped by every PLAY, so the same row played again gets a new element and anything else keeps the old one. */
  play: number;
  player: FramePlayer | FilePlayer;
  title: string;
  /** An audio player's frame is one strip high (`h-[44px]`), so its float is too. */
  shape: 'video' | 'audio';
  /** The address it was started on: the float's `[ BACK ]` goes there. */
  home: string;
  /** What the row had picked (a media server, a season), for drawing itself again when it comes back. */
  details?: unknown;
};

export type FloatingState = {
  entry: FloatingEntry | null;
  /** The reader pressed `[ PIP ]`: it floats even with its box in view. */
  asked: boolean;
  /** Where the layer is now, worked out each frame (`shouldFloat`). */
  floating: boolean;
};

const EMPTY: FloatingState = { entry: null, asked: false, floating: false };
const slot = createWindowSlot<FloatingState>(EMPTY);

export const floatingState = slot.state;
export const subscribeToFloating = slot.subscribe;

let plays = 0;
/** Each row's box. A row that is not on the page has none, and its video floats. */
const boxes = new Map<string, HTMLElement>();
/** Show the box when it next arrives: just pressed PLAY, or `[ BACK ]` from another page. */
let revealWanted = false;
/** The video was in its box when its row left the page, so it goes back there in view. */
let leftInBox = false;
/** That box, back on the page: put ahead of a saved scroll position, because MEDIA's rows can come back in another order. */
let kept: HTMLElement | null = null;
/** How far each video got this visit, for a row that plays it again. Memory only: never stored, never sent. */
const places = new Map<string, number>();

/** Starts a video, replacing whatever was playing. Asked for by the reader's own press of PLAY, always. */
export function playFloating(next: Omit<FloatingEntry, 'play' | 'home'>): void {
  plays += 1;
  leftInBox = false;
  kept = null;
  const home = typeof window === 'undefined' ? '/' : `${window.location.pathname}${window.location.search}`;
  slot.set({ entry: { ...next, play: plays, home }, asked: false, floating: false });
  const box = boxes.get(next.id);
  if (box === undefined) revealWanted = true;
  else box.scrollIntoView({ block: 'nearest' });
}

/** How many videos have been started: an answer that arrives later than a newer PLAY can tell, and drop itself. */
export function playCount(): number {
  return plays;
}

/** The layer's one player, for the keys that put it in fullscreen. */
let playerElement: HTMLElement | null = null;

export function notePlayerElement(element: HTMLElement | null): void {
  playerElement = element;
}

/**
 * Fullscreen, or back. The player goes into the browser's top layer where it stands, so it is not moved and never reloads,
 * and a float comes back exactly as it was.
 */
export function togglePlayerFullscreen(): void {
  if (document.fullscreenElement !== null) {
    void document.exitFullscreen().catch(() => undefined);
    return;
  }
  void playerElement?.requestFullscreen().catch(() => undefined);
}

/** Stops the video. Its place stays for the visit; `places` was kept up as it played. */
export function closeFloating(): void {
  revealWanted = false;
  leftInBox = false;
  kept = null;
  if (slot.state().entry !== null) slot.set(EMPTY);
}

/** Closes it only if this row's: a row switching server stops its own video, never another row's. */
export function closeFloatingIfMine(id: string): void {
  if (slot.state().entry?.id === id) closeFloating();
}

/** `[ PIP ]`: float, or back into the box. */
export function setFloatAsked(asked: boolean): void {
  const state = slot.state();
  if (state.entry !== null && state.asked !== asked) slot.set({ ...state, asked });
}

/** Written by the layer when its position changes, so the row's box can show the way back. */
export function noteFloating(floating: boolean): void {
  const state = slot.state();
  if (state.floating !== floating) slot.set({ ...state, floating });
}

/** The float's `[ BACK ]` from another page: once the row is back, show it. */
export function wantBoxShown(): void {
  revealWanted = true;
  setFloatAsked(false);
}

/**
 * A row's reserved box, while it is on the page. Arriving back on the page ends a `[ PIP ]`: "coming back to the page
 * puts it back in its box" (the spec). Returns the way to take it away.
 */
export function registerBox(id: string, element: HTMLElement): () => void {
  boxes.set(id, element);
  if (slot.state().entry?.id === id) {
    setFloatAsked(false);
    if (leftInBox) kept = element;
    if (revealWanted || leftInBox) element.scrollIntoView({ block: 'nearest' });
    revealWanted = false;
    leftInBox = false;
  }
  return () => {
    if (boxes.get(id) !== element) return;
    boxes.delete(id);
    if (kept === element) kept = null;
    const state = slot.state();
    if (state.entry?.id === id && !state.floating) leftInBox = true;
  };
}

export function boxOf(id: string): HTMLElement | undefined {
  return boxes.get(id);
}

/** The box a video came back to, while the page is being put back as it was. */
export function keptBox(): HTMLElement | null {
  return kept;
}

/** The page is settled, or the reader has done something: from here the box goes wherever the page takes it. */
export function letKeptBoxGo(): void {
  kept = null;
}

/** Where this row's video had got to, or null. Only players that report their time ever have one. */
export function placeOf(id: string): number | null {
  return places.get(id) ?? null;
}

/** Kept up as a video plays; null when it finished, so playing it again starts it again. */
export function notePlace(id: string, seconds: number | null): void {
  if (seconds === null) places.delete(id);
  else if (Number.isFinite(seconds) && seconds >= 0) places.set(id, seconds);
}
