/**
 * The knobs of a background, whichever background it is (SPEC-backgrounds.md): what kinds of knob there are, what a stored
 * value is read back as, and what PARTY, the looks and MORPH do to them. Plain data and plain functions, no browser: the
 * settings window draws a background's knobs from its `BackdropDef`, the store parses with it, and the checks run all of it.
 *
 * The AQUARIUM's settings were the first of these (`../aquarium/settings.ts`); this is that file's machinery with the
 * aquarium taken out of it, so SAND, FLUID and the rest are a list of knobs each and nothing more.
 */

export type KnobValue = number | boolean | string;
/** A background's settings: every knob's value, by the knob's key. */
export type Values = Record<string, KnobValue>;

type KnobBase = {
  key: string;
  /** Which tab of the window it is listed under. */
  tab: string;
  label: string;
  /** The row's hover tip. */
  tip: string;
};

export type RangeKnob = KnobBase & {
  kind: 'range';
  min: number;
  max: number;
  step: number;
  /** Written after the value: `2x`, `60%`. */
  unit: string;
  /** Written with its sign: a knob that runs both ways from nothing (CURRENT, GRAVITY). */
  signed?: boolean;
  /** What PARTY may pick between, where the whole range would be too much (a sea too dark to see). */
  party?: readonly [number, number];
};

export type SwitchKnob = KnobBase & {
  kind: 'switch';
  /** The chance PARTY switches it on (0 keeps it as the default has it). */
  party: number;
};

export type ChoiceKnob = KnobBase & {
  kind: 'choice';
  options: readonly { value: string; label: string; tip: string }[];
  /** PARTY leaves it alone unless this is set. */
  party?: boolean;
};

export type Knob = RangeKnob | SwitchKnob | ChoiceKnob;

/** Two range knobs on one square, dragged with one finger. */
export type PadWidget = { kind: 'pad'; id: string; tab: string; label: string; tip: string; x: string; y: string };
/** Two range knobs that are the ends of one stretch, on one strip: `low` never comes within `gap` of `high`. */
export type BandWidget = { kind: 'band'; id: string; tab: string; label: string; tip: string; low: string; high: string; gap: number };
/** A way of showing two knobs as one control. The knobs it shows are not listed again as sliders. */
export type Widget = PadWidget | BandWidget;

/** A key in the window that does something once (GIANT MODE, SHAKE, CLEAR) rather than holding a value. */
export type Action = { id: string; tab: string; label: string; tip: string };

export type Look = { id: string; label: string; tip: string; values: Values };

export type BackdropDef = {
  id: string;
  /** The background's name, as PREFERENCES and its window's title say it. */
  label: string;
  tabs: readonly { id: string; label: string }[];
  /** Every knob, in the order the window lists them. */
  knobs: readonly Knob[];
  widgets: readonly Widget[];
  actions: readonly Action[];
  /** The background as it comes: what RESET gives back. */
  defaults: Values;
  /** The ready-made looks along the window's foot. The first is the default, by name. */
  looks: readonly Look[];
  /** PARTY's last word: a few knobs put back to nothing as often as not, so two parties don't look alike. */
  partyRests?: readonly { key: string; chance: number }[];
};

/** A number held to a knob's range and snapped to its step (so a stored 2.37x is read back as 2.25x). */
export function clampToKnob(knob: RangeKnob, value: number): number {
  const stepped = knob.min + Math.round((value - knob.min) / knob.step) * knob.step;
  // Steps like 0.1 don't add up exactly; six places is far finer than any step here.
  return Math.min(knob.max, Math.max(knob.min, Math.round(stepped * 1e6) / 1e6));
}

const rangeOf = (def: BackdropDef, key: string): RangeKnob | null => {
  const knob = def.knobs.find((each) => each.key === key);
  return knob !== undefined && knob.kind === 'range' ? knob : null;
};

