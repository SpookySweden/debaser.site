/**
 * The AQUARIUM background's settings (SPEC-aquarium-settings.md, Luke 2026-11-15): every knob in the AQUARIUM window, what it
 * may be set to, and what a browser or an account that has stored something odd is read back as.
 *
 * Plain data and plain functions, no browser: the window draws `KNOBS`, the store parses with `parseAquariumSettings`, the
 * simulation (`./sim.ts`) reads the values, and the checks run all of it. `DEFAULT_SETTINGS` is the Windows 98 look the
 * aquarium shipped with: four fish, one of each, crossing alone.
 *
 * The machinery (parse, clamp, PARTY, the looks) is every background's since SPEC-backgrounds.md (`../backdrops/knobs.ts`);
 * this file is the aquarium's own list, and the same functions under the names the sea already used.
 */
import { morphValues, parseValues, partyValues, sameValues, shownValue as shownKnobValue, withValue, type BackdropDef, type Knob, type Values } from '../backdrops/knobs';

export type { Knob, RangeKnob, SwitchKnob, ChoiceKnob } from '../backdrops/knobs';

export type PointerMode = 'ignore' | 'scare' | 'follow';

export type AquariumSettings = {
  /** The shape's version, so a later change can tell an old save from a new one. */
  v: 1;
  // FISH
  size: number;
  count: number;
  butterfly: boolean;
  trigger: boolean;
  ray: boolean;
  stripe: boolean;
  speed: number;
  depthTop: number;
  depthBottom: number;
  flap: number;
  mixed: boolean;
  schooling: number;
  schoolSize: number;
  wander: number;
  parade: boolean;
  // SEA
  tint: number;
  tintHue: number;
  light: number;
  murk: number;
  dayNight: boolean;
  bubbles: number;
  bubbleSpeed: number;
  coralLeft: boolean;
  coralRight: boolean;
  coralSize: number;
  current: number;
  tide: boolean;
  // PLAY
  pointer: PointerMode;
  scareRadius: number;
  feed: boolean;
  pelletLife: number;
  greed: number;
  clickBubbles: boolean;
  wake: boolean;
  // SILLY
  upsideDown: boolean;
  mirror: boolean;
  rainbow: boolean;
  disco: boolean;
  gravity: number;
  time: number;
  tiny: boolean;
};

/** The aquarium as it shipped on 2026-11-15: what `[ RESET ]` and the `[ 98 ]` preset give back. */
export const DEFAULT_SETTINGS: AquariumSettings = {
  v: 1,
  size: 2,
  count: 4,
  butterfly: true,
  trigger: true,
  ray: true,
  stripe: true,
  speed: 1,
  depthTop: 4,
  depthBottom: 60,
  flap: 10,
  mixed: false,
  schooling: 0,
  schoolSize: 6,
  wander: 0,
  parade: false,
  tint: 0,
  tintHue: 0,
  light: 100,
  murk: 0,
  dayNight: false,
  bubbles: 4,
  bubbleSpeed: 1,
  coralLeft: true,
  coralRight: true,
  coralSize: 2,
  current: 0,
  tide: false,
  pointer: 'ignore',
  scareRadius: 160,
  feed: false,
  pelletLife: 20,
  greed: 50,
  clickBubbles: false,
  wake: false,
  upsideDown: false,
  mirror: false,
  rainbow: false,
  disco: false,
  gravity: 0,
  time: 1,
  tiny: false,
};

export type AquariumTab = 'fish' | 'sea' | 'play' | 'silly';

export const TABS: readonly { id: AquariumTab; label: string }[] = [
  { id: 'fish', label: 'FISH' },
  { id: 'sea', label: 'SEA' },
  { id: 'play', label: 'PLAY' },
  { id: 'silly', label: 'SILLY' },
];

