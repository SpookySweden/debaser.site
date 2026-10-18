/**
 * Where the docked windows sit on a desktop: their boxes, their groups, their stacking - and the rules
 * that move them.
 *
 * Every `DockWindow` reads its own entry out of this one module-level store with
 * `useSyncExternalStore`, the arrangement `window-slot.ts` explains: a window being dragged re-renders
 * the windows that moved and nothing else, and above all not the board underneath. Nothing here is a
 * React context.
 *
 * **Desktop only.** Below the `sm` breakpoint the windows are bottom sheets and none of this applies;
 * `DockWindow` does not even ask. A saved layout is never read on a phone.
 *
 * The behaviour, in the order SPEC-windows.md lists it:
 *
 *   SNAP     while a window (or its group) is dragged, an edge within `SNAP` px of another window's edge
 *            jumps flush to it, and tops and sides line up. Only other windows attract; the screen edges
 *            do not, and there are no half-screen zones.
 *   GROUP    dropped flush against another window, the two become a group: one `group` id on both. A
 *            group moves as one and comes to the front as one.
 *   SHAKE    side to side while dragging, fast enough (`isShake`), and the dragged window leaves its group
 *            and carries on alone. `detachWindow` is the same thing from a key, for a hand that cannot
 *            shake a mouse.
 *   RESIZE   any edge or corner. An edge shared with neighbours in the group is a *splitter*: moving it
 *            grows one side and shrinks the other, so the group stays flush with no gap and no overlap,
 *            and it stops at the first window's minimum.
 *   MAXIMISE fills the area under the top bar; the second press puts it back - into its group, if it is
 *            still flush with it.
 *   REMEMBER one layout per screen shape (`bucketFor`), handed to the saver at most once a second, after a
 *            drag or resize finishes rather than on every pixel.
 *
 * The geometry is exported as plain functions so a check can hold it without a browser.
 */

export type WindowRect = { x: number; y: number; w: number; h: number };
export type WindowSize = { w: number; h: number };

/** Screen shapes, by width ÷ height. Each keeps its own layout. */
export type ScreenBucket = 'tall' | 'standard' | 'wide';

/** What a window says about itself when it opens. */
export type WindowSpec = {
  /** Below this the window's contents break, so a resize stops here. */
  min: WindowSize;
  /** Its size before anybody has touched it. Clipped to the screen. */
  size: WindowSize;
  /** Which corner it starts in: the upper right, or the lower right over the player bar. */
  dock: 'top' | 'bottom';
};

/** One window, as stored: enough to put it back. */
export type SavedWindow = {
  rect: WindowRect;
  group: string | null;
  open: boolean;
  /** Set while maximised: where it was, and which group it was in. */
  restore: { rect: WindowRect; group: string | null } | null;
};

/** One screen shape's layout. `screen` is the viewport it was saved on, which `fitLayout` reads. */
export type SavedBucket = {
  screen: WindowSize;
  windows: Record<string, SavedWindow>;
  /** Back to front. */
  order: string[];
};

/** Everything one person (or one guest browser) has saved: one layout per screen shape. */
export type SavedLayouts = Partial<Record<ScreenBucket, SavedBucket>>;

/** A window as `DockWindow` draws it. Identity-stable between writes that do not touch it. */
export type LiveWindow = SavedWindow & {
  /** Stacking order above the base: 0 is the back. */
  z: number;
  /** In a group with at least one other *open* window - which is what lights the detach key. */
  grouped: boolean;
  /** Bumped when it detaches, so the frame can flicker once. */
  flash: number;
};

type LayoutState = {
  /** False until the saved layouts have been read (or have failed to be). Windows wait for it. */
  ready: boolean;
  bucket: ScreenBucket;
  viewport: WindowSize;
  /** Where the usable area starts: the bottom of the guest strip, or 0. */
  top: number;
  windows: Record<string, LiveWindow>;
};

/* -------------------------------------------------------------------------------------------------
 * Numbers worth tuning
 * ---------------------------------------------------------------------------------------------- */

/** How close, in px, an edge has to come before it jumps flush. */
export const SNAP = 10;
/** The title bar's height: the part of a window that must stay on screen. */
export const TITLE_BAR = 28;
/** Two edges this close count as touching. Positions are whole pixels, so this is only rounding. */
const TOUCH = 1;
/**
 * A shake: this many changes of direction, each after a swing of at least `SHAKE_SWING` px, all inside
 * `SHAKE_WINDOW` ms. Four turns in 0.7s is two full wiggles - a straight drag, however fast, never turns
 * at all, so it never trips it. It was 0.5s, which a quick deliberate shake could miss (measured: a
 * six-swing shake takes 350-400ms of pointer events, and a busy machine stretched it past the limit), and
 * which the spec already warned would be awkward on a trackpad.
 */
export const SHAKE_TURNS = 4;
export const SHAKE_SWING = 14;
export const SHAKE_WINDOW = 700;
/** The `sm` breakpoint: narrower than this is a phone, and has no layout. */
export const PHONE_BELOW = 640;
/** The least time between two saves. */
export const SAVE_EVERY = 1000;

