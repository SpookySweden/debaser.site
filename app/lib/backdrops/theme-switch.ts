import type { BackdropDef, SwitchKnob } from './knobs';

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
