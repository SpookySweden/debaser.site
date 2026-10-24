'use client';

import { useRef, useState } from 'react';
import { MEDIA_ACCEPT, MEDIA_LIMITS, STORAGE_CEILING_BYTES, STORAGE_REFUSE_VIDEO_AT, formatBytes, validateMediaFile } from '../lib/media/rules';
import type { MediaItem, MediaKind } from '../lib/media/types';
import { findLookalike, findOriginal, uploadMedia, type MediaFingerprint } from '../lib/media/upload';
import { FIELD, PLATE, PLATE_MAIN, PLATE_PRESSED } from '../lib/ui/controls';
import AudioTagChooser from './AudioTagChooser';
import PopoutWindow from './PopoutWindow';
import SheetImage from './SheetImage';

type MediaUploadWindowProps = {
  /** Who is filing; null for a guest, who is told why the key does nothing. */
  uploader: { id: string; displayName: string } | null;
  /** The catalogue as the caller holds it, for the looks-alike check. */
  items: MediaItem[];
  /** Uploaded bytes so far, for the ceiling. */
  bytesUsed: number;
  /** Which kinds the window offers; audio is filed from the shelf, which keeps its folders. */
  kinds?: MediaKind[];
  /** The kind to start on. */
  initialKind?: MediaKind;
  onClose: () => void;
  /** The item that was filed - or the original that was used instead - and the sentence to show. */
  onFiled: (item: MediaItem, note: string) => void;
  /** Pressed when the person wants to file audio: the shelf's own NEW FILE does that. */
  onAudioWanted?: () => void;
};

/** What a chosen file turned out to be, before anything is sent. */
type Looked =
  | { state: 'reading' }
  | { state: 'original'; item: MediaItem }
  | { state: 'lookalike'; item: MediaItem; distance: number; fingerprint: MediaFingerprint }
  | { state: 'new'; fingerprint: MediaFingerprint };

/**
 * UPLOAD: filing a picture or a video into the catalogue (SPEC-media-catalogue.md).
 *
 * The file is fingerprinted the moment it is chosen, before anything is sent, and the window says
 * what it found: the same bytes already here (the original is used, nothing is uploaded), a picture
 * that looks the same (the original is shown beside it with `[ USE THE ORIGINAL ]`, but
 * `[ KEEP MINE ]` is a real choice), or a new file. Tags are the shelf's own chooser, so a tag means
 * the same thing on a picture as on a track.
 */
