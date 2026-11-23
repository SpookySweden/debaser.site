'use client';

import type { ReactNode } from 'react';
import { PAPERS, TEXT_SIZES, type ReaderLook, type TextSize } from '../../lib/seeing/lenses/lens';
import { LENS_NAMES, type LensId } from '../../lib/seeing/lenses/names';
import { lensById } from '../../lib/seeing/lenses/registry';
import { PLATE, PLATE_PRESSED } from '../../lib/ui/controls';

type Props = { lens: LensId; look: ReaderLook; onLook: (look: ReaderLook) => void; onLens: (lens: LensId) => void; children: ReactNode };

/** The lens keys, and READER's own settings while it is the lens. A lens that isn't built yet has a quiet key. */
export default function SeeingLenses({ lens, look, onLook, onLens, children }: Props) {
  const sizeBy = (by: -1 | 1) => TEXT_SIZES.find((size) => size === look.size + by);
  const toSize = (size: TextSize | undefined) => {
    if (size !== undefined) onLook({ ...look, size });
  };
  return (
    <div className="flex flex-wrap items-center gap-x-1 gap-y-1 pt-1" data-seeing-lenses>
      <span className="flex flex-wrap items-center gap-1" role="group" aria-label="Lens">
        {LENS_NAMES.map(({ id, label }) => {
          const built = lensById(id) !== null;
          return (
            <button
              key={id}
              type="button"
              aria-pressed={lens === id}
              disabled={!built}
              title={built ? undefined : 'Not built yet'}
              onClick={() => onLens(id)}
              className={lens === id ? `${PLATE_PRESSED} cursor-pointer` : PLATE}
            >
              [ {label} ]
            </button>
          );
        })}
      </span>
      {lens === 'reader' ? (
        <span className="flex flex-wrap items-center gap-1" role="group" aria-label="Reader">
          {PAPERS.map((paper) => (
            <button
              key={paper}
              type="button"
              aria-pressed={look.paper === paper}
              aria-label={`Paper: ${paper}`}
              onClick={() => onLook({ ...look, paper })}
              className={look.paper === paper ? `${PLATE_PRESSED} cursor-pointer` : PLATE}
            >
              [ {paper.toUpperCase()} ]
            </button>
          ))}
          <button type="button" aria-label="Smaller words" disabled={sizeBy(-1) === undefined} onClick={() => toSize(sizeBy(-1))} className={PLATE}>
            [ A− ]
          </button>
          <button type="button" aria-label="Larger words" disabled={sizeBy(1) === undefined} onClick={() => toSize(sizeBy(1))} className={PLATE}>
            [ A+ ]
          </button>
        </span>
      ) : null}
      <span className="ml-auto flex items-center">{children}</span>
    </div>
  );
}
