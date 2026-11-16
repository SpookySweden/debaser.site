import { DYES, type ThemeId } from '../ui/themes';
import { subscribeToTheme, themeState } from '../ui/theme-slot';
import { mix, pixel, pixelFromHex, shade, type Palette } from './engine';
import { clampToKnob, type BackdropDef, type Values } from './knobs';
import { backdropDef } from './registry';
import { liveValues, subscribeToLiveValues } from './runtime';
import { THEME_KEY } from './theme-switch';

/**
 * `[ THEME ]` (Luke, 2026-11-16: "add a theme option for each backround that calibrates the colours and brightness and all of the
 * other settings to match each site theme in a unique way, this will be on by default and inside of the individual backrounds
 * settings as a switch").
 *
 * Every background with settings has the switch, on as it comes. While it is on, what the background is DRAWN with is the
 * reader's own settings with the site theme laid over them, and it follows the theme when the theme changes:
 *
 * - **colours**: the background's ink set becomes the theme's own dyes, brighter or deeper as the theme is (a few knobs are SET
 *   by the theme outright: COLOURS everywhere, and the AQUARIUM's water tint, light and murk);
 * - **the ground**: the empty background, black until now, is tinted toward the theme's desk (dark always, so the inks still
 *   read on it);
 * - **mood**: a few of the knobs that give a background its character are NUDGED a little from wherever the reader has them:
 *   a lively theme (OVERDRIVE) swirls and flies faster, a lazy one (TIGERBREAD, the pastels) slower and softer, a sleek one is
 *   cut cleaner and a crumbly one speckled more. The reader's sliders still work: they move the value the nudge starts from.
 *
 * Off, the background is the reader's own settings exactly, as before. Nothing here is stored but the switch (`theme`, a knob
 * like any other, saved lean: only when it is off). Nothing new moves: the theme changes colours and values, never adds motion,
 * so `prefers-reduced-motion` holds as before. A background is a simulation, not artwork (SPEC-backgrounds.md): every colour
 * here is a dye from `../ui/themes.ts`, named, never written.
 */

export { THEME_KEY, THEME_KNOB, withThemeSwitch } from './theme-switch';

type Dye = keyof typeof DYES;

/**
 * One site theme, as the backgrounds wear it. Hand-tuned, one each, so no two themes look alike.
 *
 * `inks`: the theme's own colours, the leading one first (null: the background's own colours, which are the site's dyes already).
 * `star`: the light most stars are. `ground` and `groundShare`: the empty background, that share of the way from black to the dye.
 * `sea`, `seaTint`, `seaLight`, `seaMurk`: the AQUARIUM's water colour and its WATER TINT, LIGHT and MURK. `glow`: the inks made
 * brighter (over 1) or deeper. `energy` (-1 lazy to 1 lively) and `crisp` (-1 crumbly to 1 sleek): the mood nudges.
 */
export type ThemeTune = {
  inks: readonly [Dye, Dye, Dye, Dye, Dye, Dye] | null;
  star: Dye;
  ground: Dye;
  groundShare: number;
  sea: Dye;
  seaTint: number;
  seaLight: number;
  seaMurk: number;
  glow: number;
  energy: number;
  crisp: number;
};

