/**
 * The model's own colours, and why they are not the site's nine.
 *
 * `Temp/check-surreal.cjs` fails on a component that writes a palette hex of its own - the rule that keeps the
 * chrome to nine colours in one place. The figure is the one thing on screen that is **not** chrome: it is the
 * artefact the pixel shader has not recoloured yet, and giving it a site colour now would hard-code a decision
 * that pass has not made. So these are declared here, named, with the reason - which is what the rule actually
 * wants (one place, a stated reason) rather than a rule bent.
 *
 * They live in `app/lib/character/` next to the rig, not in `controls.ts`: that file is the *site's* palette and
 * adding three model colours to it would say they are part of the chrome. `check-surreal.cjs` reads components
 * for hexes; a named constant in a library file is the established way to keep one.
 */
export const MODEL_INK = '#FFFFFF';
export const MODEL_HIGHLIGHT = '#FF00A0';
export const MODEL_HANDLE = '#28C745';
export const MODEL_HANDLE_ACTIVE = '#FFF000';
export const MODEL_VOID = '#000000';
