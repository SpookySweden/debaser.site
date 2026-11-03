/**
 * The room canvas ("magma mode", SPEC-stream-art.md): a shared 480 x 270 pixel drawing on a room's screen. Pure:
 * no React, no DOM, no store, so the room, the archive's replay and the checks share one set of rules.
 *
 * Everything drawn is an **input** on the canvas's timeline: a stroke, an erase, an undo or a placement (a GIF from
 * the chat's picture search, or a chat line as a line of text). Inputs are applied in the order they arrive (the
 * server's order once written), and the picture is always what that list of inputs makes:
 *
 * - **Strokes** are solid pixels, no anti-aliasing: a square brush stamped along a Bresenham line.
 * - **The eraser rubs out your own strokes only.** Each person draws on a layer of their own, and every pixel on a
 *   layer remembers when it was painted; the picture shows, per pixel, the latest paint of any layer. An erase
 *   clears pixels on the eraser's own layer, so whatever somebody else painted there (above or below) stays.
 * - **Undo takes back your own latest input** (a stroke, an erase or a placement). An undo naming somebody
 *   else's input is ignored, wherever it came from: nobody can clear or change anybody else's work.
 */

export const CANVAS_WIDTH = 480;
export const CANVAS_HEIGHT = 270;
const PIXELS = CANVAS_WIDTH * CANVAS_HEIGHT;

/** The pen's sizes, in canvas pixels (a square brush that many pixels across). */
export const PEN_SIZES = [1, 2, 4, 8] as const;
/** The eraser is one size, a little bigger than the biggest pen. */
export const ERASER_SIZE = 10;
/** The most points one stroke keeps: a long scribble is sent as several strokes. */
export const STROKE_MAX_POINTS = 400;
/** How tall a dropped GIF lands, in canvas pixels; its width follows its own shape. */
export const PLACED_PICTURE_HEIGHT = 72;
/** The longest line of text a dropped chat message makes. */
export const PLACED_TEXT_MAX = 200;

export type CanvasPoint = readonly [number, number];

/** What a placement is: a hotlinked picture, or a chat line as text credited to its writer. */
export type Placement =
  | { type: 'picture'; url: string; title: string; x: number; y: number; h: number }
  | { type: 'text'; text: string; colour: string; x: number; y: number; writerId: string | null; writerLabel: string };

type InputBase = {
  id: string;
  authorId: string;
  authorLabel: string;
  /** When the input was made, ISO. */
  at: string;
};

export type StrokeInput = InputBase & { kind: 'stroke'; colour: string; size: number; points: CanvasPoint[] };
export type EraseInput = InputBase & { kind: 'erase'; size: number; points: CanvasPoint[] };
export type UndoInput = InputBase & { kind: 'undo'; target: string };
export type PlaceInput = InputBase & { kind: 'place'; place: Placement };
export type CanvasInput = StrokeInput | EraseInput | UndoInput | PlaceInput;
export type CanvasInputKind = CanvasInput['kind'];

/** What an input carries besides who and when: what is written in the timeline's `data`. */
export type CanvasInputData =
  | { kind: 'stroke'; colour: string; size: number; points: CanvasPoint[] }
  | { kind: 'erase'; size: number; points: CanvasPoint[] }
  | { kind: 'undo'; target: string }
  | { kind: 'place'; place: Placement };

/* --- small helpers ------------------------------------------------------------------------------ */

const HEX = /^#[0-9a-f]{6}$/i;

/** A colour as the canvas keeps it: `#rrggbb`, lower case; anything else is refused. */
export function canvasColour(value: unknown): string | null {
  return typeof value === 'string' && HEX.test(value) ? value.toLowerCase() : null;
}

/** A point inside the canvas, in whole pixels. */
export function clampPoint(x: number, y: number): CanvasPoint {
  const clamp = (value: number, most: number) => Math.min(most, Math.max(0, Math.floor(Number.isFinite(value) ? value : 0)));
  return [clamp(x, CANVAS_WIDTH - 1), clamp(y, CANVAS_HEIGHT - 1)];
}

