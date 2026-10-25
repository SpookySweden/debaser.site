'use client';

import { useSyncExternalStore } from 'react';
import { PLATE, TITLE_BAR_INACTIVE } from '../lib/ui/controls';
import {
  closePreferences,
  preferencesWindowState,
  subscribeToPreferencesWindow,
} from '../lib/ui/preferences-window';
import {
  setTheme,
  subscribeToTheme,
  themeState,
  THEMES,
  type Theme,
  type ThemeId,
} from '../lib/ui/theme-slot';
import { resetLayout } from '../lib/ui/window-layout';
import DockWindow from './DockWindow';

/** The lamp on a theme's row: filled with the field it would give you, inked with that theme's prose. */
function ThemeSwatch({ theme }: { theme: Theme }) {
  return (
    <span
      aria-hidden="true"
      className="inline-block h-4 w-4 shrink-0 rounded-none border border-ink-plate"
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
 * One theme's row: a key that switches to it, filled while it is the one on.
 *
 * A `button` with `aria-pressed` rather than a radio group, because the whole row is the control on
 * this site - a 13px radio beside a label would be the only native input on the page that is not a
 * field, and it would not take the site's press. The filled pill is what says which one is on, as it
 * does for every tab and switch, so the `[ ON ]` / `[ ]` mark went (SPEC-efficiency.md, 2026-10-23);
 * the theme's note is the row's hover tip.
 */
function ThemeRow({ theme, active }: { theme: Theme; active: boolean }) {
  return (
    <button
      type="button"
      onClick={() => setTheme(theme.id)}
      aria-pressed={active}
      title={theme.note}
      className={`flex w-full cursor-pointer items-center gap-2 px-2 py-1 text-left text-label max-sm:min-h-tap max-sm:px-3 max-sm:text-sm ${
        active
          ? 'key key-fill [--key-fill:var(--color-ink)] text-paper'
          : 'key'
      }`}
    >
      <ThemeSwatch theme={theme} />

      <span className="min-w-0 flex-1 truncate">
        [ {theme.label} ]
        {theme.experimental === true ? ' :: EXPERIMENTAL' : ''}
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
  // Subscribed rather than read once, so the filled row moves the moment a theme is pressed.
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
      onClose={closePreferences}
      // Empty on purpose: no title-bar tip (DockWindow's fallback is a drag how-to, SPEC-less-text.md).
      status=""
      dock="bottom"
      id="preferences"
      defaultSize={{ w: 384, h: 460 }}
      minSize={{ w: 280, h: 200 }}
    >
      {/* What each section is for is its title line's hover tip, not a paragraph under it
          (SPEC-efficiency.md, 2026-10-23). The SESSION placeholder, the "on the theme now" readback and
          the back-to-default key went with them: the filled row already says which theme is on. */}
      <section>
        <div className={TITLE_BAR_INACTIVE}>
          <span>THEME</span>
        </div>

        <div className="space-y-1 p-2">
          {THEMES.map((theme) => (
            <ThemeRow key={theme.id} theme={theme} active={theme.id === (id as ThemeId)} />
          ))}
        </div>
      </section>

      {/* Window layout: a desktop thing only, so a phone - which has bottom sheets, not windows - does
          not see it at all. */}
      <section className="mt-2 hidden sm:block">
        <div className={TITLE_BAR_INACTIVE}>
          <span>WINDOWS</span>
        </div>

        <p className="p-2">
          <button
            type="button"
            onClick={resetLayout}
            title="PUT EVERY WINDOW BACK IN ITS CORNER"
            className={PLATE}
          >
            [ RESET LAYOUT ]
          </button>
        </p>
      </section>
    </DockWindow>
  );
}
