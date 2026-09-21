'use client';

import { useEffect, useState } from 'react';
import {
  CRT_PASTEL_PALETTE,
  canonicalTagLabel,
  makeUserTag,
  normaliseTagLabel,
} from '../lib/forum/tag-vocabulary';
import PopoutWindow from './PopoutWindow';
import { tagChipClasses, tagChipStyleFromColour } from './TagBadge';

type TagCreatorWindowProps = {
  /** Labels already in use, so the editor can warn when a name folds onto one. */
  knownLabels: string[];
  onCancel: () => void;
  onCreate: (label: string, colour: string) => void;
};

/**
 * The tag editor pop-up.
 *
 * Opened from the subtle "+ NEW TAG..." control in any composer. Name the tag,
 * pick one of the 16 CRT pastel swatches, and it is created with that colour -
 * the colour is remembered against the tag, so the same tag always comes back
 * in the same pastel.
 */
export default function TagCreatorWindow({ knownLabels, onCancel, onCreate }: TagCreatorWindowProps) {
  const [name, setName] = useState('');
  const [colour, setColour] = useState<string>(CRT_PASTEL_PALETTE[0]);
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
      bodyClassName="bg-white"
      status="ESC OR CLICK THE DESKTOP TO CANCEL"
      actions={
        <button
          type="button"
          onClick={handleCreate}
          className="cursor-pointer rounded-none border-t border-l border-white border-r-2 border-b-2 border-black bg-[#c0c0c0] px-3 py-1 text-xs font-bold hover:bg-gray-300"
        >
          [ CREATE TAG ]
        </button>
      }
    >
        <div className="text-black">
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
            className="mt-1 w-full rounded-none border-2 border-t-gray-600 border-l-gray-600 border-r-white border-b-white bg-white p-2 font-mono text-xs text-black outline-none"
          />

          <p className="mt-3 text-[10px] font-bold">CRT PASTEL SWATCHES (16):</p>
          <div className="mt-1 grid grid-cols-8 gap-1">
            {CRT_PASTEL_PALETTE.map((swatch) => (
              <button
                key={swatch}
                type="button"
                onClick={() => setColour(swatch)}
                title={swatch.toUpperCase()}
                aria-label={`Use colour ${swatch}`}
                aria-pressed={colour === swatch}
                className={`h-6 w-full cursor-pointer rounded-none border-2 border-t-white border-l-white border-r-[#606060] border-b-[#606060] ${
                  colour === swatch ? 'outline-2 outline-black' : ''
                }`}
                style={{ backgroundColor: swatch }}
              />
            ))}
          </div>

          <div className="mt-3 rounded-none border border-gray-600 bg-[#f0f0f0] p-2">
            <p className="text-[10px] font-bold">PREVIEW:</p>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <span
                className={tagChipClasses(makeUserTag(previewLabel))}
                style={tagChipStyleFromColour(colour)}
              >
                {previewLabel}
              </span>
              <span className="text-[10px] font-bold">{colour.toUpperCase()}</span>
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
            <p className="mt-2 text-[10px] font-bold text-[#800000]">ERROR: {error}</p>
          )}
        </div>
    </PopoutWindow>
  );
}
