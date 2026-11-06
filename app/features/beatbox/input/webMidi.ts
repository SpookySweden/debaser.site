// MIDI keyboards, through the browser's own Web MIDI. Permission is only ever asked for
// when connectMidi is called, and that only happens from the "Connect MIDI keyboard" button.
import type { NoteEvent, NoteListener } from "./noteEvents";

const NOTE_OFF = 0x80;
const NOTE_ON = 0x90;

/** Reads one MIDI message. Returns null for anything that isn't a note. */
export function parseMidiMessage(data: ArrayLike<number>, time: number): NoteEvent | null {
  const status = data[0];
  const note = data[1];
  const velocity = data[2] ?? 0;
  if (status === undefined || note === undefined) return null;
  const kind = status & 0xf0;
  // Many keyboards send "note on" with no velocity to mean "note off".
  if (kind === NOTE_ON && velocity > 0) return { type: "on", note, velocity, time, source: "midi" };
  if (kind === NOTE_OFF || kind === NOTE_ON) return { type: "off", note, velocity: 0, time, source: "midi" };
  return null;
}

export type MidiResult =
  | { readonly status: "connected"; readonly connection: MidiConnection }
  | { readonly status: "unsupported" }
  | { readonly status: "denied" };

export interface MidiConnection {
  getInputNames(): string[];
  onDevicesChange(listener: () => void): void;
  disconnect(): void;
}

// The parts of the browser's MIDI objects used here.
interface MidiInputLike {
  readonly name?: string | null;
  onmidimessage: ((event: { data: ArrayLike<number> | null; timeStamp: number }) => void) | null;
}

export interface MidiAccessLike {
  readonly inputs: { values(): Iterable<MidiInputLike> };
  onstatechange: (() => void) | null;
}

export interface MidiNavigator {
  requestMIDIAccess?: (options: { sysex: boolean }) => Promise<MidiAccessLike>;
}

export async function connectMidi(emit: NoteListener, browser: MidiNavigator): Promise<MidiResult> {
  if (!browser.requestMIDIAccess) return { status: "unsupported" };
  let access: MidiAccessLike;
  try {
    access = await browser.requestMIDIAccess({ sysex: false });
  } catch {
    return { status: "denied" };
  }

  let devicesChanged: () => void = () => {};

  function listenToInputs() {
    for (const input of access.inputs.values()) {
      input.onmidimessage = (event) => {
        if (!event.data) return;
        const note = parseMidiMessage(event.data, event.timeStamp);
        if (note) emit(note);
      };
    }
  }

  listenToInputs();
  // Keyboards can be plugged in later.
  access.onstatechange = () => {
    listenToInputs();
    devicesChanged();
  };

  return {
    status: "connected",
    connection: {
      getInputNames: () => [...access.inputs.values()].map((input) => input.name || "MIDI keyboard"),
      onDevicesChange(listener) {
        devicesChanged = listener;
      },
      disconnect() {
        access.onstatechange = null;
        for (const input of access.inputs.values()) input.onmidimessage = null;
      },
    },
  };
}
