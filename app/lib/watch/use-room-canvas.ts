'use client';

import { useEffect, useSyncExternalStore } from 'react';
import {
  CANVAS_HEIGHT,
  CANVAS_WIDTH,
  CanvasRaster,
  asksOnCanvasView,
  asksOnClose,
  autosaveDue,
  creditsOf,
  nextUndoTarget,
  placementsOf,
  rasterOf,
  readInput,
  replayOrder,
  type CanvasInput,
  type Placement,
  type EraseInput,
  type StrokeInput,
} from './canvas';
import { whenRoomClientChanges } from './room-client';
import { getCanvasRepository, type CanvasParticipant, type CanvasWire, type CanvasWireMessage, type RoomCanvasRecord } from './canvas-repository';

/**
 * One room's canvas in this tab (SPEC-stream-art.md): the timeline as it stands, the pixels it makes, the live
 * wire, and the save rules. Kept per room at module level, so the canvas keeps hearing strokes while a viewer
 * looks at the picture, and the room's close keys can ask "save this canvas?" (`askToSaveCanvas`).
 *
 * Inputs go out on the wire at once (a stroke while it is drawn, too) and onto the timeline in batches every
 * couple of seconds; the timeline is read again now and then, so a stroke missed on the wire still arrives.
 */

/** How often this tab writes its waiting inputs to the timeline. */
const FLUSH_MS = 2000;
/** How often the timeline and the canvas row are read again, for anything the wire missed. */
const REFRESH_MS = 20_000;
/** How often the autosave rule is asked. */
const AUTOSAVE_TICK_MS = 30_000;
/** A wire input the timeline has not taken within this long is dropped (a failed write, or a forged message). */
const WIRE_GRACE_MS = 30_000;
/** The bucket's rate limit: one picture per account every 10 seconds (the migration's storage policy). */
const SNAPSHOT_GAP_MS = 10_500;

/** What the room tells its canvas on every render. */
export type CanvasContext = {
  me: { id: string; label: string } | null;
  host: { id: string; label: string };
  title: string;
  amHost: boolean;
  live: boolean;
  /** Somebody's music room (SPEC-music-queues.md): its host closing the room switches it off. */
  music: boolean;
  /** The session is over: the stream ended, or the music room was switched off (not just quiet for a moment). */
  over: boolean;
  /** Everybody signed in who is in the room now, crowned or not. */
  present: CanvasParticipant[];
  /** Who holds a crown now. */
  crowned: ReadonlySet<string>;
  /** Somebody with no account (SPEC-guests.md). A named guest draws, as `me`, and doesn't save: nothing here asks them to. */
  guest?: boolean;
  /** The guests in the room now, so their strokes are heard on the wire as they are drawn. */
  guests?: ReadonlySet<string>;
  /** Set while somebody could draw if they had a name: pressing the canvas asks them for one. */
  askName?: () => void;
};

/** "Save this canvas?" waiting on an answer: at a close (END STREAM, leaving) or on the canvas view. */
export type SaveAsk = { reason: 'close' | 'view' };

export type RoomCanvasView = {
  canvas: RoomCanvasRecord | null;
  /** Bumped whenever the pixels or placements change. */
  version: number;
  inputCount: number;
  placements: { id: string; authorId: string; place: Placement }[];
  saved: boolean;
  changed: boolean;
  saving: boolean;
  asking: SaveAsk | null;
  error: string | null;
};

type Session = {
  roomId: string;
  users: number;
  raster: CanvasRaster;
  /** What this tab draws, in order: the timeline's inputs in the server's order, then those not yet written. */
  inputs: CanvasInput[];
  known: Map<string, CanvasInput>;
  /** The inputs the timeline holds (the server took them); the rest came over the wire or are this tab's own. */
  confirmed: Set<string>;
  /** Everybody with an input on the timeline. */
  confirmedAuthors: Set<string>;
  /** When each input not yet on the timeline was first seen here. */
  seenAt: Map<string, number>;
  canvas: RoomCanvasRecord | null;
  opening: Promise<RoomCanvasRecord | null> | null;
  pending: CanvasInput[];
  /** Wire messages waiting for the canvas to be opened. */
  held: CanvasWireMessage[];
  /** The newest snapshot this tab knows of, and how many timeline inputs it was made from. */
  lastSnapshot: { at: number; inputCount: number } | null;
  /** When this tab last took a snapshot (the bucket takes one per account every few seconds). */
  mySnapshotAt: number;
  lastAskedAt: number | null;
  context: CanvasContext | null;
  wire: CanvasWire | null;
  timers: number[];
  view: RoomCanvasView;
  listeners: Set<() => void>;
  resolveAsk: ((save: boolean) => void) | null;
};