/** Width ÷ height: below 1.45 is tall/square (4:3, 5:4), up to 1.95 is standard (16:10, 16:9), above is wide. */
export function bucketFor(width: number, height: number): ScreenBucket {
  const ratio = width / Math.max(1, height);
  if (ratio < 1.45) return 'tall';
  if (ratio < 1.95) return 'standard';
  return 'wide';
}

/* -------------------------------------------------------------------------------------------------
 * Geometry
 * ---------------------------------------------------------------------------------------------- */

function overlaps(a0: number, a1: number, b0: number, b1: number): boolean {
  return a0 < b1 - TOUCH && b0 < a1 - TOUCH;
}

/** Edge to edge, with some length of the edge actually shared - a corner touching a corner is not flush. */
export function areFlush(a: WindowRect, b: WindowRect): boolean {
  const sideBySide =
    (Math.abs(a.x + a.w - b.x) <= TOUCH || Math.abs(b.x + b.w - a.x) <= TOUCH) && overlaps(a.y, a.y + a.h, b.y, b.y + b.h);
  const stacked =
    (Math.abs(a.y + a.h - b.y) <= TOUCH || Math.abs(b.y + b.h - a.y) <= TOUCH) && overlaps(a.x, a.x + a.w, b.x, b.x + b.w);

  return sideBySide || stacked;
}

/**
 * The nudge that makes a dragged set of windows snap, given how far the pointer moved them.
 *
 * Each axis is settled on its own: the nearest candidate within `SNAP` wins, and none means the drag is
 * left alone. On the x axis a candidate is either *flush* (my left to your right, my right to your left,
 * when we share some height) or *aligned* (left to left, right to right, when one of us sits on top of the
 * other). The y axis is the same turned through ninety degrees.
 */
export function snapOffset(moving: WindowRect[], others: WindowRect[], dx: number, dy: number): { dx: number; dy: number } {
  let bestX: number | null = null;
  let bestY: number | null = null;
  const consider = (best: number | null, candidate: number) =>
    Math.abs(candidate) <= SNAP && (best === null || Math.abs(candidate) < Math.abs(best)) ? candidate : best;

  for (const start of moving) {
    const m = { x: start.x + dx, y: start.y + dy, w: start.w, h: start.h };

    for (const o of others) {
      const shareHeight = m.y < o.y + o.h && o.y < m.y + m.h;
      const shareWidth = m.x < o.x + o.w && o.x < m.x + m.w;
      const nearVertically = Math.abs(m.y - (o.y + o.h)) <= SNAP || Math.abs(o.y - (m.y + m.h)) <= SNAP;
      const nearHorizontally = Math.abs(m.x - (o.x + o.w)) <= SNAP || Math.abs(o.x - (m.x + m.w)) <= SNAP;

      if (shareHeight) {
        bestX = consider(bestX, o.x + o.w - m.x);
        bestX = consider(bestX, o.x - (m.x + m.w));
      }
      if (nearVertically && (shareWidth || nearHorizontally)) {
        bestX = consider(bestX, o.x - m.x);
        bestX = consider(bestX, o.x + o.w - (m.x + m.w));
      }
      if (shareWidth) {
        bestY = consider(bestY, o.y + o.h - m.y);
        bestY = consider(bestY, o.y - (m.y + m.h));
      }
      if (nearHorizontally && (shareHeight || nearVertically)) {
        bestY = consider(bestY, o.y - m.y);
        bestY = consider(bestY, o.y + o.h - (m.y + m.h));
      }
    }
  }

  return { dx: dx + (bestX ?? 0), dy: dy + (bestY ?? 0) };
}

/** The furthest a set of windows may travel: every one stays wholly across the screen, title bar below `top`. */
export function clampOffset(
  moving: WindowRect[],
  dx: number,
  dy: number,
  viewport: WindowSize,
  top: number,
): { dx: number; dy: number } {
  let minDx = -Infinity;
  let maxDx = Infinity;
  let minDy = -Infinity;
  let maxDy = Infinity;

  for (const r of moving) {
    minDx = Math.max(minDx, -r.x);
    maxDx = Math.min(maxDx, viewport.w - (r.x + r.w));
    minDy = Math.max(minDy, top - r.y);
    maxDy = Math.min(maxDy, viewport.h - TITLE_BAR - r.y);
  }

  // A set already wider than the screen cannot satisfy both sides; the left edge wins, so the title
  // bar's text is the part that stays reachable.
  const clamp = (value: number, lo: number, hi: number) => (lo > hi ? lo : Math.min(hi, Math.max(lo, value)));

  return { dx: clamp(dx, minDx, maxDx), dy: clamp(dy, minDy, maxDy) };
}

/**
 * Tracks the pointer's x while a drag runs, and says when it has been shaken.
 *
 * A change of direction only counts after a real swing (`SHAKE_SWING`), so the jitter of a hand holding
 * still - a pixel either way - never adds up to a shake.
 */
