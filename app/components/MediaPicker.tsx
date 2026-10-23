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
 * a substitute, it only points at the file (see CLAUDE.md).
 */
export default function MediaPicker({ id, items, value, onChange, heightClass = 'h-28' }: MediaPickerProps) {
  const selected = items.find((item) => item.id === value);

  return (
    <div id={id} className="p-1">
      <div className="flex flex-col gap-1 sm:flex-row">
        <div
          className={`w-full overflow-y-auto frame bg-paper p-1 sm:w-3/5 ${heightClass}`}
        >
          {/* 84px tiles: the labels are 10px, the floor where the pixel font still reads, and `TEXT ONLY`
              is 74px at that size. At 64px it was cut, and `[ NONE ]` broke onto two lines. */}
          <div role="radiogroup" aria-label="Containing media" className="flex flex-wrap gap-1">
            <button
              type="button"
              role="radio"
              aria-checked={value === ''}
              onClick={() => onChange('')}
              className={`w-21 cursor-pointer rounded-none border p-0.5 text-center ${
                value === '' ? 'border-ink-plate bg-ena text-ink-bar' : 'border-ink bg-sun-pale text-ink hover:bg-ice-pale'
              }`}
            >
              <span className="flex h-12 items-center justify-center border border-ink bg-paper text-label font-bold text-ink">
                [ NONE ]
              </span>
              <span className="mt-0.5 block truncate text-label font-bold">TEXT ONLY</span>
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
                  className={`w-21 cursor-pointer rounded-none border p-0.5 text-center ${
                    picked ? 'border-ink-plate bg-ena text-ink-bar' : 'border-ink bg-sun-pale text-ink hover:bg-ice-pale'
                  }`}
                >
                  <span className="flex h-12 items-center justify-center overflow-hidden border border-ink bg-paper">
                    <SheetImage
                      src={item.preview.src}
                      alt={item.preview.alt}
                      width={item.preview.width}
                      height={item.preview.height}
                      sizes="84px"
                    />
                  </span>
                  <span className="mt-0.5 block truncate text-label font-bold">{item.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Rose is one of the surfaces that does *not* move with the theme, so every ink on it is the
            bar ink: Black on Rose is 4.47:1 - a hair under the floor, and it is the pair the audit
            caught here - while Pure White is 4.70:1 in either theme. The children name their own ink
            rather than inheriting, so each one has to say it. */}
        <div className={`flex w-full items-center gap-2 border border-ink bg-bubble-pale p-1 [--key-ink:var(--color-ink-bar)] [--key-hover-ink:var(--color-bubble-pale)] [--key-quiet-ink:var(--color-ink-bar)] sm:flex-1 ${heightClass}`}>
          {selected === undefined ? (
            <p className="text-label font-bold text-ink-bar">
              {NONE}
              <br />
              <span className="font-normal text-ink-bar">PICK A SHEET TO ATTACH IT.</span>
            </p>
          ) : (
            <>
              <MediaThumbnail media={selected.preview} size={56} />
              <span className="min-w-0 flex-1 text-label font-bold text-ink-bar">
                <span className="block truncate">{selected.label}</span>
                <span className="mt-0.5 block font-normal text-ink-bar">
                  {selected.preview.width} x {selected.preview.height}
                </span>
                <button
                  type="button"
                  onClick={() => onChange('')}
                  className="mt-1 cursor-pointer key px-0.5 py-0.75 text-label font-bold max-sm:min-h-tap max-sm:px-1"
                >
                  [ CLEAR ]
                </button>
              </span>
            </>
          )}
        </div>
      </div>

      <p className="mt-1 px-1 text-label text-ink">
        {items.length === 0
          ? 'THE ARCHIVE IS EMPTY.'
          : `${items.length} SHEET${items.length === 1 ? '' : 'S'} IN THE ARCHIVE.`}
      </p>
    </div>
  );
}