/** Every knob, in the order the window lists them. */
export const KNOBS: readonly Knob[] = [
  // FISH
  { kind: 'range', key: 'size', tab: 'fish', label: 'FISH SIZE', tip: 'HOW BIG EVERY FISH IS. PAST 4x THE SEA HOLDS FEWER OF THEM: TEN AT 8x, FOUR AT 12x', min: 1, max: 12, step: 1, unit: 'x', party: [1, 4] },
  { kind: 'range', key: 'count', tab: 'fish', label: 'FISH COUNT', tip: 'HOW MANY FISH, SHARED BETWEEN THE KINDS THAT ARE ON', min: 0, max: 40, step: 1, unit: '', party: [3, 26] },
  { kind: 'switch', key: 'butterfly', tab: 'fish', label: 'BUTTERFLY', tip: 'THE YELLOW BUTTERFLYFISH', party: 0 },
  { kind: 'switch', key: 'trigger', tab: 'fish', label: 'TRIGGER', tip: 'THE BLUE TRIGGERFISH', party: 0 },
  { kind: 'switch', key: 'ray', tab: 'fish', label: 'RAY', tip: 'THE STINGRAY', party: 0 },
  { kind: 'switch', key: 'stripe', tab: 'fish', label: 'STRIPE', tip: 'THE ORANGE AND WHITE BUTTERFLYFISH', party: 0 },
  { kind: 'range', key: 'speed', tab: 'fish', label: 'SPEED', tip: 'HOW FAST THEY SWIM', min: 0.25, max: 4, step: 0.25, unit: 'x', party: [0.5, 2.5] },
  { kind: 'range', key: 'depthTop', tab: 'fish', label: 'HIGHEST', tip: 'HOW NEAR THE TOP THEY SWIM', min: 0, max: 90, step: 1, unit: '%', party: [0, 30] },
  { kind: 'range', key: 'depthBottom', tab: 'fish', label: 'LOWEST', tip: 'HOW NEAR THE BOTTOM THEY SWIM', min: 10, max: 100, step: 1, unit: '%', party: [45, 90] },
  { kind: 'range', key: 'flap', tab: 'fish', label: 'FLAP RATE', tip: 'HOW FAST TAILS AND FINS BEAT, IN FRAMES A SECOND', min: 3, max: 30, step: 1, unit: '', party: [5, 24] },
  { kind: 'switch', key: 'mixed', tab: 'fish', label: 'MIXED SIZES', tip: 'EACH FISH PICKS ITS OWN SIZE, UP TO FISH SIZE', party: 0.5 },
  { kind: 'range', key: 'schooling', tab: 'fish', label: 'SCHOOLING', tip: 'FROM EVERY FISH ALONE TO TIGHT SHOALS THAT TURN TOGETHER', min: 0, max: 100, step: 1, unit: '%' },
  { kind: 'range', key: 'schoolSize', tab: 'fish', label: 'SCHOOL SIZE', tip: 'THE MOST FISH IN ONE SHOAL', min: 2, max: 12, step: 1, unit: '' },
  { kind: 'range', key: 'wander', tab: 'fish', label: 'WANDER', tip: 'HOW OFTEN A FISH CHANGES ITS MIND AND TURNS', min: 0, max: 100, step: 1, unit: '%' },
  { kind: 'switch', key: 'parade', tab: 'fish', label: 'FOLLOW THE LEADER', tip: 'EVERY FISH LINES UP BEHIND THE FIRST', party: 0.15 },
  // SEA
  { kind: 'range', key: 'tint', tab: 'sea', label: 'WATER TINT', tip: 'HOW MUCH COLOUR IS IN THE WATER: NONE IS THE BLACK SEA', min: 0, max: 100, step: 1, unit: '%', party: [0, 70] },
  { kind: 'range', key: 'tintHue', tab: 'sea', label: 'TINT COLOUR', tip: "WHICH COLOUR THE WATER TINT IS, ROUND THE COLOUR WHEEL FROM BLUE", min: 0, max: 359, step: 1, unit: '°' },
  { kind: 'range', key: 'light', tab: 'sea', label: 'LIGHT', tip: 'THE WHOLE SEA DARKER OR BRIGHTER', min: 20, max: 100, step: 1, unit: '%', party: [65, 100] },
  { kind: 'range', key: 'murk', tab: 'sea', label: 'MURK', tip: 'A SOFT HAZE OVER THE WATER', min: 0, max: 100, step: 1, unit: '%', party: [0, 40] },
  { kind: 'switch', key: 'dayNight', tab: 'sea', label: 'DAY AND NIGHT', tip: 'THE LIGHT COMES AND GOES EVERY FEW MINUTES; AT NIGHT THE FISH SLOW AND SINK A LITTLE', party: 0.3 },
  { kind: 'range', key: 'bubbles', tab: 'sea', label: 'BUBBLES', tip: 'HOW MANY BUBBLES RISE OFF EACH CORAL', min: 0, max: 8, step: 1, unit: '' },
  { kind: 'range', key: 'bubbleSpeed', tab: 'sea', label: 'BUBBLE SPEED', tip: 'HOW FAST BUBBLES RISE', min: 0.25, max: 3, step: 0.25, unit: 'x' },
  { kind: 'switch', key: 'coralLeft', tab: 'sea', label: 'LEFT CORAL', tip: 'THE CORAL IN THE LEFT CORNER', party: 0 },
  { kind: 'switch', key: 'coralRight', tab: 'sea', label: 'RIGHT CORAL', tip: 'THE CORAL IN THE RIGHT CORNER', party: 0 },
  { kind: 'range', key: 'coralSize', tab: 'sea', label: 'CORAL SIZE', tip: 'HOW BIG THE CORAL IS', min: 1, max: 3, step: 1, unit: 'x' },
  { kind: 'range', key: 'current', tab: 'sea', label: 'CURRENT', tip: 'THE WATER PUSHES EVERYTHING LEFT (-) OR RIGHT (+)', min: -100, max: 100, step: 5, unit: '', signed: true, party: [-50, 50] },
  { kind: 'switch', key: 'tide', tab: 'sea', label: 'TIDE', tip: 'THE WHOLE SEA RISES AND FALLS A LITTLE, SLOWLY', party: 0.4 },
  // PLAY
  {
    kind: 'choice',
    key: 'pointer',
    tab: 'play',
    label: 'POINTER',
    tip: 'WHAT THE FISH MAKE OF YOUR POINTER',
    party: true,
    options: [
      { value: 'ignore', label: 'IGNORE', tip: 'THEY TAKE NO NOTICE' },
      { value: 'scare', label: 'SCARE', tip: 'THEY DART AWAY FROM IT' },
      { value: 'follow', label: 'FOLLOW', tip: 'THEY DRIFT AFTER IT' },
    ],
  },
  { kind: 'range', key: 'scareRadius', tab: 'play', label: 'SCARE RADIUS', tip: 'HOW CLOSE THE POINTER GETS BEFORE THEY BOLT', min: 60, max: 400, step: 10, unit: '' },
  { kind: 'switch', key: 'feed', tab: 'play', label: 'FEED ON CLICK', tip: 'CLICK THE SEA TO DROP FOOD: IT SINKS AND THE NEAREST FISH RACE FOR IT', party: 0.7 },
  { kind: 'range', key: 'pelletLife', tab: 'play', label: 'FOOD LASTS', tip: 'HOW LONG UNEATEN FOOD STAYS, IN SECONDS', min: 5, max: 60, step: 5, unit: 's' },
  { kind: 'range', key: 'greed', tab: 'play', label: 'GREED', tip: 'HOW FAR A FISH WILL COME FOR FOOD', min: 10, max: 100, step: 5, unit: '%' },
  { kind: 'switch', key: 'clickBubbles', tab: 'play', label: 'BUBBLES ON CLICK', tip: 'CLICK THE SEA TO LET OUT A BURST OF BUBBLES', party: 0.5 },
  { kind: 'switch', key: 'wake', tab: 'play', label: 'WAKE', tip: 'A TRAIL OF BUBBLES FOLLOWS YOUR POINTER', party: 0.4 },
  // SILLY
  { kind: 'switch', key: 'upsideDown', tab: 'silly', label: 'UPSIDE DOWN', tip: 'THE WHOLE SEA FLIPS: CORAL ON THE CEILING', party: 0.2 },
  { kind: 'switch', key: 'mirror', tab: 'silly', label: 'MIRROR', tip: 'THE WHOLE SEA, LEFT TO RIGHT', party: 0.3 },
  { kind: 'switch', key: 'rainbow', tab: 'silly', label: 'RAINBOW', tip: 'EVERY FISH CYCLES THROUGH ITS COLOURS', party: 0.4 },
  { kind: 'switch', key: 'disco', tab: 'silly', label: 'DISCO', tip: 'THE WATER CHANGES COLOUR TO A BEAT', party: 0.15 },
  { kind: 'range', key: 'gravity', tab: 'silly', label: 'GRAVITY', tip: 'FISH SINK (+) OR FLOAT UP (-)', min: -100, max: 100, step: 5, unit: '', signed: true, party: [-30, 30] },
  { kind: 'range', key: 'time', tab: 'silly', label: 'TIME', tip: 'EVERYTHING SLOWER OR FASTER', min: 0.1, max: 3, step: 0.1, unit: 'x', party: [0.5, 2] },
  { kind: 'switch', key: 'tiny', tab: 'silly', label: 'TINY TANK', tip: 'THE WHOLE AQUARIUM SHRINKS INTO A SMALL TANK IN THE CORNER', party: 0 },
];

