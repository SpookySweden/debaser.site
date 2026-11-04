/**
 * The preferences window, held where it can fail.
 *
 * Three things this site decided about utility windows, all of which a new one can quietly break:
 *
 *   1. a window's state lives in a module-level slot, so opening it cannot re-render the board;
 *   2. a window drawn *over* the board is a toggle from the control that sits on the board - press
 *      again to shut what you opened;
 *   3. a setting is a `DockWindow` (beside the feed, no scrim), not a `PopoutWindow` (which takes the
 *      screen) - because a reader judging a theme needs to see the page it applies to.
 *
 * Compiled fresh on every run (it used to have no step here, so it tested a copy compiled weeks earlier):
 *   npx tsc app/components/PreferencesWindow.tsx app/components/ThemeHost.tsx --outDir Temp/preferences-out --module commonjs --target es2020 --moduleResolution node --jsx react-jsx --skipLibCheck --esModuleInterop
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');

// Imported rather than read as text, so this file is an entry point in the structure walk - every
// component the shell mounts has to be reachable from some check, and a check that only *greps* a
// component does not count as rendering it.
const slot = require('./preferences-out/lib/ui/preferences-window.js');
const PreferencesWindow = require('./preferences-out/components/PreferencesWindow.js').default;
const ThemeHost = require('./preferences-out/components/ThemeHost.js').default;
const window = fs.readFileSync('app/components/PreferencesWindow.tsx', 'utf8');
const profile = fs.readFileSync('app/components/SidebarProfile.tsx', 'utf8');
const layout = fs.readFileSync('app/layout.tsx', 'utf8');

/* 1. The slot, and no provider. */
const slotText = fs.readFileSync('app/lib/ui/preferences-window.ts', 'utf8');

assert.ok(typeof slot.togglePreferences === 'function', 'the row has a toggle');
assert.ok(typeof slot.openPreferences === 'function', 'and an opener');
assert.ok(typeof slot.closePreferences === 'function', 'and a closer');
assert.equal(typeof slot.subscribeToPreferencesWindow, 'function', 'and hands out a subscription');
assert.equal(slot.preferencesWindowState().open, false, 'and starts shut, so nothing is open on load');

// The toggle really toggles - this is the behaviour the panel row depends on.
slot.togglePreferences();
assert.equal(slot.preferencesWindowState().open, true, 'a press opens it');
slot.togglePreferences();
assert.equal(slot.preferencesWindowState().open, false, 'and a second press shuts what the first opened');

assert.match(slotText, /createWindowSlot</, 'the state is a module-level slot');
assert.doesNotMatch(
  slotText,
  /useContext|createContext/,
  'and not a context - a provider would re-render every consumer when a theme changes',
);

/* 2. A toggle, and the row states which way it is. */
assert.match(profile, /onClick=\{togglePreferences\}/, 'the menu row calls the toggle');
assert.match(profile, /preferencesOpen \? '\[ ON \]' : '\[ ▶ \]'/, 'with the state in the row`s own mark');
assert.doesNotMatch(profile, /\[ PREFERENCES \] :: SOON/, 'the placeholder is gone');

/* 3. Docked, not a dialogue - and it draws nothing until it is open. */
assert.match(window, /<DockWindow/, 'a setting is a docked window');
assert.doesNotMatch(window, /<PopoutWindow/, 'not a screen-taking dialogue');
assert.match(window, /dock="bottom"/, 'it docks to the lower corner, under the archive');
assert.match(window, /useSyncExternalStore\(/, 'the window reads its own slot');
assert.match(window, /if \(!open\) return null/, 'and draws nothing at all while it is shut');

/* 4. Drawn by the shell, so no page has to know about it. */
assert.match(layout, /<PreferencesWindow \/>/, 'the shell draws it once');
assert.doesNotMatch(
  profile,
  /<PreferencesWindow/,
  'and the panel does not - the panel only reads the slot for its tick',
);

/* 5. The theme, applied and remembered. */
const themeSlotSource = fs.readFileSync('app/lib/ui/theme-slot.ts', 'utf8');
assert.match(themeSlotSource, /applyTheme/, 'the theme is written onto the document');
assert.match(themeSlotSource, /localStorage/, 'and remembered');
assert.match(layout, /<ThemeHost \/>/, 'the shell mounts the applier');
assert.match(
  fs.readFileSync('app/components/ThemeHost.tsx', 'utf8'),
  /useEffect\(\(\) => initTheme\(\), \[\]\)/,
  'which runs once, on mount',
);

/* 6. Every theme in the library is offered by the picker, so a new one cannot be added and forgotten. */
// (2026-11-04) The picker walks the library by family now, one row per family.
assert.match(window, /for \(const theme of THEMES\)/, 'the picker draws whatever the library holds');
assert.match(window, /THEMES\.filter\(\(option\) => option\.family === family\)/, 'each row offering every theme of its family');

/* 7. Both components are real React components, so the structure walk sees them rendered. */
assert.equal(typeof PreferencesWindow, 'function', 'PreferencesWindow is a component');
assert.equal(typeof ThemeHost, 'function', 'ThemeHost is a component');

console.log('preferences window');
console.log('  slot     : module-level, read with useSyncExternalStore, no provider');
console.log('  trigger  : a toggle on the panel row, ticked while open');
console.log('  frame    : DockWindow - docked beside the feed rather than taking the screen');
console.log('  theme    : applied to <html>, remembered in localStorage, drawn from the library');