const sessions = new Map<string, Session>();
const EMPTY_VIEW: RoomCanvasView = { canvas: null, version: 0, inputCount: 0, placements: [], saved: false, changed: false, saving: false, asking: null, error: null };

function emit(session: Session, patch: Partial<RoomCanvasView> = {}, drawn = false): void {
  session.view = {
    ...session.view,
    ...patch,
    canvas: session.canvas,
    inputCount: session.inputs.length,
    saved: session.canvas?.savedAt != null,
    changed: session.inputs.length > 0,
    ...(drawn ? { version: session.view.version + 1, placements: placementsOf(session.inputs) } : {}),
  };
  for (const listener of session.listeners) listener();
}

function newId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `i-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * Empties the session for a new canvas. `keepPending`: what this tab drew since the old one closed is the new
 * session's (ensureCanvas); otherwise it belonged to the old session and is let go.
 */
function reset(session: Session, keepPending: boolean): void {
  if (!keepPending) session.pending = [];
  session.canvas = null;
  session.raster = new CanvasRaster();
  session.inputs = [];
  session.known = new Map();
  session.confirmed = new Set();
  session.confirmedAuthors = new Set();
  session.seenAt = new Map();
  session.lastSnapshot = null;
  session.lastAskedAt = null;
  for (const input of session.pending) take(session, input);
}

/**
 * One input into this tab's canvas, from anywhere (this tab, the wire, the timeline). A stroke or rub seen again
 * grows; an id already known as somebody else's, or as another kind, is not taken.
 */
function take(session: Session, input: CanvasInput): boolean {
  const known = session.known.get(input.id);
  if (known !== undefined) {
    if (known.authorId !== input.authorId || known.kind !== input.kind) return false;
    if ((input.kind !== 'stroke' && input.kind !== 'erase') || (known.kind !== 'stroke' && known.kind !== 'erase') || input.points.length <= known.points.length) return false;
    const index = session.inputs.findIndex((entry) => entry.id === input.id);
    if (index >= 0) session.inputs[index] = input;
  } else {
    session.inputs.push(input);
    if (!session.confirmed.has(input.id) && !session.seenAt.has(input.id)) session.seenAt.set(input.id, Date.now());
  }
  session.known.set(input.id, input);
  session.raster.apply(input);
  return true;
}

/**
 * The timeline read again: the canvas is drawn in the server's order (`seq`), then what is not written yet - this
 * tab's own, and what came over the wire in the last half minute. A wire input the timeline never took (somebody
 * forging one on the open channel, or a write that failed) is dropped after that.
 */
async function loadTimeline(session: Session, canvas: RoomCanvasRecord): Promise<void> {
  const timeline = replayOrder(await getCanvasRepository().readInputs(canvas.id));
  if (session.canvas?.id !== canvas.id) return;
  const onTimeline = new Set(timeline.map((input) => input.id));
  const me = session.context?.me?.id ?? null;
  const now = Date.now();
  const unwritten = session.inputs.filter(
    (input) => !onTimeline.has(input.id) && (input.authorId === me || now - (session.seenAt.get(input.id) ?? 0) < WIRE_GRACE_MS),
  );
  const next: CanvasInput[] = [...timeline, ...unwritten];
  const same = next.length === session.inputs.length && next.every((input, index) => input.id === session.inputs[index].id && session.confirmed.has(input.id) === onTimeline.has(input.id));
  session.confirmed = onTimeline;
  session.confirmedAuthors = new Set(timeline.map((input) => input.authorId));
  for (const id of onTimeline) session.seenAt.delete(id);
  if (same) return;
  session.inputs = [];
  session.known = new Map();
  session.raster = new CanvasRaster();
  for (const input of next) take(session, input);
  emit(session, {}, true);
}

/** Adopts the room's open canvas (read from the store) and hands it whatever waited for it. */
async function adopt(session: Session, canvas: RoomCanvasRecord | null): Promise<void> {
  if (canvas === null || canvas.closedAt !== null) return;
  const fresh = session.canvas?.id !== canvas.id;
  if (fresh && session.canvas !== null) reset(session, false);
  session.canvas = canvas;
  if (session.lastAskedAt === null) session.lastAskedAt = Date.parse(canvas.openedAt) || Date.now();
  if (fresh) {
    const held = session.held.splice(0);
    for (const message of held) session.wire?.send({ ...message, canvasId: canvas.id });
    emit(session, {}, true);
    await loadTimeline(session, canvas).catch(() => undefined);
  } else {
    emit(session);
  }
}

async function refresh(session: Session): Promise<void> {
  const repository = getCanvasRepository();
  try {
    if (session.canvas === null) {
      await adopt(session, await repository.findOpenCanvas(session.roomId));
      return;
    }
    const canvas = await repository.readCanvas(session.canvas.id);
    if (canvas !== null && canvas.closedAt !== null) {
      // That session's canvas is closed. Only once another is open (a music room's next GO PUBLIC) does this tab move
      // to it; until then the closed one stays on screen as it was (the room is ending, or about to read as over).
      const next = await repository.findOpenCanvas(session.roomId);
      if (next !== null && next.id !== canvas.id) {
        reset(session, false);
        emit(session, {}, true);
        await adopt(session, next);
        return;
      }
    }
    if (canvas !== null) {
      session.canvas = canvas;
      emit(session);
      await loadTimeline(session, canvas);
    }
  } catch {
    // Read again on the next tick.
  }
}

async function flush(session: Session): Promise<void> {
  const canvas = session.canvas;
  const me = session.context?.me ?? null;
  if (canvas === null || canvas.closedAt !== null || me === null || session.pending.length === 0) return;
  const batch = session.pending.splice(0);
  try {
    await getCanvasRepository().writeInputs(canvas.id, batch, me.id);
    // On the timeline now: counted as such at once (the next snapshot's "changed since" depends on it).
    for (const input of batch) {
      session.confirmed.add(input.id);
      session.confirmedAuthors.add(input.authorId);
      session.seenAt.delete(input.id);
    }
    emit(session, { error: null });
  } catch (failure) {
    // Put back unless the canvas is closed for good (the room ended): then the drawing is not kept.
    const words = failure instanceof Error ? failure.message : 'THE DRAWING COULD NOT BE SAVED.';
    if (session.context?.live) session.pending.unshift(...batch);
    emit(session, { error: words });
  }
}

/**
 * Who may be heard on the wire: the people in the room now, the host, and whoever already has inputs on the
 * timeline. The channel itself is open, so this keeps a stranger's messages (and a flood of made-up names, each a
 * layer of pixels) off the canvas; the timeline, written under the database's rules, has the last word.
 */
function heard(session: Session, authorId: string): boolean {
  const context = session.context;
  if (context === null) return false;
  if (authorId === context.host.id || context.present.some((person) => person.id === authorId) || context.guests?.has(authorId) === true) return true;
  return session.confirmedAuthors.has(authorId);
}

function onWire(session: Session, message: CanvasWireMessage): void {
  if (message.type === 'canvas') {
    if (session.canvas === null || session.canvas.id !== message.canvasId) {
      void getCanvasRepository()
        .readCanvas(message.canvasId)
        .then((canvas) => (canvas !== null && canvas.roomId === session.roomId && canvas.closedAt === null ? adopt(session, canvas) : undefined))
        .catch(() => undefined);
    } else {
      void refresh(session);
    }
    return;
  }
  const input = readInput(message.input);
  if (input === null || !heard(session, input.authorId)) return;
  if (session.canvas === null || session.canvas.id !== message.canvasId) {
    // A canvas this tab has not met yet: read it in the background. With none here yet, draw the input now; with
    // another one here, the input is that other canvas's business (a late stroke from the last session).
    onWire(session, { type: 'canvas', canvasId: message.canvasId });
    if (session.canvas !== null) return;
  }
  let taken: boolean;
  if (message.type === 'progress' && (input.kind === 'stroke' || input.kind === 'erase')) {
    const known = session.known.get(input.id);
    const before = known !== undefined && (known.kind === 'stroke' || known.kind === 'erase') ? known.points : [];
    if (message.start > before.length) return;
    taken = take(session, { ...input, points: [...before.slice(0, message.start), ...input.points] });
  } else {
    taken = take(session, input);
  }
  if (taken) emit(session, {}, true);
}

// Somebody became a guest or logged in: the wire was joined as who they were, and what they can read has changed.
whenRoomClientChanges(() => {
  for (const session of sessions.values()) {
    if (session.users === 0) continue;
    session.wire?.leave();
    session.wire = getCanvasRepository().joinWire(session.roomId, (message) => onWire(session, message));
    void refresh(session);
  }
});

/** The room's session object: one per room for the life of the tab, so every caller holds the same one. */
function sessionFor(roomId: string): Session {
  let session = sessions.get(roomId);
  if (session === undefined) {
    session = {
      roomId,
      users: 0,
      raster: new CanvasRaster(),
      inputs: [],
      known: new Map(),
      confirmed: new Set(),
      confirmedAuthors: new Set(),
      seenAt: new Map(),
      canvas: null,
      opening: null,
      pending: [],
      held: [],
      lastSnapshot: null,
      mySnapshotAt: 0,
      lastAskedAt: null,
      context: null,
      wire: null,
      timers: [],
      view: EMPTY_VIEW,
      listeners: new Set(),
      resolveAsk: null,
    };
    sessions.set(roomId, session);
  }
  return session;
}

/** Starts hearing the room (the wire, the timers) on the first user; stops on the last. */
function acquire(session: Session): void {
  session.users += 1;
  if (session.users !== 1) return;
  session.wire = getCanvasRepository().joinWire(session.roomId, (message) => onWire(session, message));
  session.timers = [
    window.setInterval(() => void flush(session), FLUSH_MS),
    window.setInterval(() => void refresh(session), REFRESH_MS),
    window.setInterval(() => void autosave(session), AUTOSAVE_TICK_MS),
  ];
  void refresh(session);
}

function release(session: Session): void {
  session.users -= 1;
  if (session.users > 0) return;
  void flush(session);
  for (const timer of session.timers) window.clearInterval(timer);
  session.timers = [];
  session.wire?.leave();
  session.wire = null;
  session.resolveAsk?.(false);
}

/** The room's canvas, opened if nobody has yet (by a signed-in person in a live room). */
async function ensureCanvas(session: Session): Promise<RoomCanvasRecord | null> {
  if (session.canvas !== null && session.canvas.closedAt === null) return session.canvas;
  const context = session.context;
  if (context === null || context.me === null || !context.live || context.over) return null;
  // That session's canvas is closed: this is a new session, with a canvas of its own.
  if (session.canvas !== null) {
    reset(session, true);
    emit(session, {}, true);
  }
  if (session.opening === null) {
    const me = context.me;
    session.opening = getCanvasRepository()
      .openCanvas({ roomId: session.roomId, host: context.host, title: context.title, by: me.id })
      .then(async (canvas) => {
        await adopt(session, canvas);
        session.wire?.send({ type: 'canvas', canvasId: canvas.id });
        return canvas;
      })
      .catch((failure: unknown) => {
        emit(session, { error: failure instanceof Error ? failure.message : 'THE CANVAS COULD NOT BE OPENED.' });
        return null;
      })
      .finally(() => {
        session.opening = null;
      });
  }
  return session.opening;
}

/** Closes the canvas (the host, at the session's end), here as well as in the store. */
async function closeCanvas(session: Session): Promise<void> {
  const canvas = session.canvas;
  const me = session.context?.me ?? null;
  if (canvas === null || canvas.closedAt !== null || me === null) return;
  await getCanvasRepository().close(canvas.id, me.id);
  if (session.canvas?.id === canvas.id) session.canvas = { ...canvas, closedAt: new Date().toISOString() };
  session.wire?.send({ type: 'canvas', canvasId: canvas.id });
  emit(session);
}

/* --- snapshots and saving ------------------------------------------------------------------------- */

function pngOf(raster: CanvasRaster): Promise<Blob | null> {
  const canvas = document.createElement('canvas');
  canvas.width = CANVAS_WIDTH;
  canvas.height = CANVAS_HEIGHT;
  const context = canvas.getContext('2d');
  if (context === null) return Promise.resolve(null);
  context.putImageData(new ImageData(new Uint8ClampedArray(raster.rgba), CANVAS_WIDTH, CANVAS_HEIGHT), 0, 0);
  return new Promise((resolve) => canvas.toBlob((blob) => resolve(blob), 'image/png'));
}

function participantsNow(session: Session, inputs: readonly CanvasInput[]): CanvasParticipant[] {
  const context = session.context;
  const byId = new Map<string, CanvasParticipant>();
  const crowned = context?.crowned ?? new Set<string>();
  const add = (id: string, label: string) => {
    if (!byId.has(id)) byId.set(id, { id, label, crowned: crowned.has(id) });
  };
  if (context !== null) {
    add(context.host.id, context.host.label);
    for (const person of context.present) add(person.id, person.label);
  }
  for (const input of inputs) add(input.authorId, input.authorLabel);
  return [...byId.values()];
}

/**
 * A snapshot of what the timeline holds, in the server's order: this tab's own inputs are written first, and only
 * what the database took goes into the archive (never something heard only on the wire).
 */
async function snapshot(session: Session): Promise<void> {
  const canvas = session.canvas;
  const me = session.context?.me ?? null;
  if (canvas === null || canvas.savedAt === null || me === null || session.context?.guest === true) return;
  await flush(session);
  const timeline = replayOrder(await getCanvasRepository().readInputs(canvas.id));
  const raster = rasterOf(timeline);
  const png = await pngOf(raster);
  if (png === null) return;
  // The bucket takes one picture per account every few seconds: a snapshot right after another waits its turn.
  const wait = session.mySnapshotAt + SNAPSHOT_GAP_MS - Date.now();
  if (wait > 0) await new Promise((resolve) => window.setTimeout(resolve, wait));
  await getCanvasRepository().addSnapshot({
    canvasId: canvas.id,
    takenBy: me,
    png,
    placements: placementsOf(timeline).map((entry) => entry.place),
    credits: creditsOf(timeline),
    participants: participantsNow(session, timeline),
    inputCount: timeline.length,
  });
  session.mySnapshotAt = Date.now();
  session.lastSnapshot = { at: Date.now(), inputCount: timeline.length };
  session.wire?.send({ type: 'canvas', canvasId: canvas.id });
}

async function autosave(session: Session): Promise<void> {
  const context = session.context;
  if (context === null || context.me === null || context.guest === true || !context.live || session.canvas?.savedAt == null) return;
  // Only somebody with a part in the canvas may take a snapshot (room_canvas_may_snapshot): anybody else would be
  // refused on every try, so they leave autosaving to those who can.
  const me = context.me.id;
  const canvas = session.canvas;
  const hasPart =
    context.amHost ||
    canvas.hostId === me ||
    canvas.savedBy === me ||
    context.crowned.has(me) ||
    session.inputs.some((input) => input.authorId === me && session.confirmed.has(input.id));
  if (!hasPart) return;
  if (session.lastSnapshot === null) {
    // What the others already took: this tab only knows its own snapshots, so read the newest.
    const shots = await getCanvasRepository()
      .listSnapshots(session.canvas.id)
      .catch(() => []);
    const last = shots[shots.length - 1];
    if (last !== undefined) session.lastSnapshot = { at: Date.parse(last.takenAt), inputCount: last.inputCount };
  }
  const last = session.lastSnapshot;
  const due = autosaveDue({
    saved: true,
    changedSinceSnapshot: last === null || session.confirmed.size + session.pending.length !== last.inputCount,
    lastSnapshotAt: last?.at ?? null,
    now: Date.now(),
    host: context.amHost,
  });
  if (due) await snapshot(session).catch(() => undefined);
}

/** SAVE: documented in the archive from now on, with a snapshot at once. */
async function saveNow(session: Session): Promise<void> {
  const me = session.context?.me ?? null;
  if (me === null || session.context?.guest === true) return;
  emit(session, { saving: true, error: null });
  try {
    const canvas = await ensureCanvas(session);
    if (canvas === null) throw new Error('THIS CANVAS IS CLOSED.');
    await flush(session);
    const saved = await getCanvasRepository().save(canvas.id, me);
    if (saved === null || saved.savedAt === null) throw new Error('THE CANVAS COULD NOT BE SAVED.');
    session.canvas = saved;
    await snapshot(session);
    session.wire?.send({ type: 'canvas', canvasId: canvas.id });
    emit(session, { saving: false });
  } catch (failure) {
    emit(session, { saving: false, error: failure instanceof Error ? failure.message : 'THE CANVAS COULD NOT BE SAVED.' });
  }
}

function ask(session: Session, reason: SaveAsk['reason']): Promise<boolean> {
  session.resolveAsk?.(false);
  return new Promise((resolve) => {
    session.resolveAsk = (save) => {
      session.resolveAsk = null;
      emit(session, { asking: null });
      resolve(save);
    };
    emit(session, { asking: { reason } });
  });
}

/* --- what the room and its screen use ------------------------------------------------------------ */

/** The host ends the session after "save this canvas?" was already answered (the leave prompt's END STREAM). */
export async function closeRoomCanvas(roomId: string): Promise<void> {
  const session = sessions.get(roomId);
  if (session !== undefined) await closeCanvas(session).catch(() => undefined);
}

/**
 * Before a room session closes for this tab (END STREAM, leaving, public off): a changed canvas nobody saved asks
 * "save this canvas?" first; a saved one that changed takes its last snapshot. `ending`: the host is ending the
 * session, so the canvas is closed once that is done (`hostId` closes the room's open canvas even when no room
 * window is open in this tab). Resolves when the room may close.
 */
export async function askToSaveCanvas(roomId: string, options: { ending?: boolean; hostId?: string } = {}): Promise<void> {
  const session = sessions.get(roomId);
  if (session === undefined || session.users === 0) {
    // No room window here (public off from the QUEUES tab): nothing drawn in this tab to ask about, but the
    // session still ends, so its canvas is closed.
    if (options.ending && options.hostId !== undefined) {
      const repository = getCanvasRepository();
      const open = await repository.findOpenCanvas(roomId).catch(() => null);
      if (open !== null) await repository.close(open.id, options.hostId).catch(() => undefined);
    }
    return;
  }
  await flush(session);
  const context = session.context;
  const state = { changed: session.inputs.length > 0, saved: session.canvas?.savedAt != null };
  // Only while it can still be saved: once the room is over (the host ended it) the canvas takes nothing more.
  const open = context !== null && context.me !== null && context.guest !== true && context.live && !context.over && session.canvas?.closedAt == null;
  if (open && asksOnClose(state)) {
    if (await ask(session, 'close')) await saveNow(session);
  } else if (open && state.saved && session.lastSnapshot?.inputCount !== session.confirmed.size + session.pending.length) {
    await snapshot(session).catch(() => undefined);
  }
  // A music room's host closing the room switches it off: that ends the session too.
  const ending = options.ending === true || (context?.music === true && context.amHost);
  if (ending) await closeCanvas(session).catch(() => undefined);
}

export type RoomCanvasControls = {
  view: RoomCanvasView;
  /** The pixels: read `rgba` after each `version` change. */
  raster: () => CanvasRaster;
  /** Opens the room's canvas if nobody has yet. */
  open: () => void;
  /** A finished input of this tab's own. */
  draw: (input: CanvasInput) => void;
  /** A stroke being drawn: its points from `start` on are new. */
  drawing: (stroke: StrokeInput | EraseInput, start: number) => void;
  undo: () => void;
  save: () => void;
  /** The viewer switched to the canvas: every half hour of unsaved drawing, that asks "save this canvas?". */
  viewed: () => void;
  answer: (save: boolean) => void;
  newInputId: () => string;
};

/** A finished input of this tab's own: drawn now, sent on the wire, written in the next batch. */
function drawOwn(session: Session, input: CanvasInput): void {
  take(session, input);
  session.pending.push(input);
  if (session.canvas !== null) session.wire?.send({ type: 'input', canvasId: session.canvas.id, input });
  else {
    session.held.push({ type: 'input', canvasId: '', input });
    void ensureCanvas(session);
  }
  emit(session, {}, true);
}

/** A stroke of this tab's own while it is drawn: drawn now and sent on the wire, written once it is finished. */
function drawingOwn(session: Session, stroke: StrokeInput | EraseInput, start: number): void {
  take(session, stroke);
  if (session.canvas !== null) session.wire?.send({ type: 'progress', canvasId: session.canvas.id, input: { ...stroke, points: stroke.points.slice(start) }, start });
  emit(session, {}, true);
}

function undoOwn(session: Session): void {
  const me = session.context?.me;
  if (!me) return;
  const target = nextUndoTarget(session.inputs, me.id);
  if (target === null) return;
  drawOwn(session, { id: newId(), authorId: me.id, authorLabel: me.label, at: new Date().toISOString(), kind: 'undo', target });
}

function viewedNow(session: Session): void {
  const now = Date.now();
  const state = { changed: session.inputs.length > 0, saved: session.canvas?.savedAt != null };
  if (!session.context?.me || session.context.guest === true || session.lastAskedAt === null || !asksOnCanvasView(state, now, session.lastAskedAt)) return;
  session.lastAskedAt = now;
  void ask(session, 'view').then((save) => (save ? saveNow(session) : undefined));
}

function setContext(session: Session, context: CanvasContext): void {
  const was = session.context;
  session.context = context;
  // The session ended while the host looked on (END STREAM, a music room switched off): the host's tab closes the
  // canvas, so the next session starts a new one.
  if (was !== null && !was.over && context.over && context.amHost && context.me !== null && session.canvas !== null && session.canvas.closedAt === null) {
    void closeCanvas(session).catch(() => undefined);
  }
}

export function useRoomCanvas(roomId: string, context: CanvasContext): RoomCanvasControls {
  const session = sessionFor(roomId);
  // The room's latest word on who, where and what, for the timers and the snapshots. Before the effect below,
  // and before the caller's own, so opening the canvas already knows who is asking.
  useEffect(() => setContext(session, context));
  useEffect(() => {
    acquire(session);
    return () => release(session);
  }, [session]);
  const view = useSyncExternalStore(
    (listener) => {
      session.listeners.add(listener);
      return () => session.listeners.delete(listener);
    },
    () => session.view,
    () => EMPTY_VIEW,
  );

  return {
    view,
    raster: () => session.raster,
    open: () => void ensureCanvas(session),
    draw: (input) => drawOwn(session, input),
    drawing: (stroke, start) => drawingOwn(session, stroke, start),
    undo: () => undoOwn(session),
    save: () => void saveNow(session),
    viewed: () => viewedNow(session),
    answer: (save) => session.resolveAsk?.(save),
    newInputId: newId,
  };
}

/** "Save this canvas?" for the room's own prompt line: what is asked, and the answer. */
export function useCanvasAsk(roomId: string): { asking: SaveAsk | null; saving: boolean; answer: (save: boolean) => void } {
  const session = sessionFor(roomId);
  const view = useSyncExternalStore(
    (listener) => {
      session.listeners.add(listener);
      return () => session.listeners.delete(listener);
    },
    () => session.view,
    () => EMPTY_VIEW,
  );
  return { asking: view.asking, saving: view.saving, answer: (save) => session.resolveAsk?.(save) };
}