/** A band's two ends kept apart: the one that was not just moved gives way. */
function holdBands(def: BackdropDef, values: Values, moved?: string): void {
  for (const widget of def.widgets) {
    if (widget.kind !== 'band') continue;
    const low = rangeOf(def, widget.low);
    const high = rangeOf(def, widget.high);
    if (low === null || high === null) continue;
    const [a, b] = [values[widget.low] as number, values[widget.high] as number];
    if (b >= a + widget.gap) continue;
    // The end that was not moved gives way; when it has no further to go, the moved end stops a gap short of it.
    if (moved === widget.high) {
      const gave = clampToKnob(low, Math.max(low.min, b - widget.gap));
      values[widget.low] = gave;
      if (b < gave + widget.gap) values[widget.high] = clampToKnob(high, gave + widget.gap);
    } else {
      const gave = clampToKnob(high, Math.min(high.max, a + widget.gap));
      values[widget.high] = gave;
      if (gave < a + widget.gap) values[widget.low] = clampToKnob(low, gave - widget.gap);
    }
  }
}

/**
 * Whatever was stored, read back as this background's settings: every key checked on its own, anything missing, of the wrong
 * kind or out of range falling back or clamped, unknown keys dropped. Never throws.
 */
export function parseValues(def: BackdropDef, raw: unknown): Values {
  const held = typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const values: Values = { ...def.defaults };
  for (const knob of def.knobs) {
    const value = held[knob.key];
    if (knob.kind === 'range') {
      if (typeof value === 'number' && Number.isFinite(value)) values[knob.key] = clampToKnob(knob, value);
    } else if (knob.kind === 'switch') {
      if (typeof value === 'boolean') values[knob.key] = value;
    } else if (typeof value === 'string' && knob.options.some((option) => option.value === value)) {
      values[knob.key] = value;
    }
  }
  holdBands(def, values);
  return values;
}

/** One knob changed, the rest as they were, read back through the same checks. */
export function withValue(def: BackdropDef, values: Values, key: string, value: KnobValue): Values {
  const knob = def.knobs.find((each) => each.key === key);
  if (knob === undefined) return values;
  let checked: KnobValue = values[key];
  if (knob.kind === 'range') {
    if (typeof value === 'number' && Number.isFinite(value)) checked = clampToKnob(knob, value);
  } else if (knob.kind === 'switch') {
    if (typeof value === 'boolean') checked = value;
  } else if (typeof value === 'string' && knob.options.some((option) => option.value === value)) checked = value;
  const next: Values = { ...values, [key]: checked };
  // The end of a band that was just moved stays where it was put; the other end gives way.
  holdBands(def, next, key);
  return parseValues(def, next);
}

/** True when two settings are the same on every knob. */
export function sameValues(def: BackdropDef, a: Values, b: Values): boolean {
  return def.knobs.every((knob) => a[knob.key] === b[knob.key]);
}

/** A value as the window writes it beside the knob's name. */
export function shownValue(knob: RangeKnob, value: number): string {
  const rounded = Math.round(value * 100) / 100;
  return `${knob.signed === true && rounded > 0 ? '+' : ''}${rounded}${knob.unit}`;
}

/** One knob somewhere at random, inside what PARTY may pick for it. */
export function rolledValue(knob: Knob, random: () => number): KnobValue {
  if (knob.kind === 'range') {
    const [low, high] = knob.party ?? [knob.min, knob.max];
    return clampToKnob(knob, low + random() * (high - low));
  }
  if (knob.kind === 'switch') return random() < Math.max(knob.party, 0.5);
  return knob.options[Math.floor(random() * knob.options.length) % knob.options.length].value;
}

/**
 * PARTY: every knob somewhere at random, inside limits that keep the background worth looking at. Locked knobs keep what they
 * have. `random` is `Math.random` on the site and a fixed sequence in the checks.
 */
export function partyValues(def: BackdropDef, random: () => number, current?: Values, locks: readonly string[] = []): Values {
  const next: Record<string, unknown> = { ...def.defaults };
  for (const knob of def.knobs) {
    if (knob.kind === 'range') {
      const [low, high] = knob.party ?? [knob.min, knob.max];
      next[knob.key] = low + random() * (high - low);
    } else if (knob.kind === 'switch') {
      if (knob.party > 0) next[knob.key] = random() < knob.party;
    } else if (knob.party === true) {
      next[knob.key] = knob.options[Math.floor(random() * knob.options.length) % knob.options.length].value;
    }
  }
  for (const rest of def.partyRests ?? []) if (random() < rest.chance) next[rest.key] = def.defaults[rest.key];
  if (current !== undefined) for (const key of locks) next[key] = current[key];
  return parseValues(def, next);
}

