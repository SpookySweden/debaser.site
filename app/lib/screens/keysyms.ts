/**
 * A browser key as the X11 key number ("keysym") Guacamole sends to the server's Remote Desktop. guacd turns it into
 * the Windows key itself, by the server's keyboard layout. Null for a key that has no meaning to send.
 */

const NAMED: Record<string, number> = {
  Escape: 0xff1b,
  Enter: 0xff0d,
  Backspace: 0xff08,
  Tab: 0xff09,
  CapsLock: 0xffe5,
  NumLock: 0xff7f,
  ScrollLock: 0xff14,
  Pause: 0xff13,
  PrintScreen: 0xff61,
  ContextMenu: 0xff67,
  Insert: 0xff63,
  Delete: 0xffff,
  Home: 0xff50,
  End: 0xff57,
  PageUp: 0xff55,
  PageDown: 0xff56,
  ArrowLeft: 0xff51,
  ArrowUp: 0xff52,
  ArrowRight: 0xff53,
  ArrowDown: 0xff54,
  AltGraph: 0xfe03,
};

/** Left and right keep their own numbers, as the server tells them apart. */
const SIDED: Record<string, [number, number]> = {
  Shift: [0xffe1, 0xffe2],
  Control: [0xffe3, 0xffe4],
  Alt: [0xffe9, 0xffea],
  Meta: [0xffeb, 0xffec],
  OS: [0xffeb, 0xffec],
};

/** The number pad by its key's place, so the server sees the pad, whatever NumLock says here. */
const PAD: Record<string, number> = {
  NumpadEnter: 0xff8d,
  NumpadMultiply: 0xffaa,
  NumpadAdd: 0xffab,
  NumpadSubtract: 0xffad,
  NumpadDecimal: 0xffae,
  NumpadDivide: 0xffaf,
};

export function keysymOf(event: Pick<KeyboardEvent, 'key' | 'code' | 'location'>): number | null {
  const { key, code } = event;
  if (key in SIDED) return SIDED[key][code.endsWith('Right') ? 1 : 0];
  if (code in PAD) return PAD[code];
  if (/^Numpad[0-9]$/.test(code) && /^[0-9]$/.test(key)) return 0xffb0 + Number(key);
  if (key in NAMED) return NAMED[key];
  const f = /^F([1-9]|1[0-9]|2[0-4])$/.exec(key);
  if (f) return 0xffbd + Number(f[1]);
  if (key === ' ' || key === 'Spacebar') return 0x20;
  const chars = [...key];
  if (chars.length === 1) {
    const point = chars[0].codePointAt(0) ?? 0;
    // Latin-1 is its own number; everything else is 0x01000000 plus its Unicode number.
    if (point >= 0x20 && point <= 0x7e) return point;
    if (point >= 0xa0 && point <= 0xff) return point;
    if (point > 0xff) return 0x01000000 + point;
  }
  return null;
}
