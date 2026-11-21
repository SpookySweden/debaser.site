/**
 * CONTROL's messages (SPEC-screens.md, phase 2): this device's mouse, keys and wheel driving the PC. A few bytes
 * each, sent on two WebRTC data channels (`keys`: in order and never lost; `pointer`: the newest only).
 * `engine/src/control.rs` is the one place they are written down; the numbers here follow it, as the engine's own
 * viewer page (`engine/web/viewer.html`, its CONTROL part) does. Nothing here touches a page: sums and bytes only.
 */

export const TAKE = 0x01;
export const RELEASE = 0x02;
export const STILL_HERE = 0x03;
export const ALL_UP = 0x04;
export const KEY = 0x10;
export const BUTTON = 0x11;
export const WHEEL = 0x12;
export const POINTER_AT = 0x20;
export const POINTER_BY = 0x21;
/** The first byte of what the PC says back. */
export const STATE = 0x80;

/** What the PC says about control, in words. */
export const PC_SAYS: Readonly<Record<number, string>> = {
  2: 'ANOTHER DEVICE HAS CONTROL',
  3: 'THIS PC IS NOT ALLOWING CONTROL',
  4: 'NOT DURING A LEAGUE MATCH',
  5: 'REFUSED: THE PC COULD NOT SET UP ITS CUT-OFF KEY',
  11: 'CONTROL ENDED: THIS DEVICE WENT SILENT',
  12: 'CONTROL WAS STOPPED AT THE PC',
  13: "CONTROL ENDED: A LEAGUE MATCH STARTED",
  14: "CONTROL ENDED: THE PC'S ENGINE IS STOPPING",
};

/** What a message from the PC means for this device. */
export type PcSaid = { kind: 'yours' } | { kind: 'released' } | { kind: 'ended'; why: string } | { kind: 'refused'; why: string };

export function pcSaid(bytes: Uint8Array): PcSaid | null {
  if (bytes.length < 2 || bytes[0] !== STATE) return null;
  const what = bytes[1];
  if (what === 1) return { kind: 'yours' };
  if (what === 10) return { kind: 'released' };
  if (what >= 11) return { kind: 'ended', why: PC_SAYS[what] ?? 'CONTROL ENDED' };
  return { kind: 'refused', why: PC_SAYS[what] ?? 'REFUSED' };
}

/** Where the picture is on the page, in the page's own pixels. */
export type PictureBox = { left: number; top: number; width: number; height: number };

/** A two-byte number, low byte first (signed ones wrap the way the PC expects). */
export const two = (n: number): [number, number] => [n & 0xff, (n >> 8) & 0xff];

const signed16 = (n: number): number => Math.max(-32768, Math.min(32767, n));

/** A picture of `wide` by `tall` fitted inside a box, in its middle (how SMOOTH and SHARP show it). */
export function fittedBox(box: PictureBox, wide: number, tall: number): PictureBox {
  const fit = Math.min(box.width / wide, box.height / tall);
  const width = wide * fit;
  const height = tall * fit;
  return { left: box.left + (box.width - width) / 2, top: box.top + (box.height - height) / 2, width, height };
}

/** A place on the page as a place on the picture: 0 to 65535 from edge to edge, each way. */
export function placeOnPicture(box: PictureBox | null, clientX: number, clientY: number): [number, number] | null {
  if (box === null || box.width <= 0 || box.height <= 0) return null;
  const share = (value: number) => Math.round(Math.min(1, Math.max(0, value)) * 65535);
  return [share((clientX - box.left) / box.width), share((clientY - box.top) / box.height)];
}

/** The browser numbers buttons left 0, middle 1, right 2, back 3, forward 4; the PC's order is left, right, middle. */
export const BUTTONS: readonly number[] = [0, 2, 1, 3, 4];

/** The way out on this device: Ctrl+Alt+Shift+Q. It is never sent to the PC. */
export function isLetGoChord(event: { ctrlKey: boolean; altKey: boolean; shiftKey: boolean; code: string }): boolean {
  return event.ctrlKey && event.altKey && event.shiftKey && event.code === 'KeyQ';
}

const bytes = (values: number[]): Uint8Array<ArrayBuffer> => new Uint8Array(values);

export const takeMessage = () => bytes([TAKE]);
export const releaseMessage = () => bytes([RELEASE]);
export const stillHereMessage = () => bytes([STILL_HERE]);
export const allUpMessage = () => bytes([ALL_UP]);

/** A key by its `KeyboardEvent.code` ("KeyA", "ShiftRight", "ArrowLeft"...). */
export function keyMessage(down: boolean, code: string): Uint8Array<ArrayBuffer> {
  return bytes([KEY, down ? 1 : 0, ...new TextEncoder().encode(code)]);
}

/** A button (the PC's number), with the place of the click when there is one: the pointer is put there first. */
export function buttonMessage(button: number, down: boolean, place: [number, number] | null): Uint8Array<ArrayBuffer> {
  return bytes([BUTTON, button, down ? 1 : 0, place ? 1 : 0, ...two(place ? place[0] : 0), ...two(place ? place[1] : 0)]);
}