export function createShakeTracker() {
  let lastX: number | null = null;
  let anchorX = 0;
  let direction = 0;
  let turns: number[] = [];

  return {
    /** Feeds one pointer position; true once the drag has been shaken. */
    feed(x: number, time: number): boolean {
      if (lastX === null) {
        lastX = x;
        anchorX = x;
        return false;
      }

      const step = x - lastX;
      if (Math.abs(step) < 1) return false;

      const heading = Math.sign(step);
      if (direction !== 0 && heading !== direction) {
        if (Math.abs(lastX - anchorX) >= SHAKE_SWING) turns.push(time);
        anchorX = lastX;
      }
      direction = heading;
      lastX = x;
      turns = turns.filter((t) => time - t <= SHAKE_WINDOW);

      return turns.length >= SHAKE_TURNS;
    },
    reset() {
      lastX = null;
      direction = 0;
      turns = [];
    },
  };
}

/** Which edges a resize grip moves. */
export type ResizeEdges = { left?: boolean; right?: boolean; top?: boolean; bottom?: boolean };

type Sized = { id: string; rect: WindowRect; min: WindowSize };

/**
 * Moves one shared edge, as a splitter: the windows before the line grow, the ones after it shrink (or
 * the other way round), so whatever was flush stays flush.
 *
 * `line` is the edge's current position, `axis` says whether it is a vertical line (x) or a horizontal one
 * (y), and `side` says which side of it the grabbed window is on. The windows on the line are found by
 * walking from the grabbed window across to its flush neighbours and back, so a window that merely
 * happens to share the coordinate, elsewhere on the screen, is not dragged along.
 *
 * The move is clamped so nobody goes below their minimum and nothing crosses the screen's edge.
 */
export function moveLine(
  windows: Sized[],
  grabbed: string,
  axis: 'x' | 'y',
  side: 'before' | 'after',
  delta: number,
  bounds: { lo: number; hi: number },
): { rects: Record<string, WindowRect>; applied: number } {
  const pos = (r: WindowRect) => (axis === 'x' ? r.x : r.y);
  const len = (r: WindowRect) => (axis === 'x' ? r.w : r.h);
  const crossStart = (r: WindowRect) => (axis === 'x' ? r.y : r.x);
  const crossLen = (r: WindowRect) => (axis === 'x' ? r.h : r.w);
  const minLen = (s: Sized) => (axis === 'x' ? s.min.w : s.min.h);

  const self = windows.find((s) => s.id === grabbed);
  if (self === undefined) return { rects: {}, applied: 0 };

  const line = side === 'before' ? pos(self.rect) + len(self.rect) : pos(self.rect);
  const before = new Map<string, Sized>(); // windows whose far edge is the line
  const after = new Map<string, Sized>(); // windows whose near edge is the line
  (side === 'before' ? before : after).set(self.id, self);

  const touchesAcross = (a: WindowRect, b: WindowRect) =>
    overlaps(crossStart(a), crossStart(a) + crossLen(a), crossStart(b), crossStart(b) + crossLen(b));

  // Walk the line: a window on one side pulls in every window on the other side that shares some of its
  // length, and so on until nothing new is found.
  let grew = true;
  while (grew) {
    grew = false;
    for (const s of windows) {
      if (before.has(s.id) || after.has(s.id)) continue;
      const endsHere = Math.abs(pos(s.rect) + len(s.rect) - line) <= TOUCH;
      const startsHere = Math.abs(pos(s.rect) - line) <= TOUCH;
      if (startsHere && [...before.values()].some((b) => touchesAcross(b.rect, s.rect))) {
        after.set(s.id, s);
        grew = true;
      } else if (endsHere && [...after.values()].some((a) => touchesAcross(a.rect, s.rect))) {
        before.set(s.id, s);
        grew = true;
      }
    }
  }

  // How far the line may go: windows before it can shrink to their minimum, windows after it likewise,
  // and neither may be pushed off the screen.
  let lo = bounds.lo - line;
  let hi = bounds.hi - line;
  for (const b of before.values()) lo = Math.max(lo, minLen(b) - len(b.rect));
  for (const a of after.values()) hi = Math.min(hi, len(a.rect) - minLen(a));

  const applied = lo > hi ? 0 : Math.round(Math.min(hi, Math.max(lo, delta)));
  const rects: Record<string, WindowRect> = {};

  for (const b of before.values()) {
    rects[b.id] = axis === 'x' ? { ...b.rect, w: b.rect.w + applied } : { ...b.rect, h: b.rect.h + applied };
  }
  for (const a of after.values()) {
    rects[a.id] =
      axis === 'x'
        ? { ...a.rect, x: a.rect.x + applied, w: a.rect.w - applied }
        : { ...a.rect, y: a.rect.y + applied, h: a.rect.h - applied };
  }

  return { rects, applied };
}

