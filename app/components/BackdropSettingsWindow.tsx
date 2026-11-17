'use client';

import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import {
  firstSway,
  keepingLocks,
  morphValues,
  partyValues,
  rolledValue,
  sameValues,
  shownValue,
  withValue,
  type BackdropDef,
  type ChoiceKnob,
  type Knob,
  type RangeKnob,
  type SwitchKnob,
  type Values,
  type Widget,
} from '../lib/backdrops/knobs';
import { backdropDef } from '../lib/backdrops/registry';
import { COLUMN_W, LOOKS_SECTION, choiceLayout, evenRows, looksKeys, sheetLayout } from '../lib/backdrops/sheet';
import {
  GHOST_SECONDS,
  activeActions,
  backdropMeters,
  bouncingVersion,
  fireBackdropAction,
  ghostState,
  liveValues,
  padIsBouncing,
  padPuck,
  serverGhostState,
  serverMeters,
  startBounce,
  startGhost,
  stopBounce,
  stopGhost,
  subscribeToActiveActions,
  subscribeToBouncing,
  subscribeToGhost,
  subscribeToLiveValues,
  subscribeToMeters,
  watchLiveValues,
} from '../lib/backdrops/runtime';
import {
  NO_EXTRAS,
  backdropExtras,
  backdropSaveFailed,
  backdropValues,
  backdropWindowState,
  closeBackdropWindow,
  serverBackdropSaveFailed,
  setBackdropAccount,
  setBackdropLock,
  setBackdropSway,
  setBackdropValues,
  subscribeToBackdropSaveFailed,
  subscribeToBackdropScenes,
  subscribeToBackdropWindow,
  toggleBackdropSeeThrough,
  toggleBackdropWindow,
} from '../lib/backdrops/store';
import { THEME_KEY, currentThemeId, subscribeToTheme, themeSet, themedValues } from '../lib/backdrops/theme';
import { resetValues } from '../lib/backdrops/theme-switch';
import { BACKDROPS, DEFAULT_BACKDROP, backdropState, setBackdrop, subscribeToBackdrop } from '../lib/ui/backdrop-slot';
import { themeById } from '../lib/ui/themes';
import { PLATE, PLATE_ON_BLACK, PLATE_ON_BLACK_PRESSED, PLATE_PRESSED, TITLE_BAR_INACTIVE } from '../lib/ui/controls';
import { useAuth } from './AuthProvider';
import { BandStrip, MINI, MINI_ON, Sparkline, XYPad } from './backdrops/BackdropControls';
import DockWindow from './DockWindow';

const REDUCED_MOTION = '(prefers-reduced-motion: reduce)';

function subscribeToReducedMotion(listener: () => void) {
  const query = window.matchMedia(REDUCED_MOTION);
  query.addEventListener('change', listener);
  return () => query.removeEventListener('change', listener);
}

const reducedMotion = () => window.matchMedia(REDUCED_MOTION).matches;

const NOTE = 'w-fit bg-bubble-pale px-1 text-label text-ink-bar';

/*
 * The sheet's grid (Luke, 2026-11-17: "more readable ... ideally i dont want any scrolling"). Every knob is one line, as a
 * control panel's property sheet or a plug-in panel lays them out: its name in a column of names, its control, its value in
 * a column of values on the right, and its `~ ? =` keys in a column of their own at the far end, so the eye runs straight
 * down any of the four. A run of switches, a choice's keys and a section's one-off actions are a line of bracket keys.
 */
/** One knob's line. */
const LINE = 'flex min-h-6 items-center gap-1.5 text-label text-ink';
/** The knob's name: one width for every name, so the controls start in one place. */
const NAME = 'w-24 shrink-0 truncate';
/** Its value: a column on the right, in the one heavier weight, so the numbers read at a glance. */
const VALUE = 'w-18 shrink-0 text-right text-key font-strong';
/** The `~ ? =` keys: a column at the far end; a knob with fewer keys keeps them at the right of it. */
const ROW_KEYS = 'flex w-13 shrink-0 items-center justify-end gap-px';

/** Everything a row needs to read and change its background's settings. */
type Panel = {
  def: BackdropDef;
  /** The stored settings, which the keys change... */
  values: Values;
  /** ...and the settings this instant, which the sliders show: a swaying knob's slider moves by itself. */
  live: Values;
  locks: readonly string[];
  sway: Readonly<Record<string, readonly [number, number]>>;
  still: boolean;
  /** While `[ THEME ]` is on: the knobs the theme sets outright (drawn as the theme's, not to be moved)... */
  themed: Values;
  /** ...and the settings as the background is drawn, the theme's nudges included, for the `35% → 50%` beside a nudged slider. */
  drawn: Values;
};

