'use client';

import { useRef, useState, type KeyboardEvent } from "react";
import { groupOfSound, soundGroups, soundIdOf, soundIsExactly } from "../engine/sounds";
import type { SongData } from "../engine/songData";
import { channelName, noteShapeStyle } from "./channelLooks";
import { nextChoiceIndex } from "./ChoiceGroup";
import { listRow } from "./looks";

const SONGS_OWN = "own";

/**
 * A channel, its kinds of sound down the side and that kind's sounds beside them. Picking one plays it, and so does moving to one with the
 * arrow keys, so a list can be run through by ear.
 */
export function SoundsPanel({
  song,
  channel,
  onPickChannel,
  onPickSound,
  onTrySound,
}: {
  song: SongData;
  channel: number;
  onPickChannel: (channel: number) => void;
  onPickSound: (sound: string) => void;
  /** Plays the sound it has now. */
  onTrySound: () => void;
}) {
  const picked = song.channels[channel];
  const [open, setOpen] = useState<{ channel: number; group: string } | null>(null);
  const list = useRef<HTMLDivElement>(null);
  const channels = useRef<HTMLDivElement>(null);
  if (!picked) return null;

  const known = soundIdOf(picked.sounds[0], picked.isDrum);
  const groups = soundGroups(picked.isDrum);
  // It opens on the kind this channel's sound is, until another kind is opened.
  const openGroup = open?.channel === channel ? open.group : groupOfSound(known, picked.isDrum);
  const group = groups.find((other) => other.id === openGroup) ?? groups[0];
  // A sound the song brought with it stays on offer until something else is picked.
  const choices = known === null ? [{ value: SONGS_OWN, label: "This song's own" }, ...(group?.choices ?? [])] : (group?.choices ?? []);
  const chosenIndex = choices.findIndex((choice) => choice.value === (known ?? SONGS_OWN));
  // Something to Tab to, when the sound that's chosen is in another list.
  const tabStop = chosenIndex === -1 ? 0 : chosenIndex;

  function pick(sound: string) {
    // The one it is already just plays. One it only looks like, such as a wave the song has changed, is put back to the plain one.
    if (sound === SONGS_OWN || soundIsExactly(sound, picked?.sounds[0], picked?.isDrum ?? false)) onTrySound();
    else onPickSound(sound);
  }

  function listKeyDown(event: KeyboardEvent) {
    const next = nextChoiceIndex(event.key, chosenIndex === -1 ? -1 : chosenIndex, choices.length);
    const choice = next === null ? undefined : choices[next];
    if (!choice || next === null) return;
    event.preventDefault();
    pick(choice.value);
    list.current?.querySelectorAll("button")[next]?.focus();
  }

  function channelKeyDown(event: KeyboardEvent) {
    const next = nextChoiceIndex(event.key, channel, song.channels.length);
    if (next === null) return;
    event.preventDefault();
    onPickChannel(next);
    channels.current?.querySelectorAll("button")[next]?.focus();
  }

  return (
    <div className="flex w-full flex-col gap-bb-gutter">
      <div ref={channels} role="radiogroup" aria-label="Channel" onKeyDown={channelKeyDown} className="flex flex-wrap gap-1">
        {song.channels.map((_, index) => {
          const on = index === channel;
          return (
            <button
              key={index}
              type="button"
              role="radio"
              aria-checked={on}
              tabIndex={on ? 0 : -1}
              title={channelName(song, index)}
              onClick={() => onPickChannel(index)}
              className={`${listRow(on)} w-auto! gap-1 ${on ? "" : "text-bb-daffodil"}`}
            >
              <span
                aria-hidden="true"
                className={`block flex-none ${on ? "bg-bb-black" : "bg-bb-pink"}`}
                style={{ width: "var(--target-swatch)", height: "var(--target-swatch)", ...noteShapeStyle(song, index, true, true) }}
              />
              {channelName(song, index)}
            </button>
          );
        })}
      </div>

      <div className="flex w-full min-w-0 gap-bb-gutter">
        <div role="group" aria-label="Kinds of sound" className="flex w-32 flex-none flex-col border-r-(length:--frame-width) border-bb-white pr-1">
          {groups.map((other) => {
            const on = other.id === group?.id;
            return (
              <button
                key={other.id}
                type="button"
                aria-pressed={on}
                onClick={() => setOpen({ channel, group: other.id })}
                className={`${listRow(false)} uppercase ${on ? "text-bb-daffodil underline decoration-(length:--beat-line)" : ""}`}
              >
                {other.label}
              </button>
            );
          })}
        </div>
        <div ref={list} role="radiogroup" aria-label="Sound" onKeyDown={listKeyDown} className="grid min-w-0 flex-1 auto-rows-min grid-cols-1 gap-x-1 sm:grid-cols-2">
          {choices.map((choice, index) => {
            const on = choice.value === (known ?? SONGS_OWN);
            return (
              <button
                key={choice.value}
                type="button"
                role="radio"
                aria-checked={on}
                tabIndex={index === tabStop ? 0 : -1}
                onClick={() => pick(choice.value)}
                className={listRow(on)}
              >
                {choice.label}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