/** Splits a set of windows into the pieces that are actually touching. */
export function connectedPieces(rects: { id: string; rect: WindowRect }[]): string[][] {
  const seen = new Set<string>();
  const pieces: string[][] = [];

  for (const start of rects) {
    if (seen.has(start.id)) continue;
    const piece: string[] = [];
    const stack = [start];
    seen.add(start.id);
    while (stack.length > 0) {
      const next = stack.pop()!;
      piece.push(next.id);
      for (const other of rects) {
        if (!seen.has(other.id) && areFlush(next.rect, other.rect)) {
          seen.add(other.id);
          stack.push(other);
        }
      }
    }
    pieces.push(piece);
  }

  return pieces;
}

/**
 * Brings a layout saved on one screen onto another of the same shape.
 *
 * A group is moved and shrunk as one block, so it arrives together: shrunk only when it really does not
 * fit (and never below a window's minimum), then slid back on screen. A layout saved on a smaller screen is
 * left exactly where it was.
 */
export function fitWindows(
  windows: Record<string, SavedWindow>,
  specs: Record<string, WindowSpec>,
  viewport: WindowSize,
  top: number,
): Record<string, SavedWindow> {
  const out: Record<string, SavedWindow> = { ...windows };
  const blocks = new Map<string, string[]>();

  for (const id of Object.keys(windows)) {
    const key = windows[id].group ?? `solo:${id}`;
    blocks.set(key, [...(blocks.get(key) ?? []), id]);
  }

  const areaH = Math.max(TITLE_BAR, viewport.h - top);

  for (const ids of blocks.values()) {
    const rects = ids.map((id) => windows[id].rect);
    const bx = Math.min(...rects.map((r) => r.x));
    const by = Math.min(...rects.map((r) => r.y));
    const bw = Math.max(...rects.map((r) => r.x + r.w)) - bx;
    const bh = Math.max(...rects.map((r) => r.y + r.h)) - by;
    const scale = Math.min(1, viewport.w / bw, areaH / bh);

    const scaled = ids.map((id) => {
      const r = windows[id].rect;
      if (scale >= 1) return { id, rect: r };
      const min = specs[id]?.min ?? { w: 160, h: 120 };
      return {
        id,
        rect: {
          x: Math.round(bx + (r.x - bx) * scale),
          y: Math.round(by + (r.y - by) * scale),
          w: Math.max(Math.min(min.w, viewport.w), Math.round(r.w * scale)),
          h: Math.max(Math.min(min.h, areaH), Math.round(r.h * scale)),
        },
      };
    });

    const nx = Math.min(...scaled.map((s) => s.rect.x));
    const ny = Math.min(...scaled.map((s) => s.rect.y));
    const nr = Math.max(...scaled.map((s) => s.rect.x + s.rect.w));
    const nb = Math.max(...scaled.map((s) => s.rect.y + s.rect.h));
    let dx = 0;
    let dy = 0;
    if (nr > viewport.w) dx = viewport.w - nr;
    if (nx + dx < 0) dx = -nx;
    if (nb > viewport.h) dy = viewport.h - nb;
    if (ny + dy < top) dy = top - ny;

    for (const s of scaled) {
      out[s.id] = { ...windows[s.id], rect: { ...s.rect, x: s.rect.x + dx, y: s.rect.y + dy } };
    }
  }

  // A maximised window fills whatever screen it is on now.
  for (const id of Object.keys(out)) {
    if (out[id].restore !== null) out[id] = { ...out[id], rect: { x: 0, y: top, w: viewport.w, h: viewport.h - top } };
  }

  return out;
}

/** Where a window goes when nobody has put it anywhere: the corner it always used. */
export function defaultRect(spec: WindowSpec, viewport: WindowSize, top: number): WindowRect {
  const w = Math.min(spec.size.w, viewport.w - 24);
  const areaH = viewport.h - top;
  const h = Math.max(Math.min(spec.min.h, areaH), Math.min(spec.size.h, Math.round(areaH * 0.78)));
  const x = viewport.w - 8 - w;
  // The upper corner sits 64px down, as the docked windows always have; the lower one sits clear of the
  // player bar (112px), and never above the usable area.
  const y = spec.dock === 'top' ? Math.max(top + 8, 64) : Math.max(top + 8, viewport.h - 112 - h);

  return { x: Math.max(0, x), y, w, h };
}

/* -------------------------------------------------------------------------------------------------
 * The store
 * ---------------------------------------------------------------------------------------------- */

const specs: Record<string, WindowSpec> = {};
let saved: SavedLayouts = {};
let order: string[] = [];
let saver: ((layouts: SavedLayouts) => void) | null = null;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let lastSave = 0;

let state: LayoutState = {
  ready: false,
  bucket: 'standard',
  viewport: { w: 1440, h: 900 },
  top: 0,
  windows: {},
};
const listeners = new Set<() => void>();