const SET_BY_THEME = 'SET BY THE THEME WHILE [ THEME ] IS ON. SWITCH IT OFF TO SET THIS YOURSELF';

const change = (panel: Panel, key: string, value: number | boolean | string) => setBackdropValues(panel.def.id, withValue(panel.def, panel.values, key, value));

/**
 * The three small keys at the end of a knob's row. `~` sways a slider between two marks by itself; `?` rolls the knob to
 * somewhere at random; `=` locks it, so PARTY, RESET and the looks leave it alone.
 */
function RowKeys({ panel, knobs, name }: { panel: Panel; knobs: readonly Knob[]; name: string }) {
  const id = panel.def.id;
  const ranges = knobs.filter((knob): knob is RangeKnob => knob.kind === 'range');
  const swaying = ranges.length === 1 && panel.sway[ranges[0].key] !== undefined;
  const locked = knobs.every((knob) => panel.locks.includes(knob.key));
  return (
    <span className={ROW_KEYS}>
      {ranges.length === 1 && knobs.length === 1 ? (
        <button
          type="button"
          aria-pressed={swaying}
          aria-label={`Sway ${name} by itself`}
          title={swaying ? 'STOP SWAYING' : 'SWAY: THE VALUE DRIFTS BETWEEN TWO MARKS BY ITSELF'}
          onClick={() => setBackdropSway(id, ranges[0].key, swaying ? null : firstSway(ranges[0], panel.values[ranges[0].key] as number))}
          className={swaying ? MINI_ON : MINI}
          data-backdrop-sway={ranges[0].key}
        >
          ~
        </button>
      ) : null}
      <button
        type="button"
        aria-label={`Roll ${name} at random`}
        title="ROLL: THIS ONE SOMEWHERE AT RANDOM"
        onClick={() => {
          let next = panel.values;
          for (const knob of knobs) next = withValue(panel.def, next, knob.key, rolledValue(knob, Math.random));
          setBackdropValues(id, next);
        }}
        className={MINI}
        data-backdrop-roll={knobs[0].key}
      >
        ?
      </button>
      <button
        type="button"
        aria-pressed={locked}
        aria-label={`Lock ${name}`}
        title={locked ? 'UNLOCK' : 'LOCK: PARTY, RESET AND THE LOOKS LEAVE THIS ONE ALONE'}
        onClick={() => knobs.forEach((knob) => setBackdropLock(id, knob.key, !locked))}
        className={locked ? MINI_ON : MINI}
        data-backdrop-lock={knobs[0].key}
      >
        =
      </button>
    </span>
  );
}

/**
 * In the keys' column of a knob the theme sets while `[ THEME ]` is on: the word THEME where the keys were, because the keys
 * would change nothing the reader sees.
 */
function SetByTheme() {
  return (
    <span className={ROW_KEYS} data-backdrop-set-by-theme="">
      THEME
    </span>
  );
}

/** A slider on one line: its name, the slider, its value, its keys. The arrow keys work on it when it has focus. */
function RangeRow({ knob, panel }: { knob: RangeKnob; panel: Panel }) {
  const marks = panel.sway[knob.key];
  const byTheme = knob.key in panel.themed;
  const value = (byTheme ? panel.themed[knob.key] : panel.live[knob.key]) as number;
  const shown = shownValue(knob, value);
  // A knob the theme nudges: the reader's own value, and where the theme has it drawn.
  const drawn = panel.drawn[knob.key];
  const nudged = !byTheme && typeof drawn === 'number' && drawn !== value ? shownValue(knob, drawn) : null;
  return (
    <div className="flex flex-col" title={byTheme ? SET_BY_THEME : nudged === null ? knob.tip : `${knob.tip}. THE THEME NUDGES IT TO ${nudged}`}>
      <div className={LINE}>
        <span className={NAME}>{knob.label}</span>
        <input
          type="range"
          min={knob.min}
          max={knob.max}
          step={knob.step}
          value={value}
          // While it sways, the slider shows where the value has got to and the strip under it sets the two marks.
          disabled={byTheme || (marks !== undefined && !panel.still)}
          aria-label={knob.label}
          aria-valuetext={shown}
          onChange={(event) => change(panel, knob.key, Number(event.target.value))}
          className="h-5 min-w-0 flex-1 cursor-pointer accent-bubble"
          data-backdrop-knob={knob.key}
        />
        <span className={VALUE} data-backdrop-value={knob.key}>
          {nudged === null ? shown : `${shown}→${nudged}`}
        </span>
        {byTheme ? <SetByTheme /> : <RowKeys panel={panel} knobs={[knob]} name={knob.label} />}
      </div>
      {/* Swaying: the strip that sets its two marks, on a line of its own under the slider, in the slider's column. */}
      {marks === undefined || byTheme ? null : (
        <div className={LINE}>
          <span className={NAME}>SWAYS</span>
          <span className="min-w-0 flex-1">
            <BandStrip
              id={`sway-${knob.key}`}
              low={knob}
              high={knob}
              values={marks}
              gap={0}
              names={[`${knob.label} sways from`, `${knob.label} sways to`]}
              onChange={(low, high) => setBackdropSway(panel.def.id, knob.key, [low, high])}
            />
          </span>
          <span className={VALUE}>
            {shownValue(knob, marks[0])}–{shownValue(knob, marks[1])}
          </span>
          <span className={ROW_KEYS} />
        </div>
      )}
    </div>
  );
}

