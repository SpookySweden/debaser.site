'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { replayTour, TOUR_PAGE } from '../lib/ui/first-visit-tour';
import { useEffect, useSyncExternalStore, type ReactNode } from 'react';
import { inkOnNameColour } from '../lib/profile/name-colours';
import { KEY_FOCUS } from '../lib/ui/controls';
import { MODULES, moduleColour, moduleIsOn, moduleSwatches, withColour, withTick, type ModuleDef } from '../lib/ui/modules';
import {
  closeModulesWindow,
  modulesSaveFailed,
  modulesState,
  modulesWindowOpen,
  serverModules,
  serverModulesSaveFailed,
  serverModulesWindowOpen,
  setModuleChoices,
  setModulesAccount,
  subscribeToModules,
  subscribeToModulesSaveFailed,
  subscribeToModulesWindow,
} from '../lib/ui/modules-slot';
import { subscribeToTheme, themeState, THEMES } from '../lib/ui/theme-slot';
import { useAuth } from './AuthProvider';
import DockWindow from './DockWindow';
import { useModeration } from './ModerationProvider';

const TICK = `${KEY_FOCUS} key inline-flex min-h-7 w-full items-center gap-2 px-1 text-sm font-bold leading-none disabled:cursor-not-allowed pointer-coarse:min-h-tap`;
const SWATCH = `${KEY_FOCUS} inline-flex h-7 w-7 items-center justify-center border-line border-ink text-key leading-none cursor-pointer pointer-coarse:min-h-tap pointer-coarse:min-w-tap`;
const SMALL_KEY = `${KEY_FOCUS} key inline-flex h-7 items-center px-1 text-label font-bold leading-none pointer-coarse:min-h-tap`;

/** A module still being made. Drawn in the key's own ink so it reads on any face the key wears. */
export function WipTag() {
  return (
    <span title="WORK IN PROGRESS" className="ml-1 border-line border-current px-0.5 text-label font-bold leading-none">
      WIP
    </span>
  );
}

/** The bar's fill on the theme in use: what a colour is read against. */
export function moduleBarColour(themeId: string): string {
  return (THEMES.find((theme) => theme.id === themeId) ?? THEMES[0]).tokens['sun-pale'];
}

function ModuleRow({ module, bar }: { module: ModuleDef; bar: string }) {
  const choices = useSyncExternalStore(subscribeToModules, modulesState, serverModules);
  const on = moduleIsOn(module, choices);
  // What its word turns on hover: the one picked, else the module's own default (FORUM, MEDIA and STREAM have one).
  const picked = moduleColour(module, choices);
  const chosen = choices.colours[module.key];
  const swatches = moduleSwatches(bar, picked);
  const pickedLabel = swatches.find((swatch) => swatch.id === picked)?.label ?? 'SITE';

  return (
    <li className="rule-pixel py-1.5">
      <button
        type="button"
        role="checkbox"
        aria-checked={on}
        disabled={module.always === true}
        onClick={() => setModuleChoices(withTick(choices, module, !on))}
        className={TICK}
      >
        <span aria-hidden="true">{on ? '[ ✓ ]' : '[   ]'}</span>
        <span>{module.label}</span>
        {module.wip ? <WipTag /> : null}
        {module.always ? <span className="text-label">ALWAYS ON</span> : null}
      </button>
      <p className="px-1 pt-1 text-label text-ink">COLOUR: {pickedLabel}</p>
      <div role="group" aria-label={`${module.label} colour`} className="flex flex-wrap items-center gap-1 px-1 pt-1">
        {swatches.map((swatch) => (
          <button
            key={swatch.id}
            type="button"
            aria-label={swatch.label}
            aria-pressed={picked === swatch.id}
            title={swatch.label}
            onClick={() => setModuleChoices(withColour(choices, module.key, swatch.id))}
            className={SWATCH}
            style={{ backgroundColor: swatch.ink, color: inkOnNameColour(swatch.ink) }}
          >
            {picked === swatch.id ? <span aria-hidden="true">✓</span> : null}
          </button>
        ))}
        <button type="button" aria-pressed={chosen === undefined} onClick={() => setModuleChoices(withColour(choices, module.key, null))} className={SMALL_KEY}>
          {module.defaultColour === undefined ? '[ SITE ]' : '[ DEFAULT ]'}
        </button>
      </div>
    </li>
  );
}

function Group({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section className="pb-2">
      {title ? <h3 className="text-sm font-bold text-ink">{title}</h3> : null}
      <ul>{children}</ul>
    </section>
  );
}

/**
 * The MODULOS key's list (Luke, 2026-11-06): tick what appears on your bar, and pick what colour each word turns on hover. A window beside the page rather than a
 * dialogue, because the bar it changes is the thing to look at while changing it. Drawn once in `layout.tsx`, and it's what tells the choices who is signed in.
 */
