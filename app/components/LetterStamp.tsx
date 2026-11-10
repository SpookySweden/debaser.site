import type { ReactNode } from 'react';
import { artSlot } from '../lib/ui/art/slots';
import type { Letter } from '../lib/letters/types';
import SpriteSlot from './SpriteSlot';

const ENVELOPE = `/${artSlot('letter-envelope')?.path ?? 'assets/letters/envelope.png'}`;

/**
 * A letter's stamp: its picture cropped to a circle (Luke, 2026-11-10: "the stamp is replaced by a circular cropped picture").
 * The one round thing letters draw, held to this wrapper so `check-surreal` can name it, as it names VANITY's faces.
 */
export function StampCircle({ src, className, children }: { src?: string; className: string; children?: ReactNode }) {
  return (
    <span className={`block overflow-hidden rounded-full border border-ink bg-paper ${className}`}>
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element -- a hotlinked or uploaded picture, drawn as it is
        <img src={src} alt="" referrerPolicy="no-referrer" loading="lazy" className="h-full w-full object-cover" />
      ) : null}
      {children}
    </span>
  );
}

/**
 * One letter as a small envelope (Luke's drawing, `letter-envelope` slot) with the letter's own picture as its stamp in the
 * top right corner. Until the envelope is drawn the slot shows its dotted field.
 */
export default function LetterStamp({ letter }: { letter: Pick<Letter, 'name' | 'stampUrl'> }) {
  return (
    <span className="relative inline-block h-12 w-16 shrink-0">
      <SpriteSlot src={ENVELOPE} alt="" width={64} height={48} className="h-12 w-16" />
      <StampCircle src={letter.stampUrl} className="absolute right-1 top-1 h-6 w-6" />
    </span>
  );
}
