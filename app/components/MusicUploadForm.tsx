'use client';

import { useRef, useState } from 'react';
import { MAX_TRACK_BYTES, MUSIC_ACCEPT } from '../lib/audio/catalogue';
import { getMusicRepository } from '../lib/audio/repository';
import { FIELD, PLATE_LARGE } from '../lib/ui/controls';
import { useAuth } from './AuthProvider';
import { useMusicPlayer } from './MusicPlayerProvider';

/**
 * Filing a track onto the shelf.
 *
 * The audio goes to the `mp3` bucket (Supabase) or into the project's own
 * `assets/audio/` folder (the mock store), and the shelf is reloaded afterwards - so
 * the track that was just filed is in the player's queue, and the player is pointed at
 * it, without anybody reloading the page.
 *
 * An account is needed: an upload is a write, and a shelf that anybody can write to
 * anonymously is a shelf nobody can trust. Guests can still play everything.
 */
export default function MusicUploadForm() {
  const { user } = useAuth();
  const player = useMusicPlayer();
  const fileInput = useRef<HTMLInputElement | null>(null);

  const [title, setTitle] = useState('');
  const [credit, setCredit] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  if (user === null) {
    return (
      <section className="rounded-none border-2 border-t-white border-l-white border-r-gray-800 border-b-gray-800 bg-[#c0c0c0] p-3">
        <p className="text-[10px] font-bold text-black">
          FILING A TRACK TAKES AN ACCOUNT - SIGN IN ON THE ACCOUNT PAGE. PLAYING WHAT IS ALREADY ON THE SHELF TAKES
          NOTHING.
        </p>
      </section>
    );
  }

  async function handleSubmit() {
    if (file === null) {
      setError('CHOOSE AN AUDIO FILE FIRST.');
      return;
    }

    setBusy(true);
    setError(null);
    setNote(null);

    try {
      const track = await getMusicRepository().uploadTrack({
        uploaderId: user?.id ?? '',
        uploaderName: user?.displayName ?? 'Anonymous',
        title,
        credit,
        file,
      });

      // The shelf, then the track: the queue is read again and the player is pointed at
      // what was just filed, so the upload is audible immediately.
      player.refresh();
      player.play(track);
      setTitle('');
      setCredit('');
      setFile(null);
      if (fileInput.current !== null) fileInput.current.value = '';
      setNote(`FILED :: ${track.src}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'THE UPLOAD WAS REFUSED.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-none border-2 border-t-white border-l-white border-r-gray-800 border-b-gray-800 bg-[#c0c0c0] p-3">
      <p className="text-[10px] font-bold text-black">FILE A TRACK ONTO THE SHELF</p>
      <p className="mt-1 text-[10px] text-gray-700">
        THE TRACK APPEARS IN THE PLAYER AT THE BOTTOM OF THE WINDOW. MP3, M4A, OGG, WAV AND FLAC, UP TO{' '}
        {Math.round(MAX_TRACK_BYTES / (1024 * 1024))}MB.
      </p>

      <label className="mt-2 block text-[10px] font-bold text-black" htmlFor="music-title">
        TITLE
      </label>
      <input
        id="music-title"
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        placeholder="e.g. WARD THEME (ROUGH)"
        className={FIELD}
      />

      <label className="mt-2 block text-[10px] font-bold text-black" htmlFor="music-credit">
        CREDITED TO (LEAVE EMPTY FOR YOUR OWN NAME)
      </label>
      <input
        id="music-credit"
        value={credit}
        onChange={(event) => setCredit(event.target.value)}
        placeholder={user.displayName}
        className={FIELD}
      />

      <label className="mt-2 block text-[10px] font-bold text-black" htmlFor="music-file">
        THE AUDIO FILE
      </label>
      <input
        id="music-file"
        ref={fileInput}
        type="file"
        accept={MUSIC_ACCEPT}
        onChange={(event) => setFile(event.target.files?.[0] ?? null)}
        className="mt-1 block w-full cursor-pointer rounded-none border border-gray-500 bg-white p-1 text-[10px] font-bold text-black"
      />

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => void handleSubmit()} disabled={busy} className={PLATE_LARGE}>
          {busy ? '[ UPLOADING... ]' : '[ FILE THE TRACK ]'}
        </button>
        {error === null ? null : <p className="text-[10px] font-bold text-[#800000]">{error}</p>}
        {note === null ? null : <p className="text-[10px] font-bold text-black">{note}</p>}
      </div>
    </section>
  );
}
