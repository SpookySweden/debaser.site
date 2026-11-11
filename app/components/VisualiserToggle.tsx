'use client';

import { artSlot } from '../lib/ui/art/slots';
import { PLATE_ON_BLACK, PLATE_ON_BLACK_PRESSED } from '../lib/ui/controls';
import { setVisualiserOn, useVisualiserOn } from '../lib/watch/visualiser';
import ArtMark from './ArtMark';

/** The key's hand-drawn mark (`mark-visualiser` in app/lib/ui/art/slots.ts), shown at 16px; `[ VIS ]` until it's drawn. */
const MARK_SRC = `/${artSlot('mark-visualiser')?.path ?? 'assets/icons/visualiser.png'}`;

/**
 * The visualiser key (Luke, 2026-11-11), beside the canvas key in a room's screen corner: this viewer's own music
 * visualiser on or off over the screen. Nothing is synced: each person sees their own.
 */
export default function VisualiserToggle({ roomId }: { roomId: string }) {
  const showing = useVisualiserOn(roomId);
  return (
    <button
      type="button"
      className={showing ? PLATE_ON_BLACK_PRESSED : PLATE_ON_BLACK}
      aria-pressed={showing}
      aria-label={showing ? 'Hide the visualiser' : 'Show the music visualiser'}
      title="Visualiser"
      onClick={() => setVisualiserOn(roomId, !showing)}
      data-visualiser-toggle={showing ? 'on' : 'off'}
    >
      <ArtMark src={MARK_SRC} size={16} fallback={<span>[ VIS ]</span>} />
    </button>
  );
}
