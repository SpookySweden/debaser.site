'use client';

import { useRef, useSyncExternalStore, type KeyboardEvent, type PointerEvent } from "react";
import { DRUM_ROW_COUNT, midiToPitch, pitchName, type SongData } from "../engine/songData";
import type { NoteEvent } from "../input/noteEvents";
import { channelName, noteShapeStyle } from "./channelLooks";
import type { LiveNotes } from "./liveNotes";

const PAD_VELOCITY = 100;
const PAD_KEYS = new Set(["Enter", " "]);

const padLook =
  "relative flex min-h-bb-target-large min-w-bb-target-large flex-1 cursor-pointer touch-none items-center justify-center border-(length:--border-width) border-bb-white p-2 text-center text-bb-large leading-none font-bold wrap-anywhere select-none focus:outline-(length:--focus-width) focus:outline-offset-(length:--focus-width) focus:outline-bb-daffodil";

function Pad({
  note,
  name,
  lit,
  shape,
  onNote,
}: {
  note: number;
  name: string;
  lit: boolean;
  shape: React.CSSProperties;
  onNote: (type: NoteEvent["type"], note: number, time: number) => void;
}) {
  const down = useRef(false);

  function press(time: number) {
    if (down.current) return;
    down.current = true;
    onNote("on", note, time);
  }

  function letGo(time: number) {
    if (!down.current) return;
    down.current = false;
    onNote("off", note, time);
  }

  function pointerDown(event: PointerEvent<HTMLButtonElement>) {
    event.currentTarget.setPointerCapture(event.pointerId);
    press(event.timeStamp);
  }

  function keyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (!PAD_KEYS.has(event.key)) return;
    event.preventDefault();
    press(event.timeStamp);
  }

  function keyUp(event: KeyboardEvent<HTMLButtonElement>) {
    if (!PAD_KEYS.has(event.key)) return;
    event.preventDefault();
    letGo(event.timeStamp);
  }

  return (
    <button
      type="button"
      aria-pressed={lit}
      onPointerDown={pointerDown}
      onPointerUp={(event) => letGo(event.timeStamp)}
      onPointerCancel={(event) => letGo(event.timeStamp)}
      onKeyDown={keyDown}
      onKeyUp={keyUp}
      onBlur={(event) => letGo(event.timeStamp)}
      className={`${padLook} ${lit ? "bb-sunk bg-bb-pink text-bb-black" : "bg-bb-royal-blue text-bb-white"}`}
    >
      {lit && <span aria-hidden="true" className="absolute inset-2 bg-bb-pink" style={shape} />}
      <span className="relative">{name}</span>
    </button>
  );
}

export function Pads({ song, channelIndex, live }: { song: SongData; channelIndex: number; live: LiveNotes }) {
  const held = useSyncExternalStore(live.subscribe, live.getHeld);
  const octave = useSyncExternalStore(live.subscribe, live.getOctave);
  const channel = song.channels[channelIndex];
  if (!channel) throw new Error(`The song has no channel ${channelIndex}.`);

  function playPad(type: NoteEvent["type"], note: number, time: number) {
    live.stream.emit({ type, note, velocity: type === "on" ? PAD_VELOCITY : 0, time, source: "pads" });
  }

  const shape = noteShapeStyle(song, channelIndex, true, true);
  const pads = channel.isDrum
    ? Array.from({ length: DRUM_ROW_COUNT }, (_, row) => ({
        // Pads go up the drum rows in order. See noteToDrumRow.
        note: 60 + row,
        pitch: row,
      }))
    : Array.from({ length: 12 }, (_, semitone) => {
        const note = (octave + 1) * 12 + semitone;
        return { note, pitch: midiToPitch(song, note) };
      });

  return (
    <section aria-label="Pads" className="flex w-full flex-none flex-col gap-1 px-2 pb-1">
      <h2 className="sr-only">
        <span>Pads: {channelName(song, channelIndex)}</span>
      </h2>
      <div className="flex w-full flex-wrap gap-bb-gutter">
        {pads.map(({ note, pitch }) =>
          pitch === null ? null : (
            <Pad
              key={note}
              note={note}
              name={pitchName(song, channel, pitch)}
              lit={held.has(pitch)}
              shape={shape}
              onNote={playPad}
            />
          ),
        )}
      </div>
    </section>
  );
}
