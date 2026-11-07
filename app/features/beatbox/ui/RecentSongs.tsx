'use client';

import { useEffect, useState, useSyncExternalStore } from "react";
import { GLYPHS } from "./keyHelp";
import { focusOnly, glyphKey, smallKey, titleLine } from "./looks";
import { MOST_RECENT_SONGS, type RecentSong, type RecentStore } from "./recentStore";

function when(time: number): string {
  return new Date(time).toLocaleString([], { dateStyle: "short", timeStyle: "short" });
}

/** One song on the list: which version, a key to hear it, and a key to open it, which asks once more before it replaces what's on screen. */
function RecentRow({
  song,
  onScreen,
  arming,
  hearing,
  onArm,
  onOpen,
  onHear,
}: {
  song: RecentSong;
  onScreen: boolean;
  /** Which of this song's versions has been pressed once. */
  arming: number | null;
  /** Is this song the one being heard? */
  hearing: boolean;
  onArm: (time: number) => void;
  onOpen: (data: string) => void;
  /** Starts hearing this version, or stops with null. */
  onHear: (data: string | null) => void;
}) {
  const newest = song.versions[0]?.time ?? 0;
  const [picked, setPicked] = useState<number | null>(null);
  // Newer versions arrive while it's on screen: the list follows them unless an older one has been picked.
  const version = song.versions.find((one) => one.time === picked) ?? song.versions[0];
  if (!version) return null;
  const name = when(newest);
  const armed = arming === version.time;

  return (
    <li className="flex w-full flex-wrap items-center gap-x-bb-gutter gap-y-1 border-b-(length:--cell-line) border-bb-royal-blue py-1">
      {song.versions.length > 1 ? (
        <select
          aria-label={`Which version of the song from ${name}`}
          value={version.time}
          onChange={(event) => setPicked(Number(event.target.value))}
          className={`bb-field min-h-bb-target-min min-w-0 flex-1 basis-48 bg-bb-black px-1 text-display text-bb-white ${focusOnly}`}
        >
          {song.versions.map((one) => (
            <option key={one.time} value={one.time}>
              {when(one.time)}
            </option>
          ))}
        </select>
      ) : (
        <span className="min-w-0 flex-1 basis-48 text-display">{name}</span>
      )}
      {onScreen && <span className="text-display font-bold text-bb-daffodil uppercase">On screen</span>}
      <button
        type="button"
        aria-label={`${hearing ? "Stop hearing" : "Hear"} the song from ${when(version.time)}`}
        aria-pressed={hearing}
        title={hearing ? "Stop" : "Hear it, without opening it"}
        onClick={() => onHear(hearing ? null : version.data)}
        className={glyphKey(hearing)}
      >
        {hearing ? GLYPHS.stop : GLYPHS.play}
      </button>
      <button
        type="button"
        aria-label={armed ? `Open the song from ${when(version.time)}, replacing the one on screen` : `Open the song from ${when(version.time)}`}
        onClick={() => (armed ? onOpen(version.data) : onArm(version.time))}
        className={smallKey(armed)}
      >
        {armed ? "Open, replacing" : "Open"}
      </button>
    </li>
  );
}

/** The songs worked on in this browser, newest first, to go back to. */
export function RecentSongs({
  open,
  store,
  currentUid,
  songPlaying,
  onOpen,
  onHear,
}: {
  /** Is the window it's in open? Shut, nothing goes on playing and no key stays pressed. */
  open: boolean;
  store: RecentStore;
  /** The song on screen, so the list can say which it is. */
  currentUid: string;
  /** The song itself is playing, which is the end of hearing another. */
  songPlaying: boolean;
  onOpen: (uid: string, data: string) => void;
  /** Plays a version, or stops with null. */
  onHear: (data: string | null) => void;
}) {
  const songs = useSyncExternalStore(store.subscribe, store.getSongs);
  const [arming, setArming] = useState<{ uid: string; time: number } | null>(null);
  const [hearing, setHearing] = useState<string | null>(null);
  const [uidSeen, setUidSeen] = useState(currentUid);

  if (!open && (arming !== null || hearing !== null)) {
    setArming(null);
    setHearing(null);
  }
  // Opening any song, or playing the one on screen, stops what was being heard.
  if (hearing !== null && (songPlaying || uidSeen !== currentUid)) setHearing(null);
  if (uidSeen !== currentUid) setUidSeen(currentUid);
  useEffect(() => {
    if (open) store.refresh();
    else onHear(null);
    // Only as the window opens and shuts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return (
    <section aria-label="Recent songs" className="flex w-full flex-col items-start gap-bb-gutter">
      <h2 className={titleLine}>
        <span>Recent songs</span>
      </h2>
      <p className="text-display">The last {MOST_RECENT_SONGS} you worked on, kept as you go, in this browser only.</p>
      {songs.length === 0 ? (
        <p className="text-display font-bold uppercase">Nothing yet.</p>
      ) : (
        <ul className="flex w-full flex-col">
          {songs.map((song) => (
            <RecentRow
              key={song.uid}
              song={song}
              onScreen={song.uid === currentUid}
              arming={arming?.uid === song.uid ? arming.time : null}
              hearing={hearing === song.uid}
              onArm={(time) => setArming({ uid: song.uid, time })}
              onOpen={(data) => {
                setArming(null);
                setHearing(null);
                onOpen(song.uid, data);
              }}
              onHear={(data) => {
                setHearing(data === null ? null : song.uid);
                onHear(data);
              }}
            />
          ))}
        </ul>
      )}
    </section>
  );
}