export default function MediaUploadWindow({
  uploader,
  items,
  bytesUsed,
  kinds = ['image', 'video'],
  initialKind = 'image',
  onClose,
  onFiled,
  onAudioWanted,
}: MediaUploadWindowProps) {
  const fileInput = useRef<HTMLInputElement | null>(null);
  /** Which read of a chosen file is the current one: a slower read of an earlier file is dropped. */
  const readToken = useRef(0);
  const [kind, setKind] = useState<MediaKind>(initialKind);
  const [file, setFile] = useState<File | null>(null);
  const [looked, setLooked] = useState<Looked | null>(null);
  const [title, setTitle] = useState('');
  const [credit, setCredit] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const share = bytesUsed / STORAGE_CEILING_BYTES;
  const videoRefused = share >= STORAGE_REFUSE_VIDEO_AT;

  /** A file was chosen: fingerprint it at once, because the answer is what the window is for. */
  function pickFile(next: File | null) {
    setFile(next);
    setError(null);
    readToken.current += 1;

    if (next === null) {
      setLooked(null);
      return;
    }

    if (title.trim().length === 0) setTitle(next.name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').toUpperCase());

    const problem = validateMediaFile(kind, next);
    if (problem !== undefined) {
      setError(problem);
      setLooked(null);
      return;
    }

    const token = readToken.current;
    setLooked({ state: 'reading' });

    void findOriginal(kind, next).then(({ fingerprint, original }) => {
      if (token !== readToken.current) return;

      if (original !== null) {
        setLooked({ state: 'original', item: original });
        return;
      }

      const alike = kind === 'image' ? findLookalike(fingerprint.phash, items) : null;
      setLooked(alike === null ? { state: 'new', fingerprint } : { state: 'lookalike', ...alike, fingerprint });
    });
  }

  async function fileIt() {
    if (uploader === null) {
      setError('FILING A FILE TAKES AN ACCOUNT.');
      return;
    }

    if (file === null) {
      setError('CHOOSE A FILE FIRST.');
      return;
    }

    if (kind === 'video' && videoRefused) {
      setError(`THE CATALOGUE IS ${Math.round(share * 100)}% FULL - VIDEO IS REFUSED UNTIL ROOM IS MADE.`);
      return;
    }

    setBusy(true);
    setError(null);

    try {
      const result = await uploadMedia({ kind, file, title, credit, tags, uploader });
      // `'error' in` rather than `!result.ok`: the scratch checks compile this file without strict
      // null checks, where a boolean discriminant does not narrow and the build they test would fail.
      if ('error' in result) {
        setError(result.error);
        return;
      }

      onFiled(result.item, result.note);
    } finally {
      setBusy(false);
    }
  }

  const takeOriginal = (item: MediaItem) => onFiled(item, `USING THE ORIGINAL, "${item.title}".`);

  return (
    <PopoutWindow
      title="UPLOAD :: FILE INTO THE CATALOGUE"
      onClose={onClose}
      maxWidth="max-w-2xl"
      status={`PICTURES ${formatBytes(MEDIA_LIMITS.image)} :: VIDEO ${formatBytes(MEDIA_LIMITS.video)} :: THE SAME FILE TWICE IS THE SAME FILE`}
      actions={
        looked?.state === 'original' ? (
          <button type="button" onClick={() => takeOriginal(looked.item)} className={PLATE_MAIN}>
            [ USE THE ORIGINAL ]
          </button>
        ) : (
          <button type="button" onClick={() => void fileIt()} disabled={busy || looked?.state === 'reading'} className={PLATE_MAIN}>
            {busy ? '[ FILING... ]' : '[ FILE IT ]'}
          </button>
        )
      }
    >
      <div className="flex flex-wrap items-center gap-1" role="radiogroup" aria-label="Kind of file">
        {kinds.map((option) => (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={kind === option}
            onClick={() => {
              setKind(option);
              pickFile(null);
              if (fileInput.current !== null) fileInput.current.value = '';
            }}
            className={kind === option ? PLATE_PRESSED : PLATE}
          >
            [ {option.toUpperCase()} ]
          </button>
        ))}
        {onAudioWanted === undefined ? null : (
          <button type="button" onClick={onAudioWanted} className={PLATE} title="Audio is filed from the AUDIO tab, which keeps the shelf's folders">
            [ AUDIO: FILE IT ON THE SHELF ]
          </button>
        )}
      </div>

      {kind === 'video' && videoRefused ? (
        <p className="mt-2 w-fit bg-bubble-pale px-1 text-label font-bold text-ink-bar" role="alert">
          THE CATALOGUE IS {Math.round(share * 100)}% FULL. VIDEO IS REFUSED FIRST.
        </p>
      ) : null}

      <label htmlFor="media-upload-file" className="mt-3 block text-label font-bold text-ink">
        THE FILE ({kind === 'image' ? 'PNG, JPG, WEBP, GIF' : 'MP4, WEBM'} - {formatBytes(MEDIA_LIMITS[kind])} MAX)
      </label>
      <input
        id="media-upload-file"
        ref={fileInput}
        type="file"
        accept={MEDIA_ACCEPT[kind]}
        onChange={(event) => pickFile(event.target.files?.[0] ?? null)}
        className="mt-1 block w-full cursor-pointer rounded-none border border-ink bg-paper p-1 text-label font-bold text-ink"
      />

      {/* What the fingerprints found. The box keeps its place in every state, so the form under it
          never jumps as the answer arrives. */}
      <div className="mt-2 min-h-tap" aria-live="polite">
        {looked?.state === 'reading' ? <p className="text-label font-bold text-ink">READING THE FILE...</p> : null}

        {looked?.state === 'original' ? (
          <p className="w-fit bg-sun-pale px-1 text-label font-bold text-ink">
            ALREADY IN THE CATALOGUE AS &quot;{looked.item.title}&quot; - NOTHING NEEDS UPLOADING. USE THE ORIGINAL.
          </p>
        ) : null}

        {looked?.state === 'lookalike' ? (
          <div className="flex flex-wrap items-start gap-2">
            <span className="block w-20 rounded-none border border-ink bg-paper">
              <SheetImage src={looked.item.src} alt={looked.item.title} width={looked.item.width ?? 80} height={looked.item.height ?? 80} sizes="80px" compact />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-label font-bold text-ink">
                THIS LOOKS LIKE &quot;{looked.item.title}&quot;, ALREADY IN THE CATALOGUE. CITE THE ORIGINAL INSTEAD?
              </p>
              <div className="mt-1 flex flex-wrap gap-2">
                <button type="button" onClick={() => takeOriginal(looked.item)} className={PLATE_MAIN}>
                  [ USE THE ORIGINAL ]
                </button>
                <button type="button" onClick={() => setLooked({ state: 'new', fingerprint: looked.fingerprint })} className={PLATE}>
                  [ KEEP MINE ]
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {looked?.state === 'new' && file !== null ? (
          <p className="text-label font-bold text-ink-quiet">NEW TO THE CATALOGUE: {formatBytes(file.size)}</p>
        ) : null}
      </div>

      <label htmlFor="media-upload-title" className="mt-2 block text-label font-bold text-ink">
        TITLE
      </label>
      <input id="media-upload-title" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="What it is called" className={FIELD} />

      <label htmlFor="media-upload-credit" className="mt-2 block text-label font-bold text-ink">
        CREDITED TO
      </label>
      <input id="media-upload-credit" value={credit} onChange={(event) => setCredit(event.target.value)} placeholder={uploader?.displayName ?? 'Who made it'} className={FIELD} />

      <AudioTagChooser id="media-upload" value={tags} onChange={setTags} />

      {error === null ? null : (
        <p className="mt-2 w-fit bg-bubble-pale px-1 text-label font-bold text-ink-bar" role="alert">
          {error}
        </p>
      )}
    </PopoutWindow>
  );
}
