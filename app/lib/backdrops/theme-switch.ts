import { keepingLocks, type BackdropDef, type SwitchKnob, type Values } from './knobs';

/**
 * The `[ THEME ]` switch every background with settings has, on as it comes (Luke, 2026-11-16; what it does is `./theme.ts`).
 * Here on its own, with nothing but the knob machinery, because the registry wraps every background in it and `./theme.ts`
 * itself reads the registry.
 */

export const THEME_KEY = 'theme';

/** The switch itself. `tab: ''` keeps it out of every tab: the window draws it at the top, above the tabs. */
export const THEME_KNOB: SwitchKnob = {
  kind: 'switch',
  key: THEME_KEY,
  tab: '',
  label: 'THEME',
  tip: "COLOURS, LIGHT AND MOOD MATCHED TO THE SITE'S THEME, AND FOLLOWING IT WHEN THE THEME CHANGES. OFF: YOUR OWN SETTINGS",
  party: 0,
};

/**
 * RESET (Luke, 2026-11-17: "the "theme" button ... should be a toggle separate to the "reset" button, the reset button resets
 * according to wether theme is on or off, resetting to a separate default ie the one we used before incoroporating the "theme"
 * button"). Every knob goes back to the background as it comes, except the locked ones and `[ THEME ]` itself, which RESET never
 * flips. With THEME on, that is the theme's tuned look (the theme sets and nudges the defaults, `./theme.ts`); with THEME off,
 * the background's own plain defaults, as they were before the switch existed (FLUID: GRID 10px, COLOUR STEPS 3, DITHER 15%,
 * KALEIDOSCOPE OFF).
 */
export function resetValues(def: BackdropDef, current: Values, locks: readonly string[]): Values {
  return keepingLocks(def, def.defaults, current, [...locks, THEME_KEY]);
}

/** A background's settings with the switch added, on as it comes, and on in every ready-made look. */
export function withThemeSwitch(def: BackdropDef): BackdropDef {
  if (def.knobs.some((knob) => knob.key === THEME_KEY)) return def;
  return {
    ...def,
    knobs: [...def.knobs, THEME_KNOB],
    defaults: { ...def.defaults, [THEME_KEY]: true },
    looks: def.looks.map((look) => ({ ...look, values: { ...look.values, [THEME_KEY]: true } })),
  };
}