export const THEME_TUNES: Readonly<Record<ThemeId, ThemeTune>> = {
  // NIGROSINE, the site's own: the backgrounds keep their own dyes (they are this theme's), on the desk's Nigrosine.
  dark: { inks: null, star: 'white', ground: 'nigrosine', groundShare: 1, sea: 'royalBlue', seaTint: 14, seaLight: 95, seaMurk: 0, glow: 1, energy: 0, crisp: 0 },
  // DEBASER: Flavine and Brilliant Pink, loud, on a deep pink.
  default: { inks: ['brilliantPink', 'flavine', 'royalBlue', 'daffodil', 'emerald', 'rose'], star: 'flavine', ground: 'brilliantPink', groundShare: 0.16, sea: 'brilliantPink', seaTint: 22, seaLight: 100, seaMurk: 0, glow: 1, energy: 0.3, crisp: 0.3 },
  // SHERBET: pastels, soft and slow.
  'sherbet-pink': { inks: ['candy', 'mint', 'orchid', 'carnation', 'lime', 'coral'], star: 'candy', ground: 'orchid', groundShare: 0.22, sea: 'carnation', seaTint: 30, seaLight: 100, seaMurk: 10, glow: 1, energy: -0.3, crisp: -0.3 },
  'sherbet-night': { inks: ['coral', 'orchid', 'mint', 'lime', 'candy', 'salmon'], star: 'mint', ground: 'orchid', groundShare: 0.12, sea: 'orchid', seaTint: 32, seaLight: 75, seaMurk: 5, glow: 0.95, energy: 0, crisp: 0.2 },
  'sherbet-mint': { inks: ['mint', 'tangerine', 'lime', 'candy', 'salmon', 'orchid'], star: 'lime', ground: 'mint', groundShare: 0.16, sea: 'mint', seaTint: 28, seaLight: 100, seaMurk: 0, glow: 1, energy: 0.1, crisp: -0.2 },
  // MARMALADE, light: peach and pistachio, lazy and soft.
  'marmalade-peach': { inks: ['apricot', 'spearmint', 'nectar', 'peach', 'sage', 'burntOrange'], star: 'peach', ground: 'burntOrange', groundShare: 0.3, sea: 'apricot', seaTint: 26, seaLight: 100, seaMurk: 15, glow: 1, energy: -0.4, crisp: -0.4 },
  'marmalade-pistachio': { inks: ['spearmint', 'apricot', 'pistachioDeep', 'honeydew', 'peach', 'leaf'], star: 'pistachio', ground: 'leaf', groundShare: 0.35, sea: 'spearmint', seaTint: 26, seaLight: 100, seaMurk: 10, glow: 1, energy: -0.3, crisp: -0.2 },
  'marmalade-nectarine': { inks: ['papaya', 'fern', 'nectarineDeep', 'greengage', 'apricot', 'rust'], star: 'nectarine', ground: 'rust', groundShare: 0.3, sea: 'papaya', seaTint: 30, seaLight: 100, seaMurk: 5, glow: 1, energy: 0.1, crisp: 0 },
  'marmalade-kiwi': { inks: ['fern', 'papaya', 'kiwiDeep', 'greengage', 'nectarine', 'leaf'], star: 'kiwi', ground: 'forest', groundShare: 0.45, sea: 'fern', seaTint: 28, seaLight: 100, seaMurk: 5, glow: 1, energy: 0, crisp: -0.1 },
  // MARMALADE, dark: MAGMA is slow lava, MOSS a damp forest floor.
  'marmalade-magma': { inks: ['neonOrange', 'gold', 'kumquat', 'amber', 'neonGreen', 'papaya'], star: 'amber', ground: 'magmaDeep', groundShare: 1, sea: 'neonOrange', seaTint: 22, seaLight: 70, seaMurk: 25, glow: 1.05, energy: -0.5, crisp: -0.2 },
  'marmalade-moss': { inks: ['neonGreen', 'kumquat', 'lime', 'spearmint', 'amber', 'fern'], star: 'mintWhite', ground: 'mossDeep', groundShare: 1, sea: 'neonGreen', seaTint: 20, seaLight: 70, seaMurk: 30, glow: 1, energy: -0.3, crisp: -0.1 },
  // OVERDRIVE: neon on near-black, fast and cut clean.
  'overdrive-ember': { inks: ['neonOrange', 'amber', 'neonGreen', 'kumquat', 'cream', 'gold'], star: 'cream', ground: 'emberDesk', groundShare: 1, sea: 'neonOrange', seaTint: 30, seaLight: 85, seaMurk: 0, glow: 1.1, energy: 0.6, crisp: 1 },
  'overdrive-volt': { inks: ['neonGreen', 'kumquat', 'mintWhite', 'lime', 'neonOrange', 'spearmint'], star: 'mintWhite', ground: 'voltDesk', groundShare: 1, sea: 'neonGreen', seaTint: 30, seaLight: 85, seaMurk: 0, glow: 1.1, energy: 0.7, crisp: 1 },
  'overdrive-blaze': { inks: ['neonOrange', 'cyan', 'amber', 'lightBlue', 'lilacWhite', 'kumquat'], star: 'lilacWhite', ground: 'blazeBlack', groundShare: 1, sea: 'cyan', seaTint: 25, seaLight: 80, seaMurk: 0, glow: 1.1, energy: 0.8, crisp: 0.8 },
  'overdrive-glitch': { inks: ['magenta', 'neonGreen', 'cyan', 'lime', 'mintWhite', 'neonOrange'], star: 'mintWhite', ground: 'voltBlack', groundShare: 1, sea: 'magenta', seaTint: 30, seaLight: 80, seaMurk: 0, glow: 1.1, energy: 1, crisp: 1 },
  // TIGERBREAD: crumb, crust and char: lazy, warm, and speckled like a loaf.
  'tigerbread-crumb': { inks: ['golden', 'crustOrange', 'butter', 'crust', 'wheat', 'crumbDeep'], star: 'crumb', ground: 'crust', groundShare: 0.35, sea: 'golden', seaTint: 30, seaLight: 100, seaMurk: 25, glow: 1, energy: -0.4, crisp: -1 },
  'tigerbread-toasted': { inks: ['golden', 'crustOrange', 'wheat', 'toastedPale', 'butter', 'toastedGlow'], star: 'butter', ground: 'toasted', groundShare: 0.8, sea: 'crustOrange', seaTint: 30, seaLight: 80, seaMurk: 30, glow: 1, energy: -0.2, crisp: -0.8 },
  'tigerbread-charred': { inks: ['neonOrange', 'gold', 'crustOrange', 'amber', 'wheat', 'emberGlow'], star: 'amber', ground: 'charcoalDesk', groundShare: 1, sea: 'neonOrange', seaTint: 18, seaLight: 60, seaMurk: 40, glow: 0.95, energy: -0.1, crisp: -0.6 },
  // CLEMENTINE: the fruit, its pith and its leaves, bright and a little lively.
  clementine: { inks: ['clementine', 'limeLeaf', 'pith', 'leafGreen', 'clementineLight', 'pithWhite'], star: 'pithWhite', ground: 'leafDark', groundShare: 0.8, sea: 'clementine', seaTint: 30, seaLight: 100, seaMurk: 0, glow: 1, energy: 0.2, crisp: 0 },
};

