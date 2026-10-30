'use client';

import Image from 'next/image';
import { useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { cropPosition, type AvatarCrop } from '../lib/profile/avatar-crop';

type AvatarCropEditorProps = {
  /** The picture on display. */
  src: string;
  crop: AvatarCrop;
  /** Saves at once: the switch on a click, the square when it is let go (or on each arrow key). */
  onChange: (patch: Partial<AvatarCrop>) => Promise<void> | void;
  /** Quiets the switch while something else saves; the square stays live so keyboard focus is never lost. */
  disabled?: boolean;
};

/** One arrow key moves the square this far (percent of the room it has to move in). */
const KEY_STEP = 5;

/** Within 1% of square, there is nothing to cut and nothing to drag. */
const SQUARE_TOLERANCE = 0.01;

/**
 * The CROP section of the picture tab: the switch, and the whole picture with the square on it.
 *
 * The square is dragged (mouse or finger) to the part of the drawing that shows; only one direction
 * matters - sideways on a wide picture, up and down on a tall one - so the other is left where it is.
 * The square is a slider for the keyboard (arrow keys, Home, End). Nothing is filed until it is let
 * go, so a drag is one save, not one per pixel.
 */
export default function AvatarCropEditor({ src, crop, onChange, disabled = false }: AvatarCropEditorProps) {
  const frame = useRef<HTMLSpanElement>(null);
  /** Width over height, once the file has loaded; null until then. */
  const [ratio, setRatio] = useState<number | null>(null);
  /** Where the square sits mid-drag, before it is saved. */
  const [draft, setDraft] = useState<number | null>(null);
  const [dragging, setDragging] = useState(false);

  const wide = ratio !== null && ratio > 1 + SQUARE_TOLERANCE;
  const tall = ratio !== null && ratio < 1 - SQUARE_TOLERANCE;
  const axis: 'x' | 'y' = tall ? 'y' : 'x';
  const position = draft ?? crop[axis];
  /** The square's edge as a share of the picture's long side. */
  const share = ratio === null ? 1 : wide ? 1 / ratio : ratio;
  const offset = `${(position / 100) * (1 - share) * 100}%`;

  /** The square centred on the pointer, as a crop percentage. */
  function positionAt(event: PointerEvent<HTMLSpanElement>): number {
    const box = frame.current?.getBoundingClientRect();
    if (box === undefined) return position;
    const along = axis === 'x' ? (event.clientX - box.left) / box.width : (event.clientY - box.top) / box.height;
    const room = 1 - share;
    return room <= 0 ? 50 : cropPosition(((along - share / 2) / room) * 100);
  }

  function save(next: number) {
    void Promise.resolve(onChange({ [axis]: next })).finally(() => setDraft(null));
  }

  function onKeyDown(event: KeyboardEvent<HTMLSpanElement>) {
    const back = axis === 'x' ? 'ArrowLeft' : 'ArrowUp';
    const forward = axis === 'x' ? 'ArrowRight' : 'ArrowDown';
    const next =
      event.key === back ? position - KEY_STEP
        : event.key === forward ? position + KEY_STEP
          : event.key === 'Home' ? 0
            : event.key === 'End' ? 100
              : null;
    if (next === null) return;
    event.preventDefault();
    const kept = cropPosition(next);
    setDraft(kept);
    save(kept);
  }

  const canDrag = crop.on && (wide || tall);

  return (
    <div className="space-y-2">
      <label className="flex items-center gap-2 text-label font-bold text-ink max-sm:min-h-tap">
        <input
          type="checkbox"
          checked={crop.on}
          disabled={disabled}
          onChange={(event) => void onChange({ on: event.target.checked })}
        />
        CROP TO A SQUARE
      </label>

      {/* Off, the CURRENT picture above already shows the whole drawing; square, there is nothing to place. */}
      {!crop.on || (ratio !== null && !wide && !tall) ? null : (
        <span
          ref={frame}
          className={`relative block w-60 max-w-full select-none ${canDrag ? 'cursor-move touch-none' : ''}`}
          onPointerDown={(event) => {
            if (!canDrag) return;
            event.currentTarget.setPointerCapture(event.pointerId);
            setDragging(true);
            setDraft(positionAt(event));
          }}
          onPointerMove={(event) => {
            if (dragging) setDraft(positionAt(event));
          }}
          onPointerUp={(event) => {
            if (!dragging) return;
            setDragging(false);
            save(positionAt(event));
          }}
          onPointerCancel={() => {
            setDragging(false);
            setDraft(null);
          }}
        >
          <Image
            src={src}
            alt="Whole profile picture"
            width={240}
            height={240}
            sizes="240px"
            draggable={false}
            onLoad={(event) => {
              const image = event.currentTarget;
              if (image.naturalHeight > 0) setRatio(image.naturalWidth / image.naturalHeight);
            }}
            className="block h-auto w-full rounded-none"
          />

          {!crop.on || ratio === null ? null : (
            <span
              role="slider"
              tabIndex={0}
              aria-label={wide ? 'Crop square, left to right' : 'Crop square, top to bottom'}
              aria-orientation={wide ? 'horizontal' : 'vertical'}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={position}
              title="DRAG"
              onKeyDown={onKeyDown}
              className="absolute border-line border-bubble focus-visible:outline focus-visible:outline-2 focus-visible:outline-ink"
              style={
                wide
                  ? { top: 0, bottom: 0, left: offset, width: `${share * 100}%` }
                  : { left: 0, right: 0, top: offset, height: `${share * 100}%` }
              }
            />
          )}
        </span>
      )}
    </div>
  );
}
