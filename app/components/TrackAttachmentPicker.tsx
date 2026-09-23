'use client';

import { useRef, useState } from 'react';
import { SOURCE_LABEL } from '../lib/audio/archive-tree';
import { trackFromLink, uploadPostTrack } from '../lib/audio/attach';
import { MAX_TRACK_BYTES, MUSIC_ACCEPT } from '../lib/audio/catalogue';
import { normaliseAudioTags } from '../lib/audio/tags';
import type { AudioTrack } from '../lib/audio/tracks';
import type { ForumAuthor, ForumTrack } from '../lib/forum/types';
import { FIELD, PLATE, PLATE_LARGE } from '../lib/ui/controls';
import AudioTagChooser from './AudioTagChooser';
import AudioTagPill from './AudioTagPill';
import { useMusicPlayer } from './MusicPlayerProvider';

type TrackAttachmentPickerProps = {
  id: string;
  /** The track filed with this post, or null while there is none. */
  value: ForumTrack | null;
  onChange: (track: ForumTrack | null) => void;
  /** Who is posting: an account may file a file, a guest may only link one. */
  author: ForumAuthor;
};

/** How many shelf files the browser lists at once; typing narrows the rest. */
const ARCHIVE_PAGE = 10;

/**
 * The archive, browsed from inside the composer.
 *
 * A post can carry a track the shelf already holds - one of the archive's own releases, or
 * anything uploaded to it - so a reply can be filed against a record instead of asking the
 * poster to find the file again. The list is the player's own queue, so whatever the bar at
 * the bottom of the window can play is exactly what can be attached, and a file that is
 * attached this way is a reference: the archive keeps owning the audio.
 */
function ArchivePicker({ id, onPick }: { id: string; onPick: (track: AudioTrack) => void }) {
  const player = useMusicPlayer();
  const [query, setQuery] = useState('');

  const words = query
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter((word) => word.length > 0);

  const found = player.queue.filter((track) => {
    const text = `${track.title} ${track.credit}`.toLowerCase();
    return words.every((word) => text.includes(word));
  });
  const shown = found.slice(0, ARCHIVE_PAGE);

  return (
    <div className="mt-2">
      <label htmlFor={`${id}-archive`} className="block text-[10px] font-bold text-black">
        FIND A TRACK ({player.loading ? 'READING...' : `${found.length} OF ${player.queue.length}`})
      </label>
      <input
        id={`${id}-archive`}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="TRACK, RELEASE OR ARTIST"
        className={FIELD}
      />

      {shown.length === 0 ? (
        <p className="mt-1 text-[10px] font-bold text-black">
          {player.loading ? 'READING THE SHELF...' : 'NO MATCHES.'}
        </p>
      ) : (
        <ul className="mt-1 max-h-40 overflow-y-auto rounded-none border-2 border-t-gray-600 border-l-gray-600 border-r-white border-b-white bg-white">
          {shown.map((track) => (
            <li
              key={track.src}
              className="flex items-center gap-2 border-b border-dotted border-gray-400 px-1 py-[2px]"
            >
              <span className="min-w-0 flex-1 text-[10px] font-bold text-black" title={track.title}>
                <span className="block truncate">{track.title}</span>
                <span className="block truncate font-normal text-gray-700">
                  {track.credit} :: {track.length} ::{' '}
                  {track.shelf === 'bucket' ? SOURCE_LABEL.SHELF : SOURCE_LABEL.ARCHIVE}
                </span>
              </span>

              <button
                type="button"
                onClick={() => onPick(track)}
                className={PLATE}
                title={`Attach ${track.title}`}
              >
                [ ATTACH ]
              </button>
            </li>
          ))}
        </ul>
      )}

      {found.length > shown.length ? (
        <p className="mt-1 text-[9px] font-bold text-gray-700">
          {shown.length} OF {found.length}
        </p>
      ) : null}
    </div>
  );
}

