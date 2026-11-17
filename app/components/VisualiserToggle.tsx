'use client';

import { artSlot } from '../lib/ui/art/slots';
import { PLATE_ON_BLACK, PLATE_ON_BLACK_PRESSED } from '../lib/ui/controls';
import { chooseScreen, useScreenView } from '../lib/watch/canvas-view';
import { ROOM_VIS_MARK } from '../lib/watch/room-frame';
import { setVisualiserOn, useVisualiserOn } from '../lib/watch/visualiser';
import ArtMark from './ArtMark';

/** The key's hand-drawn mark (`mark-visualiser` in app/lib/ui/art/slots.ts), shown at 16px; `[ ▁▃▅ ]` until it's drawn. */
const MARK_SRC = `/${artSlot('mark-visualiser')?.path ?? 'assets/icons/visualiser.png'}`;

/**
 * The visualiser key (Luke, 2026-11-11), beside the canvas key in a room's screen corner: this viewer's own music
 * visualiser on or off over the screen. Nothing is synced: each person sees their own.
 */
export default function VisualiserToggle({
  roomId,
  audio,
  className,
}: {
  roomId: string;
  /** As the canvas key's: a song plays, so the canvas is the default. */
  audio: boolean;
  className?: string;
}) {
  const showing = useVisualiserOn(roomId);
  const onCanvas = useScreenView(roomId, audio) === 'canvas';
  return (
    <button
      type="button"
      className={`${showing ? PLATE_ON_BLACK_PRESSED : PLATE_ON_BLACK} ${className ?? ''}`}
      aria-pressed={showing}
      aria-label={showing ? 'Hide the visualiser' : 'Show the music visualiser'}
      title="Visualiser"
      onClick={() => {
        // Over the canvas the visualiser would only cover it: switched on from there, the screen goes back to the picture.
        if (!showing && onCanvas) chooseScreen(roomId, 'picture', audio);
        setVisualiserOn(roomId, !showing);
      }}
      data-visualiser-toggle={showing ? 'on' : 'off'}
    >
      <ArtMark src={MARK_SRC} size={16} fallback={<span>{`[ ${ROOM_VIS_MARK} ]`}</span>} />
    </button>
  );
}
