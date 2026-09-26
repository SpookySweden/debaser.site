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
 *
 * ---
 *
 * **`MODEL_INK` was `#FFFFFF`, and that was the bug that made the figure a grey silhouette.**
 *
 * The measurement is what found it. Once the canvas actually drew, `Temp/measure-panes.cjs` reported every pane
 * as exactly two colours: the `MODEL_VOID` clear, and **`rgb(226,226,226)`** - 6,976 pixels in the front pane and
 * 5,235 in the side. A grey. The palette forbids greys, and the reason is not fussiness: white geometry under a
 * `meshLambertMaterial` is darkened by whatever light reaches it, and no light on this stage reaches 1.0, so
 * `#FFFFFF` plus lighting rounds to a grey *every time*. The figure had no colour of its own at all - it was a
 * white mass pretending to be one.
 *
 * So the ink is a real pigment, Violet, and the lighting has room to shade it darker *and* lighter without the
 * result ever being grey - because a saturated hue stays a hue as it dims. `MODEL_LIMB` gives the arms and legs
 * a second tone so a joint reads as a joint rather than as more of the same mass, which is also what makes the
 * two panes distinguishable rather than two silhouettes.
 */
export const MODEL_INK = '#7A5CC4';
export const MODEL_LIMB = '#4A3A7A';
export const MODEL_HIGHLIGHT = '#FF00A0';
export const MODEL_HANDLE = '#28C745';
export const MODEL_HANDLE_ACTIVE = '#FFF000';
export const MODEL_VOID = '#000000';

/**
 * The MASS layer's wireframe colour, which is the same green as a handle.
 *
 * Deliberately the same value as `MODEL_HANDLE` and still a separate name, because they mean different things: a
 * handle is a thing you grab, a wireframe is a thing you look at. Collapsing them would make "change the handle
 * colour" a change to the wireframe too, which is not what anybody editing one would expect.
 */
export const MODEL_WIRE = '#28C745';

/**
 * What a shape may be recoloured to, as *the site's own nine dyes* rather than a new set.
 *
 * **Reusing the palette is the point, not a shortcut.** `check-surreal.cjs` fails a component that writes a hex,
 * and the reason is not tidiness: a figure tinted in six colours nobody else on the site uses would stop looking
 * like it belongs to this site. The dyes below are the same values as the `@theme` tokens, named here because the
 * swatch row needs them as *values* to paint and to store - a class name cannot be persisted in a saved figure.
 *
 * **Nigrosine (`#1A1525`) and Black are deliberately absent.** Both are the field or the void - a shape in either
 * is a shape that has vanished, and a "recolour" control that offers invisibility is a control that will be
 * pressed by accident. `null` covers black: the render stage already draws the trunk in a dark violet.
 *
 * The first entry is `null` because "no colour of its own" is a choice like any other and has to be reachable
 * again - it is how a reader puts a shape back into the two-tone scheme the figure ships with.
 */
export type MassDye = { id: string; label: string; value: string | null };

export const MASS_DYES: readonly MassDye[] = [
  { id: 'figure', label: 'FIGURE', value: null },
  { id: 'royal', label: 'ROYAL BLUE', value: '#1D3CA6' },
  { id: 'acid', label: 'FLAVINE', value: '#E1FF00' },
  { id: 'sun', label: 'DAFFODIL', value: '#FFF000' },
  { id: 'emerald', label: 'EMERALD', value: '#28C745' },
  { id: 'bubble', label: 'BRILLIANT PINK', value: '#FF00A0' },
  { id: 'rose', label: 'ROSE', value: '#E6004C' },
  { id: 'paper', label: 'PURE WHITE', value: '#FFFFFF' },
];

/** True for a value the figure is allowed to wear, so a corrupt saved colour cannot reach the renderer. */
export function isMassDye(colour: string | null): boolean {
  return colour === null || MASS_DYES.some((dye) => dye.value === colour);
}
