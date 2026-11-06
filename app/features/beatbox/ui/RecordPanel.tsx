'use client';

import { useSyncExternalStore } from "react";
import type { MetronomeMode } from "../engine";
import { QUANTISE_OPTIONS } from "../recorder/convert";
import type { RecordMode } from "../recorder/merge";
import { ChoiceGroup } from "./ChoiceGroup";
import { focusOnly, smallKey, stripKey } from "./looks";
import type { KeyAction } from "./keyBindings";
import type { RecordSession } from "./recordSession";

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
      <ChoiceGroup label="Mode" keyName={keyFor("recordMode")} value={settings.mode} options={MODES} onChange={session.setMode} look={stripKey} stacked />
      <ChoiceGroup label="Count-in" keyName={keyFor("countIn")} value={settings.countInBars} options={COUNT_INS} onChange={session.setCountIn} look={stripKey} stacked />
      <ChoiceGroup label="Metronome" keyName={keyFor("metronome")} value={settings.metronome} options={METRONOMES} onChange={session.setMetronome} look={stripKey} stacked />
      <ChoiceGroup
        label="Quantise"
        keyName={keyFor("quantise")}
        value={settings.quantiseIndex}
        options={quantiseOptions}
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
        <button type="button" onClick={onCapture} title={`Key: ${keyFor("capture")}`} className={smallKey()}>
          Capture last pass
        </button>
        <button
          type="button"
          onClick={() => session.calibrate()}
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
