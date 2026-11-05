'use client';

import { useRef, useState, type ChangeEvent, type FormEvent, type KeyboardEvent, type ReactNode } from "react";
import type { Engine } from "../engine";
import { audioToWav, songToMidi } from "../engine/exportFiles";
import { bigKey, focusOnly, mainKey, smallKey, titleLine } from "./looks";

// The example song from BeepBox's own README (MIT licence, see CREDITS.md).
const EXAMPLE_LINK =
  "https://www.beepbox.co/#9n30sbk7l00e00t2-a7g00j00r1i0o443T0v2u00f0qw02d03w2h0E0T0v2u00f0qw02d03w2h0E0T0v0u00f0qw02d03w1h0E0bUp1OFEYtghQ4sBihS7dQQuwE8W2eywzwPbGcKCzZk4t17hghQCngpo";

const FILE_NAME = "debaser-beatbox";

function saveFile(content: BlobPart, extension: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `${FILE_NAME}.${extension}`;
  link.click();
  URL.revokeObjectURL(url);
}

export interface SavedSong {
  readonly link: string;
  readonly json: string;
}

export function InOut({
  engine,
  onOpen,
  onSave,
  shareLinkStart,
  extras,
  onAnnounce,
}: {
  engine: Engine;
  onOpen: (text: string) => void;
  onSave?: (song: SavedSong) => void;
  shareLinkStart?: string;
  extras?: (getSong: () => SavedSong) => ReactNode;
  onAnnounce: (message: string) => void;
}) {
  const [link, setLink] = useState("");
  const [shareLink, setShareLink] = useState("");
  const [renderProgress, setRenderProgress] = useState<number | null>(null);
  const filePicker = useRef<HTMLInputElement>(null);

  function submit(event: FormEvent) {
    event.preventDefault();
    onOpen(link);
  }

  function linkKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
    }
  }

  async function openFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    // Cleared, so the same file can be picked again after being changed.
    event.target.value = "";
    if (!file) return;
    try {
      onOpen(await file.text());
    } catch {
      onAnnounce("Problem: that file couldn't be read.");
    }
  }

  function saveMidi() {
    saveFile(songToMidi(engine.getSong()), "mid", "audio/midi");
    onAnnounce("MIDI file saved to your downloads.");
  }

  function saveJson() {
    saveFile(engine.getSongJson(), "json", "application/json");
    onAnnounce("Song file saved to your downloads.");
  }

  async function saveWav() {
    if (renderProgress !== null) return;
    onAnnounce("Making the sound file. The music keeps playing while it does.");
    setRenderProgress(0);
    try {
      const audio = await engine.renderAudio(setRenderProgress);
      saveFile(audioToWav(audio), "wav", "audio/wav");
      onAnnounce("Sound file saved to your downloads.");
    } finally {
      setRenderProgress(null);
    }
  }

  async function copyShareLink() {
    const songLink = currentSong().link;
    setShareLink(songLink);
    try {
      await navigator.clipboard.writeText(songLink);
      onAnnounce("Share link copied.");
    } catch {
      onAnnounce("Couldn't copy by itself, so the share link is in the box below to copy.");
    }
  }

  function currentSong(): SavedSong {
    const link = engine.getSongLink();
    const hash = link.slice(link.indexOf("#"));
    return { link: shareLinkStart ? `${shareLinkStart}${hash}` : link, json: engine.getSongJson() };
  }

  function save() {
    onSave?.(currentSong());
    onAnnounce("Song saved.");
  }

  const textBox = `bb-field w-full bg-bb-black p-bb-gutter text-bb-large wrap-anywhere text-bb-white ${focusOnly}`;

  return (
    <section aria-label="Open and share" className="flex w-full flex-col items-start gap-bb-gap">
      <h2 className={titleLine}>
        <span>Open and share</span>
      </h2>

      <form onSubmit={submit} className="flex w-full flex-col items-start gap-bb-gutter">
        <label htmlFor="song-link" className="text-bb-large font-bold uppercase">
          Open a beepbox.co link or song text
        </label>
        <textarea
          id="song-link"
          value={link}
          rows={3}
          spellCheck={false}
          onChange={(event) => setLink(event.target.value)}
          onKeyDown={linkKeyDown}
          className={textBox}
        />
        <div className="flex flex-wrap gap-bb-gutter">
          <button type="submit" className={bigKey()}>
            Open song
          </button>
          <button type="button" onClick={() => setLink(EXAMPLE_LINK)} className={bigKey()}>
            Use example song
          </button>
          <button type="button" onClick={() => filePicker.current?.click()} className={bigKey()}>
            Open a song file
          </button>
          <input
            ref={filePicker}
            type="file"
            accept=".json,.txt,application/json,text/plain"
            tabIndex={-1}
            aria-label="Song file to open"
            onChange={(event) => void openFile(event)}
            className="sr-only"
          />
        </div>
      </form>

      <div role="group" aria-label="Save" className="flex flex-wrap gap-bb-gutter">
        {onSave && (
          <button type="button" onClick={save} className={mainKey}>
            Save song
          </button>
        )}
        <button type="button" onClick={saveMidi} className={smallKey()}>
          Save MIDI (.mid)
        </button>
        <button
          type="button"
          onClick={() => void saveWav()}
          aria-disabled={renderProgress !== null}
          className={smallKey()}
        >
          {renderProgress === null ? "Save sound (.wav)" : `Making sound: ${Math.round(renderProgress * 100)}%`}
        </button>
        <button type="button" onClick={saveJson} className={smallKey()}>
          Save song file (.json)
        </button>
        <button type="button" onClick={() => void copyShareLink()} className={smallKey()}>
          Copy share link
        </button>
      </div>

      {extras?.(currentSong)}

      {renderProgress !== null && (
        <label className="flex w-full flex-col gap-bb-gutter text-bb-large font-bold uppercase">
          Making the sound file
          <progress value={renderProgress} max={1} className="h-bb-target-min w-full accent-bb-pink" />
        </label>
      )}

      {shareLink !== "" && (
        <label className="flex w-full flex-col gap-bb-gutter text-bb-large font-bold uppercase">
          Share link
          <textarea readOnly rows={3} value={shareLink} onFocus={(event) => event.target.select()} className={textBox} />
        </label>
      )}
    </section>
  );
}
