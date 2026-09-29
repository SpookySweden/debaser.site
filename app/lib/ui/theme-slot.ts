/**
 * Which theme is on, as a store outside React.
 *
 * The same shape the utility windows use (`./window-slot.ts`) and for the same reason: changing the
 * theme must not re-render the board. Everything that *is* the theme is a CSS custom property on
 * `<html>`, so applying one is a handful of `style.setProperty` calls that the browser repaints - no
 * React state, no re-render, no component that even knows which theme is on.
 *
 * The only React-aware part is the picker, which subscribes with `useSyncExternalStore` to draw which
 * theme is currently ticked. Nothing else in the site reads this.
 */
import { createWindowSlot } from './window-slot';
import { DEFAULT_THEME, THEMES, THEME_TOKEN_NAMES, themeById, type Theme, type ThemeId } from './themes';

const STORAGE_KEY = 'debaser.site.theme.v1';

/** The stored key, exported so the browser tooling can seed a theme without guessing at a string. */
export const THEME_STORAGE_KEY = STORAGE_KEY;

/** What the store holds: the id, and nothing else - the theme itself is looked up from the library. */
export type ThemeState = { id: ThemeId };

const slot = createWindowSlot<ThemeState>({ id: DEFAULT_THEME.id });

/** The theme as it is now, for `useSyncExternalStore`. */
export const themeState = slot.state;

/** Draws from the theme: the listener fires when it changes. */
export const subscribeToTheme = slot.subscribe;

/**
 * The token name as a CSS custom property.
 *
 * `ink-plate` becomes `--color-ink-plate`, which is the same name Tailwind's `@theme` block declares,
 * so a utility like `text-ink-plate` resolves to whatever the active theme put there.
 */
function propertyFor(token: string): string {
  return `--color-${token}`;
}

/**
 * Writes a theme onto the document.
 *
 * Every token is written, not just the ones that differ, so switching back to the default cannot leave
 * a value from the previous theme behind. `color-scheme` is written too: it is not a colour and no
 * component reads it, but it is the only way to tell the browser what the page *is* - the popup of a
 * `<select>`, a date picker, the caret and the default canvas background are drawn by Chrome, Safari and
 * Firefox and no stylesheet can reach them. A dark theme without it gets a white caret and a white
 * dropdown inside a dark window, which is a fault no component could have fixed.
 *
 * The `data-theme` attribute is written as well, and it is what anything that needs to branch on the
 * theme *in CSS* reads - there is nothing today, and it is there so that a future rule does not have to
 * invent a second mechanism.
 */
export function applyTheme(theme: Theme, root: HTMLElement): void {
  for (const token of THEME_TOKEN_NAMES) {
    root.style.setProperty(propertyFor(token), theme.tokens[token]);
  }

  root.dataset.theme = theme.id;
  root.style.colorScheme = theme.scheme;
}

/**
 * Reads the stored choice.
 *
 * A stored id that is no longer in the library falls back to the default rather than throwing: a theme
 * can be removed, and a browser that remembers a removed one must still open a readable site.
 */
function readStored(): ThemeId {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === null) return DEFAULT_THEME.id;
    return themeById(stored).id;
  } catch {
    // No storage (private mode, blocked cookies): the default stands.
    return DEFAULT_THEME.id;
  }
}

/**
 * Puts the stored theme on the document, once, as early as anything can.
 *
 * It subscribes to its own store and applies every write, so there is exactly one path that reaches
 * the document: `setTheme` writes the slot, this applies it, and the picker re-renders because it is
 * subscribed too. Wiring the apply to the subscription rather than to the calls is what stops a second
 * writer (a future "reset to default" button, a keyboard shortcut) from changing the store and leaving
 * the page on the old colours.
 *
 * Called from `layout.tsx`'s own effect, so the first paint has already happened in the default
 * colours and this corrects it. That flash is real and is the price of not having a server-rendered
 * theme; a `<script>` in `<head>` would avoid it, and would also mean the theme logic lived outside the
 * typed library. It is one frame, on a site whose whole look is a hard switch, so the trade is taken
 * deliberately rather than missed.
 *
 * The returned function unsubscribes - needed only by a test that mounts the shell twice.
 */
export function initTheme(root: HTMLElement = document.documentElement): () => void {
  const apply = () => applyTheme(currentTheme(), root);

  apply();
  const unsubscribe = slot.subscribe(apply);

  // A stored choice is read here rather than in the slot's initial value, because the slot is created
  // at module load on the server too, where there is no storage.
  slot.set({ id: readStored() });

  return unsubscribe;
}

/** Switches the theme and remembers it. */
export function setTheme(id: ThemeId): void {
  if (slot.state().id === id) return;

  slot.set({ id });

  try {
    window.localStorage.setItem(STORAGE_KEY, id);
  } catch {
    // The theme still applies for this session; it just will not be remembered.
  }
}

/** The theme the store is on. */
export function currentTheme(): Theme {
  return themeById(slot.state().id);
}

/**
 * The first paint of a themed site, as a string of JavaScript for `<head>`.
 *
 * `initTheme` runs in a React effect, which is after the browser has already painted the default
 * colours - so a reader who chose the dark theme got one frame of the light one. On a site whose whole
 * look is a hard switch that frame is a visible white flash, and the fix has to happen before the
 * browser has anything to paint, which in HTML means an inline `<script>` in `<head>`.
 *
 * It is *generated from this module's own library* rather than written out as a second copy of the
 * values. That matters more than it looks: a hand-written boot script is a place for the theme to be
 * said twice, and the two sayings drift - the tokens would be added to `themes.ts` and forgotten here,
 * and the flash would come back one token at a time. So the writes below are built from
 * `THEME_TOKEN_NAMES` and serialised from `THEMES`, which is the same data `applyTheme` walks. The
 * comment in `globals.css` that asks the library and the stylesheet to agree has a third party here.
 *
 * It is deliberately *not* a general-purpose script: it reads one key, picks one theme, writes its
 * tokens, and swallows every error. A browser with storage blocked gets the default theme - which is
 * exactly what the site looks like without this script at all.
 */
export function themeBootScript(): string {
  const themes = Object.fromEntries(THEMES.map((theme) => [theme.id, theme]));
  const writes = THEME_TOKEN_NAMES.map(
    (token) => `r.style.setProperty('--color-${token}',t.tokens[${JSON.stringify(token)}]);`,
  ).join('');

  return [
    '(function(){try{',
    `var k=${JSON.stringify(STORAGE_KEY)},d=${JSON.stringify(DEFAULT_THEME.id)},`,
    `a=${JSON.stringify(themes)};`,
    'var t=a[localStorage.getItem(k)||d]||a[d],r=document.documentElement;',
    writes,
    'r.setAttribute("data-theme",t.id);r.style.colorScheme=t.scheme;',
    '}catch(e){}})();',
  ].join('');
}

/** The picker's own list, so a component never imports the library's shape directly. */
export { THEMES } from './themes';
export type { Theme, ThemeId } from './themes';
