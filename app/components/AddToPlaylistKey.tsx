'use client';

import { useState } from 'react';
import { MAX_PLAYLIST_NAME, validatePlaylistName } from '../lib/audio/library';
import { addToNewPlaylist, holdable, playlistChoices, toggleInPlaylist, type PlaylistThing } from '../lib/audio/playlist-adding';
import type { AudioTrack } from '../lib/audio/tracks';
import { FIELD_TIGHT, PLATE, PLATE_PRESSED } from '../lib/ui/controls';
import { useMusicLibrary } from './MusicLibraryProvider';
import PopoutWindow from './PopoutWindow';

/**
 * ADD TO: [ PLAYLIST ] (Luke, 2026-11-14: "add to needs to go like 'add to: (playlist) (letter)'"). The twin of
 * `AddToLetterKey`: one key, and the short window it opens, listing your playlists with a new one's name at the top.
 * Signed-in people only, as a letter is: a playlist is saved to an account.
 *
 * What adding means is `app/lib/audio/playlist-adding.ts`, shared with MEDIA's rows; this is only the key and its window.
 */

/** A no-break space: what an answer's line holds while there is no answer, so the line keeps its height. */
export const BLANK_LINE = String.fromCharCode(160);

/** A song of the player's as a playlist's thing: its id is what a playlist holds today. */
export function songAsPlaylistThing(song: AudioTrack): PlaylistThing {
  return { title: song.title, link: { url: song.src, kind: 'audio', title: song.title }, trackId: song.id };
}

export default function AddToPlaylistKey({
  thing,
  className = PLATE,
  label = '[ PLAYLIST ]',
  disabled = false,
  reason,
}: {
  thing: PlaylistThing;
  className?: string;
  label?: string;
  /** A thing no list can hold yet: the key stays in its place, quiet. A thing with no `trackId` is off by itself. */
  disabled?: boolean;
  /** Why it is off, as the key's tip. */
  reason?: string;
}) {
  const library = useMusicLibrary();
  const [open, setOpen] = useState(false);
  if (!library.canWrite) return null;
  const off = disabled || !holdable(thing);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={off}
        aria-haspopup="dialog"
        className={className}
        title={off ? reason : undefined}
        aria-label={`Add "${thing.title}" to a playlist`}
        data-add-to-playlist
      >
        {label}
      </button>
      {open ? <PlaylistPicker thing={thing} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

/** One line each, as wide as the window: a thumb or a tired eye lands on it. */
const ROW = 'block w-full break-words text-left';

function PlaylistPicker({ thing, onClose }: { thing: PlaylistThing; onClose: () => void }) {
  const library = useMusicLibrary();
  const choices = playlistChoices(library, thing);
  const [name, setName] = useState('');
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(action: () => Promise<string>) {
    setBusy(true);
    setNote(null);
    try {
      setNote(await action());
    } catch (caught) {
      setNote(caught instanceof Error ? caught.message : 'THE LIBRARY DID NOT ANSWER.');
    } finally {
      setBusy(false);
    }
  }

  const startNew = () => {
    const problem = validatePlaylistName(name);
    if (problem !== undefined) {
      setNote(problem);
      return;
    }
    void run(async () => {
      const made = await addToNewPlaylist(library, thing, name);
      setName('');
      return `ADDED TO ${made}.`;
    });
  };

  return (
    <PopoutWindow title="ADD TO PLAYLIST" onClose={onClose} maxWidth="max-w-md" centred>
      <div className="flex flex-col gap-2 p-3" data-playlist-picker>
        <p className="break-words text-label text-ink">{thing.title}</p>
        <form
          className="flex flex-wrap items-center gap-1"
          onSubmit={(event) => {
            event.preventDefault();
            startNew();
          }}
        >
          <input
            type="text"
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={MAX_PLAYLIST_NAME}
            placeholder="NEW PLAYLIST'S NAME"
            aria-label="New playlist's name"
            className={`${FIELD_TIGHT} min-w-0 flex-1 basis-40`}
          />
          <button type="submit" className={PLATE} disabled={busy || name.trim().length === 0}>
            [ + NEW PLAYLIST ]
          </button>
        </form>
        {choices.length === 0 ? <p className="text-label text-ink">NO PLAYLISTS YET.</p> : null}
        <ul className="flex max-h-80 flex-col gap-1 overflow-auto">
          {choices.map((choice) => (
            <li key={choice.id}>
              <button
                type="button"
                aria-pressed={choice.holds}
                disabled={busy}
                onClick={() =>
                  void run(async () =>
                    (await toggleInPlaylist(library, thing, choice)) === 'added' ? `ADDED TO ${choice.name}.` : `TAKEN OUT OF ${choice.name}.`,
                  )
                }
                className={`${choice.holds ? `${PLATE_PRESSED} cursor-pointer` : PLATE} ${ROW}`}
                title={choice.holds ? `Take it out of ${choice.name}` : `Add it to ${choice.name}`}
              >
                [ {choice.holds ? '✓ ' : ''}
                {choice.name} ]
              </button>
            </li>
          ))}
        </ul>
        {/* The line keeps its height while empty, so an answer never moves the rows above it. */}
        <p role="status" className="break-words text-label font-bold text-ink">
          {note ?? BLANK_LINE}
        </p>
      </div>
    </PopoutWindow>
  );
}