export default function ModulesWindow() {
  const open = useSyncExternalStore(subscribeToModulesWindow, modulesWindowOpen, serverModulesWindowOpen);
  const failed = useSyncExternalStore(subscribeToModulesSaveFailed, modulesSaveFailed, serverModulesSaveFailed);
  const { id: themeId } = useSyncExternalStore(subscribeToTheme, themeState, themeState);
  const { user, status } = useAuth();
  const person = status === 'signed-in' && user !== null ? user.id : null;
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (status !== 'loading') void setModulesAccount(person);
  }, [person, status]);

  if (!open) return null;
  const bar = moduleBarColour(themeId);

  return (
    // Full height (Luke, 2026-11-17: "make sure the modulos window opens to full height on the screen"): `tall` opens it as tall
    // as the room between the top bar and the music bar, as PREFERENCES does. A new layout name, so a box saved at the old
    // 640px height doesn't keep it short.
    <DockWindow
      title="MODULOS"
      onClose={closeModulesWindow}
      status=""
      dock="bottom"
      id="modules"
      layoutId="modules-tall"
      tall
      defaultSize={{ w: 400, h: 1000 }}
      minSize={{ w: 280, h: 200 }}
    >
      <div className="p-2">
        {failed ? (
          <p role="alert" className="w-fit bg-bubble-pale px-1 text-label text-ink-bar">
            COULD NOT SAVE TO YOUR ACCOUNT. KEPT IN THIS BROWSER.
          </p>
        ) : null}
        <Group>
          {MODULES.filter((module) => module.group === 'site').map((module) => (
            <ModuleRow key={module.key} module={module} bar={bar} />
          ))}
        </Group>
        <Group title="CREATIVE">
          {MODULES.filter((module) => module.group === 'creative').map((module) => (
            <ModuleRow key={module.key} module={module} bar={bar} />
          ))}
        </Group>
        <AlwaysOn signedIn={person !== null} />
        {/* The two places only the START menu led to on a computer, which went on 2026-11-14: the projects map (its shelves, CONCEPTS,
            LORE, NOTES and LINKS, hang off it) and the catalogue of the site's own files. PROJECTS is a module too, off until ticked. */}
        <section className="pb-2">
          <h3 className="text-sm font-bold text-ink">ALSO</h3>
          <p className="flex flex-wrap items-center gap-2 pt-1">
            <Link href="/projects" className={SMALL_KEY}>
              [ PROJECTS ]
            </Link>
            <Link href="/files" className={SMALL_KEY}>
              [ FILES ]
            </Link>
            {/* FIRSTVISIT (Luke's A, 2026-11-20): the desktop tour again, on the board. */}
            <button
              type="button"
              onClick={() => {
                closeModulesWindow();
                replayTour();
                if (pathname !== TOUR_PAGE) router.push(TOUR_PAGE);
              }}
              className={SMALL_KEY}
              data-tour-replay
            >
              [ TOUR ]
            </button>
          </p>
        </section>
      </div>
    </DockWindow>
  );
}

/**
 * The keys that are always there, listed so nobody hunts for a tick that isn't (Luke, 2026-11-21: "in modulos show the other
 * 'always ons' such as 'search, desk, reports if applicable'"). Locked on, like MODULOS's own row: each is the one door to what
 * it opens (the arrows are the site's undo, SEARCH the one box, REPORTS a moderator's duty, DESK what is waiting, the window
 * keys the way back to a normal window), so hiding one would only lose it. Who sees which follows the bar: REPORTS for
 * moderators, DESK for an account.
 */
function AlwaysOn({ signedIn }: { signedIn: boolean }) {
  const { role } = useModeration();
  const rows: { key: string; label: string; where: string }[] = [
    { key: 'arrows', label: '◄ ► UNDO / REDO', where: 'START OF THE BAR' },
    { key: 'search', label: '⌕ SEARCH', where: 'ON THE BAR · CTRL+K' },
    ...(role.moderator ? [{ key: 'reports', label: 'REPORTS', where: 'ON THE BAR · MODERATORS' }] : []),
    ...(signedIn ? [{ key: 'desk', label: '▭ DESK', where: 'SIDE PANEL, ABOVE THE BELL' }] : []),
    { key: 'window', label: 'HIDE / FILL WINDOW', where: 'END OF THE BAR' },
  ];
  return (
    <Group title="ALWAYS ON">
      {rows.map((row) => (
        <li key={row.key} className="rule-pixel py-1.5" data-always-on={row.key}>
          <button type="button" role="checkbox" aria-checked disabled className={TICK}>
            <span aria-hidden="true">[ ✓ ]</span>
            <span>{row.label}</span>
            <span className="text-label">ALWAYS ON</span>
          </button>
          <p className="px-1 pt-1 text-label text-ink">{row.where}</p>
        </li>
      ))}
    </Group>
  );
}
