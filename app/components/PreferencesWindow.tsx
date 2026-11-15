'use client';

import { useSyncExternalStore, type ReactNode } from 'react';
import { PLATE, PLATE_PRESSED, TITLE_BAR_INACTIVE } from '../lib/ui/controls';
import { OUTSIDE_MODES, outsidePicturesServerState, outsidePicturesState, setOutsideMode, subscribeToOutsidePictures } from '../lib/watch/outside-pictures';
import {
  CURSORS,
  cursorState,
  setCursor,
  subscribeToCursor,
  type Cursor,
} from '../lib/ui/cursor-slot';
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
  type ThemeFamily,
  type ThemeId,
} from '../lib/ui/theme-slot';
import { resetLayout } from '../lib/ui/window-layout';
import { BACKDROPS, backdropState, setBackdrop, subscribeToBackdrop } from '../lib/ui/backdrop-slot';
import CompanionPreferences from './CompanionPreferences';
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
function ThemeRow({
  theme,
  active,
  label = theme.label,
  note = theme.note,
  option = false,
}: {
  theme: Theme;
  active: boolean;
  label?: string;
  note?: string;
  /** An option of the template above it: set in from the left, under its template. */
  option?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={() => setTheme(theme.id)}
      aria-pressed={active}
      title={note}
      className={`flex cursor-pointer items-center gap-2 px-2 py-1 text-left text-label max-sm:min-h-tap max-sm:px-3 max-sm:text-sm ${
        option ? 'ml-6 w-[calc(100%-1.5rem)]' : 'w-full'
      } ${
        active
          ? 'key key-fill [--key-fill:var(--color-ink)] text-paper'
          : 'key'
      }`}
    >
      <ThemeSwatch theme={theme} />

      <span className="min-w-0 flex-1 truncate">
        [ {label} ]
        {theme.experimental === true ? ' :: EXPERIMENTAL' : ''}
      </span>
    </button>
  );
}

/**
 * The THEME list: one row per template. A template with options (SHERBET) is one row that picks its
 * first option, and while any of its options is on they are listed under it, the one on filled.
 */
function ThemeList({ id }: { id: ThemeId }) {
  const current = THEMES.find((theme) => theme.id === id);
  const rows: ReactNode[] = [];
  const seen = new Set<ThemeFamily>();

  for (const theme of THEMES) {
    const family = theme.family;
    if (family === undefined) {
      rows.push(<ThemeRow key={theme.id} theme={theme} active={theme.id === id} />);
      continue;
    }
    if (seen.has(family)) continue;
    seen.add(family);

    const options = THEMES.filter((option) => option.family === family);
    const on = current?.family === family;
    rows.push(
      <ThemeRow
        key={family.label}
        theme={on && current !== undefined ? current : theme}
        active={on}
        label={family.label}
        note={family.note}
      />,
    );
    if (on) {
      for (const option of options) {
        rows.push(<ThemeRow key={option.id} theme={option} active={option.id === id} option />);
      }
    }
  }

  return <>{rows}</>;
}

/** One cursor's row: the theme row's key, without a swatch (the cursor itself is the preview). */
function CursorRow({ cursor, active }: { cursor: Cursor; active: boolean }) {
  return (
    <button
      type="button"
      onClick={() => setCursor(cursor.id)}
      aria-pressed={active}
      title={cursor.note}
      className={`flex w-full cursor-pointer items-center gap-2 px-2 py-1 text-left text-label ${
        active
          ? 'key key-fill [--key-fill:var(--color-ink)] text-paper'
          : 'key'
      }`}
    >
      <span className="min-w-0 flex-1 truncate">[ {cursor.label} ]</span>
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
/** ASK (the start), ALWAYS SHOW or NEVER: one of three, the chosen one pressed in. */
function OutsidePicturesChoice() {
  const { mode } = useSyncExternalStore(subscribeToOutsidePictures, outsidePicturesState, outsidePicturesServerState);
  return (
    <section className="mt-2">
      <div className={TITLE_BAR_INACTIVE} title="A picture somebody queued from outside the site is loaded from wherever it lives, and that server sees your browser ask for it">
        <span>OUTSIDE PICTURES</span>
      </div>

      <div className="flex flex-wrap items-center gap-1 p-2" role="group" aria-label="Outside pictures" data-outside-pictures={mode}>
        {OUTSIDE_MODES.map((option) => (
          <button key={option.value} type="button" aria-pressed={mode === option.value} title={option.tip} onClick={() => setOutsideMode(option.value)} className={mode === option.value ? PLATE_PRESSED : PLATE} data-outside-mode={option.value}>
            [ {option.label} ]
          </button>
        ))}
      </div>
    </section>
  );
}

/** AQUARIUM or TILE: one row each, the theme row's key, the chosen one filled. Kept in this browser only, like the cursor. */
function BackdropChoice() {
  const { id } = useSyncExternalStore(subscribeToBackdrop, backdropState, backdropState);
  return (
    <section className="mt-2">
      <div className={TITLE_BAR_INACTIVE}>
        <span>BACKGROUND</span>
      </div>

      <div className="space-y-1 p-2" role="group" aria-label="Background" data-backdrop-choice={id}>
        {BACKDROPS.map((backdrop) => (
          <button
            key={backdrop.id}
            type="button"
            onClick={() => setBackdrop(backdrop.id)}
            aria-pressed={backdrop.id === id}
            title={backdrop.note}
            data-backdrop-option={backdrop.id}
            className={`flex w-full cursor-pointer items-center gap-2 px-2 py-1 text-left text-label max-sm:min-h-tap max-sm:px-3 max-sm:text-sm ${
              backdrop.id === id ? 'key key-fill [--key-fill:var(--color-ink)] text-paper' : 'key'
            }`}
          >
            <span className="min-w-0 flex-1 truncate">[ {backdrop.label} ]</span>
          </button>
        ))}
      </div>
    </section>
  );
}

export default function PreferencesWindow() {
  // Subscribed rather than read once, so the filled row moves the moment a theme is pressed.
  const { id } = useSyncExternalStore(subscribeToTheme, themeState, themeState);
  const { id: cursorId } = useSyncExternalStore(subscribeToCursor, cursorState, cursorState);
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
      defaultSize={{ w: 384, h: 620 }}
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
          <ThemeList id={id as ThemeId} />
        </div>
      </section>

      {/* What is behind the window: the Windows 98 aquarium (the default since 2026-11-15) or the theme's own tile. */}
      <BackdropChoice />

      {/* The pointer: a desktop thing too, since a phone has no cursor to change. */}
      <section className="mt-2 hidden sm:block">
        <div className={TITLE_BAR_INACTIVE}>
          <span>CURSOR</span>
        </div>

        <div className="space-y-1 p-2">
          {CURSORS.map((cursor) => (
            <CursorRow key={cursor.id} cursor={cursor} active={cursor.id === cursorId} />
          ))}
        </div>
      </section>

      {/* Your companion along the bottom of the site (SPEC-companion.md): on phones too, where it has its own switch. */}
      <CompanionPreferences />

      {/* Pictures from outside the site in a queue (SPEC-rooms-queues.md, section 6): loading one tells its server
          that this browser asked, so each viewer says whether theirs may. Kept in this browser only. */}
      <OutsidePicturesChoice />

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