/** A switch: a key that stays filled while it is on, as every switch on the site does. Its lock is a right-hand twin. */
function SwitchKey({ knob, panel }: { knob: SwitchKnob; panel: Panel }) {
  const on = panel.values[knob.key] === true;
  return (
    <button type="button" aria-pressed={on} title={knob.tip} onClick={() => change(panel, knob.key, !on)} className={on ? PLATE_PRESSED : PLATE} data-backdrop-knob={knob.key}>
      [ {knob.label} ]
    </button>
  );
}

/** One of a few: the chosen one filled. */
function ChoiceRow({ knob, panel }: { knob: ChoiceKnob; panel: Panel }) {
  // Set by the theme (COLOURS, while THEME is on): the reader's own choice is kept and waits; the keys rest.
  const byTheme = knob.key in panel.themed;
  const { beside, rows } = choiceLayout(knob);
  const keys = byTheme ? <SetByTheme /> : <RowKeys panel={panel} knobs={[knob]} name={knob.label} />;
  const line = (row: number[]) => (
    <span key={row[0]} className="flex min-w-0 flex-1 items-center gap-1">
      {row.map((index) => {
        const option = knob.options[index];
        const chosen = !byTheme && panel.values[knob.key] === option.value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={chosen}
            title={byTheme ? SET_BY_THEME : option.tip}
            disabled={byTheme}
            onClick={() => change(panel, knob.key, option.value)}
            className={chosen ? PLATE_PRESSED : PLATE}
            data-backdrop-knob={`${knob.key}-${option.value}`}
          >
            [ {option.label} ]
          </button>
        );
      })}
    </span>
  );
  // Beside its name when its keys fit there on one line, as a slider sits; otherwise its name's line, then its keys under it in
  // even lines (`choiceLayout`).
  return beside ? (
    <div className={LINE} role="group" aria-label={knob.label} title={byTheme ? SET_BY_THEME : knob.tip}>
      <span className={NAME}>{knob.label}</span>
      {line(rows[0])}
      {keys}
    </div>
  ) : (
    <div className="flex flex-col gap-1" role="group" aria-label={knob.label} title={byTheme ? SET_BY_THEME : knob.tip}>
      <span className={LINE}>
        <span className="min-w-0 flex-1 truncate">{knob.label}</span>
        {keys}
      </span>
      {rows.map(line)}
    </div>
  );
}

const THEME_TIP = "THE BACKGROUND MATCHED TO THE SITE'S THEME: ITS COLOURS, LIGHT AND MOOD, FOLLOWING THE THEME WHEN IT CHANGES. OFF: YOUR OWN SETTINGS";

/**
 * `[ THEME ]` (Luke, 2026-11-16): at the top of every background's window, on as it comes. While it is on the background wears the
 * site theme (`../lib/backdrops/theme.ts`). It heads the sheet, first thing in its top-left corner, with the theme's name beside it in
 * the heavier weight and nothing more, so the head stays one line beside the meters. Which knobs it sets each say so in their own row
 * (THEME where their keys were), and a value it nudges reads `35%→50%`, its hover tip saying what the arrow is.
 */
function ThemeRow({ panel, theme }: { panel: Panel; theme: string }) {
  const on = panel.values[THEME_KEY] === true;
  const shown = themeById(theme);
  const name = shown.family === undefined ? shown.label : `${shown.family.label} ${shown.label}`;
  return (
    <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-label text-ink" data-backdrop-theme={on ? 'on' : 'off'}>
      <button type="button" aria-pressed={on} title={THEME_TIP} onClick={() => change(panel, THEME_KEY, !on)} className={on ? PLATE_PRESSED : PLATE} data-backdrop-knob={THEME_KEY}>
        {/* It says which way it is, as a toggle (Luke, 2026-11-17: "a toggle separate to the "reset" button"). */}
        [ THEME: {on ? 'ON' : 'OFF'} ]
      </button>
      <span>{on ? <span className="text-key font-strong">{name}</span> : 'YOUR OWN SETTINGS'}</span>
    </span>
  );
}