const tuneOf = (theme: string): ThemeTune => THEME_TUNES[theme as ThemeId] ?? THEME_TUNES.dark;
const dyePixel = (name: Dye): number => pixelFromHex(DYES[name]) ?? 0;
/** A dye's CSS variable name: `lightBlue` is `--dye-light-blue` in the token files. */
export const dyeVariable = (name: Dye): string => `--dye-${name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`;

/* ------------------------------------------------------------------ what the theme does to the knobs */

/** The knobs a theme SETS outright on a background (the window shows them as the theme's, not to be moved while it is on). */
export function themeSet(theme: string, id: string): Values {
  const tune = tuneOf(theme);
  if (id === 'aquarium') return { tint: tune.seaTint, tintHue: 0, light: tune.seaLight, murk: tune.seaMurk };
  // The theme's inks are laid over the `dyes` set's names (see `themePalette`), so the set is chosen for them.
  return tune.inks === null ? {} : { colours: 'dyes' };
}

/** How far a theme nudges a background's character knobs from the reader's own values (added, then held to the knob). */
export function themeNudges(theme: string, id: string): Record<string, number> {
  const { energy: e, crisp: c } = tuneOf(theme);
  const nudges: Record<string, number> =
    id === 'fluid'
      ? { swirl: 15 * e, thickness: -10 * e, auto: 10 * e, dither: -15 * c, steps: c >= 0.5 ? 1 : 0 }
      : id === 'sand'
        ? { speckle: -30 * c, rain: 8 * e, fireSpread: 15 * e }
        : id === 'starfield'
          ? { speed: 15 * e, warp: e > 0 ? 10 * e : 0, twinkle: -15 * c }
          : id === 'mystify'
            ? { speed: 15 * e, trails: -4 * e, cycle: 15 * e }
            : id === 'aquarium'
              ? { speed: 0.5 * e, flap: 4 * e, bubbles: 2 * e }
              : {};
  for (const key of Object.keys(nudges)) if (Math.abs(nudges[key]) < 1e-9) delete nudges[key];
  return nudges;
}

/**
 * The settings a background is drawn with: the reader's own, and while THEME is on, the theme's set knobs and nudges laid over
 * them. The same object back when THEME is off or the theme changes nothing.
 */
export function themedValues(def: BackdropDef, values: Values, theme: string): Values {
  if (values[THEME_KEY] !== true) return values;
  const set = themeSet(theme, def.id);
  const nudges = themeNudges(theme, def.id);
  if (Object.keys(set).length === 0 && Object.keys(nudges).length === 0) return values;
  const next: Values = { ...values };
  for (const knob of def.knobs) {
    if (knob.key in set) next[knob.key] = set[knob.key];
    else if (knob.kind === 'range' && knob.key in nudges && typeof values[knob.key] === 'number') next[knob.key] = clampToKnob(knob, (values[knob.key] as number) + nudges[knob.key]);
  }
  return next;
}

