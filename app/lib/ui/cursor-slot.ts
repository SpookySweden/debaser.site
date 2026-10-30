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

export type CursorId = 'contrast' | 'white' | 'black' | 'pink' | 'system';

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
  { id: 'system', label: 'SYSTEM', note: "YOUR COMPUTER'S OWN POINTER" },
];

const FALLBACK_CURSOR: CursorId = 'contrast';

const STORAGE_KEY = 'debaser.site.cursor.v1';

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
 * `themeBootScript` exists. A missing or unknown choice writes nothing, which is `contrast` in the CSS.
 */
export function cursorBootScript(): string {
  return [
    '(function(){try{',
    `var c=localStorage.getItem(${JSON.stringify(STORAGE_KEY)});`,
    `if(${JSON.stringify(CURSORS.map((cursor) => cursor.id))}.indexOf(c)>=0)`,
    'document.documentElement.setAttribute("data-cursor",c);',
    '}catch(e){}})();',
  ].join('');
}