const rangeOf = (def: BackdropDef, key: string): RangeKnob | null => {
  const knob = def.knobs.find((each) => each.key === key);
  return knob !== undefined && knob.kind === 'range' ? knob : null;
};

/** Two knobs shown as one control: a strip with two handles, or a square with a puck. */
function WidgetRow({ widget, panel }: { widget: Widget; panel: Panel }) {
  const id = panel.def.id;
  // Redrawn when a pad starts or stops bouncing; the live values redraw it while it bounces.
  useSyncExternalStore(subscribeToBouncing, bouncingVersion, bouncingVersion);
  if (widget.kind === 'band') {
    const [low, high] = [rangeOf(panel.def, widget.low), rangeOf(panel.def, widget.high)];
    if (low === null || high === null) return null;
    const values = [panel.values[widget.low] as number, panel.values[widget.high] as number] as const;
    return (
      <div className={LINE} title={widget.tip}>
        <span className={NAME}>{widget.label}</span>
        <span className="min-w-0 flex-1">
          <BandStrip
            id={widget.id}
            low={low}
            high={high}
            values={values}
            gap={widget.gap}
            names={[low.label, high.label]}
            onChange={(a, b) => {
              // Whichever end moved goes through the same door as a slider would, so the other end gives way the same way.
              if (a !== values[0]) change(panel, widget.low, a);
              else if (b !== values[1]) change(panel, widget.high, b);
            }}
          />
        </span>
        <span className={VALUE} data-backdrop-value={widget.id}>
          {shownValue(low, values[0])}–{shownValue(high, values[1])}
        </span>
        <RowKeys panel={panel} knobs={[low, high]} name={widget.label} />
      </div>
    );
  }
  const [x, y] = [rangeOf(panel.def, widget.x), rangeOf(panel.def, widget.y)];
  if (x === null || y === null) return null;
  const bouncing = padIsBouncing(id, widget.id);
  const puck = padPuck(id, widget.id);
  return (
    // The pad's block: its name over its keys in the names' column, the pad in the sliders', its two values beside it.
    <div className="flex items-start gap-1.5 py-1 text-label text-ink" title={widget.tip}>
      <span className="flex w-24 shrink-0 flex-col items-start gap-1">
        <span>{widget.label}</span>
        <RowKeys panel={panel} knobs={[x, y]} name={widget.label} />
      </span>
      <XYPad
        id={widget.id}
        label={widget.label}
        x={x}
        y={y}
        puck={puck}
        onCatch={bouncing ? () => stopBounce(id, widget.id) : undefined}
        onChange={(a, b) => setBackdropValues(id, withValue(panel.def, withValue(panel.def, backdropValues(id), widget.x, a), widget.y, b))}
        onFling={(flung) => startBounce(id, widget.id, flung)}
        compact
      />
      <div className="flex min-w-0 flex-1 flex-col items-start gap-1">
        <span data-backdrop-value={widget.x}>
          {x.label} <span className="text-key font-strong">{shownValue(x, panel.live[widget.x] as number)}</span>
        </span>
        <span data-backdrop-value={widget.y}>
          {y.label} <span className="text-key font-strong">{shownValue(y, panel.live[widget.y] as number)}</span>
        </span>
        {panel.still ? null : (
          <button
            type="button"
            aria-pressed={bouncing}
            title={bouncing ? 'CATCH IT: THE TWO KNOBS STOP WHERE THE PUCK IS' : 'LET THE PUCK GO: IT BOUNCES ROUND THE PAD AND THE TWO KNOBS GO WITH IT. FLICK IT TO SEND IT FASTER'}
            onClick={() => (bouncing ? stopBounce(id, widget.id) : startBounce(id, widget.id, { ...puck, vx: 0, vy: 0 }))}
            className={bouncing ? PLATE_PRESSED : PLATE}
            data-backdrop-bounce={widget.id}
          >
            [ BOUNCE ]
          </button>
        )}
      </div>
    </div>
  );
}

