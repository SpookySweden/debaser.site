'use client';

import { useEffect, useState } from 'react';
import {
  TAG_MARK_PALETTE,
  canonicalTagLabel,
  makeUserTag,
  normaliseTagLabel,
} from '../lib/forum/tag-vocabulary';
import { contrastRatio } from '../lib/ui/colour';
import PopoutWindow from './PopoutWindow';
import { TagMark, tagChipClasses, tagMarkColourFromColour } from './TagBadge';

type TagCreatorWindowProps = {
  /** Labels already in use, so the editor can warn when a name folds onto one. */
  knownLabels: string[];
  onCancel: () => void;
  onCreate: (label: string, colour: string) => void;
};

/**
 * The tag editor pop-up.
 *
 * Opened from the subtle "+ NEW TAG..." control in any composer. Name the tag, pick one of the
 * sixteen swatches, and it is created with that colour - the colour is remembered against the tag, so
 * the same tag always comes back in the same colour. Each swatch is drawn the way a tag wears it (a
 * small key on a neutral chip), so what is picked here is what a post will show.
 */
export default function TagCreatorWindow({ knownLabels, onCancel, onCreate }: TagCreatorWindowProps) {
  const [name, setName] = useState('');
  const [colour, setColour] = useState<string>(TAG_MARK_PALETTE[0]);
  const [error, setError] = useState<string | null>(null);

  const inputId = 'tag-creator-name';

  useEffect(() => {
    document.getElementById(inputId)?.focus();
  }, []);

  const typed = normaliseTagLabel(name);
  const label = typed.length === 0 ? '' : canonicalTagLabel(typed, knownLabels);
  const previewLabel = label.length === 0 ? 'NEW TAG' : label;
  const foldsOnto = label.length > 0 && label !== typed ? label : null;

  function handleCreate() {
    if (label.length === 0) {
      setError('GIVE THE TAG A NAME FIRST.');
      return;
    }

    onCreate(label, colour);
  }

  return (
    <PopoutWindow
      title="TAG EDITOR :: CREATE A TAG"
      badge="[ 16 COLOURS ]"
      onClose={onCancel}
      maxWidth="max-w-md"
      bodyClassName="bg-paper"
      status="ESC OR CLICK THE DESKTOP TO CANCEL"
      actions={
        <button
          type="button"
          onClick={handleCreate}
          className="cursor-pointer rounded-none border-t border-l border-white border-r-2 border-b-2 border-black bg-sun-pale px-3 py-1 text-xs font-bold hover:bg-ice"
        >
          [ CREATE TAG ]
        </button>
      }
    >
        <div className="text-ink">
          <label htmlFor={inputId} className="block text-[10px] font-bold">
            TAG NAME:
          </label>
          <input
            id={inputId}
            type="text"
            value={name}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== 'Enter') return;
              event.preventDefault();
              handleCreate();
            }}
            placeholder="e.g. world building"
            className="mt-1 w-full rounded-none border-2 border-t-black border-l-black border-r-white border-b-white bg-paper p-2 font-mono text-xs text-ink outline-none"
          />

          <p className="mt-3 text-[10px] font-bold">
            SWATCHES ({TAG_MARK_PALETTE.length}) :: EACH IS DRAWN AS A TAG&apos;S COLOUR KEY
          </p>
          <div className="mt-1 grid grid-cols-8 gap-1">
            {TAG_MARK_PALETTE.map((swatch) => (
              <button
                key={swatch}
                type="button"
                onClick={() => setColour(swatch)}
                title={`${swatch.toUpperCase()} :: ${contrastRatio(swatch, '#ffffcc').toFixed(1)}:1 against the chip it sits on`}
                aria-label={`Use colour ${swatch}`}
                aria-pressed={colour === swatch}
                className={`flex cursor-pointer items-center justify-center rounded-none border border-t-white border-l-white border-r-[#808080] border-b-[#808080] bg-bubble-pale py-1 ${
                  colour === swatch ? 'outline-2 outline-ink' : 'hover:bg-sun'
                }`}
              >
                <TagMark colour={swatch} />
              </button>
            ))}
          </div>

          <div className="mt-3 rounded-none border border-ink bg-ice-pale p-2">
            <p className="text-[10px] font-bold">PREVIEW:</p>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <span className={tagChipClasses(makeUserTag(previewLabel))}>
                <TagMark colour={tagMarkColourFromColour(colour)} />
                {previewLabel}
              </span>
              <span className="text-[10px] font-bold">KEY: {tagMarkColourFromColour(colour).toUpperCase()}</span>
            </div>
            {foldsOnto === null ? (
              <p className="mt-1 text-[10px]">A NEW TAG WILL BE CREATED.</p>
            ) : (
              <p className="mt-1 text-[10px] font-bold">
                DECIDEDLY SIMILAR TO AN EXISTING TAG - IT WILL REUSE: {foldsOnto}
              </p>
            )}
          </div>

          {error === null ? null : (
            <p className="mt-2 text-[10px] font-bold text-bubble-pale">ERROR: {error}</p>
          )}
        </div>
    </PopoutWindow>
  );
}