/**
 * The MP3 that goes with a post.
 *
 * Three ways in, side by side, because three kinds of poster want it:
 *
 *   - a file from this machine, which is uploaded where every other track on the site lives
 *     and then filed with the post. An upload is a write, so it takes an account - the same
 *     rule the music shelf keeps;
 *   - a track the archive already holds, browsed from the shelf itself, so a reply can be
 *     filed against a record nobody has to upload again;
 *   - a link to an MP3 that is somewhere else, which nobody has to hold and anybody may
 *     paste, guests included.
 *
 * Either way the post ends up with the same record, and the same player appears under it.
 * One track per post: the control says so rather than growing a list, because a post that
 * carries six songs is a thread, not a post.
 */
export default function TrackAttachmentPicker({ id, value, onChange, author }: TrackAttachmentPickerProps) {
  const fileInput = useRef<HTMLInputElement | null>(null);
  const signedIn = author.id !== null;

  const [mode, setMode] = useState<'file' | 'archive' | 'link'>(signedIn ? 'file' : 'archive');
  const [title, setTitle] = useState('');
  const [credit, setCredit] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [link, setLink] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  /** Everything the picker holds, back to how it opened. */
  function forget() {
    setTitle('');
    setCredit('');
    setTags([]);
    setLink('');
    setFile(null);
    if (fileInput.current !== null) fileInput.current.value = '';
  }

  async function attachFile() {
    if (author.id === null) {
      setError('FILING A FILE TAKES AN ACCOUNT - LINK AN MP3 INSTEAD, OR SIGN IN ON THE ACCOUNT PAGE.');
      return;
    }

    if (file === null) {
      setError('CHOOSE AN AUDIO FILE FIRST.');
      return;
    }

    setBusy(true);
    setError(null);
    setStatus(null);

    try {
      const track = await uploadPostTrack({
        file,
        title,
        credit,
        tags,
        uploader: { id: author.id, displayName: author.displayName },
      });

      onChange(track);
      forget();
      setStatus(`ATTACHED :: ${track.title}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'THE TRACK COULD NOT BE FILED.');
    } finally {
      setBusy(false);
    }
  }

  function attachLink() {
    const result = trackFromLink({ src: link, title, credit, tags });

    // `=== false` rather than `!result.ok`: the refusal is read back as words here, and a
    // plain negation only narrows the union when the compiler is in strict mode.
    if (result.ok === false) {
      setError(result.error);
      setStatus(null);
      return;
    }

    onChange(result.track);
    forget();
    setError(null);
    setStatus(`ATTACHED :: ${result.track.title}`);
  }

  /**
   * A track the archive already holds, attached as a reference.
   *
   * Nothing is copied and nothing is re-titled: the post keeps the file's own name, credit,
   * tags and running time, so a track pulled into a thread and the same row in the /music
   * directory are one file with one name.
   */
  function attachArchive(track: AudioTrack) {
    onChange({
      src: track.src,
      title: track.title,
      credit: track.credit,
      tags: normaliseAudioTags(track.tags),
      ...(track.length.length === 0 ? {} : { length: track.length }),
    });
    setError(null);
    setStatus(`ATTACHED :: ${track.title}`);
  }

  /** What is filed, said plainly, with the one control that takes it back off. */
  if (value !== null) {
    const filed = normaliseAudioTags(value.tags);

    return (
      <fieldset id={id} className="mt-2 rounded-none border border-gray-600 p-2">
        <legend className="px-1 text-[10px] font-bold text-black">MP3 (1/1)</legend>

        <div className="flex flex-wrap items-center gap-2 text-[10px] font-bold text-black">
          <span className="min-w-0 flex-1">
            <span className="block truncate">ATTACHED: {value.title}</span>
            <span className="block truncate font-normal text-gray-700">
              {value.credit.length === 0 ? author.displayName : value.credit}
              {value.length === undefined ? '' : ` :: ${value.length}`} ::
              {` ${value.src.split('/').pop() ?? value.src}`}
            </span>
          </span>

          <button
            type="button"
            onClick={() => {
              onChange(null);
              setStatus(null);
              setError(null);
            }}
            className={PLATE}
          >
            [ CLEAR ]
          </button>
        </div>

        {filed.length === 0 ? null : (
          <div className="mt-1 flex flex-wrap items-center gap-1">
            <span className="text-[9px] font-bold text-gray-700">AUDIO TAGS:</span>
            {filed.map((tag) => (
              <AudioTagPill key={tag} tag={tag} compact />
            ))}
          </div>
        )}
      </fieldset>
    );
  }

  return (
    <fieldset id={id} className="mt-2 rounded-none border border-gray-600 p-2">
      <legend className="px-1 text-[10px] font-bold text-black">MP3 (0/1)</legend>

      <div className="flex flex-wrap items-center gap-2 text-[10px] font-bold text-black">
        <span>SOUNDTRACK:</span>

        <button
          type="button"
          onClick={() => setMode('file')}
          disabled={!signedIn}
          aria-pressed={mode === 'file'}
          className={`${PLATE} disabled:cursor-not-allowed`}
          title={signedIn ? 'File a track from this machine' : 'Filing a track takes an account'}
        >
          {mode === 'file' ? '[ ▣ FROM THIS MACHINE ]' : '[ FROM THIS MACHINE ]'}
        </button>

        <button
          type="button"
          onClick={() => setMode('archive')}
          aria-pressed={mode === 'archive'}
          className={PLATE}
          title="Attach a track the archive already holds"
        >
          {mode === 'archive' ? '[ ▣ FROM THE ARCHIVE ]' : '[ FROM THE ARCHIVE ]'}
        </button>

        <button
          type="button"
          onClick={() => setMode('link')}
          aria-pressed={mode === 'link'}
          className={PLATE}
          title="Paste a link to an MP3 that is hosted somewhere else"
        >
          {mode === 'link' ? '[ ▣ LINK ONE ]' : '[ LINK ONE ]'}
        </button>
      </div>

      {mode === 'archive' ? (
        <ArchivePicker id={id} onPick={attachArchive} />
      ) : (
        <>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            <label className="block text-[10px] font-bold text-black">
              TRACK TITLE
              <input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="LEFT EMPTY, THE FILE NAME IS USED"
                className={FIELD}
              />
            </label>

            <label className="block text-[10px] font-bold text-black">
              CREDITED TO
              <input
                value={credit}
                onChange={(event) => setCredit(event.target.value)}
                placeholder={author.displayName}
                className={FIELD}
              />
            </label>
          </div>

          {mode === 'file' ? (
            <div className="mt-2">
              <label htmlFor={`${id}-file`} className="block text-[10px] font-bold text-black">
                THE AUDIO FILE (MP3, M4A, OGG, WAV, FLAC - {Math.round(MAX_TRACK_BYTES / (1024 * 1024))}MB MAX)
              </label>
              <input
                id={`${id}-file`}
                ref={fileInput}
                type="file"
                accept={MUSIC_ACCEPT}
                onChange={(event) => setFile(event.target.files?.[0] ?? null)}
                className="mt-1 block w-full cursor-pointer rounded-none border border-gray-500 bg-white p-1 text-[10px] font-bold text-black"
              />
            </div>
          ) : (
            <div className="mt-2">
              <label htmlFor={`${id}-link`} className="block text-[10px] font-bold text-black">
                THE LINK
              </label>
              <input
                id={`${id}-link`}
                value={link}
                onChange={(event) => setLink(event.target.value)}
                placeholder="https://.../track.mp3"
                className={FIELD}
              />
            </div>
          )}

      <AudioTagChooser id={id} value={tags} onChange={setTags} />
        </>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-2">
        {mode === 'archive' ? null : (
          <button
            type="button"
            onClick={() => (mode === 'file' ? void attachFile() : attachLink())}
            disabled={busy}
            className={PLATE_LARGE}
          >
            {busy ? '[ FILING... ]' : '[ ATTACH TRACK ]'}
          </button>
        )}

        {error === null ? null : <p className="text-[10px] font-bold text-[#800000]">{error}</p>}
        {error === null && status !== null ? <p className="text-[10px] font-bold text-[#006000]">{status}</p> : null}
      </div>
    </fieldset>
  );
}
