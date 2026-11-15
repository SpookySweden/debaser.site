'use client';

import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import {
  DEFAULT_SETTINGS,
  KNOBS,
  PRESETS,
  TABS,
  partySettings,
  sameSettings,
  shownValue,
  withSetting,
  type AquariumSettings,
  type AquariumTab,
  type ChoiceKnob,
  type Knob,
  type RangeKnob,
  type SwitchKnob,
} from '../lib/aquarium/settings';
import {
  aquariumGiant,
  aquariumSaveFailed,
  aquariumSettings,
  aquariumWindowState,
  closeAquariumWindow,
  serverAquariumGiant,
  serverAquariumSaveFailed,
  serverAquariumSettings,
  setAquariumAccount,
  setAquariumSettings,
  subscribeToAquariumGiant,
  subscribeToAquariumSaveFailed,
  subscribeToAquariumSettings,
  subscribeToAquariumWindow,
  toggleAquariumSeeThrough,
  toggleAquariumWindow,
  toggleGiant,
} from '../lib/aquarium/settings-slot';
import { GIANT_MOST } from '../lib/aquarium/sim';
import { backdropState, setBackdrop, subscribeToBackdrop } from '../lib/ui/backdrop-slot';
import { PLATE, PLATE_ON_BLACK, PLATE_ON_BLACK_PRESSED, PLATE_PRESSED, TITLE_BAR_INACTIVE } from '../lib/ui/controls';
import { useAuth } from './AuthProvider';
import DockWindow from './DockWindow';

const REDUCED_MOTION = '(prefers-reduced-motion: reduce)';

function subscribeToReducedMotion(listener: () => void) {
  const query = window.matchMedia(REDUCED_MOTION);
  query.addEventListener('change', listener);
  return () => query.removeEventListener('change', listener);
}

const reducedMotion = () => window.matchMedia(REDUCED_MOTION).matches;

const NOTE = 'w-fit bg-bubble-pale px-1 text-label text-ink-bar';

/** A slider: its name and its value written out above it, the arrow keys working on it when it has focus. */
function RangeRow({ knob, settings }: { knob: RangeKnob; settings: AquariumSettings }) {
  const value = settings[knob.key];
  const shown = shownValue(knob, value);
  return (
    <label className="flex flex-col gap-0.5 py-1 text-label text-ink" title={knob.tip}>
      <span className="flex justify-between gap-2">
        <span>{knob.label}</span>
        <span data-aquarium-value={knob.key}>{shown}</span>
      </span>
      <input
        type="range"
        min={knob.min}
        max={knob.max}
        step={knob.step}
        value={value}
        aria-label={knob.label}
        aria-valuetext={shown}
        onChange={(event) => setAquariumSettings(withSetting(settings, knob.key, Number(event.target.value)))}
        className="h-5 w-full cursor-pointer accent-bubble"
        data-aquarium-knob={knob.key}
      />
    </label>
  );
}

/** A switch: a key that stays filled while it is on, as every switch on the site does. */
function SwitchKey({ knob, settings }: { knob: SwitchKnob; settings: AquariumSettings }) {
  const on = settings[knob.key];
  return (
    <button
      type="button"
      aria-pressed={on}
      title={knob.tip}
      onClick={() => setAquariumSettings(withSetting(settings, knob.key, !on))}
      className={on ? PLATE_PRESSED : PLATE}
      data-aquarium-knob={knob.key}
    >
      [ {knob.label} ]
    </button>
  );
}

/** One of a few: the chosen one filled. */
function ChoiceRow({ knob, settings }: { knob: ChoiceKnob; settings: AquariumSettings }) {
  return (
    <div className="flex flex-wrap items-center gap-1 py-1 text-label text-ink" role="group" aria-label={knob.label} title={knob.tip}>
      <span className="pr-1">{knob.label}</span>
      {knob.options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={settings[knob.key] === option.value}
          title={option.tip}
          onClick={() => setAquariumSettings(withSetting(settings, knob.key, option.value))}
          className={settings[knob.key] === option.value ? PLATE_PRESSED : PLATE}
          data-aquarium-knob={`${knob.key}-${option.value}`}
        >
          [ {option.label} ]
        </button>
      ))}
    </div>
  );
}