/**
 * Browsers report the wheel in pixels, lines or pages; the PC wants notches, 120 to one, with "away from the hand"
 * (up) and "to the right" positive.
 */
export function wheelTurns(deltaX: number, deltaY: number, deltaMode: number): { dx: number; dy: number } {
  const perNotch = deltaMode === 1 ? 3 : deltaMode === 2 ? 1 : 100;
  // (`+ 0` so that no turn at all is a plain zero, never the "minus zero" that negating nothing leaves behind.)
  return { dx: signed16(Math.round((deltaX / perNotch) * 120)) + 0, dy: signed16(Math.round((-deltaY / perNotch) * 120)) + 0 };
}

export function wheelMessage(dx: number, dy: number, place: [number, number] | null): Uint8Array<ArrayBuffer> {
  return bytes([WHEEL, ...two(dx), ...two(dy), place ? 1 : 0, ...two(place ? place[0] : 0), ...two(place ? place[1] : 0)]);
}

/** POINTER: where the pointer is on the picture. */
export function pointerAtMessage(place: [number, number]): Uint8Array<ArrayBuffer> {
  return bytes([POINTER_AT, ...two(place[0]), ...two(place[1])]);
}

/** How much of a movement fits one message: whole pixels, a signed 16-bit number each way. */
export function wholeMove(owed: number): number {
  return signed16(Math.trunc(owed));
}

/** GAME: movement since the last one. */
export function pointerByMessage(dx: number, dy: number): Uint8Array<ArrayBuffer> {
  return bytes([POINTER_BY, ...two(dx), ...two(dy)]);
}

/**
 * 127.x.x.x or ::1, as a connection's statistics write an address. When the far end of the connection is one of
 * these, this browser reached the engine on its own machine: this device IS the PC.
 */
export function isLoopbackAddress(address: string): boolean {
  const plain = address.trim().toLowerCase().replace(/^\[|\]$/g, '');
  if (plain === '::1' || plain === '0:0:0:0:0:0:0:1') return true;
  return /^(::ffff:)?127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(plain);
}

/* --- SOUND and CONTROLLER (page to PC) ------------------------------------------------------------ */

export const PAD = 0x13;
export const PAD_STATE = 0x22;
export const SOUND = 0x30;

/** `30 on`: this viewer wants the PC's sound, or does not. Not about control: any viewer may listen. */
export const soundMessage = (on: boolean) => bytes([SOUND, on ? 1 : 0]);

/** `13 present`: this device has a game controller (so the PC plugs a pretend one in), or it has gone. */
export const padPresentMessage = (present: boolean) => bytes([PAD, present ? 1 : 0]);

/**
 * Where each button of a controller the browser understands (its "standard" layout) goes on an Xbox 360 one: the
 * browser's button number, then Windows' bit for it. Buttons 6 and 7 are the triggers, sent as amounts.
 */
export const PAD_BUTTONS: readonly (readonly [number, number])[] = [
  [0, 0x1000], // A
  [1, 0x2000], // B
  [2, 0x4000], // X
  [3, 0x8000], // Y
  [4, 0x0100], // LB
  [5, 0x0200], // RB
  [8, 0x0020], // BACK
  [9, 0x0010], // START
  [10, 0x0040], // the left stick, pressed
  [11, 0x0080], // the right stick, pressed
  [12, 0x0001], // UP
  [13, 0x0002], // DOWN
  [14, 0x0004], // LEFT
  [15, 0x0008], // RIGHT
  [16, 0x0400], // GUIDE
];

/** A controller with nothing pressed: the twelve bytes after the counter. */
export const PAD_NEUTRAL: readonly number[] = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];

/** What a browser says of a controller, as far as this needs it. */
export type PadReading = { buttons: readonly ({ pressed: boolean; value: number } | undefined)[]; axes: readonly (number | undefined)[] };

/**
 * A controller's whole state as the PC wants it, twelve bytes: the button bits, the two triggers (0 to 255), then
 * the two sticks, each -32767 to 32767 with right and UP positive (a browser's "up" is negative).
 */
export function padState(reading: PadReading): number[] {
  let buttons = 0;
  for (const [button, bit] of PAD_BUTTONS) if (reading.buttons[button]?.pressed) buttons |= bit;
  const trigger = (button: number) => Math.round(Math.min(1, Math.max(0, reading.buttons[button]?.value ?? 0)) * 255);
  const stick = (value: number | undefined) => Math.round(Math.min(1, Math.max(-1, value || 0)) * 32767) + 0;
  const up = (value: number | undefined) => stick(-(value || 0));
  return [...two(buttons), trigger(6), trigger(7), ...two(stick(reading.axes[0])), ...two(up(reading.axes[1])), ...two(stick(reading.axes[2])), ...two(up(reading.axes[3]))];
}

/** `22 n n b b lt rt lx lx ly ly rx rx ry ry`: the whole state every time, with a counter so a late one is dropped. */
export function padStateMessage(counter: number, state: readonly number[]): Uint8Array<ArrayBuffer> {
  return bytes([PAD_STATE, ...two(counter), ...state]);
}

