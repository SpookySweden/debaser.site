'use client';

import { useState } from 'react';
import { HIGHLIGHT_COLOURS, MARK_LABELS } from '../../lib/books/reader-look';
import { COMMENT_MAX, type HighlightColour } from '../../lib/books/types';
import { FIELD_TIGHT, PLATE, PLATE_MAIN, PLATE_PRESSED } from '../../lib/ui/controls';

/** The swatch's fill: a token per colour, written out so the stylesheet keeps each class. */
export const SWATCH: Record<HighlightColour, string> = {
  yellow: 'bg-mark-yellow',
  pink: 'bg-mark-pink',
  green: 'bg-mark-green',
  blue: 'bg-mark-blue',
  red: 'bg-mark-red',
};

/** Where the bar sits: the selection's middle, and its top and bottom, in the stage's own pixels. */
export type BarSpot = { x: number; top: number; bottom: number; stageWidth: number; stageHeight: number };

const BAR_WIDTH = 296;
const BAR_HEIGHT = 64;

/** The bar's corner, kept inside the stage: above the words if there's room, else below them. Never moves the page. */
function placed(spot: BarSpot, tall: boolean): { left: number; top: number } {
  const height = tall ? 200 : BAR_HEIGHT;
  const left = Math.max(4, Math.min(spot.stageWidth - BAR_WIDTH - 4, spot.x - BAR_WIDTH / 2));
  const above = spot.top - height - 8;
  const top = above >= 4 ? above : Math.min(spot.stageHeight - height - 4, spot.bottom + 8);
  return { left, top: Math.max(4, top) };
}

/**
 * The small bar beside words chosen in the book (SPEC-reader.md): the five colours (a press highlights in that colour),
 * COMMENT (a highlight with a few words of your own) and 🔒 (kept to yourself, not posted). For a highlight already made,
 * the colours recolour it, and the lock and DELETE work on it. Absolutely placed over the page, so nothing on it moves.
 */
export default function HighlightBar({
  spot,
  quote,
  existing,
  signedIn,
  onColour,
  onComment,
  onLock,
  onDelete,
  onClose,
}: {
  spot: BarSpot;
  quote: string;
  /** The highlight tapped, when it's one already made: its colour and lock. */
  existing: { colour: HighlightColour; isLocked: boolean } | null;
  signedIn: boolean;
  onColour: (colour: HighlightColour, locked: boolean) => void;
  onComment: (colour: HighlightColour, comment: string, locked: boolean) => void;
  onLock: () => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const [locked, setLocked] = useState(false);
  const [writing, setWriting] = useState(false);
  const [comment, setComment] = useState('');
  const [colour, setColour] = useState<HighlightColour>(existing?.colour ?? 'yellow');
  const corner = placed(spot, writing);

  return (
    <div
      role="dialog"
      aria-label={existing ? 'Your highlight' : 'Highlight the words you chose'}
      className="frame absolute z-30 flex flex-col gap-1 bg-sun-pale p-1 text-ink"
      style={{ left: corner.left, top: corner.top, width: BAR_WIDTH }}
      onKeyDown={(event) => event.key === 'Escape' && onClose()}
    >
      {!signedIn ? (
        <p className="flex items-center justify-between gap-1 px-0.5">
          <span className="text-label">LOG IN TO HIGHLIGHT</span>
          <button type="button" onClick={onClose} className={PLATE} aria-label="Close">
            [ × ]
          </button>
        </p>
      ) : (
        <>
          <p className="flex flex-wrap items-center gap-1">
            {HIGHLIGHT_COLOURS.map((each) => (
              <button
                key={each}
                type="button"
                title={MARK_LABELS[each]}
                aria-label={existing ? `Make it ${MARK_LABELS[each].toLowerCase()}` : `Highlight in ${MARK_LABELS[each].toLowerCase()}`}
                aria-pressed={(existing?.colour ?? colour) === each}
                onClick={() => (writing ? setColour(each) : onColour(each, locked))}
                className={`frame h-7 w-7 max-sm:h-tap max-sm:w-tap ${SWATCH[each]} ${(existing?.colour ?? (writing ? colour : null)) === each ? 'outline-2 outline-offset-1 outline-ink' : ''}`}
              />
            ))}
            {existing ? (
              <>
                <button type="button" onClick={onLock} aria-pressed={existing.isLocked} className={existing.isLocked ? PLATE_PRESSED : PLATE}>
                  {existing.isLocked ? '🔒' : '🔓'}
                </button>
                <button type="button" onClick={onDelete} className={PLATE}>
                  [ DELETE ]
                </button>
              </>
            ) : (
              <>
                <button type="button" onClick={() => setWriting((open) => !open)} aria-expanded={writing} className={writing ? PLATE_PRESSED : PLATE}>
                  COMMENT
                </button>
                <button
                  type="button"
                  onClick={() => setLocked((on) => !on)}
                  aria-pressed={locked}
                  aria-label={locked ? 'Kept to yourself: not posted in your thread' : 'Posted in your thread for this book'}
                  title={locked ? 'KEPT TO YOURSELF' : 'POSTED IN YOUR THREAD'}
                  className={locked ? PLATE_PRESSED : PLATE}
                >
                  {locked ? '🔒' : '🔓'}
                </button>
              </>
            )}
          </p>
          {writing && !existing ? (
            <div className="flex flex-col gap-1">
              <p className="line-clamp-2 break-words text-label text-ink-quiet">&quot;{quote}&quot;</p>
              <textarea
                value={comment}
                onChange={(event) => setComment(event.target.value)}
                maxLength={COMMENT_MAX}
                rows={2}
                placeholder="A COMMENT"
                aria-label="Your comment"
                className={FIELD_TIGHT}
                autoFocus
              />
              <p className="flex gap-1">
                <button type="button" onClick={() => onComment(colour, comment, locked)} className={PLATE_MAIN}>
                  SAVE
                </button>
                <button type="button" onClick={() => setWriting(false)} className={PLATE}>
                  [ CANCEL ]
                </button>
              </p>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