/** A tab's knobs in their listed order, switches that follow one another sharing a line. */
function KnobList({ tab, settings }: { tab: AquariumTab; settings: AquariumSettings }) {
  const rows: ReactNode[] = [];
  let switches: SwitchKnob[] = [];
  const flush = () => {
    if (switches.length === 0) return;
    const group = switches;
    switches = [];
    rows.push(
      <div key={`switches-${group[0].key}`} className="flex flex-wrap items-center gap-1 py-1" role="group">
        {group.map((knob) => (
          <SwitchKey key={knob.key} knob={knob} settings={settings} />
        ))}
      </div>,
    );
  };
  for (const knob of KNOBS.filter((each: Knob) => each.tab === tab)) {
    if (knob.kind === 'switch') {
      switches.push(knob);
      continue;
    }
    flush();
    if (knob.kind === 'range') rows.push(<RangeRow key={knob.key} knob={knob} settings={settings} />);
    else rows.push(<ChoiceRow key={knob.key} knob={knob} settings={settings} />);
  }
  flush();
  return <>{rows}</>;
}

/** What the window holds. Exported so a check can draw it without the window's frame round it. */
export function AquariumKnobs() {
  const settings = useSyncExternalStore(subscribeToAquariumSettings, aquariumSettings, serverAquariumSettings);
  const failed = useSyncExternalStore(subscribeToAquariumSaveFailed, aquariumSaveFailed, serverAquariumSaveFailed);
  const giant = useSyncExternalStore(subscribeToAquariumGiant, aquariumGiant, serverAquariumGiant);
  const { id: backdrop } = useSyncExternalStore(subscribeToBackdrop, backdropState, backdropState);
  const still = useSyncExternalStore(subscribeToReducedMotion, reducedMotion, () => false);
  const [tab, setTab] = useState<AquariumTab>('fish');

  return (
    <div className="flex min-h-full flex-col" data-aquarium-window="">
      {failed ? (
        <p role="alert" className={NOTE}>
          COULD NOT SAVE TO YOUR ACCOUNT. KEPT IN THIS BROWSER.
        </p>
      ) : null}
      {backdrop === 'aquarium' ? null : (
        <p className="flex flex-wrap items-center gap-2 pb-1 text-label text-ink">
          <span>THE BACKGROUND IS ON TILE.</span>
          <button type="button" onClick={() => setBackdrop('aquarium')} className={PLATE}>
            [ SHOW THE AQUARIUM ]
          </button>
        </p>
      )}
      {still ? <p className={`${NOTE} mb-1`}>YOUR COMPUTER ASKS FOR LESS MOTION, SO THE FISH AND BUBBLES ARE RESTING. THE SEA AND CORAL KNOBS STILL WORK.</p> : null}

      <div className="flex flex-wrap items-center gap-1 pb-1" role="group" aria-label="Kinds of setting">
        {TABS.map((each) => (
          <button key={each.id} type="button" aria-pressed={tab === each.id} onClick={() => setTab(each.id)} className={tab === each.id ? PLATE_PRESSED : PLATE} data-aquarium-tab={each.id}>
            [ {each.label} ]
          </button>
        ))}
      </div>

      <section className="flex-1 pb-2" aria-label={TABS.find((each) => each.id === tab)?.label}>
        <KnobList tab={tab} settings={settings} />
        {tab === 'silly' ? (
          <p className="py-1">
            <button
              type="button"
              aria-pressed={giant}
              title={`FOR 20 SECONDS THE FISH ARE EIGHT TIMES THEIR SIZE (${GIANT_MOST} FISH AT THE MOST). PRESS AGAIN TO STOP`}
              onClick={toggleGiant}
              className={giant ? PLATE_PRESSED : PLATE}
              data-aquarium-knob="giant"
            >
              [ GIANT MODE ]
            </button>
          </p>
        ) : null}
      </section>

      {/* The foot stays in sight however far the knobs are scrolled: starting again, a surprise, and the ready-made looks. */}
      <div className="sticky -bottom-2 -mx-2 -mb-2 bg-sun-pale px-2 pt-2 pb-2">
        <div className={TITLE_BAR_INACTIVE}>
          <span>LOOKS</span>
        </div>
        <div className="flex flex-wrap items-center gap-1 pt-1" role="group" aria-label="Looks">
          <button type="button" title="BACK TO THE WINDOWS 98 LOOK" onClick={() => setAquariumSettings(DEFAULT_SETTINGS)} className={PLATE} data-aquarium-look="reset">
            [ RESET ]
          </button>
          <button type="button" title="EVERY KNOB SOMEWHERE AT RANDOM" onClick={() => setAquariumSettings(partySettings(Math.random))} className={PLATE} data-aquarium-look="party">
            [ PARTY ]
          </button>
          {PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              aria-pressed={sameSettings(settings, preset.settings)}
              title={preset.tip}
              onClick={() => setAquariumSettings(preset.settings)}
              className={sameSettings(settings, preset.settings) ? PLATE_PRESSED : PLATE}
              data-aquarium-look={preset.id}
            >
              [ {preset.label} ]
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * The AQUARIUM window (SPEC-aquarium-settings.md, Luke 2026-11-15): every knob of the sea behind the site, in four kinds, with
 * the looks along its foot. A window beside the page, with no scrim, because the sea it changes is the thing to look at while
 * changing it; its `[ 50% ]` key makes the window itself half see-through for the same reason. Drawn once in `layout.tsx`, and
 * it is what tells the settings who is signed in (as the MODULOS window does for the bar), so it does that whether or not it is open.
 */
export default function AquariumSettingsWindow() {
  const { open, seeThrough } = useSyncExternalStore(subscribeToAquariumWindow, aquariumWindowState, aquariumWindowState);
  const { user, status } = useAuth();
  const person = status === 'signed-in' && user !== null ? user.id : null;

  useEffect(() => {
    if (status !== 'loading') void setAquariumAccount(person);
  }, [person, status]);

  if (!open) return null;

  return (
    <DockWindow
      id="aquarium"
      title="AQUARIUM"
      onClose={closeAquariumWindow}
      status=""
      dock="top"
      defaultSize={{ w: 400, h: 620 }}
      minSize={{ w: 300, h: 240 }}
      seeThrough={seeThrough}
      titleKeys={
        <button
          type="button"
          onPointerDown={(event) => event.stopPropagation()}
          onDoubleClick={(event) => event.stopPropagation()}
          onClick={toggleAquariumSeeThrough}
          aria-pressed={seeThrough}
          aria-label="Make this window half see-through"
          title={seeThrough ? 'SOLID AGAIN' : 'HALF SEE-THROUGH, SO THE SEA SHOWS THROUGH THE WINDOW'}
          className="cursor-pointer key px-1 py-0.75 text-label font-bold leading-none max-sm:min-h-tap max-sm:min-w-tap max-sm:text-sm"
          data-aquarium-see-through={seeThrough ? 'on' : 'off'}
        >
          [ 50% ]
        </button>
      }
    >
      <AquariumKnobs />
    </DockWindow>
  );
}

/**
 * The key on the sea itself: in the top-left corner of the bare desk, it opens (and shuts) the AQUARIUM window. Where it shows
 * is the stylesheet's business (`.aquarium-key`, globals.css): only on the aquarium, and only where there is sea to be on.
 */
export function AquariumSeaKey() {
  const { open } = useSyncExternalStore(subscribeToAquariumWindow, aquariumWindowState, aquariumWindowState);
  return (
    <button
      type="button"
      onClick={toggleAquariumWindow}
      aria-pressed={open}
      title="CHANGE THE AQUARIUM: FISH, SEA, PLAY, SILLY"
      className={`aquarium-key ${open ? PLATE_ON_BLACK_PRESSED : PLATE_ON_BLACK}`}
      data-aquarium-key=""
    >
      [ AQUARIUM ]
    </button>
  );
}