/** A tab's knobs in their listed order: switches that follow one another share a line; two knobs with a control of their own are drawn as it, once. */
function KnobList({ tab, panel }: { tab: string; panel: Panel }) {
  const rows: ReactNode[] = [];
  const inWidget = new Map<string, Widget>();
  for (const widget of panel.def.widgets) for (const key of widget.kind === 'pad' ? [widget.x, widget.y] : [widget.low, widget.high]) inWidget.set(key, widget);
  const drawn = new Set<string>();
  let switches: SwitchKnob[] = [];
  const flush = () => {
    if (switches.length === 0) return;
    const group = switches;
    switches = [];
    rows.push(
      <div key={`switches-${group[0].key}`} className="flex flex-wrap items-center gap-1" role="group">
        {group.map((knob) => (
          <SwitchKey key={knob.key} knob={knob} panel={panel} />
        ))}
      </div>,
    );
  };
  // A two-knob control is listed in its own tab: at the place of its first knob there, or at the tab's end.
  for (const knob of panel.def.knobs) {
    const widget = inWidget.get(knob.key);
    if (widget !== undefined) {
      if (widget.tab !== tab || drawn.has(widget.id) || knob.tab !== tab) continue;
      flush();
      drawn.add(widget.id);
      rows.push(<WidgetRow key={widget.id} widget={widget} panel={panel} />);
      continue;
    }
    if (knob.tab !== tab) continue;
    if (knob.kind === 'switch') {
      switches.push(knob);
      continue;
    }
    flush();
    if (knob.kind === 'range') rows.push(<RangeRow key={knob.key} knob={knob} panel={panel} />);
    else rows.push(<ChoiceRow key={knob.key} knob={knob} panel={panel} />);
  }
  flush();
  // A control whose knobs are all listed under other tabs still shows in its own.
  for (const widget of panel.def.widgets) if (widget.tab === tab && !drawn.has(widget.id)) rows.push(<WidgetRow key={widget.id} widget={widget} panel={panel} />);
  return <>{rows}</>;
}

/** What the background says about itself as it runs: each number with its last half-minute beside it. */
function Meters({ ownLine }: { ownLine: boolean }) {
  const meters = useSyncExternalStore(subscribeToMeters, backdropMeters, serverMeters);
  if (meters.length === 0) return null;
  return (
    <div className={`ml-auto flex flex-wrap items-end justify-end gap-x-4 gap-y-1 text-label text-ink${ownLine ? " w-full" : ""}`} data-backdrop-meters="">
      {meters.map((meter) => (
        <span key={meter.id} className="flex items-end gap-1.5" title={`${meter.label}, AS IT IS NOW`}>
          <span>{meter.label}</span>
          <Sparkline readings={meter.history} most={meter.most} />
          <span className="text-key font-strong">{Math.round(meter.value)}</span>
        </span>
      ))}
    </div>
  );
}

/** MORPH: a slider from the settings as they were when it was first moved to the look named beside it. */
function Morph({ panel }: { panel: Panel }) {
  const { def } = panel;
  const [target, setTarget] = useState(def.looks[def.looks.length - 1]?.id ?? '');
  /** Where the morph started, and what it last set: when the settings are no longer that, somebody changed a knob and the morph starts again. */
  const [held, setHeld] = useState<{ from: Values; last: Values; t: number } | null>(null);
  const run = held !== null && held.last === panel.values ? held : null;
  const look = def.looks.find((each) => each.id === target) ?? def.looks[0];
  if (look === undefined) return null;
  const t = run?.t ?? 0;
  return (
    <div className={LINE} title="MORPH: EVERY KNOB SLIDES FROM WHERE IT IS TO THE LOOK NAMED HERE">
      <span className={NAME}>MORPH TO</span>
      <button
        type="button"
        title="WHICH LOOK TO MORPH TO: PRESS FOR THE NEXT"
        onClick={() => {
          setHeld(null);
          setTarget(def.looks[(def.looks.findIndex((each) => each.id === look.id) + 1) % def.looks.length].id);
        }}
        className={PLATE}
        data-backdrop-morph-target={look.id}
      >
        [ {look.label} ]
      </button>
      <input
        type="range"
        min={0}
        max={100}
        step={1}
        value={Math.round(t * 100)}
        aria-label={`Morph to ${look.label}`}
        aria-valuetext={`${Math.round(t * 100)}%`}
        onChange={(event) => {
          const from = run?.from ?? panel.values;
          const part = Number(event.target.value) / 100;
          // `[ THEME ]` stays as the reader has it through a morph, as through a look.
          const next = keepingLocks(def, morphValues(def, from, look.values, part), panel.values, [...panel.locks, THEME_KEY]);
          // The same settings again (a morph between two equal looks) changes nothing, and `last` must still match what is stored.
          if (sameValues(def, next, panel.values)) setHeld({ from, last: panel.values, t: part });
          else {
            setHeld({ from, last: next, t: part });
            setBackdropValues(def.id, next);
          }
        }}
        className="h-5 min-w-0 flex-1 cursor-pointer accent-bubble"
        data-backdrop-morph=""
      />
    </div>
  );
}

