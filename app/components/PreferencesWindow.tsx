'use client';

import { useSyncExternalStore } from 'react';
import { PLATE, TITLE_BAR_INACTIVE } from '../lib/ui/controls';
import {
  closePreferences,
  preferencesWindowState,
  subscribeToPreferencesWindow,
} from '../lib/ui/preferences-window';
import {
  currentTheme,
  setTheme,
  subscribeToTheme,
  themeState,
  THEMES,
  type Theme,
  type ThemeId,
} from '../lib/ui/theme-slot';
import DockWindow from './DockWindow';

/** The lamp on a theme's row: filled with the field it would give you, inked with that theme's prose. */
function ThemeSwatch({ theme }: { theme: Theme }) {
  return (
    <span
      aria-hidden="true"
      className="inline-block h-4 w-4 shrink-0 rounded-none border border-black"
      style={{ backgroundColor: theme.tokens.paper, borderColor: theme.tokens.ink }}
    >
      <span
        className="block h-1/2 w-full"
        style={{ backgroundColor: theme.tokens.ena }}
      />
    </span>
  );
}

/**
 * One theme's row: a plate that switches to it, ticked if it is the one on.
 *
 * A `button` with `aria-pressed` rather than a radio group, because the whole row is the control on
 * this site - a 13px radio beside a label would be the only native input on the page that is not a
 * field, and it would not take the site's press. The tick is the same `[ ON ]`/`[ ]` mark the shelf
 * keys use, so "which one is selected" reads the same way everywhere.
 */
function ThemeRow({ theme, active }: { theme: Theme; active: boolean }) {
  return (
    <button
      type="button"
      onClick={() => setTheme(theme.id)}
      aria-pressed={active}
      title={theme.experimental ? `${theme.label} - experimental` : theme.label}
      className={`flex w-full cursor-pointer items-start gap-2 rounded-none border-t border-l border-r-2 border-b-2 px-2 py-1 text-left text-[10px] font-bold max-sm:min-h-11 max-sm:px-3 max-sm:text-sm ${
        active
          ? 'border-t-black border-l-black border-r-white border-b-white bg-ena text-sun'
          : 'border-t-white border-l-white border-black bg-sun text-ink-plate hover:bg-ice'
      }`}
    >
      <ThemeSwatch theme={theme} />

      <span className="min-w-0 flex-1">
        <span className="block truncate">
          {theme.label}
          {theme.experimental === true ? ' :: EXPERIMENTAL' : ''}
        </span>
        <span className={`mt-[2px] block text-[10px] font-normal ${active ? 'text-sun' : 'text-ink'}`}>
          {theme.note}
        </span>
      </span>

      <span aria-hidden="true" className="shrink-0 pt-[2px]">
        {active ? '[ ON ]' : '[ ]'}
      </span>
    </button>
  );
}

/**
 * Preferences: the settings a reader keeps for themselves, in a window beside the board.
 *
 * It is a `DockWindow` rather than a `PopoutWindow`, and that is the site's own rule rather than a
 * preference: the pop-ups are *dialogues* - the composer, the pickers - and they take the screen,
 * while a setting a reader changes is something they do while still looking at the page they are
 * changing. Docking it means the board stays behind it and a theme can be judged against the thing it
 * is for, which is also why there is no live preview pane: the preview is the page.
 *
 * The window is drawn once in `layout.tsx` and its state is a module-level slot
 * (`../lib/ui/preferences-window.ts`), so opening it does not re-render the board underneath - the
 * same arrangement the arcade and the archive keep.
 */
export default function PreferencesWindow() {
  // Subscribed rather than read once, so the tick moves the moment a theme is pressed.
  const { id } = useSyncExternalStore(subscribeToTheme, themeState, themeState);
  const { open } = useSyncExternalStore(
    subscribeToPreferencesWindow,
    preferencesWindowState,
    preferencesWindowState,
  );

  // Drawn only while it is open. The slot is read here rather than by a host above it, so the window
  // is the only thing that re-renders when it opens or closes - the same arrangement `MusicWindow`
  // keeps, and the reason opening a window cannot touch the board.
  if (!open) return null;

  return (
    <DockWindow
      title="PREFERENCES"
      badge="[ SETTINGS ]"
      onClose={closePreferences}
      status="CHANGES APPLY AT ONCE :: DRAG THE TITLE BAR TO MOVE IT"
      dock="bottom"
      widthClass="sm:w-[min(24rem,calc(100vw-1.5rem))]"
    >
      <section className="rounded-none border-2 border-t-white border-l-white border-r-black border-b-black bg-sun-pale">
        <div className={TITLE_BAR_INACTIVE}>
          <span>THEME</span>
          <span>[ {THEMES.length} ]</span>
        </div>

        <p className="border-b border-ink px-2 py-1 text-[10px] text-ink-plate">
          THE COLOURS THE WHOLE SITE IS DRAWN IN. EVERY THEME IS HELD TO THE SAME CONTRAST FLOOR, SO
          NOTHING HERE CAN MAKE A PAGE UNREADABLE.
        </p>

        <div className="space-y-1 p-2">
          {THEMES.map((theme) => (
            <ThemeRow key={theme.id} theme={theme} active={theme.id === (id as ThemeId)} />
          ))}
        </div>
      </section>

      <section className="mt-2 rounded-none border-2 border-t-white border-l-white border-r-black border-b-black bg-sun-pale">
        <div className={TITLE_BAR_INACTIVE}>
          <span>SESSION</span>
          <span>[ SOON ]</span>
        </div>

        <p className="p-2 text-[10px] text-ink-plate">
          WHAT THIS WILL HOLD - SIGN-OUT, THE NOTIFICATION SOUND, WHETHER THE PLAYER BAR STARTS OPEN -
          IS STILL BEING DECIDED, SO NOTHING IS DRAWN HERE YET. THE ROW IS LEFT IN PLACE SO THE WINDOW
          DOES NOT GROW ONE LATER.
        </p>
      </section>

      <p className="mt-2 text-center text-[10px] text-ink-plate">
        ON THE THEME NOW:{' '}
        <span className="font-bold text-ink-plate">{currentTheme().label}</span>
      </p>

      {/* The one place `PLATE` is spent in this window: a reader who wants the tick they came for and
          nothing else can get back to the default in one press. */}
      {id === 'default' ? null : (
        <p className="mt-1 text-center">
          <button type="button" onClick={() => setTheme('default')} className={PLATE}>
            [ BACK TO THE DEFAULT ]
          </button>
        </p>
      )}
    </DockWindow>
  );
}
