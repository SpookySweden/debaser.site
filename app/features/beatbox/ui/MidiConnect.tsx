'use client';

import { useEffect, useRef, useState } from "react";
import { connectMidi, type MidiConnection, type MidiNavigator } from "../input/webMidi";
import type { LiveNotes } from "./liveNotes";
import { bigKey, titleLine } from "./looks";

function describeInputs(names: string[]): string {
  return names.length === 0
    ? "Ready, but no MIDI keyboard is plugged in. Plug one in and it will appear here."
    : `Connected: ${names.join(", ")}. Play a note to hear it.`;
}

export function MidiConnect({ live }: { live: LiveNotes }) {
  const [message, setMessage] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const connection = useRef<MidiConnection | null>(null);

  const here = useRef(true);

  useEffect(() => {
    here.current = true;
    return () => {
      here.current = false;
      connection.current?.disconnect();
    };
  }, []);

  async function connect() {
    setMessage("Waiting for your browser. It may ask you to allow MIDI.");
    const result = await connectMidi(live.stream.emit, navigator as unknown as MidiNavigator);
    if (!here.current) {
      if (result.status === "connected") result.connection.disconnect();
      return;
    }
    if (result.status === "unsupported") {
      setMessage(
        "This browser can't use MIDI keyboards. Chrome and Edge can, as can Firefox on a computer and Chrome on Android. The pads and computer keys still work here.",
      );
    } else if (result.status === "denied") {
      setMessage("MIDI wasn't allowed. The pads and computer keys still work. Press the button to try again.");
    } else {
      connection.current = result.connection;
      setConnected(true);
      setMessage(describeInputs(result.connection.getInputNames()));
      result.connection.onDevicesChange(() => setMessage(describeInputs(result.connection.getInputNames())));
    }
  }

  return (
    <section aria-label="MIDI keyboard" className="flex w-full flex-col items-start gap-bb-gutter">
      <h2 className={titleLine}>
        <span>MIDI keyboard</span>
      </h2>
      {!connected && (
        <>
          <p className="text-bb-large wrap-anywhere">Your browser will ask to let this page hear the notes you play.</p>
          <button type="button" onClick={() => void connect()} className={bigKey()}>
            Connect MIDI keyboard
          </button>
        </>
      )}
      {/* Always here, so screen readers are listening before a message arrives. */}
      <p role="status" className="text-bb-large wrap-anywhere">
        {message}
      </p>
    </section>
  );
}
