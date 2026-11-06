'use client';

import { useEffect, useSyncExternalStore, type ReactNode } from 'react';
import { inkOnNameColour } from '../lib/profile/name-colours';
import { KEY_FOCUS } from '../lib/ui/controls';
import { MODULES, moduleIsOn, moduleSwatches, withColour, withTick, type ModuleDef } from '../lib/ui/modules';
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
  const picked = choices.colours[module.key];
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
      <p className="px-1 pt-1 text-label text-ink">HOVER: {pickedLabel}</p>
      <div role="group" aria-label={`${module.label} hover colour`} className="flex flex-wrap items-center gap-1 px-1 pt-1">
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
        <button type="button" aria-pressed={picked === undefined} onClick={() => setModuleChoices(withColour(choices, module.key, null))} className={SMALL_KEY}>
          [ SITE ]
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

  useEffect(() => {
    if (status !== 'loading') void setModulesAccount(person);
  }, [person, status]);

  if (!open) return null;
  const bar = moduleBarColour(themeId);

  return (
    <DockWindow title="MODULOS" onClose={closeModulesWindow} status="" dock="bottom" id="modules" defaultSize={{ w: 400, h: 640 }} minSize={{ w: 280, h: 200 }}>
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
      </div>
    </DockWindow>
  );
}
