/**
 * BROWSER's keys (IMPROVE, 2026-11-23). Pure. None of them is one a browser keeps for itself on Windows (Ctrl+T, Ctrl+W, Ctrl+L, Alt+D are),
 * and none works while the page in the frame has the keyboard: a page from elsewhere hears its own keys, never ours.
 */
export type SeeingKey = { do: 'box' } | { do: 'new' } | { do: 'close' } | { do: 'tab'; index: number };

export type Pressed = { key: string; code: string; altKey: boolean; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; typing: boolean };

/** What a press asks of the machine, or null for one that isn't ours. `typing`: the press was in a box. */
export function seeingKey(pressed: Pressed): SeeingKey | null {
  if (pressed.ctrlKey || pressed.metaKey) return null;
  if (!pressed.altKey) return pressed.key === '/' && !pressed.shiftKey && !pressed.typing ? { do: 'box' } : null;
  if (pressed.shiftKey) return null;
  if (pressed.code === 'KeyN') return { do: 'new' };
  if (pressed.code === 'KeyW') return { do: 'close' };
  const digit = /^Digit([1-8])$/.exec(pressed.code);
  return digit === null ? null : { do: 'tab', index: Number(digit[1]) - 1 };
}

/** Said once, where the keys are listed. */
export const KEYS_LINE = 'KEYS: / THE BOX · ALT+N A NEW TAB · ALT+W CLOSE IT · ALT+1 TO 8 A TAB';
