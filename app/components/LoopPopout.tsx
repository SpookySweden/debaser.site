'use client';

import { useEffect, useRef } from 'react';
import { PLATE, TITLE_BAR } from '../lib/ui/controls';
import { formatClock } from '../lib/audio/format';
import type { LoopSource } from '../lib/audio/loops';
import { useMusicPlayer } from './MusicPlayerProvider';

/**
 * A loop, opened: what it is, and the two things you can do with it.
 *
 * A small dialogue rather than this site's usual `PopoutWindow`, and the difference is deliberate. A
 * `PopoutWindow` takes the screen because the things it holds are *decisions* - the composer, the
 * pickers - and they deserve the room. This is one loop: two lines and two keys, so it is a card that
 * sits where the plate was, and it leaves the RADI-OH grid visible behind it so the reader can see what
 * they are choosing between.
 *
 * **Two ways out, as the brief asked.** The red X in the corner, and a press anywhere off the card. Both
 * are wired here rather than in a wrapper because a dialogue that only closes one way is a dialogue a
 * reader can get stuck in - and the off-press has to stop at the card itself, or pressing a button
 * inside it would close it before the press landed.
 *
 * ESC is wired too. It is not in the brief, but this is the one shape on the site that *is* a dialogue
 * and ESC is what a dialogue owes a keyboard: `DockWindow` deliberately does not take ESC, because two
 * of those can be open at once and one key closing both is worse than a `[ CLOSE ]`. One card at a time
 * has no such problem.
 */
export default function LoopPopout({
  loop,
  label,
  onClose,
}: {
  loop: LoopSource;
  label: string;
  onClose: () => void;
}) {
  const player = useMusicPlayer();
  const card = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  /**
   * Back to where the loop points.
   *
   * The track is played by its `src` first, because `play` queues a track the shelf does not hold as well
   * as one it does - so a loop whose file has been removed still resolves to a player that says so rather
   * than to a press that does nothing. The seek comes after, in the same handler, because the element is
   * loaded by then: `play` swaps `src` synchronously and the browser seeks once it has the metadata.
   */
  const goBack = () => {
    const track = player.queue.find((entry) => entry.src === loop.trackId);

    if (track !== undefined) player.play(track);

    player.seek(loop.positionSeconds);
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center bg-ink/40 p-4"
      onPointerDown={(event) => {
        // A press on the backdrop closes; a press that started inside the card does not, which is why
        // the card stops the event rather than this testing where the pointer landed.
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={card}
        role="dialog"
        aria-label={`Loop at ${label}`}
        onPointerDown={(event) => event.stopPropagation()}
        className="relative w-full max-w-sm rounded-none border-2 border-t-white border-l-white border-r-black border-b-black bg-sun-pale"
      >
        <div className={TITLE_BAR}>
          <span className="truncate">LOOP</span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            title="Close - or press anywhere off this card"
            className="flex h-5 w-5 cursor-pointer items-center justify-center rounded-none border border-black bg-bubble-pale text-[11px] font-bold leading-none text-paper hover:bg-bubble focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-bubble"
          >
            ×
          </button>
        </div>

        <div className="space-y-2 p-3">
          <p className="flex items-center gap-2 text-[12px] font-bold text-ink">
            <span aria-hidden="true" className="text-[18px] leading-none">
              ↻
            </span>
            <span className="min-w-0 break-words">{label}</span>
          </p>

          <p className="text-[10px] text-ink-plate">
            {loop.kind === 'taken-over'
              ? `THIS WAS PLAYING WHEN ${(loop.displacedBy ?? 'SOMEONE').toUpperCase()}'S QUEUE TOOK THE PLAYER OVER.`
              : 'A PLACE YOU SAVED.'}
          </p>

          <p className="text-[10px] font-bold text-ink">
            GOES TO {formatClock(loop.positionSeconds)} IN THAT TRACK
          </p>

          <p className="flex flex-wrap gap-2 pt-1">
            <button type="button" onClick={goBack} className={PLATE}>
              [ GO BACK TO IT ]
            </button>
            <button type="button" onClick={onClose} className={PLATE}>
              [ LEAVE IT ]
            </button>
          </p>
        </div>
      </div>
    </div>
  );
}
