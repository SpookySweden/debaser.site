'use client';

import { useSyncExternalStore } from "react";
import type { MetronomeMode } from "../engine";
import { QUANTISE_OPTIONS } from "../recorder/convert";
import type { RecordMode } from "../recorder/merge";
import { ChoiceGroup } from "./ChoiceGroup";
import { focusOnly, smallKey, stripKey } from "./looks";
import type { KeyAction } from "./keyBindings";
import type { RecordSession } from "./recordSession";
import { explain } from '../../../lib/ui/explain';

const MODES: readonly { value: RecordMode; label: string }[] = [
  { value: "overdub", label: "Overdub" },
  { value: "replace", label: "Replace" },
];
const COUNT_INS = [
  { value: 0, label: "Off" },
  { value: 1, label: "1 bar" },
  { value: 2, label: "2 bars" },
];
const METRONOMES: readonly { value: MetronomeMode; label: string }[] = [
  { value: "off", label: "Off" },
  { value: "count-in", label: "Count-in only" },
  { value: "always", label: "Always" },
];

/** What the hover box says for each choice in this window (shown only while [ EXPLAIN ] is on). */
const modeWords = (mode: RecordMode) =>
  mode === "overdub"
    ? { what: "Sets recording to add your notes on top of what is already there.", why: "For building a part up over several passes." }
    : { what: "Sets recording to replace what is there with what you play.", why: "For doing a part again." };
const countInWords = (bars: number) =>
  bars === 0
    ? { what: "Sets recording to start straight away, with no count-in.", why: "For when you are already in time." }
    : { what: `Sets a count-in of ${bars === 1 ? "one bar" : "two bars"} before recording starts.`, why: "Time to get ready." };
const metronomeWords = (mode: MetronomeMode) =>
  mode === "off"
    ? { what: "Turns the metronome click off.", why: "For playing without the click." }
    : mode === "count-in"
      ? { what: "Sets the metronome to click during the count-in only.", why: "It gives you the speed, then gets out of the way." }
      : { what: "Sets the metronome to click all the way through.", why: "For keeping in time while you record." };
const quantiseWords = (label: string) =>
  label === "Off"
    ? { what: "Keeps your notes exactly where you played them.", why: "No snapping to the beat." }
    : { what: `Snaps recorded notes to the nearest ${label} of a beat.`, why: "For tidying timing; the strength below says how far they move." };

/** The light flashes with the beat, and the verse is the pass being recorded. */
export function BeatLight({ session }: { session: RecordSession }) {
  const beat = useSyncExternalStore(session.subscribe, session.getBeat);
  const text = !beat ? "" : beat.countIn > 0 ? `In ${beat.countIn}:${beat.beat}` : `Beat ${beat.beat}`;
  // Its place is kept while it's dark, so nothing on the bar moves when recording starts.
  return (
    <div
      aria-hidden="true"
      className={`flex w-[7ch] flex-none items-center justify-center self-stretch font-bold whitespace-nowrap uppercase ${beat?.lit ? "motion-safe:bg-bb-flavine motion-safe:text-bb-black" : ""}`}
    >
      {text}
    </div>
  );
}

export function RecordPanel({
  session,
  keyFor,
  onCapture,
}: {
  session: RecordSession;
  /** The words for the key that does this, as it is now. */
  keyFor: (action: KeyAction) => string;
  onCapture: () => void;
}) {
  const settings = useSyncExternalStore(session.subscribe, session.getSettings);
  const quantiseOptions = QUANTISE_OPTIONS.map((option, index) => ({ value: index, label: option.label }));

  return (
    <section aria-label="Loop recorder" className="flex w-full flex-col items-start gap-bb-gutter">
      <ChoiceGroup label="Mode" keyName={keyFor("recordMode")} value={settings.mode} options={MODES} onChange={session.setMode} look={stripKey} stacked words={modeWords} />
      <ChoiceGroup label="Count-in" keyName={keyFor("countIn")} value={settings.countInBars} options={COUNT_INS} onChange={session.setCountIn} look={stripKey} stacked words={countInWords} />
      <ChoiceGroup label="Metronome" keyName={keyFor("metronome")} value={settings.metronome} options={METRONOMES} onChange={session.setMetronome} look={stripKey} stacked words={metronomeWords} />
      <ChoiceGroup
        label="Quantise"
        keyName={keyFor("quantise")}
        value={settings.quantiseIndex}
        options={quantiseOptions}
        words={(index) => quantiseWords(quantiseOptions[index]?.label ?? "Off")}
        onChange={session.setQuantise}
        look={stripKey}
        stacked
      />
      <label className="flex w-full flex-col gap-bb-gutter text-bb-large font-bold uppercase">
        Quantise strength {settings.strength}%
        <input
          type="range"
          min={0}
          max={100}
          step={25}
          value={settings.strength}
          onChange={(event) => session.setStrength(Number(event.target.value))}
          className={`h-bb-target-min w-full max-w-full cursor-pointer accent-bb-pink ${focusOnly}`}
        />
      </label>
      <div className="flex flex-wrap items-center gap-bb-gutter">
        <button type="button" onClick={onCapture} title={`Key: ${keyFor("capture")}`} className={smallKey()} {...explain("Keeps the last time round the loop that you played without recording.", "For catching something good after the fact. It needs the loop on.")}>
          Capture last pass
        </button>
        <button
          type="button"
          onClick={() => session.calibrate()}
          {...explain("Starts a timing test: tap a note key along with the clicks for ten seconds.", "It corrects for the delay of your computer and keyboard.")}
          aria-pressed={settings.calibrating}
          className={smallKey(settings.calibrating)}
        >
          {settings.calibrating ? "Calibrating: tap along" : "Calibrate timing"}
        </button>
      </div>
      {settings.calibrationMs !== 0 && <p className="text-bb-large">Timing adjusted by {settings.calibrationMs} ms.</p>}
    </section>
  );
}
