/**
 * Which cursor is on, as a store outside React - the theme's arrangement (`./theme-slot.ts`), and for the
 * same reason: changing it must not re-render the board. The cursor itself is three CSS custom properties
 * that the `Cursors` block of `globals.css` sets from the `data-cursor` attribute on `<html>`, so applying
 * a choice is one attribute write.
 *
 * `contrast` has no files of its own: it is the white set on the dark theme and the black set on the light
 * one, and `globals.css` picks between them from `data-theme`. `system` is the computer's own pointer.
 */
import { createWindowSlot } from './window-slot';

export type CursorId = 'contrast' | 'white' | 'black' | 'pink' | 'cat' | 'system';

export type Cursor = {
  id: CursorId;
  label: string;
  /** The row's hover tip. */
  note: string;
};

export const CURSORS: readonly Cursor[] = [
  { id: 'contrast', label: 'CONTRAST', note: 'WHITE ON THE DARK THEME, BLACK ON THE LIGHT ONE' },
  { id: 'white', label: 'WHITE', note: 'WHITE ON EVERY THEME' },
  { id: 'black', label: 'BLACK', note: 'BLACK ON EVERY THEME' },
  { id: 'pink', label: 'PINK', note: 'BRILLIANT PINK ON EVERY THEME' },
  { id: 'cat', label: 'CAT', note: 'A CAT: PAW UP OVER BUTTONS, A HEART ON A CLICK, A FLASH ON A RIGHT-CLICK' },
  { id: 'system', label: 'SYSTEM', note: "YOUR COMPUTER'S OWN POINTER" },
];

/** What a browser with no choice stored gets: PINK since 2026-11-16 (Luke: "new defaults ... PINK cursor", for everyone). */
const FALLBACK_CURSOR: CursorId = 'pink';

/** `.v2`: the old `.v1` choice is left behind on purpose, so each browser lands on the new default once and can choose again. */
const STORAGE_KEY = 'debaser.site.cursor.v2';

export type CursorState = { id: CursorId };

const slot = createWindowSlot<CursorState>({ id: FALLBACK_CURSOR });

/** The cursor as it is now, for `useSyncExternalStore`. */
export const cursorState = slot.state;

/** Draws from the cursor: the listener fires when it changes. */
export const subscribeToCursor = slot.subscribe;

/** A stored id that is no longer offered falls back to the default rather than throwing. */
function cursorId(stored: string | null): CursorId {
  return CURSORS.find((cursor) => cursor.id === stored)?.id ?? FALLBACK_CURSOR;
}

function readStored(): CursorId {
  try {
    return cursorId(window.localStorage.getItem(STORAGE_KEY));
  } catch {
    // No storage (private mode, blocked cookies): the default stands.
    return FALLBACK_CURSOR;
  }
}

/** Puts the stored cursor on the document and applies every later write, as `initTheme` does. */
export function initCursor(root: HTMLElement = document.documentElement): () => void {
  const apply = () => {
    root.dataset.cursor = slot.state().id;
  };

  apply();
  const unsubscribe = slot.subscribe(apply);
  slot.set({ id: readStored() });

  return unsubscribe;
}

/** Switches the cursor and remembers it. */
export function setCursor(id: CursorId): void {
  if (slot.state().id === id) return;

  slot.set({ id });

  try {
    window.localStorage.setItem(STORAGE_KEY, id);
  } catch {
    // The cursor still applies for this session; it just will not be remembered.
  }
}

/**
 * The stored cursor, as JavaScript for `<head>`, so the first paint already has it - the same reason
 * `themeBootScript` exists. A missing or unknown choice writes the default (PINK), as the backdrop's does: with the default
 * no longer the stylesheet's own fallback (`contrast`), the attribute is always written, even when storage is blocked.
 */
export function cursorBootScript(): string {
  return [
    '(function(){var b=',
    JSON.stringify(FALLBACK_CURSOR),
    ';try{',
    `var c=localStorage.getItem(${JSON.stringify(STORAGE_KEY)});`,
    `if(${JSON.stringify(CURSORS.map((cursor) => cursor.id))}.indexOf(c)>=0)b=c;`,
    '}catch(e){}',
    'document.documentElement.setAttribute("data-cursor",b);',
    '})();',
  ].join('');
}
