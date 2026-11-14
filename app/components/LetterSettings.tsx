'use client';

import { useRef, useState } from 'react';
import { uploadStamp } from '../lib/letters/repository';
import { deleteLetter, updateLetter } from '../lib/letters/store';
import { cardPicture } from '../lib/letters/things';
import { searchEverywhere } from '../lib/web/everywhere-client';
import { rowAddresses } from '../lib/web/row-addresses';
import { LETTER_DESCRIPTION_MAX, LETTER_NAME_MAX, type Letter, type LetterItem, type LetterPatch } from '../lib/letters/types';
import { NAME_COLOURS } from '../lib/profile/name-colours';
import { FIELD, PLATE, PLATE_MAIN, PLATE_PRESSED } from '../lib/ui/controls';
import LetterStamp, { StampCircle } from './LetterStamp';
import { nameInkStyle } from './NameColourWindow';
import PopoutWindow from './PopoutWindow';

/**
 * A letter's settings, behind the cog next to its name (SPEC-letters.md): the stamp picture (upload one, or pick the picture
 * of something on the letter) with the pattern's opacity and density sliders right beside it, then the name, description
 * and text colour (the name-colour swatches, which stay readable in every theme). SAVE keeps them; closing without asks first.
 */
export default function LetterSettings({ letter, items, onClose }: { letter: Letter; items: readonly LetterItem[]; onClose: () => void }) {
  const [draft, setDraft] = useState<Letter>(letter);
  const [busy, setBusy] = useState(false);
  const [fault, setFault] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const pickable = items.map((item) => cardPicture(item.picture)).filter((src): src is string => src !== undefined);
  const unsaved =
    draft.name !== letter.name ||
    draft.description !== letter.description ||
    draft.textColour !== letter.textColour ||
    draft.stampUrl !== letter.stampUrl ||
    draft.stampOpacity !== letter.stampOpacity ||
    draft.stampDensity !== letter.stampDensity;

  const close = () => {
    if (unsaved && !window.confirm('Leave without saving these changes?')) return;
    onClose();
  };

  const upload = async (file: File | undefined) => {
    if (!file) return;
    setFault(null);
    setBusy(true);
    try {
      const url = await uploadStamp(letter.owner, file);
      setDraft((held) => ({ ...held, stampUrl: url }));
    } catch (error) {
      setFault(error instanceof Error ? error.message : 'THE PICTURE COULD NOT BE SAVED.');
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const save = async () => {
    const name = draft.name.trim();
    if (name.length === 0) {
      setFault('A LETTER NEEDS A NAME.');
      return;
    }
    setFault(null);
    setBusy(true);
    const patch: LetterPatch = {
      name,
      description: draft.description.trim(),
      textColour: draft.textColour,
      stampUrl: draft.stampUrl,
      stampOpacity: draft.stampOpacity,
      stampDensity: draft.stampDensity,
    };
    try {
      await updateLetter(letter.id, patch);
      onClose();
    } catch (error) {
      setFault(error instanceof Error ? error.message : 'The letter could not be saved.');
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    try {
      await deleteLetter(letter);
      onClose();
    } catch (error) {
      setFault(error instanceof Error ? error.message : 'The letter could not be deleted.');
      setBusy(false);
    }
  };

  return (
    <PopoutWindow
      title="LETTER SETTINGS"
      onClose={close}
      dismissOnBackdrop={false}
      maxWidth="max-w-xl"
      actions={
        <>
          <button type="button" onClick={() => setConfirmDelete(true)} className={PLATE} disabled={busy}>
            [ DELETE LETTER ]
          </button>
          <button type="button" onClick={() => void save()} className={PLATE_MAIN} disabled={busy}>
            SAVE
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-4 p-3">
        <section aria-labelledby="letter-picture" className="flex flex-wrap items-start gap-4">
          <div className="flex flex-col items-center gap-1">
            {/* Twice the size it has in a list, so the picture being chosen can be seen. */}
            <LetterStamp letter={draft} scale={2} />
            <h3 id="letter-picture" className="text-label text-ink">
              PICTURE
            </h3>
          </div>
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <label className="flex items-center gap-2 text-label text-ink">
              <span className="w-20 shrink-0">OPACITY</span>
              <input
                type="range"
                min={0}
                max={100}
                value={draft.stampOpacity}
                onChange={(event) => setDraft((held) => ({ ...held, stampOpacity: Number(event.target.value) }))}
                className="min-w-0 flex-1"
              />
              <span className="w-10 shrink-0 text-right">{draft.stampOpacity}%</span>
            </label>
            <label className="flex items-center gap-2 text-label text-ink">
              <span className="w-20 shrink-0">DENSITY</span>
              <input
                type="range"
                min={1}
                max={10}
                value={draft.stampDensity}
                onChange={(event) => setDraft((held) => ({ ...held, stampDensity: Number(event.target.value) }))}
                className="min-w-0 flex-1"
              />
              <span className="w-10 shrink-0 text-right">{draft.stampDensity}</span>
            </label>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => fileRef.current?.click()} className={PLATE} disabled={busy}>
                [ UPLOAD PICTURE ]
              </button>
              {draft.stampUrl ? (
                <button type="button" onClick={() => setDraft((held) => ({ ...held, stampUrl: undefined }))} className={PLATE} disabled={busy}>
                  [ NO PICTURE ]
                </button>
              ) : null}
              <input
                ref={fileRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                className="sr-only"
                aria-label="Upload a stamp picture"
                onChange={(event) => void upload(event.target.files?.[0])}
              />
            </div>
          </div>
        </section>

        <StampSearch chosen={draft.stampUrl} onPick={(src) => setDraft((held) => ({ ...held, stampUrl: src }))} />

        {pickable.length > 0 ? (
          <section aria-label="Or pick a picture from this letter">
            <p className="mb-1 text-label text-ink">OR PICK ONE FROM THIS LETTER</p>
            <ul className="flex flex-wrap gap-2">
              {pickable.slice(0, 24).map((src) => (
                <li key={src}>
                  <button
                    type="button"
                    aria-pressed={draft.stampUrl === src}
                    aria-label="Use this picture"
                    onClick={() => setDraft((held) => ({ ...held, stampUrl: src }))}
                    className={`block p-0.5 ${draft.stampUrl === src ? 'outline outline-2 outline-accent-ink' : ''}`}
                  >
                    <StampCircle src={src} className="h-10 w-10" />
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <label className="flex flex-col gap-1 text-label text-ink">
          NAME
          <input
            type="text"
            value={draft.name}
            maxLength={LETTER_NAME_MAX}
            onChange={(event) => setDraft((held) => ({ ...held, name: event.target.value }))}
            className={FIELD}
          />
        </label>
        <label className="flex flex-col gap-1 text-label text-ink">
          DESCRIPTION
          <textarea
            value={draft.description}
            maxLength={LETTER_DESCRIPTION_MAX}
            rows={2}
            onChange={(event) => setDraft((held) => ({ ...held, description: event.target.value }))}
            className={FIELD}
          />
        </label>

        <section aria-label="Text colour">
          <p className="mb-1 text-label text-ink">TEXT COLOUR</p>
          <ul className="flex flex-wrap gap-1">
            <li>
              <button
                type="button"
                aria-pressed={draft.textColour === undefined}
                onClick={() => setDraft((held) => ({ ...held, textColour: undefined }))}
                className={draft.textColour === undefined ? PLATE_PRESSED : PLATE}
              >
                SITE COLOUR
              </button>
            </li>
            {NAME_COLOURS.map((colour) => (
              <li key={colour.id}>
                <button
                  type="button"
                  aria-pressed={draft.textColour === colour.hex}
                  aria-label={colour.label}
                  title={colour.label}
                  onClick={() => setDraft((held) => ({ ...held, textColour: colour.hex }))}
                  className={`name-ink block h-8 w-8 border border-ink bg-current ${draft.textColour === colour.hex ? 'outline outline-2 outline-accent-ink' : ''}`}
                  style={nameInkStyle(colour.hex)}
                />
              </li>
            ))}
          </ul>
          <p className="mt-2 text-title">
            <span className={draft.textColour ? 'name-ink' : 'text-ink'} style={draft.textColour ? nameInkStyle(draft.textColour) : undefined}>
              {draft.name.trim() || 'LETTER'}
            </span>
          </p>
        </section>

        {confirmDelete ? (
          <div role="alertdialog" aria-label="Delete this letter?" className="border border-ink bg-bubble-pale p-2 text-label text-ink-bar">
            <p>
              DELETE &quot;{letter.name}&quot; AND THE {items.length} {items.length === 1 ? 'THING' : 'THINGS'} ON IT? THIS CAN&apos;T BE UNDONE.
            </p>
            <p className="mt-2 flex gap-2">
              <button type="button" onClick={() => void remove()} className={PLATE} disabled={busy}>
                [ YES, DELETE ]
              </button>
              <button type="button" onClick={() => setConfirmDelete(false)} className={PLATE} disabled={busy}>
                [ KEEP IT ]
              </button>
            </p>
          </div>
        ) : null}

        {fault ? (
          <p role="status" className="bg-bubble-pale px-2 py-1 text-label text-ink-bar">
            {fault}
          </p>
        ) : null}
      </div>
    </PopoutWindow>
  );
}

/**
 * SEARCH PICTURES for the stamp (Luke, 2026-11-11): MEDIA's own search, pictures only (Openverse, Wikimedia Commons, the
 * Internet Archive: free-licence collections). A press makes one the stamp. The picture stays hotlinked from where it
 * lives, as MEDIA's thumbnails are; nothing is copied.
 */
function StampSearch({ chosen, onPick }: { chosen?: string; onPick: (src: string) => void }) {
  const [words, setWords] = useState('');
  const [found, setFound] = useState<{ src: string; title: string }[]>([]);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const find = async () => {
    const asked = words.trim();
    if (asked.length === 0) return;
    setBusy(true);
    setNote(null);
    try {
      const page = await searchEverywhere(asked, null, undefined, null, 'image');
      const pictures = page.items
        .filter((item) => item.kind === 'image')
        .map((item) => ({ src: cardPicture(rowAddresses(item).thumb), title: item.title }))
        .filter((picture): picture is { src: string; title: string } => picture.src !== undefined)
        .slice(0, 24);
      setFound(pictures);
      if (pictures.length === 0) setNote('NO PICTURES FOUND. TRY OTHER WORDS.');
    } catch {
      setNote('THE SEARCH DIDN\'T ANSWER. TRY AGAIN.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-label="Search pictures for the stamp">
      <p className="mb-1 text-label text-ink">OR SEARCH PICTURES</p>
      <div className="flex gap-1" role="search">
        <input
          type="text"
          value={words}
          onChange={(event) => setWords(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              void find();
            }
          }}
          placeholder="WHAT SHOULD IT SHOW?"
          aria-label="Search pictures for the stamp"
          className={`${FIELD} mt-0 min-w-0 flex-1`}
        />
        <button type="button" onClick={() => void find()} className={PLATE} disabled={busy}>
          {busy ? '[ ... ]' : '[ FIND ]'}
        </button>
      </div>
      {note ? <p className="mt-1 text-label text-ink">{note}</p> : null}
      {found.length > 0 ? (
        <ul className="mt-2 flex flex-wrap gap-2">
          {found.map((picture) => (
            <li key={picture.src}>
              <button
                type="button"
                aria-pressed={chosen === picture.src}
                aria-label={`Use "${picture.title}" as the stamp`}
                title={picture.title}
                onClick={() => onPick(picture.src)}
                className={`block p-0.5 ${chosen === picture.src ? 'outline outline-2 outline-accent-ink' : ''}`}
              >
                <StampCircle src={picture.src} className="h-12 w-12" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