/** The GHOST POINTER: ten seconds of the pointer, recorded and looped, so the background is still played with when the hand is elsewhere. */
function Ghost() {
  const ghost = useSyncExternalStore(subscribeToGhost, ghostState, serverGhostState);
  return (
    <div className={LINE}>
      <span className={NAME}>GHOST</span>
      <button
        type="button"
        aria-pressed={ghost !== 'off'}
        title={ghost === 'off' ? `GHOST POINTER: RECORDS YOUR POINTER FOR ${GHOST_SECONDS} SECONDS, THEN LOOPS IT WHILE YOUR OWN IS STILL` : 'STOP THE GHOST POINTER'}
        onClick={ghost === 'off' ? startGhost : stopGhost}
        className={ghost === 'off' ? PLATE : PLATE_PRESSED}
        data-backdrop-ghost={ghost}
      >
        [ {ghost === 'off' ? 'RECORD POINTER' : ghost === 'recording' ? 'RECORDING' : 'STOP GHOST'} ]
      </button>
      {ghost === 'recording' ? <span>MOVE YOUR POINTER FOR {GHOST_SECONDS} SECONDS</span> : ghost === 'looping' ? <span>YOUR GHOST IS LOOPING</span> : null}
    </div>
  );
}

/** What the window holds, for one background. Exported so a check can draw it without the window's frame round it. */
export function BackdropKnobs({ id }: { id: string }) {
  const def = backdropDef(id);
  // Subscribed to the stored settings and to the live ones: the first for the keys, the second so swaying sliders move.
  const values = useSyncExternalStore(subscribeToBackdropScenes, () => backdropValues(id), () => def?.defaults ?? null);
  const extras = useSyncExternalStore(subscribeToBackdropScenes, () => backdropExtras(id), () => NO_EXTRAS);
  const live = useSyncExternalStore(subscribeToLiveValues, () => liveValues(id), () => def?.defaults ?? null);
  const failed = useSyncExternalStore(subscribeToBackdropSaveFailed, backdropSaveFailed, serverBackdropSaveFailed);
  const active = useSyncExternalStore(subscribeToActiveActions, activeActions, activeActions);
  const { id: backdrop } = useSyncExternalStore(subscribeToBackdrop, backdropState, backdropState);
  const still = useSyncExternalStore(subscribeToReducedMotion, reducedMotion, () => false);
  const theme = useSyncExternalStore(subscribeToTheme, currentThemeId, currentThemeId);
  useEffect(() => watchLiveValues(id), [id]);
  // A bounce doesn't outlive the window that shows it: shut the window (or change background) and every puck is caught, its
  // knobs left where it was.
  useEffect(() => () => backdropDef(id)?.widgets.forEach((widget) => (widget.kind === 'pad' ? stopBounce(id, widget.id) : undefined)), [id]);

  if (def === null || live === null || values === null) return null;
  const themeOn = values[THEME_KEY] === true;
  const panel: Panel = { def, values, live, locks: extras.locks, sway: extras.sway, still, themed: themeOn ? themeSet(theme, id) : {}, drawn: themeOn ? themedValues(def, live, theme) : live };
  const sheet = sheetLayout(def);
  // PARTY, the looks, MORPH and RESET leave `[ THEME ]` as the reader has it, as if it were locked (RESET: `resetValues`).
  const kept = [...panel.locks, THEME_KEY];
  const looks = <Looks panel={panel} still={still} kept={kept} />;

  return (
    <div className="flex flex-col" data-backdrop-window={id}>
      {failed ? (
        <p role="alert" className={NOTE}>
          COULD NOT SAVE TO YOUR ACCOUNT. KEPT IN THIS BROWSER.
        </p>
      ) : null}
      {still ? <p className={`${NOTE} mb-1`}>YOUR COMPUTER ASKS FOR LESS MOTION, SO WHAT MOVES IS RESTING. THE KNOBS THAT DON&apos;T MOVE ANYTHING STILL WORK.</p> : null}

      {/* The head: [ THEME ] first, in the top-left corner, and on the right what the background says about itself as it runs,
          or, when another background is on (TILE, which has no settings), the key that puts this one on. In a two-column window
          that goes on a line of its own: the meters' strips widen as they fill, and would wrap onto a second line later anyway,
          pushing the sheet down into a scroll (`sheet.ts` counts the line). */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 pb-2">
        <ThemeRow panel={panel} theme={theme} />
        {backdrop === id ? (
          <Meters ownLine={sheet.columns.length < 3} />
        ) : (
          <p className={`ml-auto flex flex-wrap items-center justify-end gap-2 text-label text-ink${sheet.columns.length < 3 ? " w-full" : ""}`}>
            <span>THE BACKGROUND IS ON {BACKDROPS.find((each) => each.id === backdrop)?.label ?? 'SOMETHING ELSE'}.</span>
            <button type="button" onClick={() => setBackdrop(BACKDROPS.find((each) => each.id === id)?.id ?? DEFAULT_BACKDROP)} className={PLATE}>
              [ SHOW THE {def.label} ]
            </button>
          </p>
        )}
      </div>

      {/* The sheet: every section in sight at once, shared out between two or three columns (`../lib/backdrops/sheet.ts`); one
          above another in a phone's bottom sheet, where there is no room for columns. */}
      <div className="flex min-h-0 flex-1 items-start gap-4 max-sm:flex-col max-sm:items-stretch" data-backdrop-sheet={sheet.columns.length}>
        {sheet.columns.map((column) => (
          <div key={column[0].id} className="flex min-w-0 flex-1 flex-col gap-2" data-backdrop-column="">
            {column.map((part) =>
              part.id === LOOKS_SECTION ? (
                <Section key={part.id} id={part.id} label={part.label}>
                  {looks}
                </Section>
              ) : (
                <Section key={part.id} id={part.id} label={part.label}>
                  <KnobList tab={part.id} panel={panel} />
                  {def.actions.some((action) => action.tab === part.id) ? (
                    <p className="flex flex-wrap items-center gap-1">
                      {def.actions
                        .filter((action) => action.tab === part.id)
                        .map((action) => (
                          <button
                            key={action.id}
                            type="button"
                            aria-pressed={active.includes(`${id}:${action.id}`)}
                            title={action.tip}
                            onClick={() => fireBackdropAction(id, action.id)}
                            className={active.includes(`${id}:${action.id}`) ? PLATE_PRESSED : PLATE}
                            data-backdrop-knob={action.id}
                          >
                            [ {action.label} ]
                          </button>
                        ))}
                    </p>
                  ) : null}
                </Section>
              ),
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/** A section of the sheet: its title line, as every section inside a window on the site has (no box), then its knobs. */
function Section({ id, label, children }: { id: string; label: string; children: ReactNode }) {
  return (
    <section className="flex flex-col" aria-label={label} data-backdrop-section={id}>
      <div className={TITLE_BAR_INACTIVE}>
        <span>{label}</span>
      </div>
      <div className="flex flex-col gap-px pt-1">{children}</div>
    </section>
  );
}

/** The LOOKS section's insides: starting again, a surprise, the ready-made looks, a morph between them, and the ghost. */
function Looks({ panel, still, kept }: { panel: Panel; still: boolean; kept: readonly string[] }) {
  const { def } = panel;
  const id = def.id;
  const put = (next: Values) => setBackdropValues(id, keepingLocks(def, next, panel.values, kept));
  const isLook = (look: Values) => sameValues(def, { ...panel.values, [THEME_KEY]: look[THEME_KEY] }, look);
  // RESET, PARTY, then each look, on even lines (`evenRows`): the n-th key of `looksKeys`.
  const key = (index: number) => {
    if (index === 0) {
      return (
        // RESET never flips THEME: with it on, back to the theme's own tuned look; with it off, the background's plain defaults.
        <button
          key="reset"
          type="button"
          title={panel.values[THEME_KEY] === true ? `BACK TO THE ${def.label} AS IT COMES, IN THE THEME'S LOOK` : `BACK TO THE ${def.label}'S OWN SETTINGS, AS IT COMES WITHOUT A THEME`}
          onClick={() => setBackdropValues(id, resetValues(def, panel.values, panel.locks))}
          className={PLATE}
          data-backdrop-look="reset"
        >
          [ RESET ]
        </button>
      );
    }
    if (index === 1) {
      return (
        <button key="party" type="button" title="EVERY KNOB SOMEWHERE AT RANDOM" onClick={() => setBackdropValues(id, partyValues(def, Math.random, panel.values, kept))} className={PLATE} data-backdrop-look="party">
          [ PARTY ]
        </button>
      );
    }
    const look = def.looks[index - 2];
    return (
      <button
        key={look.id}
        type="button"
        aria-pressed={isLook(look.values)}
        title={look.tip}
        onClick={() => put(look.values)}
        className={isLook(look.values) ? PLATE_PRESSED : PLATE}
        data-backdrop-look={look.id}
      >
        [ {look.label} ]
      </button>
    );
  };
  return (
    <>
      <div className="flex flex-col gap-1" role="group" aria-label="Looks">
        {evenRows(looksKeys(def), COLUMN_W).map((row) => (
          <span key={row[0]} className="flex items-center gap-1">
            {row.map(key)}
          </span>
        ))}
      </div>
      {still ? null : <Morph key={id} panel={panel} />}
      {still ? null : <Ghost />}
    </>
  );
}

/** Which background's settings the window shows: the one that is on, or (on TILE, which has none) the one it comes with. */
function shownScene(backdrop: string): string {
  return backdropDef(backdrop) === null ? DEFAULT_BACKDROP : backdrop;
}

/**
 * A background's settings window (SPEC-aquarium-settings.md, then SPEC-backgrounds.md): every knob of whichever background is
 * on, all on one sheet in labelled sections (`../lib/backdrops/sheet.ts`; they were tabs until 2026-11-17). A window beside the page, with no scrim, because the background it changes is the
 * thing to look at while changing it; its `[ 50% ]` key makes the window itself half see-through for the same reason. Drawn once
 * in `layout.tsx`, and it is what tells the settings who is signed in (as the MODULOS window does for the bar), so it does that
 * whether or not it is open.
 */
export default function BackdropSettingsWindow() {
  const { open, seeThrough } = useSyncExternalStore(subscribeToBackdropWindow, backdropWindowState, backdropWindowState);
  const { id: backdrop } = useSyncExternalStore(subscribeToBackdrop, backdropState, backdropState);
  const { user, status } = useAuth();
  const person = status === 'signed-in' && user !== null ? user.id : null;

  useEffect(() => {
    if (status !== 'loading') void setBackdropAccount(person);
  }, [person, status]);

  if (!open) return null;
  const scene = shownScene(backdrop);
  const def = backdropDef(scene);

  return (
    <DockWindow
      id="aquarium"
      // Each background's window has its own size and place (2026-11-17): it opens as big as its sheet, every knob in sight,
      // and a box saved at the old 400 x 700 doesn't stick.
      layoutId={`backdrop-${scene}`}
      title={def?.label ?? 'BACKGROUND'}
      onClose={closeBackdropWindow}
      status=""
      dock="top"
      tall
      defaultSize={def === null ? { w: 400, h: 700 } : sheetLayout(def).size}
      minSize={{ w: 300, h: 240 }}
      seeThrough={seeThrough}
      titleKeys={
        <button
          type="button"
          onPointerDown={(event) => event.stopPropagation()}
          onDoubleClick={(event) => event.stopPropagation()}
          onClick={toggleBackdropSeeThrough}
          aria-pressed={seeThrough}
          aria-label="Make this window half see-through"
          title={seeThrough ? 'SOLID AGAIN' : 'HALF SEE-THROUGH, SO THE BACKGROUND SHOWS THROUGH THE WINDOW'}
          className="cursor-pointer key px-1 py-0.75 text-label font-bold leading-none max-sm:min-h-tap max-sm:min-w-tap max-sm:text-sm"
          data-backdrop-see-through={seeThrough ? 'on' : 'off'}
        >
          [ 50% ]
        </button>
      }
    >
      <BackdropKnobs key={scene} id={scene} />
    </DockWindow>
  );
}

/**
 * The key on the background itself: in the top-left corner of the bare desk, it opens (and shuts) the settings window, and is
 * named for the background that is on. Where it shows is the stylesheet's business (`.aquarium-key`, globals.css): only on a
 * background that has settings, and only where there is background to be on.
 */
export function BackdropKey() {
  const { open } = useSyncExternalStore(subscribeToBackdropWindow, backdropWindowState, backdropWindowState);
  // The server can't know which background a browser chose: it names the one every browser starts on, and the stylesheet hides
  // the key before the first paint wherever it doesn't belong.
  const backdrop = useSyncExternalStore(subscribeToBackdrop, () => backdropState().id, () => DEFAULT_BACKDROP);
  const label = backdropDef(backdrop)?.label ?? backdropDef(DEFAULT_BACKDROP)?.label ?? 'BACKGROUND';
  return (
    <button
      type="button"
      onClick={toggleBackdropWindow}
      aria-pressed={open}
      title={`CHANGE THE ${label}: EVERY KNOB IT HAS`}
      className={`aquarium-key ${open ? PLATE_ON_BLACK_PRESSED : PLATE_ON_BLACK}`}
      data-backdrop-key=""
    >
      [ {label} ]
    </button>
  );
}
