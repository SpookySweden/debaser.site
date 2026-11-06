'use client';

import { soundChoices, soundIdOf } from "../engine/sounds";
import type { SongData } from "../engine/songData";
import { channelName } from "./channelLooks";
import { ChoiceGroup } from "./ChoiceGroup";
import { stripKey } from "./looks";

const SONGS_OWN = "own";

/** The channels, and the kinds of sound each can be. Picking one plays it, so the choice can be heard straight away. */
export function SoundsPanel({
  song,
  channel,
  onPickChannel,
  onPickSound,
}: {
  song: SongData;
  channel: number;
  onPickChannel: (channel: number) => void;
  onPickSound: (sound: string) => void;
}) {
  const picked = song.channels[channel];
  if (!picked) return null;
  const known = soundIdOf(picked.sounds[0], picked.isDrum);
  const choices = soundChoices(picked.isDrum);
  // A sound the song brought with it stays on offer until something else is picked.
  const options = known === null ? [{ value: SONGS_OWN, label: "This song's own" }, ...choices] : choices;

  return (
    <>
      <ChoiceGroup
        label="Channel"
        value={channel}
        options={song.channels.map((_, index) => ({ value: index, label: channelName(song, index) }))}
        onChange={onPickChannel}
        look={stripKey}
        stacked
      />
      <ChoiceGroup
        label="Sound"
        value={known ?? SONGS_OWN}
        options={options}
        onChange={(sound) => {
          if (sound !== SONGS_OWN) onPickSound(sound);
        }}
        look={stripKey}
        stacked
      />
      <p className="text-display wrap-anywhere">Pick one to hear it. Undo brings back the last one.</p>
    </>
  );
}