/** New settings put on over the current ones, the locked knobs keeping what they have (a look, RESET, a morph). */
export function keepingLocks(def: BackdropDef, next: Values, current: Values, locks: readonly string[]): Values {
  if (locks.length === 0) return next;
  const kept: Values = { ...next };
  for (const key of locks) if (key in current) kept[key] = current[key];
  return parseValues(def, kept);
}

/** MORPH: every knob `t` of the way (0 to 1) from one set of settings to another. Switches and choices change over at the middle. */
export function morphValues(def: BackdropDef, from: Values, to: Values, t: number): Values {
  const part = Math.min(1, Math.max(0, t));
  const next: Values = {};
  for (const knob of def.knobs) {
    const [a, b] = [from[knob.key], to[knob.key]];
    next[knob.key] = knob.kind === 'range' ? (a as number) + ((b as number) - (a as number)) * part : part < 0.5 ? a : b;
  }
  return parseValues(def, next);
}

/** The marks a knob sways between: where they start when SWAY is switched on, a fifth of the range either side of its value. */
export function firstSway(knob: RangeKnob, value: number): [number, number] {
  const reach = (knob.max - knob.min) / 5;
  return [clampToKnob(knob, value - reach), clampToKnob(knob, value + reach)];
}

/** Stored sway marks read back: only for range knobs, held to the range, the lower first. */
export function parseSway(def: BackdropDef, raw: unknown): Record<string, [number, number]> {
  const held = typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const sway: Record<string, [number, number]> = {};
  for (const knob of def.knobs) {
    const marks = held[knob.key];
    if (knob.kind !== 'range' || !Array.isArray(marks) || marks.length !== 2 || !marks.every((mark) => typeof mark === 'number' && Number.isFinite(mark))) continue;
    const [a, b] = [clampToKnob(knob, marks[0] as number), clampToKnob(knob, marks[1] as number)];
    sway[knob.key] = [Math.min(a, b), Math.max(a, b)];
  }
  return sway;
}

/** Stored locks read back: only keys that are knobs. */
export function parseLocks(def: BackdropDef, raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return def.knobs.map((knob) => knob.key).filter((key) => raw.includes(key));
}

/** How long a sway takes there and back, in seconds: each knob a little different, so they never fall into step. */
export function swayPeriod(def: BackdropDef, key: string): number {
  return 10 + (def.knobs.findIndex((knob) => knob.key === key) % 7) * 1.7;
}

/** Where a swaying knob is at a moment: back and forth between its marks, on its steps. */
export function swayedValue(def: BackdropDef, key: string, marks: readonly [number, number], seconds: number): number {
  const knob = rangeOf(def, key);
  if (knob === null) return marks[0];
  const part = (1 - Math.cos((seconds / swayPeriod(def, key)) * Math.PI * 2)) / 2;
  return clampToKnob(knob, marks[0] + (marks[1] - marks[0]) * part);
}

/** The settings with every swaying knob where its sway has it at this moment. The same object back when nothing sways. */
export function swayedValues(def: BackdropDef, values: Values, sway: Record<string, readonly [number, number]>, seconds: number): Values {
  const keys = Object.keys(sway);
  if (keys.length === 0) return values;
  const next: Values = { ...values };
  for (const key of keys) next[key] = swayedValue(def, key, sway[key], seconds);
  return next;
}

/** A pad's puck after a step of BOUNCE: `x`, `y` and its speed, as shares of the pad (0 to 1), turning back at the walls. */
export function bouncedPuck(puck: { x: number; y: number; vx: number; vy: number }, dt: number): { x: number; y: number; vx: number; vy: number } {
  let { x, y, vx, vy } = puck;
  x += vx * dt;
  y += vy * dt;
  if (x < 0) [x, vx] = [-x, -vx];
  if (x > 1) [x, vx] = [2 - x, -vx];
  if (y < 0) [y, vy] = [-y, -vy];
  if (y > 1) [y, vy] = [2 - y, -vy];
  return { x: Math.min(1, Math.max(0, x)), y: Math.min(1, Math.max(0, y)), vx, vy };
}