/** The aquarium as the shared machinery sees it: its knobs, its two-knob controls, its one-press keys. The looks are added below. */
const BASE: BackdropDef = {
  id: 'aquarium',
  label: 'AQUARIUM',
  tabs: TABS,
  knobs: KNOBS,
  widgets: [
    { kind: 'band', id: 'depth', tab: 'fish', label: 'DEPTH', tip: 'THE STRETCH OF THE SEA THE FISH KEEP TO: DRAG EITHER END', low: 'depthTop', high: 'depthBottom', gap: 10 },
    { kind: 'pad', id: 'water', tab: 'sea', label: 'CURRENT AND GRAVITY', tip: 'ACROSS: THE CURRENT, LEFT OR RIGHT. UP AND DOWN: FISH FLOAT OR SINK', x: 'current', y: 'gravity' },
  ],
  actions: [{ id: 'giant', tab: 'silly', label: 'GIANT MODE', tip: 'FOR 20 SECONDS THE FISH ARE SIXTEEN TIMES THEIR SIZE (TWO AT THE MOST). PRESS AGAIN TO STOP' }],
  defaults: DEFAULT_SETTINGS as unknown as Values,
  looks: [],
  // Schooling, wander, tint, gravity and current are worth having at nothing as often as not: a party where every fish shoals
  // looks like the last one.
  partyRests: [
    { key: 'schooling', chance: 0.5 },
    { key: 'wander', chance: 0.4 },
    { key: 'tint', chance: 0.5 },
    { key: 'gravity', chance: 0.6 },
    { key: 'current', chance: 0.5 },
  ],
};

