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
import { BACKDROPS, DEFAULT_BACKDROP, backdropState, setBackdrop, subscribeToBackdrop } from '../lib/ui/backdrop-slot';
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
};

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
    <span className="flex shrink-0 items-center gap-px">
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

/** A slider: its name and its value written out above it, the arrow keys working on it when it has focus. */
function RangeRow({ knob, panel }: { knob: RangeKnob; panel: Panel }) {
  const marks = panel.sway[knob.key];
  const value = panel.live[knob.key] as number;
  const shown = shownValue(knob, value);
  return (
    <div className="flex flex-col gap-0.5 py-1 text-label text-ink" title={knob.tip}>
      <span className="flex items-center justify-between gap-2">
        <span className="min-w-0 flex-1 truncate">{knob.label}</span>
        <span data-backdrop-value={knob.key}>{shown}</span>
        <RowKeys panel={panel} knobs={[knob]} name={knob.label} />
      </span>
      <input
        type="range"
        min={knob.min}
        max={knob.max}
        step={knob.step}
        value={value}
        // While it sways, the slider shows where the value has got to and the strip under it sets the two marks.
        disabled={marks !== undefined && !panel.still}
        aria-label={knob.label}
        aria-valuetext={shown}
        onChange={(event) => change(panel, knob.key, Number(event.target.value))}
        className="h-5 w-full cursor-pointer accent-bubble"
        data-backdrop-knob={knob.key}
      />
      {marks === undefined ? null : (
        <BandStrip
          id={`sway-${knob.key}`}
          low={knob}
          high={knob}
          values={marks}
          gap={0}
          names={[`${knob.label} sways from`, `${knob.label} sways to`]}
          onChange={(low, high) => setBackdropSway(panel.def.id, knob.key, [low, high])}
        />
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
  return (
    <div className="flex flex-wrap items-center gap-1 py-1 text-label text-ink" role="group" aria-label={knob.label} title={knob.tip}>
      <span className="pr-1">{knob.label}</span>
      {knob.options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={panel.values[knob.key] === option.value}
          title={option.tip}
          onClick={() => change(panel, knob.key, option.value)}
          className={panel.values[knob.key] === option.value ? PLATE_PRESSED : PLATE}
          data-backdrop-knob={`${knob.key}-${option.value}`}
        >
          [ {option.label} ]
        </button>
      ))}
      <span className="ml-auto">
        <RowKeys panel={panel} knobs={[knob]} name={knob.label} />
      </span>
    </div>
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
      <div className="flex flex-col gap-0.5 py-1 text-label text-ink" title={widget.tip}>
        <span className="flex items-center justify-between gap-2">
          <span className="min-w-0 flex-1 truncate">{widget.label}</span>
          <span data-backdrop-value={widget.id}>
            {shownValue(low, values[0])} TO {shownValue(high, values[1])}
          </span>
          <RowKeys panel={panel} knobs={[low, high]} name={widget.label} />
        </span>
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
      </div>
    );
  }
  const [x, y] = [rangeOf(panel.def, widget.x), rangeOf(panel.def, widget.y)];
  if (x === null || y === null) return null;
  const bouncing = padIsBouncing(id, widget.id);
  const puck = padPuck(id, widget.id);
  return (
    <div className="flex flex-col gap-1 py-1 text-label text-ink" title={widget.tip}>
      <span className="flex items-center justify-between gap-2">
        <span className="min-w-0 flex-1 truncate">{widget.label}</span>
        <RowKeys panel={panel} knobs={[x, y]} name={widget.label} />
      </span>
      <div className="flex items-start gap-2">
        <XYPad
          id={widget.id}
          label={widget.label}
          x={x}
          y={y}
          puck={puck}
          onCatch={bouncing ? () => stopBounce(id, widget.id) : undefined}
          onChange={(a, b) => setBackdropValues(id, withValue(panel.def, withValue(panel.def, backdropValues(id), widget.x, a), widget.y, b))}
          onFling={bouncing ? (flung) => startBounce(id, widget.id, flung) : undefined}
        />
        <div className="flex min-w-0 flex-1 flex-col items-start gap-1">
          <span data-backdrop-value={widget.x}>
            {x.label} {shownValue(x, panel.live[widget.x] as number)}
          </span>
          <span data-backdrop-value={widget.y}>
            {y.label} {shownValue(y, panel.live[widget.y] as number)}
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
      <div key={`switches-${group[0].key}`} className="flex flex-wrap items-center gap-1 py-1" role="group">
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
function Meters() {
  const meters = useSyncExternalStore(subscribeToMeters, backdropMeters, serverMeters);
  if (meters.length === 0) return null;
  return (
    <div className="flex flex-wrap items-end gap-x-3 gap-y-1 pb-1 text-label text-ink" data-backdrop-meters="">
      {meters.map((meter) => (
        <span key={meter.id} className="flex items-end gap-1" title={`${meter.label}, AS IT IS NOW`}>
          <Sparkline readings={meter.history} most={meter.most} />
          <span>
            {meter.label} {Math.round(meter.value)}
          </span>
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
    <div className="flex items-center gap-2 pt-1 text-label text-ink" title="MORPH: EVERY KNOB SLIDES FROM WHERE IT IS TO THE LOOK NAMED HERE">
      <span>MORPH TO</span>
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
          const next = keepingLocks(def, morphValues(def, from, look.values, part), panel.values, panel.locks);
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
    <div className="flex flex-wrap items-center gap-2 pt-1 text-label text-ink">
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
  const [tab, setTab] = useState(def?.tabs[0]?.id ?? '');
  useEffect(() => watchLiveValues(id), [id]);

  if (def === null || live === null || values === null) return null;
  const panel: Panel = { def, values, live, locks: extras.locks, sway: extras.sway, still };
  const shownTab = def.tabs.some((each) => each.id === tab) ? tab : def.tabs[0].id;
  const put = (next: Values) => setBackdropValues(id, keepingLocks(def, next, panel.values, panel.locks));

  return (
    <div className="flex min-h-full flex-col" data-backdrop-window={id}>
      {failed ? (
        <p role="alert" className={NOTE}>
          COULD NOT SAVE TO YOUR ACCOUNT. KEPT IN THIS BROWSER.
        </p>
      ) : null}
      {backdrop === id ? null : (
        <p className="flex flex-wrap items-center gap-2 pb-1 text-label text-ink">
          <span>THE BACKGROUND IS ON {BACKDROPS.find((each) => each.id === backdrop)?.label ?? 'SOMETHING ELSE'}.</span>
          <button type="button" onClick={() => setBackdrop(BACKDROPS.find((each) => each.id === id)?.id ?? DEFAULT_BACKDROP)} className={PLATE}>
            [ SHOW THE {def.label} ]
          </button>
        </p>
      )}
      {still ? <p className={`${NOTE} mb-1`}>YOUR COMPUTER ASKS FOR LESS MOTION, SO WHAT MOVES IS RESTING. THE KNOBS THAT DON&apos;T MOVE ANYTHING STILL WORK.</p> : null}

      <Meters />

      <div className="flex flex-wrap items-center gap-1 pb-1" role="group" aria-label="Kinds of setting">
        {def.tabs.map((each) => (
          <button key={each.id} type="button" aria-pressed={shownTab === each.id} onClick={() => setTab(each.id)} className={shownTab === each.id ? PLATE_PRESSED : PLATE} data-backdrop-tab={each.id}>
            [ {each.label} ]
          </button>
        ))}
      </div>

      <section className="flex-1 pb-2" aria-label={def.tabs.find((each) => each.id === shownTab)?.label}>
        <KnobList tab={shownTab} panel={panel} />
        {def.actions.some((action) => action.tab === shownTab) ? (
          <p className="flex flex-wrap items-center gap-1 py-1">
            {def.actions
              .filter((action) => action.tab === shownTab)
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
      </section>

      {/* The foot stays in sight however far the knobs are scrolled: starting again, a surprise, the ready-made looks, a morph between them, and the ghost. */}
      <div className="sticky -bottom-2 -mx-2 -mb-2 bg-sun-pale px-2 pt-2 pb-2">
        <div className={TITLE_BAR_INACTIVE}>
          <span>LOOKS</span>
        </div>
        <div className="flex flex-wrap items-center gap-1 pt-1" role="group" aria-label="Looks">
          <button type="button" title={`BACK TO THE ${def.label} AS IT CAME`} onClick={() => put(def.defaults)} className={PLATE} data-backdrop-look="reset">
            [ RESET ]
          </button>
          <button type="button" title="EVERY KNOB SOMEWHERE AT RANDOM" onClick={() => setBackdropValues(id, partyValues(def, Math.random, panel.values, panel.locks))} className={PLATE} data-backdrop-look="party">
            [ PARTY ]
          </button>
          {def.looks.map((look) => (
            <button
              key={look.id}
              type="button"
              aria-pressed={sameValues(def, panel.values, look.values)}
              title={look.tip}
              onClick={() => put(look.values)}
              className={sameValues(def, panel.values, look.values) ? PLATE_PRESSED : PLATE}
              data-backdrop-look={look.id}
            >
              [ {look.label} ]
            </button>
          ))}
        </div>
        {still ? null : <Morph key={id} panel={panel} />}
        {still ? null : <Ghost />}
      </div>
    </div>
  );
}

/** Which background's settings the window shows: the one that is on, or (on TILE, which has none) the one it comes with. */
function shownScene(backdrop: string): string {
  return backdropDef(backdrop) === null ? DEFAULT_BACKDROP : backdrop;
}

/**
 * A background's settings window (SPEC-aquarium-settings.md, then SPEC-backgrounds.md): every knob of whichever background is
 * on, in tabs, with the looks along its foot. A window beside the page, with no scrim, because the background it changes is the
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

  return (
    <DockWindow
      id="aquarium"
      title={backdropDef(scene)?.label ?? 'BACKGROUND'}
      onClose={closeBackdropWindow}
      status=""
      dock="top"
      defaultSize={{ w: 400, h: 700 }}
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
