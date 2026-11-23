'use client';

import { useState, type ReactNode } from 'react';
import { LENS_NAMES, type LensId } from '../../lib/seeing/lenses/names';
import { DIAL_FIRST, dialOf, dialTo } from '../../lib/seeing/time';
import { FIELD_TIGHT, PLATE, PLATE_PRESSED } from '../../lib/ui/controls';
import type { Loupe } from './SeeingStage';

type Props = {
  /** The page in front, or null in a new tab. */
  address: string | null;
  /** A page is drawn (not busy, not refused): SEAM, LOUPE and ERASE work on one. */
  ready: boolean;
  seam: LensId | null;
  loupe: Loupe | null;
  erasing: boolean;
  erased: number;
  good: boolean;
  onSeam: (seam: LensId | null) => void;
  onLoupe: (loupe: Loupe | null) => void;
  onErasing: (erasing: boolean) => void;
  onBringBack: () => void;
  onScan: () => void;
  onGood: (good: boolean) => void;
  onGo: (address: string) => void;
  children: ReactNode;
};

const on = (pressed: boolean): string => (pressed ? `${PLATE_PRESSED} cursor-pointer` : PLATE);

/** SEAM, LOUPE, ERASE, SCAN and the TIME DIAL. */
export default function SeeingTools({ address, ready, seam, loupe, erasing, erased, good, onSeam, onLoupe, onErasing, onBringBack, onScan, onGood, onGo, children }: Props) {
  // A new tab shows only what works without a page: SCAN, then HISTORY and KEPT.
  const page = address !== null;
  const outside = address !== null && /^https?:/.test(address);
  const dial = outside ? dialOf(address) : null;
  const thisYear = new Date().getFullYear();
  // Past the last year is now.
  const shown = dial?.year ?? thisYear + 1;
  const [turning, setTurning] = useState<number | null>(null);
  // The dial is a key until pressed; an old copy shows it open, at its year.
  const [dialAsked, setDialAsked] = useState(false);
  const dialShown = dial !== null && (dialAsked || dial.year !== null);
  const year = turning ?? shown;
  const letGo = () => {
    if (turning === null || dial === null) return;
    if (turning !== shown) onGo(dialTo(dial.address, turning > thisYear ? null : turning));
    setTurning(null);
  };
  return (
    <div className="contents" data-seeing-tools>
      {page ? (<>
      <button type="button" aria-pressed={seam !== null} disabled={!ready && seam === null} title="A lens each side of a line you drag" onClick={() => onSeam(seam === null ? 'reader' : null)} className={on(seam !== null)}>
        [ SEAM ]
      </button>
      {seam !== null ? (
        <select aria-label="The lens on the right" value={seam} onChange={(event) => onSeam(LENS_NAMES.find((each) => each.id === event.target.value)?.id ?? 'reader')} className={FIELD_TIGHT}>
          {LENS_NAMES.map(({ id, label }) => (
            <option key={id} value={id}>
              {label}
            </option>
          ))}
        </select>
      ) : null}
      <button type="button" aria-pressed={loupe !== null} disabled={!ready && loupe === null} title="Another lens under the pointer, or the same words larger" onClick={() => onLoupe(loupe === null ? 2 : null)} className={on(loupe !== null)}>
        [ LOUPE ]
      </button>
      {loupe !== null ? (
        <select
          aria-label="What the loupe shows"
          value={String(loupe)}
          onChange={(event) => onLoupe(event.target.value === '2' ? 2 : event.target.value === '3' ? 3 : event.target.value === '4' ? 4 : (LENS_NAMES.find((each) => each.id === event.target.value)?.id ?? 2))}
          className={FIELD_TIGHT}
        >
          <option value="2">2×</option>
          <option value="3">3×</option>
          <option value="4">4×</option>
          {LENS_NAMES.filter(({ id }) => id !== 'reader').map(({ id, label }) => (
            <option key={id} value={id}>
              {label}
            </option>
          ))}
        </select>
      ) : null}
      <button type="button" aria-pressed={erasing} disabled={!ready && !erasing} title="Point, press, gone" onClick={() => onErasing(!erasing)} className={on(erasing)}>
        [ ERASE ]
      </button>
      {erased > 0 ? (
        <button type="button" onClick={onBringBack} className={PLATE}>
          [ BRING BACK {erased} ]
        </button>
      ) : null}
      </>) : null}
      <button type="button" title="A page of the small, old web" onClick={onScan} className={PLATE}>
        [ SCAN ]
      </button>
      {page ? (
      <button type="button" aria-pressed={good} disabled={!outside} title="Keep it on the list in a new tab" onClick={() => onGood(!good)} className={on(good)}>
        [ GOOD ]
      </button>
      ) : null}
      {dial !== null && dial.year === null ? (
        <button type="button" aria-pressed={dialAsked} title="The page as it was, in a year you choose" onClick={() => setDialAsked(!dialAsked)} className={on(dialAsked)}>
          [ TIME ]
        </button>
      ) : null}
      {dialShown ? (
        <label className="flex items-center gap-1 text-label text-ink">
          {DIAL_FIRST}
          <input
            type="range"
            min={DIAL_FIRST}
            max={thisYear + 1}
            value={year}
            aria-label="Year"
            aria-valuetext={year > thisYear ? 'Now' : String(year)}
            onChange={(event) => setTurning(Number(event.target.value))}
            onPointerUp={letGo}
            onKeyUp={letGo}
            onBlur={letGo}
            className="w-40 accent-accent"
            data-seeing-dial
          />
          <span className="w-10 tabular-nums">{year > thisYear ? 'NOW' : year}</span>
        </label>
      ) : null}
      <span className="ml-auto flex flex-wrap items-center">{children}</span>
    </div>
  );
}
