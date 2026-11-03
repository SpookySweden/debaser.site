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
  readInput,
  type CanvasInput,
  type Placement,
  type StrokeInput,
} from './canvas';
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

/** What the room tells its canvas on every render. */
export type CanvasContext = {
  me: { id: string; label: string } | null;
  host: { id: string; label: string };
  title: string;
  amHost: boolean;
  live: boolean;
  /** The session is over: the stream ended, or the music room was switched off (not just quiet for a moment). */
  over: boolean;
  /** Everybody signed in who is in the room now, crowned or not. */
  present: CanvasParticipant[];
  /** Who holds a crown now. */
  crowned: ReadonlySet<string>;
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
  inputs: CanvasInput[];
  known: Map<string, CanvasInput>;
  canvas: RoomCanvasRecord | null;
  opening: Promise<RoomCanvasRecord | null> | null;
  pending: CanvasInput[];
  /** Wire messages waiting for the canvas to be opened. */
  held: CanvasWireMessage[];
  lastSnapshot: { at: number; inputCount: number } | null;
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

/** One input into this tab's canvas, from anywhere (this tab, the wire, the timeline). A stroke seen again grows. */
function take(session: Session, input: CanvasInput): void {
  const known = session.known.get(input.id);
  if (known !== undefined) {
    if (input.kind !== 'stroke' || known.kind !== 'stroke' || input.points.length <= known.points.length) return;
    const index = session.inputs.findIndex((entry) => entry.id === input.id);
    if (index >= 0) session.inputs[index] = input;
  } else {
    session.inputs.push(input);
  }
  session.known.set(input.id, input);
  session.raster.apply(input);
}

async function loadTimeline(session: Session, canvas: RoomCanvasRecord): Promise<void> {
  const inputs = await getCanvasRepository().readInputs(canvas.id);
  if (session.canvas?.id !== canvas.id) return;
  let added = false;
  for (const input of inputs) {
    if (!session.known.has(input.id)) added = true;
    take(session, input);
  }
  if (added) emit(session, {}, true);
}

/** Adopts the room's open canvas (read from the store) and hands it whatever waited for it. */
async function adopt(session: Session, canvas: RoomCanvasRecord | null): Promise<void> {
  if (canvas === null) return;
  const fresh = session.canvas?.id !== canvas.id;
  if (fresh && session.canvas !== null) {
    // A new session's canvas: start from nothing.
    session.raster = new CanvasRaster();
    session.inputs = [];
    session.known = new Map();
    session.lastSnapshot = null;
    session.lastAskedAt = null;
  }
  session.canvas = canvas;
  if (session.lastAskedAt === null) session.lastAskedAt = Date.parse(canvas.openedAt) || Date.now();
  if (fresh) {
    const held = session.held.splice(0);
    for (const message of held) session.wire?.send({ ...message, canvasId: canvas.id });
    for (const input of session.pending) {
      if (!session.known.has(input.id)) take(session, input);
    }
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
    if (canvas !== null && canvas.closedAt !== null && session.context !== null && !session.context.over) {
      // That session's canvas was closed and the room is on again (a music room's next GO PUBLIC): a fresh canvas.
      session.canvas = null;
      session.raster = new CanvasRaster();
      session.inputs = [];
      session.known = new Map();
      session.pending = [];
      session.lastSnapshot = null;
      session.lastAskedAt = null;
      emit(session, {}, true);
      await adopt(session, await repository.findOpenCanvas(session.roomId));
      return;
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
  if (canvas === null || me === null || session.pending.length === 0) return;
  const batch = session.pending.splice(0);
  try {
    await getCanvasRepository().writeInputs(canvas.id, batch, me.id);
    emit(session, { error: null });
  } catch (failure) {
    // Put back unless the canvas is closed for good (the room ended): then the drawing is not kept.
    const words = failure instanceof Error ? failure.message : 'THE DRAWING COULD NOT BE SAVED.';
    if (session.context?.live) session.pending.unshift(...batch);
    emit(session, { error: words });
  }
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
  if (input === null) return;
  if (session.canvas === null || session.canvas.id !== message.canvasId) {
    // A canvas this tab has not met yet: draw the input now, read the canvas in the background.
    onWire(session, { type: 'canvas', canvasId: message.canvasId });
  }
  if (message.type === 'progress' && input.kind === 'stroke') {
    const known = session.known.get(input.id);
    const before = known?.kind === 'stroke' ? known.points : [];
    if (message.start > before.length) return;
    take(session, { ...input, points: [...before.slice(0, message.start), ...input.points] });
  } else {
    take(session, input);
  }
  emit(session, {}, true);
}

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
      canvas: null,
      opening: null,
      pending: [],
      held: [],
      lastSnapshot: null,
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
  if (session.canvas !== null) return session.canvas;
  const context = session.context;
  if (context === null || context.me === null || !context.live) return null;
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

function participantsNow(session: Session): CanvasParticipant[] {
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
  for (const input of session.inputs) add(input.authorId, input.authorLabel);
  return [...byId.values()];
}

async function snapshot(session: Session): Promise<void> {
  const canvas = session.canvas;
  const me = session.context?.me ?? null;
  if (canvas === null || canvas.savedAt === null || me === null) return;
  await flush(session);
  const png = await pngOf(session.raster);
  if (png === null) return;
  const inputCount = session.inputs.length;
  await getCanvasRepository().addSnapshot({
    canvasId: canvas.id,
    takenBy: me,
    png,
    placements: placementsOf(session.inputs).map((entry) => entry.place),
    credits: creditsOf(session.inputs),
    participants: participantsNow(session),
    inputCount,
  });
  session.lastSnapshot = { at: Date.now(), inputCount };
  session.wire?.send({ type: 'canvas', canvasId: canvas.id });
}

async function autosave(session: Session): Promise<void> {
  const context = session.context;
  if (context === null || context.me === null || !context.live || session.canvas?.savedAt == null) return;
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
    changedSinceSnapshot: last === null || session.inputs.length !== last.inputCount,
    lastSnapshotAt: last?.at ?? null,
    now: Date.now(),
    host: context.amHost,
  });
  if (due) await snapshot(session).catch(() => undefined);
}

/** SAVE: documented in the archive from now on, with a snapshot at once. */
async function saveNow(session: Session): Promise<void> {
  const me = session.context?.me ?? null;
  if (me === null) return;
  emit(session, { saving: true, error: null });
  try {
    const canvas = await ensureCanvas(session);
    if (canvas === null) return;
    await flush(session);
    const saved = await getCanvasRepository().save(canvas.id, me);
    if (saved !== null) session.canvas = saved;
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

/**
 * Before a room session closes for this tab (END STREAM, leaving, public off): a changed canvas nobody saved asks
 * "save this canvas?" first; a saved one that changed takes its last snapshot. `ending`: the host is ending the
 * session, so the canvas is closed once that is done. Resolves when the room may close.
 */
export async function askToSaveCanvas(roomId: string, options: { ending?: boolean } = {}): Promise<void> {
  const session = sessions.get(roomId);
  if (session === undefined || session.users === 0) return;
  await flush(session);
  const state = { changed: session.inputs.length > 0, saved: session.canvas?.savedAt != null };
  if (asksOnClose(state) && session.context?.me) {
    if (await ask(session, 'close')) await saveNow(session);
  } else if (state.saved && session.lastSnapshot?.inputCount !== session.inputs.length) {
    await snapshot(session).catch(() => undefined);
  }
  if (options.ending && session.canvas !== null && session.context?.me) {
    await getCanvasRepository()
      .close(session.canvas.id, session.context.me.id)
      .catch(() => undefined);
  }
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
  drawing: (stroke: StrokeInput, start: number) => void;
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
function drawingOwn(session: Session, stroke: StrokeInput, start: number): void {
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
  if (!session.context?.me || session.lastAskedAt === null || !asksOnCanvasView(state, now, session.lastAskedAt)) return;
  session.lastAskedAt = now;
  void ask(session, 'view').then((save) => (save ? saveNow(session) : undefined));
}

function setContext(session: Session, context: CanvasContext): void {
  const was = session.context;
  session.context = context;
  // The session ended while the host looked on (END STREAM, a music room switched off): the host's tab closes the
  // canvas, so the next session starts a new one.
  if (was !== null && !was.over && context.over && context.amHost && context.me !== null && session.canvas !== null && session.canvas.closedAt === null) {
    const canvas = session.canvas;
    void getCanvasRepository()
      .close(canvas.id, context.me.id)
      .then(() => session.wire?.send({ type: 'canvas', canvasId: canvas.id }))
      .catch(() => undefined);
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