export function subscribeToWindowLayout(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function windowLayoutState(): LayoutState {
  return state;
}

/** One window's entry, for its own `useSyncExternalStore`. `undefined` until it has opened once. */
export function liveWindow(id: string): LiveWindow | undefined {
  return state.windows[id];
}

export function layoutReady(): boolean {
  return state.ready;
}

function sameRect(a: WindowRect, b: WindowRect): boolean {
  return a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;
}

function sameRestore(a: SavedWindow['restore'], b: SavedWindow['restore']): boolean {
  if (a === null || b === null) return a === b;
  return a.group === b.group && sameRect(a.rect, b.rect);
}

/**
 * Writes the windows, working out the derived fields (stacking, grouped) and keeping every entry that did
 * not change the *same object*, which is what lets an unmoved window skip its render.
 */
function write(next: Record<string, SavedWindow>, patch: Partial<Omit<LayoutState, 'windows'>> = {}, flashed?: string) {
  order = [...order.filter((id) => id in next), ...Object.keys(next).filter((id) => !order.includes(id))];

  const openPerGroup = new Map<string, number>();
  for (const w of Object.values(next)) {
    if (w.open && w.group !== null) openPerGroup.set(w.group, (openPerGroup.get(w.group) ?? 0) + 1);
  }

  const windows: Record<string, LiveWindow> = {};
  for (const id of Object.keys(next)) {
    const w = next[id];
    const prev = state.windows[id];
    const z = order.indexOf(id);
    const grouped = w.open && w.group !== null && (openPerGroup.get(w.group) ?? 0) >= 2;
    const flash = (prev?.flash ?? 0) + (flashed === id ? 1 : 0);
    const unchanged =
      prev !== undefined &&
      sameRect(prev.rect, w.rect) &&
      prev.group === w.group &&
      prev.open === w.open &&
      sameRestore(prev.restore, w.restore) &&
      prev.z === z &&
      prev.grouped === grouped &&
      prev.flash === flash;
    windows[id] = unchanged ? prev : { rect: w.rect, group: w.group, open: w.open, restore: w.restore, z, grouped, flash };
  }

  state = { ...state, ...patch, windows };
  for (const listener of listeners) listener();
}

function plain(): Record<string, SavedWindow> {
  const out: Record<string, SavedWindow> = {};
  for (const [id, w] of Object.entries(state.windows)) {
    out[id] = { rect: w.rect, group: w.group, open: w.open, restore: w.restore };
  }
  return out;
}

/** The current bucket, as it would be saved. */
function snapshotBucket(): SavedBucket {
  return { screen: { ...state.viewport }, windows: plain(), order: [...order] };
}

/** Everything saved, with the current bucket brought up to date. */
export function currentLayouts(): SavedLayouts {
  return { ...saved, [state.bucket]: snapshotBucket() };
}

/**
 * Whether the screen is phone-width right now. A desktop browser narrowed below `sm` turns its windows
 * into bottom sheets, which unmount and close - and none of that may be saved into a desktop layout.
 */
function phoneWidthNow(): boolean {
  return typeof window !== 'undefined' && window.innerWidth < PHONE_BELOW;
}

function saveNow() {
  if (phoneWidthNow()) return;
  lastSave = Date.now();
  saved = currentLayouts();
  saver?.(saved);
}

/** Hands the layouts to the saver - at most once per `SAVE_EVERY`, and never before they were read. */
function scheduleSave() {
  if (!state.ready || saver === null || phoneWidthNow()) return;
  if (saveTimer !== null) return;

  const wait = Math.max(0, lastSave + SAVE_EVERY - Date.now());
  saveTimer = setTimeout(() => {
    saveTimer = null;
    saveNow();
  }, wait);
}

/** Saves now, if a save is waiting: called as the page goes away. */
export function flushLayoutSave(): void {
  if (saveTimer === null) return;
  clearTimeout(saveTimer);
  saveTimer = null;
  saveNow();
}

export function setLayoutSaver(next: ((layouts: SavedLayouts) => void) | null): void {
  if (saveTimer !== null) clearTimeout(saveTimer);
  saveTimer = null;
  saver = next;
}

/** A group id nobody else has: it is saved, so it has to survive between visits. */
function newGroupId(): string {
  return `g${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

/** The window plus everyone open in its group: what a drag moves and a click raises. */
function members(id: string, windows = state.windows): string[] {
  const group = windows[id]?.group ?? null;
  if (group === null) return [id];
  // The grabbed window first: a drag treats `ids[0]` as the one in the hand.
  return [id, ...Object.keys(windows).filter((other) => other !== id && windows[other].open && windows[other].group === group)];
}

/** Rejoins a window to its saved group only if it still sits flush against an open member of it. */
function settleGroup(id: string, windows: Record<string, SavedWindow>): string | null {
  const w = windows[id];
  if (w.group === null) return null;
  const flushWithGroup = Object.keys(windows).some(
    (other) => other !== id && windows[other].open && windows[other].group === w.group && areFlush(w.rect, windows[other].rect),
  );
  return flushWithGroup ? w.group : null;
}

/** A window describes itself. Called on every open; the latest description wins. */
export function registerWindow(id: string, spec: WindowSpec): void {
  specs[id] = spec;
}

/** The windows actually drawn right now, as opposed to the ones the store merely believes open. */
const mounted = new Set<string>();

/** A window opened: put it where it was saved, or in its corner, and bring it to the front. */
export function windowOpened(id: string): void {
  const spec = specs[id];
  if (spec === undefined) return;
  mounted.add(id);

  const next = plain();
  const known = next[id];
  if (known === undefined) {
    next[id] = { rect: defaultRect(spec, state.viewport, state.top), group: null, open: true, restore: null };
  } else {
    next[id] = { ...known, open: true };
    next[id] = { ...next[id], group: settleGroup(id, next) };
  }

  order = [...order.filter((other) => other !== id), id];
  write(next);
  scheduleSave();
}

/** A window closed. The rest of its group stays put; it keeps its group id so it can rejoin. */
export function windowClosed(id: string): void {
  mounted.delete(id);
  const known = state.windows[id];
  if (known === undefined || !known.open) return;

  write({ ...plain(), [id]: { ...plain()[id], open: false } });
  scheduleSave();
}

/** Raises the window and everyone in its group, keeping their order among themselves. */
export function bringToFront(id: string): void {
  const raise = members(id);
  const nextOrder = [...order.filter((other) => !raise.includes(other)), ...order.filter((other) => raise.includes(other))];
  if (nextOrder.every((other, index) => other === order[index])) return;
  order = nextOrder;
  write(plain());
}

/** Takes a window out of its group. The ones left behind regroup by what still touches. */
export function detachWindow(id: string, flash = true): void {
  const known = state.windows[id];
  if (known === undefined || known.group === null) return;

  const next = plain();
  const oldGroup = known.group;
  next[id] = { ...next[id], group: null };

  const rest = Object.keys(next).filter((other) => next[other].open && next[other].group === oldGroup);
  const pieces = connectedPieces(rest.map((other) => ({ id: other, rect: next[other].rect })));
  pieces.forEach((piece, index) => {
    const group = piece.length < 2 ? null : index === 0 ? oldGroup : newGroupId();
    for (const other of piece) next[other] = { ...next[other], group };
  });

  write(next, {}, flash ? id : undefined);
  scheduleSave();
}

/* --- dragging ------------------------------------------------------------------------------------ */

type Drag = {
  ids: string[];
  starts: Record<string, WindowRect>;
  pointerX: number;
  pointerY: number;
  shake: ReturnType<typeof createShakeTracker>;
  /** Whether anything actually moved. A click on a title bar is a press with no move, and joins nothing. */
  moved: boolean;
};
let drag: Drag | null = null;

function startDragOf(ids: string[], x: number, y: number): Drag {
  const starts: Record<string, WindowRect> = {};
  for (const id of ids) starts[id] = state.windows[id].rect;
  return { ids, starts, pointerX: x, pointerY: y, shake: createShakeTracker(), moved: false };
}

export function beginMove(id: string, x: number, y: number): void {
  // Nothing moves until the saved layout has arrived, or the arrival would throw the move away.
  if (state.windows[id] === undefined || !state.ready) return;
  bringToFront(id);
  // A maximised window stays put: it fills the screen, and its way back is the second double-click.
  if (state.windows[id].restore !== null) return;
  drag = startDragOf(members(id), x, y);
  drag.shake.feed(x, performance.now());
}

export function moveTo(x: number, y: number, time = performance.now()): void {
  if (drag === null) return;
  const lead = drag.ids[0];

  // Shaken loose: the grabbed window carries on alone, from where it is now.
  if (drag.ids.length > 1 && drag.shake.feed(x, time)) {
    detachWindow(lead);
    drag = { ...startDragOf([lead], x, y), moved: true };
    return;
  }

  const moving = drag.ids.map((id) => drag!.starts[id]);
  const others = Object.keys(state.windows)
    .filter((id) => !drag!.ids.includes(id) && state.windows[id].open)
    .map((id) => state.windows[id].rect);
  const snapped = snapOffset(moving, others, x - drag.pointerX, y - drag.pointerY);
  const { dx, dy } = clampOffset(moving, snapped.dx, snapped.dy, state.viewport, state.top);
  // A drag, as opposed to a click, is a pointer that travelled. The window itself may not have moved at
  // all - it can snap straight back to where it was - and that still counts as a drop.
  if (!drag.moved && Math.hypot(x - drag.pointerX, y - drag.pointerY) < 3) return;
  drag.moved = true;

  const next = plain();
  for (const id of drag.ids) {
    const s = drag.starts[id];
    next[id] = { ...next[id], rect: { ...s, x: Math.round(s.x + dx), y: Math.round(s.y + dy) }, restore: null };
  }
  write(next);
}

/** The drop: anything now flush with the moved windows joins their group. */
export function endMove(): void {
  if (drag === null) return;
  const { ids, moved } = drag;
  drag = null;
  // Only a real drop joins anything: a click must not undo a detach by regrouping what still touches.
  if (!moved) return;

  const next = plain();
  const touching = new Set<string>();
  for (const other of Object.keys(next)) {
    if (ids.includes(other) || !next[other].open) continue;
    if (ids.some((id) => areFlush(next[id].rect, next[other].rect))) touching.add(other);
  }

  if (touching.size > 0) {
    const absorbed = new Set<string>([...ids.map((id) => next[id].group), ...[...touching].map((id) => next[id].group)].filter((g): g is string => g !== null));
    const group = next[ids[0]].group ?? [...absorbed][0] ?? newGroupId();
    for (const id of Object.keys(next)) {
      if (ids.includes(id) || touching.has(id) || (next[id].group !== null && absorbed.has(next[id].group!))) {
        next[id] = { ...next[id], group };
      }
    }
  }

  write(next);
  scheduleSave();
}

/* --- resizing ------------------------------------------------------------------------------------ */

type Resize = {
  id: string;
  edges: ResizeEdges;
  starts: Record<string, WindowRect>;
  pointerX: number;
  pointerY: number;
};
let resize: Resize | null = null;

export function beginResize(id: string, edges: ResizeEdges, x: number, y: number): void {
  if (state.windows[id] === undefined || !state.ready) return;
  bringToFront(id);
  const starts: Record<string, WindowRect> = {};
  for (const other of Object.keys(state.windows)) starts[other] = state.windows[other].rect;
  resize = { id, edges, starts, pointerX: x, pointerY: y };
}

export function resizeTo(x: number, y: number): void {
  if (resize === null) return;
  const { id, edges, starts } = resize;
  const group = state.windows[id].group;

  // The windows a shared edge can move: open members of the same group (and the grabbed one).
  const pool = Object.keys(state.windows).filter(
    (other) => other === id || (group !== null && state.windows[other].open && state.windows[other].group === group),
  );
  let rects: Record<string, WindowRect> = {};
  for (const other of pool) rects[other] = starts[other];

  const sized = () => pool.map((other) => ({ id: other, rect: rects[other], min: specs[other]?.min ?? { w: 160, h: 120 } }));
  const apply = (axis: 'x' | 'y', side: 'before' | 'after', delta: number) => {
    const bounds = axis === 'x' ? { lo: 0, hi: state.viewport.w } : { lo: state.top, hi: state.viewport.h };
    const moved = moveLine(sized(), id, axis, side, delta, bounds);
    rects = { ...rects, ...moved.rects };
  };

  const dx = x - resize.pointerX;
  const dy = y - resize.pointerY;
  if (edges.right) apply('x', 'before', dx);
  if (edges.left) apply('x', 'after', dx);
  if (edges.bottom) apply('y', 'before', dy);
  if (edges.top) apply('y', 'after', dy);

  const next = plain();
  for (const other of pool) {
    if (!sameRect(next[other].rect, rects[other])) next[other] = { ...next[other], rect: rects[other], restore: null };
  }
  write(next);
}

export function endResize(): void {
  if (resize === null) return;
  resize = null;
  scheduleSave();
}

/* --- maximise ------------------------------------------------------------------------------------ */

export function toggleMaximise(id: string): void {
  const known = state.windows[id];
  if (known === undefined) return;

  const next = plain();
  if (known.restore === null) {
    next[id] = {
      ...next[id],
      restore: { rect: known.rect, group: known.group },
      rect: { x: 0, y: state.top, w: state.viewport.w, h: state.viewport.h - state.top },
      group: null,
    };
    order = [...order.filter((other) => other !== id), id];
  } else {
    next[id] = { ...next[id], rect: known.restore.rect, group: known.restore.group, restore: null };
    next[id] = { ...next[id], group: settleGroup(id, next) };
  }

  write(next);
  scheduleSave();
}

/* --- the screen ---------------------------------------------------------------------------------- */

/** Opens one bucket's saved layout over whatever is open now; windows not in it fall back to their corners. */
function loadBucket(bucket: ScreenBucket, viewport: WindowSize, top: number, keepOpen: Record<string, boolean>) {
  const layout = saved[bucket];
  const next: Record<string, SavedWindow> = {};

  if (layout !== undefined) {
    for (const [id, w] of Object.entries(layout.windows)) next[id] = { ...w, open: keepOpen[id] ?? false };
    order = [...layout.order];
  }
  for (const [id, open] of Object.entries(keepOpen)) {
    if (next[id] === undefined && specs[id] !== undefined) {
      next[id] = { rect: defaultRect(specs[id], viewport, top), group: null, open, restore: null };
    }
  }

  return fitWindows(next, specs, viewport, top);
}

/**
 * The screen changed size, or the top bar did.
 *
 * Same shape: everything is nudged back on screen. A different shape (dragged to another monitor, or a
 * browser window made much narrower): the old shape's layout is kept, and this shape's is laid out in its
 * place. Which windows are open does not change - only where they are.
 */
export function setViewport(viewport: WindowSize, top: number): void {
  const bucket = bucketFor(viewport.w, viewport.h);
  const sameShape = bucket === state.bucket;
  if (sameShape && viewport.w === state.viewport.w && viewport.h === state.viewport.h && top === state.top) return;

  if (!sameShape) {
    if (state.ready) saved = currentLayouts();
    const open: Record<string, boolean> = {};
    for (const [id, w] of Object.entries(state.windows)) if (w.open) open[id] = true;
    const next = state.ready ? loadBucket(bucket, viewport, top, open) : fitWindows(plain(), specs, viewport, top);
    write(next, { bucket, viewport, top });
    return;
  }

  write(fitWindows(plain(), specs, viewport, top), { viewport, top });
}

/**
 * The saved layouts arrived (or there were none). Returns the windows the layout had open, so the host
 * can open the ones that are not open already.
 */
export function adoptLayouts(layouts: SavedLayouts | null, canOpen: (id: string) => boolean = () => true): string[] {
  saved = layouts ?? {};
  const open: Record<string, boolean> = {};
  for (const [id, w] of Object.entries(state.windows)) if (w.open) open[id] = true;

  const wanted = saved[state.bucket]?.windows ?? {};
  const reopen = Object.keys(wanted).filter((id) => wanted[id].open && !open[id] && canOpen(id));

  // The windows about to be reopened count as open already. They mount one at a time, and the first to
  // arrive would otherwise find its partner shut and drop out of the group it was saved in.
  const next = loadBucket(state.bucket, state.viewport, state.top, { ...open, ...Object.fromEntries(reopen.map((id) => [id, true])) });
  write(next, { ready: true });

  return reopen;
}

/**
 * Closes every window the store thinks is open but that never actually drew - an opener that did nothing,
 * or a window that refused. Otherwise it would count towards its group, be dragged along invisibly, and
 * be saved as open for good. The host calls it a moment after reopening a saved layout.
 */
export function closeUndrawnWindows(): void {
  const next = plain();
  let changed = false;
  for (const id of Object.keys(next)) {
    if (next[id].open && !mounted.has(id)) {
      next[id] = { ...next[id], open: false };
      changed = true;
    }
  }
  if (changed) write(next);
}

/** Back to the corners, for this screen shape only - and this shape's saved layout goes with it. */
export function resetLayout(): void {
  const next: Record<string, SavedWindow> = {};
  for (const [id, w] of Object.entries(state.windows)) {
    if (!w.open || specs[id] === undefined) continue;
    next[id] = { rect: defaultRect(specs[id], state.viewport, state.top), group: null, open: true, restore: null };
  }
  const rest = { ...saved };
  delete rest[state.bucket];
  saved = rest;
  write(next);
  scheduleSave();
}

/** Forgets everything: a different person signed in, or a check starting over. */
export function resetLayoutStore(): void {
  if (saveTimer !== null) clearTimeout(saveTimer);
  saveTimer = null;
  drag = null;
  resize = null;
  saved = {};
  order = [];
  mounted.clear();
  state = { ...state, ready: false, windows: {} };
  for (const listener of listeners) listener();
}

/** Marks the store as not yet read, keeping the open windows where they are: a session is changing. */
export function awaitLayouts(): void {
  if (saveTimer !== null) clearTimeout(saveTimer);
  saveTimer = null;
  state = { ...state, ready: false };
  for (const listener of listeners) listener();
}

/** The layouts as they would be saved now - read by the checks. */
export function savedLayoutsForTest(): SavedLayouts {
  return currentLayouts();
}

/** Turns a value read from storage or the database into layouts, dropping anything the wrong shape. */
export function readSavedLayouts(value: unknown): SavedLayouts | null {
  if (typeof value !== 'object' || value === null) return null;
  const out: SavedLayouts = {};
  const isNum = (n: unknown) => typeof n === 'number' && Number.isFinite(n);
  const isRect = (r: unknown): r is WindowRect =>
    typeof r === 'object' && r !== null && ['x', 'y', 'w', 'h'].every((k) => isNum((r as Record<string, unknown>)[k]));

  for (const bucket of ['tall', 'standard', 'wide'] as const) {
    const raw = (value as Record<string, unknown>)[bucket] as Partial<SavedBucket> | undefined;
    if (typeof raw !== 'object' || raw === null || typeof raw.windows !== 'object' || raw.windows === null) continue;
    const windows: Record<string, SavedWindow> = {};
    for (const [id, w] of Object.entries(raw.windows as Record<string, Partial<SavedWindow>>)) {
      if (typeof w !== 'object' || w === null || !isRect(w.rect)) continue;
      const restore =
        typeof w.restore === 'object' && w.restore !== null && isRect(w.restore.rect)
          ? { rect: w.restore.rect, group: typeof w.restore.group === 'string' ? w.restore.group : null }
          : null;
      windows[id] = { rect: w.rect, group: typeof w.group === 'string' ? w.group : null, open: w.open === true, restore };
    }
    const screen = raw.screen && isNum(raw.screen.w) && isNum(raw.screen.h) ? raw.screen : { w: 0, h: 0 };
    const order = Array.isArray(raw.order) ? raw.order.filter((id): id is string => typeof id === 'string') : [];
    out[bucket] = { screen, windows, order };
  }

  return out;
}
