'use client';

import { useState, useSyncExternalStore } from 'react';
import { TITLE_BAR_INACTIVE } from '../lib/ui/controls';
import { formatClock } from '../lib/audio/format';
import {
  clearAllLoops,
  clearLoop,
  loopLabel,
  loopServerState,
  loopState,
  subscribeToLoops,
  type LoopSource,
} from '../lib/audio/loops';
import { useMusicPlayer } from './MusicPlayerProvider';
import LoopPopout from './LoopPopout';

/**
 * RADI-OH: where you have been, kept as loops you can return to.
 *
 * A loop is a *place* - a track and a second - rather than a track, which is the distinction the whole
 * tab rests on: the shelf already plays a song from the beginning, and this is for coming back to the
 * bar you were on, or to the point somebody else's queue had reached before you followed it.
 *
 * **The tab earns its name through the queue window's other half.** Following a queue takes the shared
 * player over, so whatever you were listening to stops. That is not a loss, because it lands here first
 * as a loop - so the row that reads `TAKEN OVER BY <name>` is the tab doing its job rather than a
 * decoration. See `app/lib/audio/loops.ts` for the contract in full.
 *
 * The grid is a shelf of plates rather than a list, and that is a layout decision worth stating: a loop
 * is a thing you press to *go back*, so the plates are big enough to hit and laid out so several fit
 * across - which is what "wide on a desktop" means for this screen.
 */
export default function RadioLoops() {
  const loops = useSyncExternalStore(subscribeToLoops, loopState, loopServerState);
  const player = useMusicPlayer();
  const [open, setOpen] = useState<LoopSource | null>(null);

  return (
    <section className="rounded-none border-2 border-t-white border-l-white border-r-black border-b-black bg-sun-pale">
      <div className={TITLE_BAR_INACTIVE}>
        <span>RADI-OH // WHERE YOU WERE</span>
        <span>[ {loops.length} ]</span>
      </div>

      <p className="border-b border-ink px-2 py-1 text-[10px] text-ink-plate">
        A LOOP IS A PLACE IN A TRACK, NOT A TRACK. FOLLOWING SOMEBODY&apos;S QUEUE PUTS WHAT YOU WERE
        LISTENING TO HERE FIRST, SO YOU CAN ALWAYS GET BACK TO IT.
      </p>

      {loops.length === 0 ? (
        <p className="p-3 text-[11px] font-bold text-ink">
          NOTHING SAVED YET. FOLLOW SOMEBODY&apos;S QUEUE IN THE QUEUES TAB AND WHATEVER YOU WERE
          LISTENING TO WILL BE KEPT HERE.
        </p>
      ) : (
        <div className="p-2">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
            {loops.map((loop) => (
              <LoopPlate
                key={loop.id}
                loop={loop}
                label={loopLabel(loop, player.queue)}
                onOpen={() => setOpen(loop)}
                onClear={() => clearLoop(loop.id)}
              />
            ))}
          </div>

          <p className="mt-2 text-right">
            <button
              type="button"
              onClick={clearAllLoops}
              className="cursor-pointer rounded-none border-t border-l border-white border-r-2 border-b-2 border-black bg-sun-pale px-2 py-[2px] text-[10px] font-bold text-ink hover:bg-ice"
            >
              [ CLEAR ALL ]
            </button>
          </p>
        </div>
      )}

      {open === null ? null : (
        <LoopPopout loop={open} label={loopLabel(open, player.queue)} onClose={() => setOpen(null)} />
      )}
    </section>
  );
}

/**
 * One loop: a plate you press to play it again, with a red X in its corner to forget it.
 *
 * The hover behaviour is two effects rather than one, because they say two different things:
 *
 *   - **the plate wiggles left to right** while you are over it - the site's own `wobble`, which is
 *     `steps(2)`, so it moves in whole pixel frames rather than sliding. A loop is a thing that goes
 *     round, so a returning wobble is the honest animation for it.
 *   - **the X grows *and moves away from the plate*, up and to the right**, when you are over the X
 *     itself. That is the half that matters: the two targets touch, and without the movement the X would
 *     be just another part of the plate you are already pointing at. Moving it out from under the plate,
 *     while staying tight against it, is what makes "I mean the X" something you can aim.
 *
 * The X is a *real* button, not a decorative corner: it is labelled per loop, reachable by keyboard, and
 * it stops its own `pointerdown` and `click` from reaching the plate underneath. A press that both
 * played the loop and deleted it would be the worst possible outcome of a mis-aim.
 */
function LoopPlate({
  loop,
  label,
  onOpen,
  onClear,
}: {
  loop: LoopSource;
  label: string;
  onOpen: () => void;
  onClear: () => void;
}) {
  const [overX, setOverX] = useState(false);
  const takenOver = loop.kind === 'taken-over';

  return (
    <div className="relative">
      <button
        type="button"
        onClick={onOpen}
        title={`${label} - press to play it again`}
        className="flex w-full cursor-pointer flex-col gap-1 rounded-none border-t border-l border-white border-r-2 border-b-2 border-black bg-sun p-2 text-left text-[10px] font-bold text-ink-plate hover:animate-wobble hover:bg-ice focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-bubble"
      >
        <span aria-hidden="true" className="text-[20px] leading-none text-ink">
          ↻
        </span>

        <span className="line-clamp-2 min-w-0 break-words">{label}</span>

        <span className={`text-[9px] ${takenOver ? 'text-bubble-pale' : 'text-ink'}`}>
          {takenOver ? `TAKEN OVER BY ${(loop.displacedBy ?? 'SOMEONE').toUpperCase()}` : 'YOU WERE HERE'}
        </span>

        <span className="text-[9px] text-ink">{formatClock(loop.positionSeconds)}</span>
      </button>

      {/* Just outside the bevel, so its growth has somewhere to go without covering the loop mark. */}
      <button
        type="button"
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
          onClear();
        }}
        onPointerEnter={() => setOverX(true)}
        onPointerLeave={() => setOverX(false)}
        onFocus={() => setOverX(true)}
        onBlur={() => setOverX(false)}
        aria-label={`Clear the loop at ${label}`}
        title="Clear this loop"
        className={`absolute -right-1 -top-1 flex h-5 w-5 cursor-pointer items-center justify-center rounded-none border border-black bg-bubble-pale text-[11px] font-bold leading-none text-paper hover:bg-bubble focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-bubble ${
          overX ? 'origin-bottom-left translate-x-1 -translate-y-1 scale-[1.6]' : ''
        }`}
        style={{ transition: 'transform 90ms steps(2, jump-none)' }}
      >
        ×
      </button>
    </div>
  );
}