/* --- what else the PC says on the keys channel ---------------------------------------------------- */

export const POINTER_SHOWN = 0x81;
export const POINTER_SHAPE = 0x82;
export const PAD_SAYS = 0x83;
export const SOUND_SAYS = 0x84;

/** The PC's pointer shape as it arrived. `pixels` is RGBA, row by row; null when the shape was too large to be sent or made no sense. */
export type PointerShape = { number: number; width: number; height: number; hotX: number; hotY: number; pixels: Uint8ClampedArray<ArrayBuffer> | null };

/**
 * `82 n n w w h h x x y y how pixels...`: `how` 0 = RGBA as it is, 1 = runs of `count red green blue solid` (that
 * pixel `count` times), 2 = none (too large: the plain arrow is used). Null when the message is not a shape at all.
 */
export function pointerShapeFrom(message: Uint8Array): PointerShape | null {
  if (message.length < 12 || message[0] !== POINTER_SHAPE) return null;
  const word = (at: number) => message[at] | (message[at + 1] << 8);
  const width = word(3);
  const height = word(5);
  const how = message[11];
  let pixels: Uint8ClampedArray<ArrayBuffer> | null = null;
  if (how === 0 && message.length === 12 + width * height * 4) {
    pixels = new Uint8ClampedArray(width * height * 4);
    pixels.set(message.subarray(12));
  } else if (how === 1) {
    pixels = new Uint8ClampedArray(width * height * 4);
    let to = 0;
    for (let at = 12; at + 4 < message.length; at += 5) {
      for (let n = message[at]; n > 0 && to < pixels.length; n -= 1) {
        pixels[to] = message[at + 1];
        pixels[to + 1] = message[at + 2];
        pixels[to + 2] = message[at + 3];
        pixels[to + 3] = message[at + 4];
        to += 4;
      }
    }
    if (to !== pixels.length) pixels = null;
  }
  if (width === 0 || height === 0) pixels = null;
  return { number: word(1), width, height, hotX: word(7), hotY: word(9), pixels };
}

/** A browser will not show a pointer picture larger than this (in page pixels); beyond it the plain arrow is used. */
export const POINTER_LIMIT = 128;

/** How the PC's pointer shape is to be shown over the picture: at what size and hot spot, or why the plain arrow instead. */
export type PointerLook = { use: 'shape'; width: number; height: number; hotX: number; hotY: number } | { use: 'arrow'; why: string };

/**
 * The shape at the picture's scale: `scale` is how many page pixels one pixel of the PC's screen takes, the way the
 * picture is being shown now (the picture's shown width over the width of the piece of screen being sent).
 */
export function pointerLook(shape: PointerShape | null, scale: number): PointerLook {
  if (shape === null) return { use: 'arrow', why: "the PC has not sent its pointer's shape yet" };
  if (shape.pixels === null) return { use: 'arrow', why: "the PC's pointer was too large to be sent" };
  const width = Math.max(1, Math.round(shape.width * scale));
  const height = Math.max(1, Math.round(shape.height * scale));
  if (width > POINTER_LIMIT || height > POINTER_LIMIT) return { use: 'arrow', why: `the PC's pointer would be ${width} by ${height} here, and a browser shows none larger than ${POINTER_LIMIT}` };
  return { use: 'shape', width, height, hotX: Math.min(width - 1, Math.round(shape.hotX * scale)), hotY: Math.min(height - 1, Math.round(shape.hotY * scale)) };
}

/** Anything the PC says on the keys channel. */
export type PcMessage =
  | { kind: 'control'; said: PcSaid }
  | { kind: 'pointerShown'; shown: boolean }
  | { kind: 'pointerShape'; shape: PointerShape }
  /** The pretend controller: 0 not plugged in, 1 plugged in, 2 the PC has no controller driver, 3 the driver refused. */
  | { kind: 'pad'; what: number }
  /** Sound, in answer to being asked: 0 off, 1 on its way, 2 this PC is not sending sound. */
  | { kind: 'sound'; what: number };

export function pcMessage(message: Uint8Array): PcMessage | null {
  if (message.length < 2) return null;
  if (message[0] === STATE) {
    const said = pcSaid(message);
    return said === null ? null : { kind: 'control', said };
  }
  if (message[0] === POINTER_SHOWN) return { kind: 'pointerShown', shown: message[1] === 1 };
  if (message[0] === POINTER_SHAPE) {
    const shape = pointerShapeFrom(message);
    return shape === null ? null : { kind: 'pointerShape', shape };
  }
  if (message[0] === PAD_SAYS) return { kind: 'pad', what: message[1] };
  if (message[0] === SOUND_SAYS) return { kind: 'sound', what: message[1] };
  return null;
}

/** The PC's reason when its pretend controller could not be plugged in. */
export const PC_SAYS_PAD: Readonly<Record<number, string>> = { 2: 'THE PC HAS NO CONTROLLER DRIVER', 3: "THE PC'S CONTROLLER DRIVER REFUSED" };
