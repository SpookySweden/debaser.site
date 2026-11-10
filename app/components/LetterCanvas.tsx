'use client';

import type { CSSProperties } from 'react';
import type { Letter, LetterItem } from '../lib/letters/types';
import { cardPicture, KIND_LABELS } from '../lib/letters/things';

/**
 * A letter's canvas (SPEC-letters.md): the stamp picture repeating behind at the letter's opacity and density, and the
 * things on it scattered as small tilted cards, each where it landed when added (or where SHUFFLE last put it).
 * A card is a key: it opens that thing's pop-up.
 */
export default function LetterCanvas({
  letter,
  items,
  onOpen,
}: {
  letter: Letter;
  items: readonly LetterItem[];
  onOpen: (item: LetterItem) => void;
}) {
  const pattern: CSSProperties | undefined = letter.stampUrl
    ? {
        backgroundImage: `url("${encodeURI(letter.stampUrl)}")`,
        backgroundSize: `${100 / letter.stampDensity}% auto`,
        backgroundRepeat: 'repeat',
        opacity: letter.stampOpacity / 100,
      }
    : undefined;

  return (
    <div className="relative aspect-[4/3] w-full overflow-hidden border border-ink bg-paper">
      {pattern ? <div aria-hidden="true" className="pointer-events-none absolute inset-0" style={pattern} /> : null}
      {items.length === 0 ? (
        <p className="absolute inset-0 flex items-center justify-center p-4 text-center text-label text-ink">
          NOTHING HERE YET. PRESS ADD TO LETTER ON ANYTHING ON THE SITE.
        </p>
      ) : null}
      <ul className="absolute inset-0">
        {items.map((item) => (
          <li
            key={item.id}
            className="absolute w-24 max-sm:w-16"
            style={{ left: `${item.x * 100}%`, top: `${item.y * 100}%`, transform: `translate(-50%, -50%) rotate(${item.turn}deg)` }}
          >
            <LetterCard item={item} onOpen={onOpen} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function LetterCard({ item, onOpen }: { item: LetterItem; onOpen: (item: LetterItem) => void }) {
  const picture = cardPicture(item.picture);
  return (
    <button
      type="button"
      onClick={() => onOpen(item)}
      aria-label={`${KIND_LABELS[item.kind]}: ${item.title || item.ref}. Open its details.`}
      className="block w-full cursor-pointer border border-ink bg-sun-pale p-0.5 text-left hover:bg-paper focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent-ink"
    >
      {picture ? (
        // eslint-disable-next-line @next/next/no-img-element -- hotlinked from where the thing lives, never copied
        <img src={picture} alt="" referrerPolicy="no-referrer" loading="lazy" className="block aspect-square w-full object-cover" />
      ) : (
        <span className="block aspect-square w-full bg-chrome-dark p-1 text-label text-ink">{KIND_LABELS[item.kind]}</span>
      )}
      <span className="mt-0.5 block truncate text-label text-ink">{item.title || item.ref}</span>
    </button>
  );
}
