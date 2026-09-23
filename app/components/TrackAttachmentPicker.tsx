'use client';

import { useRef, useState } from 'react';
import { trackFromLink, uploadPostTrack } from '../lib/audio/attach';
import { MAX_TRACK_BYTES, MUSIC_ACCEPT } from '../lib/audio/catalogue';
import { MAX_AUDIO_TAGS, STARTER_AUDIO_TAGS, audioTagKey, normaliseAudioTags } from '../lib/audio/tags';
import type { ForumAuthor, ForumTrack } from '../lib/forum/types';
import { FIELD, PLATE, PLATE_LARGE } from '../lib/ui/controls';
import AudioTagPill from './AudioTagPill';

type TrackAttachmentPickerProps = {
  id: string;
  /** The track filed with this post, or null while there is none. */
  value: ForumTrack | null;
  onChange: (track: ForumTrack | null) => void;
  /** Who is posting: an account may file a file, a guest may only link one. */
  author: ForumAuthor;
};

/**
 * The MP3 that goes with a post.
 *
 * Two ways in, side by side, because two kinds of poster want it:
 *
 *   - a file from this machine, which is uploaded where every other track on the
 *     site lives and then filed with the post. An upload is a write, so it takes an
 *     account - the same rule the music shelf keeps;
 *   - a link to an MP3 that is already somewhere else, which nobody has to hold and
 *     anybody may paste, guests included.
 *
 * Either way the post ends up with the same record, and the same player appears
 * under it. One track per post: the control says so rather than growing a list,
 * because a post that carries six songs is a thread, not a post.
 */
export default function TrackAttachmentPicker({ id, value, onChange, author }: TrackAttachmentPickerProps) {
  const fileInput = useRef<HTMLInputElement | null>(null);
  const signedIn = author.id !== null;

  const [mode, setMode] = useState<'file' | 'link'>(signedIn ? 'file' : 'link');
  const [title, setTitle] = useState('');
  const [credit, setCredit] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [tagDraft, setTagDraft] = useState('');
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
    setTagDraft('');
    setLink('');
    setFile(null);
    if (fileInput.current !== null) fileInput.current.value = '';
  }

  function toggleTag(label: string) {
    const key = audioTagKey(label);
    if (key.length === 0) return;

    if (tags.some((tag) => audioTagKey(tag) === key)) {
      setTags(tags.filter((tag) => audioTagKey(tag) !== key));
      setError(null);
      return;
    }

    if (tags.length >= MAX_AUDIO_TAGS) {
      setError(`MAX ${MAX_AUDIO_TAGS} AUDIO TAGS PER FILE.`);
      return;
    }

    setTags([...tags, label]);
    setError(null);
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
          onClick={() => setMode('link')}
          aria-pressed={mode === 'link'}
          className={PLATE}
          title="Paste a link to an MP3 that is hosted somewhere else"
        >
          {mode === 'link' ? '[ ▣ LINK ONE ]' : '[ LINK ONE ]'}
        </button>

        <span className="font-normal text-gray-700">
          {signedIn
            ? 'OPTIONAL - A POST DOES NOT NEED A TRACK.'
            : 'GUESTS CAN LINK A TRACK; FILING A FILE TAKES AN ACCOUNT.'}
        </span>
      </div>

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

      <div className="mt-2 flex flex-wrap items-center gap-1 text-[10px] font-bold text-black">
        <span>
          AUDIO TAGS ({tags.length}/{MAX_AUDIO_TAGS}):
        </span>

        {STARTER_AUDIO_TAGS.map((tag) => (
          <AudioTagPill
            key={tag}
            tag={tag}
            compact
            active={tags.some((picked) => audioTagKey(picked) === audioTagKey(tag))}
            onToggle={() => toggleTag(tag)}
          />
        ))}

        {tags
          .filter((tag) => !STARTER_AUDIO_TAGS.some((starter) => audioTagKey(starter) === audioTagKey(tag)))
          .map((tag) => (
            <AudioTagPill key={tag} tag={tag} compact active onToggle={() => toggleTag(tag)} />
          ))}
      </div>

      <div className="mt-1 flex flex-wrap items-center gap-2">
        <label htmlFor={`${id}-tag`} className="text-[10px] font-bold text-black">
          ANOTHER TAG:
        </label>
        <input
          id={`${id}-tag`}
          value={tagDraft}
          onChange={(event) => setTagDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== 'Enter') return;
            event.preventDefault();
            toggleTag(tagDraft);
            setTagDraft('');
          }}
          placeholder="e.g. DRONE"
          className="w-32 rounded-none border-2 border-t-gray-600 border-l-gray-600 border-r-white border-b-white bg-white p-1 text-[10px] text-black outline-none max-sm:w-full max-sm:p-2"
        />
        <button
          type="button"
          onClick={() => {
            toggleTag(tagDraft);
            setTagDraft('');
          }}
          className={PLATE}
        >
          [ + ADD ]
        </button>

        <span className="text-[9px] font-normal text-gray-700">TAGS SORT THE FILE IN THE /MUSIC DIRECTORY.</span>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => (mode === 'file' ? void attachFile() : attachLink())}
          disabled={busy}
          className={PLATE_LARGE}
        >
          {busy ? '[ FILING... ]' : '[ ATTACH TRACK ]'}
        </button>

        {error === null ? null : <p className="text-[10px] font-bold text-[#800000]">{error}</p>}
        {error === null && status !== null ? <p className="text-[10px] font-bold text-[#006000]">{status}</p> : null}
      </div>
    </fieldset>
  );
}