/* ------------------------------------------------------------------ what the theme does to the colours */

/**
 * A colour at full strength, its hue kept: the weakest of its three parts taken nearly out and the rest stretched to the top.
 * FLUID's character is pure dye in water, cut to a few COLOUR STEPS: a pale or warm ink (Amber, Candy) cut that way falls to
 * grey and olive at its edges, where a pure one stays its own colour. So its inks are worn this way; the others wear them as they are.
 */
export function vivid(colour: number): number {
  const parts = [colour & 255, (colour >>> 8) & 255, (colour >>> 16) & 255];
  const floor = Math.min(...parts) * 0.85;
  const top = Math.max(...parts) - floor;
  if (top <= 0) return colour;
  const [r, g, b] = parts.map((part) => Math.round(((part - floor) / top) * 255));
  return pixel(r, g, b);
}

/**
 * The palette a simulated background draws with: the site's dyes, and while THEME is on, the names its `dyes` set uses repainted
 * in the theme's own colours (each background keeps its kinds apart: sand's water stays watery, its plants green-ish).
 */
export function themePalette(theme: string, id: string, base: Palette, on: boolean): Palette {
  const tune = tuneOf(theme);
  if (!on || tune.inks === null) return base;
  const ink = tune.inks.map((name) => shade(dyePixel(name), tune.glow));
  const named = (name: string) => base[name] ?? 0;
  const ground = dyePixel(tune.ground);
  const paint: Record<string, number> =
    id === 'fluid'
      ? { 'brilliant-pink': vivid(ink[0]), 'royal-blue': vivid(ink[1]), daffodil: vivid(ink[2]) }
      : id === 'sand'
        ? {
            daffodil: ink[0],
            tangerine: mix(ink[0], ink[5], 0.45),
            'royal-blue': mix(named('royal-blue'), ink[1], 0.5),
            'light-blue': mix(named('light-blue'), ink[1], 0.5),
            emerald: mix(named('emerald'), ink[3], 0.5),
            'deep-green': mix(named('deep-green'), ink[3], 0.3),
            ash: mix(named('ash'), ground, 0.35),
            'moon-ink': mix(named('moon-ink'), ink[4], 0.3),
            orchid: mix(named('orchid'), ink[5], 0.5),
            rose: mix(named('rose'), ink[2], 0.4),
          }
        : id === 'starfield'
          ? { white: shade(dyePixel(tune.star), tune.glow), daffodil: shade(dyePixel(tune.star), tune.glow), 'light-blue': ink[0], 'brilliant-pink': ink[1], mint: ink[2] }
          : id === 'mystify'
            ? { 'brilliant-pink': ink[0], daffodil: ink[1], 'light-blue': ink[2], emerald: ink[3], tangerine: ink[4], orchid: ink[5] }
            : {};
  return { ...base, ...paint };
}

/** The empty background's colour while THEME is on: the theme's desk, darkened. 0 (the black behind) while it is off. */
export function themeGround(theme: string, on: boolean): number {
  if (!on) return 0;
  const tune = tuneOf(theme);
  return mix(dyePixel('black'), dyePixel(tune.ground), tune.groundShare);
}

/** The AQUARIUM's water colour while THEME is on, as the dye's CSS variable; null while it is off (the water's own Royal Blue). */
export function aquariumSeaVariable(theme: string, on: boolean): string | null {
  return on ? dyeVariable(tuneOf(theme).sea) : null;
}

/* ------------------------------------------------------------------ in the browser */

export const currentThemeId = (): string => themeState().id;
export { subscribeToTheme };

const drawnCache = new Map<string, { live: Values; theme: string; values: Values }>();

/**
 * A background's settings as it is drawn this instant: the live values (stored, swayed, bounced) with the theme laid over them.
 * The same object for as long as neither moves, so React and the backgrounds' loops can tell "unchanged" by looking.
 */
export function drawnValues(id: string): Values {
  const live = liveValues(id);
  const def = backdropDef(id);
  if (def === null) return live;
  const theme = currentThemeId();
  const cached = drawnCache.get(id);
  if (cached !== undefined && cached.live === live && cached.theme === theme) return cached.values;
  const values = themedValues(def, live, theme);
  drawnCache.set(id, { live, theme, values });
  return values;
}

/** Fires when the live values move or the site theme changes. */
export function subscribeToDrawnValues(listener: () => void): () => void {
  const stopLive = subscribeToLiveValues(listener);
  const stopTheme = subscribeToTheme(listener);
  return () => {
    stopLive();
    stopTheme();
  };
}
