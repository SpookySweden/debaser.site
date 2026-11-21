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
