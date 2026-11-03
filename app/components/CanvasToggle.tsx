'use client';

import { artSlot } from '../lib/ui/art/slots';
import { PLATE_ON_BLACK, PLATE_ON_BLACK_PRESSED } from '../lib/ui/controls';
import { chooseScreen, useScreenView } from '../lib/watch/canvas-view';
import ArtMark from './ArtMark';

/** The toggle's hand-drawn mark (`mark-canvas` in app/lib/ui/art/slots.ts), shown at 16px. */
const CANVAS_MARK_SRC = `/${artSlot('mark-canvas')?.path ?? 'assets/icons/canvas.png'}`;
const MARK_SIZE = 16;

type CanvasToggleProps = {
  roomId: string;
  /** Audio is playing (a song): the canvas is then the default, the picture otherwise. */
  audio: boolean;
  className?: string;
};

/**
 * The screen toggle (SPEC-stream-art.md): switches this viewer's own screen between the picture and the room's
 * shared canvas. Each viewer picks for themselves; nothing is synced. Meant for any room screen (the stream stage,
 * a black screen of another kind): put it in the screen's corner and draw `RoomCanvas` over the screen while
 * `useScreenView(roomId, audio)` says `canvas`.
 */
export default function CanvasToggle({ roomId, audio, className }: CanvasToggleProps) {
  const view = useScreenView(roomId, audio);
  const onCanvas = view === 'canvas';
  return (
    <button
      type="button"
      className={`${onCanvas ? PLATE_ON_BLACK_PRESSED : PLATE_ON_BLACK} ${className ?? ''}`}
      aria-pressed={onCanvas}
      aria-label={onCanvas ? 'Show the picture' : 'Show the canvas'}
      title={onCanvas ? 'Picture' : 'Canvas'}
      onClick={() => chooseScreen(roomId, onCanvas ? 'picture' : 'canvas', audio)}
      data-canvas-toggle={view}
    >
      <ArtMark src={CANVAS_MARK_SRC} size={MARK_SIZE} fallback={<span>{onCanvas ? '[ PICTURE ]' : '[ CANVAS ]'}</span>} />
    </button>
  );
}
