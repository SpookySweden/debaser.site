'use client';

import type { ForumPreview } from '../lib/forum/types';
import MediaThumbnail from './MediaThumbnail';
import SheetImage from './SheetImage';

export type MediaPickerItem = {
  id: string;
  label: string;
  preview: ForumPreview;
};

type MediaPickerProps = {
  id: string;
  items: MediaPickerItem[];
  value: string;
  onChange: (id: string) => void;
  /** Height of the icon pane, so the picker keeps the same footprint everywhere. */
  heightClass?: string;
};

/** The tile that means "no artwork": a post does not have to carry a picture. */
const NONE = 'NONE - TEXT ONLY';

/**
 * Artwork picker, laid out like the icon view of a file browser.
 *
 * One scrolling pane of thumbnails - the file list - and one fixed preview pane showing what
 * is currently chosen, so a picker for a long list of sheets costs two rows of height instead
 * of a drop-down the length of the archive. The selected tile is drawn the way Explorer draws
 * a highlighted icon: solid navy, white text.
 *
 * The artwork itself is hand-drawn and lives in the project assets folder: nothing here draws
 * a substitute, it only points at the file (see AGENTS.md).
 */
export default function MediaPicker({ id, items, value, onChange, heightClass = 'h-28' }: MediaPickerProps) {
  const selected = items.find((item) => item.id === value);

  return (
    <div id={id} className="rounded-none border border-gray-600 bg-ice-pale p-1">
      <div className="flex flex-col gap-1 sm:flex-row">
        <div
          className={`w-full overflow-y-auto rounded-none border-2 border-t-gray-600 border-l-gray-600 border-r-white border-b-white bg-white p-1 sm:w-3/5 ${heightClass}`}
        >
          <div role="radiogroup" aria-label="Containing media" className="flex flex-wrap gap-1">
            <button
              type="button"
              role="radio"
              aria-checked={value === ''}
              onClick={() => onChange('')}
              className={`w-16 cursor-pointer rounded-none border p-[2px] text-center ${
                value === '' ? 'border-black bg-ena text-white' : 'border-gray-400 bg-sun-pale text-black hover:bg-yellow-100'
              }`}
            >
              <span className="flex h-12 items-center justify-center border border-gray-600 bg-white text-[9px] font-bold text-black">
                [ NONE ]
              </span>
              <span className="mt-[2px] block truncate text-[9px] font-bold">TEXT ONLY</span>
            </button>

            {items.map((item) => {
              const picked = item.id === value;

              return (
                <button
                  key={item.id}
                  type="button"
                  role="radio"
                  aria-checked={picked}
                  title={item.label}
                  onClick={() => onChange(item.id)}
                  className={`w-16 cursor-pointer rounded-none border p-[2px] text-center ${
                    picked ? 'border-black bg-ena text-white' : 'border-gray-400 bg-sun-pale text-black hover:bg-yellow-100'
                  }`}
                >
                  <span className="flex h-12 items-center justify-center overflow-hidden border border-gray-600 bg-white">
                    <SheetImage
                      src={item.preview.src}
                      alt={item.preview.alt}
                      width={item.preview.width}
                      height={item.preview.height}
                      sizes="64px"
                    />
                  </span>
                  <span className="mt-[2px] block truncate text-[9px] font-bold">{item.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        <div className={`flex w-full items-center gap-2 border border-gray-500 bg-bubble-pale p-1 sm:flex-1 ${heightClass}`}>
          {selected === undefined ? (
            <p className="text-[10px] font-bold text-black">
              {NONE}
              <br />
              <span className="font-normal text-gray-700">PICK A SHEET TO ATTACH IT.</span>
            </p>
          ) : (
            <>
              <MediaThumbnail media={selected.preview} size={56} />
              <span className="min-w-0 flex-1 text-[10px] font-bold text-black">
                <span className="block truncate">{selected.label}</span>
                <span className="mt-[2px] block font-normal text-gray-700">
                  {selected.preview.width} x {selected.preview.height}
                </span>
                <button
                  type="button"
                  onClick={() => onChange('')}
                  className="mt-1 cursor-pointer rounded-none border-t border-l border-white border-r border-b border-black bg-sun-pale px-1 py-[1px] text-[9px] font-bold text-black hover:bg-gray-300"
                >
                  [ CLEAR ]
                </button>
              </span>
            </>
          )}
        </div>
      </div>

      <p className="mt-1 px-1 text-[9px] text-gray-700">
        {items.length === 0
          ? 'THE ARCHIVE IS EMPTY.'
          : `${items.length} SHEET${items.length === 1 ? '' : 'S'} IN THE ARCHIVE.`}
      </p>
    </div>
  );
}