/** A brush size the canvas accepts (1 to 16 pixels). */
export function brushSize(value: unknown): number {
  const size = typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : 1;
  return Math.min(16, Math.max(1, size));
}

/**
 * Whether something read from the timeline (the database, the wire, the mock's storage) is an input this canvas
 * can draw, with every number and colour checked: anything that is not is dropped rather than drawn.
 */
export function readInput(value: unknown): CanvasInput | null {
  if (typeof value !== 'object' || value === null) return null;
  const row = value as Record<string, unknown>;
  if (typeof row.id !== 'string' || typeof row.authorId !== 'string' || typeof row.at !== 'string') return null;
  const base: InputBase = { id: row.id, authorId: row.authorId, authorLabel: typeof row.authorLabel === 'string' ? row.authorLabel : 'Unknown', at: row.at };
  const points = (raw: unknown): CanvasPoint[] | null => {
    if (!Array.isArray(raw) || raw.length === 0 || raw.length > STROKE_MAX_POINTS) return null;
    const out: CanvasPoint[] = [];
    for (const point of raw) {
      if (!Array.isArray(point) || typeof point[0] !== 'number' || typeof point[1] !== 'number') return null;
      out.push(clampPoint(point[0], point[1]));
    }
    return out;
  };
  switch (row.kind) {
    case 'stroke': {
      const colour = canvasColour(row.colour);
      const line = points(row.points);
      return colour === null || line === null ? null : { ...base, kind: 'stroke', colour, size: brushSize(row.size), points: line };
    }
    case 'erase': {
      const line = points(row.points);
      return line === null ? null : { ...base, kind: 'erase', size: brushSize(row.size), points: line };
    }
    case 'undo':
      return typeof row.target === 'string' ? { ...base, kind: 'undo', target: row.target } : null;
    case 'place': {
      const place = readPlacement(row.place);
      return place === null ? null : { ...base, kind: 'place', place };
    }
    default:
      return null;
  }
}

