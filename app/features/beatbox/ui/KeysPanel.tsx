'use client';

import { useEffect, useRef, useState } from "react";
import {
  actionLabel,
  bind,
  clashWith,
  KEY_GROUPS,
  keyWords,
  strokeOf,
  whyNot,
  type Bindings,
  type KeyAction,
} from "./keyBindings";
import { FIXED_KEYS } from "./keyHelp";
import { smallKey, titleLine } from "./looks";

/** Every key, what it does, and a way to change it. */
export function KeysPanel({
  bindings,
  onChange,
  onReset,
  onAnnounce,
}: {
  bindings: Bindings;
  onChange: (bindings: Bindings) => void;
  onReset: () => void;
  onAnnounce: (message: string) => void;
}) {
  // The key waiting to be pressed for, and the key pressed that some other job already has.
  const [listening, setListening] = useState<KeyAction | null>(null);
  const [clash, setClash] = useState<{ action: KeyAction; stroke: string; other: KeyAction } | null>(null);
  const [refusal, setRefusal] = useState("");
  const backTo = useRef<KeyAction | null>(null);
  const row = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!listening) return;
    const action = listening;

    function press(event: KeyboardEvent) {
      // First in line, so a pressed key is only an answer: it plays nothing and does nothing else.
      event.preventDefault();
      event.stopPropagation();
      if (event.repeat) return;
      if (event.key === "Escape") {
        setListening(null);
        setRefusal("");
        onAnnounce("Key left as it was.");
        return;
      }
      if (event.altKey || event.metaKey) {
        setRefusal("Alt and Windows keys belong to your browser. Press another key, or Esc to leave it.");
        return;
      }
      const stroke = strokeOf(event);
      if (stroke === null) return;
      const refused = whyNot(stroke, event.code);
      if (refused) {
        setRefusal(`${refused} Press another key, or Esc to leave it.`);
        return;
      }
      setListening(null);
      setRefusal("");
      const other = clashWith(bindings, action, stroke);
      if (other) {
        setClash({ action, stroke, other });
        return;
      }
      onChange(bind(bindings, action, stroke));
      onAnnounce(`${actionLabel(action)} is now ${keyWords(stroke)}.`);
    }

    // The key is let go after the answer, and a Space let go on a focused key would press it.
    function letGo(event: KeyboardEvent) {
      event.preventDefault();
      event.stopPropagation();
    }

    document.addEventListener("keydown", press, true);
    document.addEventListener("keyup", letGo, true);
    return () => {
      document.removeEventListener("keydown", press, true);
      document.removeEventListener("keyup", letGo, true);
    };
  }, [listening, bindings, onChange, onAnnounce]);

  // After an answer, the cursor goes back to the row it came from.
  useEffect(() => {
    if (listening || clash || !backTo.current) return;
    const action = backTo.current;
    backTo.current = null;
    row.current?.querySelector<HTMLElement>(`[data-change-key="${action}"]`)?.focus();
  }, [listening, clash]);

  useEffect(() => {
    if (clash) row.current?.querySelector<HTMLElement>("[data-swap-key]")?.focus();
  }, [clash]);

  function listen(action: KeyAction) {
    backTo.current = action;
    setClash(null);
    setRefusal("");
    setListening(listening === action ? null : action);
  }

  function swap() {
    if (!clash) return;
    onChange(bind(bindings, clash.action, clash.stroke));
    onAnnounce(
      `${actionLabel(clash.action)} is now ${keyWords(clash.stroke)}, and ${actionLabel(clash.other)} is now ${keyWords(bindings[clash.action])}.`,
    );
    setClash(null);
  }

  function keepAsItWas() {
    setClash(null);
    onAnnounce("Key left as it was.");
  }

  return (
    <div ref={row} className="flex w-full flex-col items-start gap-bb-gap">
      <section aria-label="Keys you can change" className="flex w-full flex-col items-start gap-bb-gutter">
        <h3 className={titleLine}>
          <span>Keyboard keys</span>
        </h3>
        <p className="text-bb-large">Press Change, then the key you want. These stay on this browser.</p>
        <button type="button" onClick={onReset} className={smallKey()}>
          Put all the keys back
        </button>
        {KEY_GROUPS.map((group) => (
          <div key={group.title} role="group" aria-label={group.title} className="flex w-full flex-col">
            <h4 className="text-bb-large font-bold text-bb-daffodil uppercase">{group.title}</h4>
            {group.actions.map(({ id, label }) => (
              <div key={id} className="flex w-full flex-col border-b-(length:--cell-line) border-bb-royal-blue py-1">
                <div className="flex w-full flex-wrap items-center justify-between gap-x-bb-gutter gap-y-1">
                  <span className="min-w-0 flex-1 basis-48 text-display wrap-anywhere">{label}</span>
                  <span className="flex flex-none items-center gap-bb-gutter">
                    <span
                      data-key-shown={id}
                      className={`text-display font-bold whitespace-nowrap ${listening === id ? "text-bb-pink" : "text-bb-white"}`}
                    >
                      {listening === id ? "Press a key" : keyWords(bindings[id])}
                    </span>
                    <button
                      type="button"
                      data-change-key={id}
                      aria-label={listening === id ? `Leave the key for ${label} as it is` : `Change the key for ${label}, now ${keyWords(bindings[id])}`}
                      onClick={() => listen(id)}
                      className={smallKey(listening === id)}
                    >
                      {listening === id ? "Cancel" : "Change"}
                    </button>
                  </span>
                </div>
                {listening === id && refusal !== "" && (
                  <p role="alert" className="text-display wrap-anywhere text-bb-pink">
                    {refusal}
                  </p>
                )}
                {clash?.action === id && (
                  <div className="flex w-full flex-col items-start gap-1">
                    <p role="alert" className="text-display wrap-anywhere text-bb-pink">
                      {keyWords(clash.stroke)} is already: {actionLabel(clash.other)}.
                    </p>
                    <div className="flex flex-wrap gap-bb-gutter">
                      <button type="button" data-swap-key onClick={swap} className={smallKey()}>
                        Swap them
                      </button>
                      <button type="button" onClick={keepAsItWas} className={smallKey()}>
                        Leave it
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        ))}
      </section>

      <section aria-label="Keys that stay as they are" className="flex w-full flex-col items-start gap-bb-gutter">
        <h3 className={titleLine}>
          <span>Keys that stay</span>
        </h3>
        {FIXED_KEYS.map((group) => (
          <div key={group.title} className="flex w-full flex-col">
            <h4 className="text-bb-large font-bold text-bb-daffodil uppercase">{group.title}</h4>
            <dl className="flex w-full flex-col">
              {group.keys.map(([keys, action]) => (
                <div key={keys} className="flex w-full flex-col border-b-(length:--cell-line) border-bb-royal-blue py-1 text-display wrap-anywhere">
                  <dt className="font-bold">{keys}</dt>
                  <dd>{action}</dd>
                </div>
              ))}
            </dl>
          </div>
        ))}
      </section>
    </div>
  );
}