const typed = (values: Values): AquariumSettings => values as unknown as AquariumSettings;
const loose = (settings: AquariumSettings): Values => settings as unknown as Values;

/**
 * Whatever was stored, read back as settings: every key checked on its own, anything missing, of the wrong kind or out of range
 * falling back or clamped, unknown keys dropped. Never throws.
 */
export function parseAquariumSettings(raw: unknown): AquariumSettings {
  return typed(parseValues(BASE, raw));
}

/** One knob changed, the rest as they were, read back through the same checks. */
export function withSetting<Key extends keyof AquariumSettings>(settings: AquariumSettings, key: Key, value: AquariumSettings[Key]): AquariumSettings {
  return typed(withValue(BASE, loose(settings), key, value));
}

/** True when two settings are the same on every knob. */
export function sameSettings(a: AquariumSettings, b: AquariumSettings): boolean {
  return sameValues(BASE, loose(a), loose(b));
}

/** A value as the window writes it beside the knob's name. */
export const shownValue = shownKnobValue;

export type Preset = { id: string; label: string; tip: string; settings: AquariumSettings };

const preset = (changes: Partial<AquariumSettings>): AquariumSettings => parseAquariumSettings({ ...DEFAULT_SETTINGS, ...changes });

/** The looks the window's foot offers. `98` is the default, by name. */
export const PRESETS: readonly Preset[] = [
  { id: '98', label: '98', tip: 'THE WINDOWS 98 SCREENSAVER, AS IT CAME', settings: DEFAULT_SETTINGS },
  {
    id: 'calm',
    label: 'CALM',
    tip: 'A SLOW BLUE EVENING',
    settings: preset({ count: 6, speed: 0.5, flap: 6, wander: 20, tint: 25, tintHue: 0, light: 85, bubbles: 6, bubbleSpeed: 0.5, dayNight: true, tide: true, time: 0.8 }),
  },
  {
    id: 'school',
    label: 'SCHOOL',
    tip: 'SHOALS OF SMALL FISH THAT SCATTER FROM YOUR POINTER',
    settings: preset({ count: 24, size: 1, ray: false, trigger: false, schooling: 80, schoolSize: 8, wander: 15, pointer: 'scare', scareRadius: 220, depthBottom: 75 }),
  },
  {
    id: 'chaos',
    label: 'CHAOS',
    tip: 'EVERYTHING AT ONCE',
    settings: preset({
      count: 40, size: 3, mixed: true, speed: 2.5, flap: 24, wander: 100, depthTop: 0, depthBottom: 90, bubbles: 8, bubbleSpeed: 2, current: 40,
      pointer: 'scare', feed: true, clickBubbles: true, wake: true, rainbow: true, disco: true, time: 1.5,
    }),
  },
];

/** The aquarium, whole: what the settings window and the store work from. */
export const AQUARIUM: BackdropDef = { ...BASE, looks: PRESETS.map((look) => ({ id: look.id, label: look.label, tip: look.tip, values: loose(look.settings) })) };

/**
 * `[ PARTY ]`: every knob somewhere at random, inside limits that keep the sea worth looking at. `random` is `Math.random` on
 * the site and a fixed sequence in the checks.
 */
export function partySettings(random: () => number): AquariumSettings {
  return typed(partyValues(BASE, random));
}

/** MORPH for the sea, typed. */
export function morphSettings(from: AquariumSettings, to: AquariumSettings, t: number): AquariumSettings {
  return typed(morphValues(BASE, loose(from), loose(to), t));
}