function readPlacement(value: unknown): Placement | null {
  if (typeof value !== 'object' || value === null) return null;
  const place = value as Record<string, unknown>;
  const [x, y] = clampPoint(Number(place.x), Number(place.y));
  if (place.type === 'picture') {
    if (typeof place.url !== 'string' || !/^https:\/\//.test(place.url)) return null;
    const h = Math.min(CANVAS_HEIGHT, Math.max(8, Math.round(Number(place.h) || PLACED_PICTURE_HEIGHT)));
    return { type: 'picture', url: place.url, title: typeof place.title === 'string' ? place.title.slice(0, 120) : '', x, y, h };
  }
  if (place.type === 'text') {
    if (typeof place.text !== 'string' || place.text.trim().length === 0) return null;
    return {
      type: 'text',
      text: place.text.slice(0, PLACED_TEXT_MAX),
      colour: canvasColour(place.colour) ?? '',
      x,
      y,
      writerId: typeof place.writerId === 'string' ? place.writerId : null,
      writerLabel: typeof place.writerLabel === 'string' ? place.writerLabel : 'Unknown',
    };
  }
  return null;
}

/** An input's `data`, as the timeline stores it (everything but who and when). */
export function inputData(input: CanvasInput): CanvasInputData {
  switch (input.kind) {
    case 'stroke':
      return { kind: 'stroke', colour: input.colour, size: input.size, points: input.points };
    case 'erase':
      return { kind: 'erase', size: input.size, points: input.points };
    case 'undo':
      return { kind: 'undo', target: input.target };
    case 'place':
      return { kind: 'place', place: input.place };
  }
}

/* --- undo: only ever your own ------------------------------------------------------------------- */

/**
 * The inputs an undo has taken back. An undo counts only when it names an input of its own author's that came
 * before it and is a stroke, an erase or a placement (an undo is never undone).
 */
export function undoneIds(inputs: readonly CanvasInput[]): Set<string> {
  const seen = new Map<string, CanvasInput>();
  const undone = new Set<string>();
  for (const input of inputs) {
    if (input.kind === 'undo') {
      const target = seen.get(input.target);
      if (target !== undefined && target.kind !== 'undo' && target.authorId === input.authorId) undone.add(target.id);
    }
    seen.set(input.id, input);
  }
  return undone;
}

/** What UNDO would take back for this person: their latest stroke, erase or placement still standing; null for none. */
export function nextUndoTarget(inputs: readonly CanvasInput[], authorId: string): string | null {
  const undone = undoneIds(inputs);
  for (let index = inputs.length - 1; index >= 0; index -= 1) {
    const input = inputs[index];
    if (input.authorId === authorId && input.kind !== 'undo' && !undone.has(input.id)) return input.id;
  }
  return null;
}

/** The placements still standing, oldest first (later ones lie on top). */
export function placementsOf(inputs: readonly CanvasInput[]): { id: string; authorId: string; place: Placement }[] {
  const undone = undoneIds(inputs);
  return inputs.flatMap((input) => (input.kind === 'place' && !undone.has(input.id) ? [{ id: input.id, authorId: input.authorId, place: input.place }] : []));
}

/**
 * Who made what is on the canvas: everybody with a stroke or placement still standing, and every chat writer whose
 * line was dropped on it, in the order they first appear.
 */
export function creditsOf(inputs: readonly CanvasInput[]): { id: string | null; label: string }[] {
  const undone = undoneIds(inputs);
  const credits = new Map<string, { id: string | null; label: string }>();
  const add = (id: string | null, label: string) => {
    const key = id ?? `label:${label}`;
    if (!credits.has(key)) credits.set(key, { id, label });
  };
  for (const input of inputs) {
    if (undone.has(input.id)) continue;
    if (input.kind === 'stroke') add(input.authorId, input.authorLabel);
    if (input.kind === 'place') {
      add(input.authorId, input.authorLabel);
      if (input.place.type === 'text') add(input.place.writerId, input.place.writerLabel);
    }
  }
  return [...credits.values()];
}

/** The timeline in replay order: the server's order (`seq`) when every input has one, else the order given. */
export function replayOrder<T extends CanvasInput & { seq?: number | null }>(inputs: readonly T[]): T[] {
  if (inputs.some((input) => typeof input.seq !== 'number')) return [...inputs];
  return [...inputs].sort((a, b) => (a.seq as number) - (b.seq as number));
}

/* --- the pixels --------------------------------------------------------------------------------- */

/** Every pixel a square brush covers along the line from `a` to `b` (Bresenham, no anti-aliasing). */
export function linePixels(a: CanvasPoint, b: CanvasPoint, size: number): number[] {
  const out = new Set<number>();
  const half = Math.floor((size - 1) / 2);
  const stamp = (cx: number, cy: number) => {
    for (let dy = 0; dy < size; dy += 1) {
      const y = cy - half + dy;
      if (y < 0 || y >= CANVAS_HEIGHT) continue;
      for (let dx = 0; dx < size; dx += 1) {
        const x = cx - half + dx;
        if (x < 0 || x >= CANVAS_WIDTH) continue;
        out.add(y * CANVAS_WIDTH + x);
      }
    }
  };
  let [x0, y0] = a;
  const [x1, y1] = b;
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let error = dx + dy;
  for (;;) {
    stamp(x0, y0);
    if (x0 === x1 && y0 === y1) break;
    const twice = 2 * error;
    if (twice >= dy) {
      error += dy;
      x0 += sx;
    }
    if (twice <= dx) {
      error += dx;
      y0 += sy;
    }
  }
  return [...out];
}

/** Every pixel a stroke's points cover. */
export function strokePixels(points: readonly CanvasPoint[], size: number): number[] {
  if (points.length === 0) return [];
  if (points.length === 1) return linePixels(points[0], points[0], size);
  const out = new Set<number>();
  for (let index = 1; index < points.length; index += 1) for (const pixel of linePixels(points[index - 1], points[index], size)) out.add(pixel);
  return [...out];
}

function packColour(hex: string): number {
  // The top bit says "painted"; the low 24 are the colour.
  return (0x1000000 | parseInt(hex.slice(1), 16)) >>> 0;
}

type Layer = { colour: Uint32Array; when: Int32Array };

/**
 * The canvas's pixels: one layer per person, and the picture (`rgba`, ready for `ImageData`) made from them. Feed it
 * inputs in order with `apply`; an undo rebuilds the undoer's layer from their own inputs that still stand.
 */
export class CanvasRaster {
  readonly rgba = new Uint8ClampedArray(PIXELS * 4);
  private readonly layers = new Map<string, Layer>();
  /** Every input applied so far, in order: an undo replays its author's from here. */
  private readonly applied: CanvasInput[] = [];
  private order = 0;
  /** Inputs already applied, by id, with the order number each was painted at. */
  private readonly orderOf = new Map<string, number>();

  private layer(authorId: string): Layer {
    let layer = this.layers.get(authorId);
    if (layer === undefined) {
      layer = { colour: new Uint32Array(PIXELS), when: new Int32Array(PIXELS) };
      this.layers.set(authorId, layer);
    }
    return layer;
  }

  /** The picture at one pixel: the latest paint of any layer, or nothing (transparent). */
  private composite(pixel: number): void {
    let best = 0;
    let bestWhen = -1;
    for (const layer of this.layers.values()) {
      const colour = layer.colour[pixel];
      if (colour !== 0 && layer.when[pixel] > bestWhen) {
        bestWhen = layer.when[pixel];
        best = colour;
      }
    }
    const at = pixel * 4;
    this.rgba[at] = (best >> 16) & 0xff;
    this.rgba[at + 1] = (best >> 8) & 0xff;
    this.rgba[at + 2] = best & 0xff;
    this.rgba[at + 3] = best === 0 ? 0 : 255;
  }

  private paint(input: StrokeInput, when: number): number[] {
    const layer = this.layer(input.authorId);
    const colour = packColour(input.colour);
    const pixels = strokePixels(input.points, input.size);
    for (const pixel of pixels) {
      layer.colour[pixel] = colour;
      layer.when[pixel] = when;
    }
    return pixels;
  }

  private rub(input: EraseInput): number[] {
    const layer = this.layer(input.authorId);
    const pixels = strokePixels(input.points, input.size);
    for (const pixel of pixels) layer.colour[pixel] = 0;
    return pixels;
  }

  /**
   * One input, in timeline order. A stroke seen again (it grows while it is drawn, `points` longer each time)
   * repaints at its first place in the order. Returns whether the picture changed.
   */
  apply(input: CanvasInput): boolean {
    const known = this.orderOf.get(input.id);
    if (known !== undefined) {
      if (input.kind !== 'stroke') return false;
      const index = this.applied.findIndex((entry) => entry.id === input.id);
      if (index >= 0) this.applied[index] = input;
      for (const pixel of this.paint(input, known)) this.composite(pixel);
      return true;
    }
    const when = (this.order += 1);
    this.orderOf.set(input.id, when);
    this.applied.push(input);
    if (input.kind === 'stroke') {
      for (const pixel of this.paint(input, when)) this.composite(pixel);
      return true;
    }
    if (input.kind === 'erase') {
      for (const pixel of this.rub(input)) this.composite(pixel);
      return true;
    }
    if (input.kind === 'undo') {
      const target = this.applied.find((entry) => entry.id === input.target);
      if (target === undefined || target.kind === 'undo' || target.authorId !== input.authorId) return false;
      if (target.kind === 'place') return true;
      this.rebuildLayer(input.authorId);
      return true;
    }
    return true;
  }

  /** One person's layer again from their inputs still standing, each at its own place in the order. */
  private rebuildLayer(authorId: string): void {
    const layer = this.layer(authorId);
    layer.colour.fill(0);
    layer.when.fill(0);
    const undone = undoneIds(this.applied);
    for (const input of this.applied) {
      if (input.authorId !== authorId || undone.has(input.id)) continue;
      if (input.kind === 'stroke') this.paint(input, this.orderOf.get(input.id) ?? 0);
      else if (input.kind === 'erase') this.rub(input);
    }
    for (let pixel = 0; pixel < PIXELS; pixel += 1) this.composite(pixel);
  }

  /** The colour at one pixel as `#rrggbb`, or null for nothing painted there (the checks read it). */
  colourAt(x: number, y: number): string | null {
    const at = (y * CANVAS_WIDTH + x) * 4;
    if (this.rgba[at + 3] === 0) return null;
    const hex = (value: number) => value.toString(16).padStart(2, '0');
    return `#${hex(this.rgba[at])}${hex(this.rgba[at + 1])}${hex(this.rgba[at + 2])}`;
  }
}

/** The canvas as a list of inputs makes it, from nothing. */
export function rasterOf(inputs: readonly CanvasInput[]): CanvasRaster {
  const raster = new CanvasRaster();
  for (const input of inputs) raster.apply(input);
  return raster;
}

/* --- saving ------------------------------------------------------------------------------------- */

/** The canvas view asks "save this canvas?" at most this often, while it changed and nobody saved. */
export const SAVE_ASK_EVERY_MS = 30 * 60 * 1000;
/** A saved canvas takes a snapshot this often while it changes. */
export const AUTOSAVE_EVERY_MS = 3 * 60 * 1000;
/** Somebody who is not the host takes the snapshot when the host's is this late (the host may be gone). */
export const AUTOSAVE_STAND_IN_MS = 2 * AUTOSAVE_EVERY_MS;

/** Where a canvas stands, as the save rules need it. */
export type CanvasSaveState = {
  /** Anything has been drawn, rubbed out, undone or placed this session. */
  changed: boolean;
  /** Somebody pressed SAVE: the canvas is documented in the archive. */
  saved: boolean;
};

/** Closing the session (END STREAM, public off, leaving): ask "save this canvas?" only if it changed and nobody saved. */
export function asksOnClose(state: CanvasSaveState): boolean {
  return state.changed && !state.saved;
}

/**
 * Switching to the canvas view: ask "save this canvas?" when it changed, nobody saved, and the last time this
 * viewer was asked (or the session began, for the first time) is at least half an hour ago.
 */
export function asksOnCanvasView(state: CanvasSaveState, now: number, lastAskedAt: number): boolean {
  return asksOnClose(state) && now - lastAskedAt >= SAVE_ASK_EVERY_MS;
}

/**
 * Whether this tab takes a snapshot now: the canvas is saved, has changed since the last snapshot, and the last
 * one is a few minutes old. The host takes it; anybody else only stands in when the host's is well overdue.
 */
export function autosaveDue(input: { saved: boolean; changedSinceSnapshot: boolean; lastSnapshotAt: number | null; now: number; host: boolean }): boolean {
  if (!input.saved || !input.changedSinceSnapshot) return false;
  if (input.lastSnapshotAt === null) return true;
  const age = input.now - input.lastSnapshotAt;
  return input.host ? age >= AUTOSAVE_EVERY_MS : age >= AUTOSAVE_STAND_IN_MS;
}

/* --- the screen --------------------------------------------------------------------------------- */

/** What a viewer's screen shows: the picture (the video, or the song's card) or the canvas. */
export type ScreenView = 'picture' | 'canvas';

/**
 * The screen a viewer sees: their own choice, made while the same kind of thing was playing; otherwise the canvas
 * while audio plays and the picture with a video.
 */
export function screenShown(choice: { view: ScreenView; audio: boolean } | null, audio: boolean): ScreenView {
  if (choice !== null && choice.audio === audio) return choice.view;
  return audio ? 'canvas' : 'picture';
}
