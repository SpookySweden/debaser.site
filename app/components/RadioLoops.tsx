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
  originLabel,
  originMark,
  subscribeToLoops,
  type LoopSource,
} from '../lib/audio/loops';
import { useMusicPlayer } from './MusicPlayerProvider';
import LoopPopout from './LoopPopout';

/**
 * RADI-OH: everything you have been listening to lately, as icons you press to jump back in.
 *
 * A **quick access** grid, like the recent files a desktop keeps: one plate per track, newest first, each
 * one returning you to where you actually were in it rather than to its beginning. Anything that plays
 * lands here - a file off the archive, somebody's profile song, a track heard by following a queue.
 *
 * **Two things share this grid, and the icons say which.** The player writes your own listening as you go
 * (`rememberPlay`, on a sampling interval); the queue window writes a `taken-over` loop whenever following
 * somebody displaces what you had on. The second is the contract the tab was built for - `queue`
 * displaces, `radio` remembers - and it is why a plate can read `TAKEN OVER BY <name>` instead of a source.
 *
 * The grid is plates rather than a list, and that is a layout decision worth stating: these are things you
 * press to *go back*, so they are big enough to hit and several fit across a wide window - which is what
 * "quick access" means once it is drawn rather than described.
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
        EVERYTHING YOU HAD ON, NEWEST FIRST. PRESS ONE TO GO BACK TO WHERE YOU WERE IN IT - A FILE FROM THE
        ARCHIVE, SOMEBODY&apos;S PROFILE SONG, OR WHAT A QUEUE DISPLACED.
      </p>

      {loops.length === 0 ? (
        <p className="p-3 text-[11px] font-bold text-ink">
          NOTHING HERE YET. PUT SOMETHING ON - FROM THE ARCHIVE, OR SOMEBODY&apos;S PROFILE - AND IT WILL
          APPEAR, KEEPING YOUR PLACE.
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
        {/* The icon: a glyph, because the asset rules forbid drawing one - and it is the *kind* of thing
            rather than the thing, so a profile's song is tellable from an archive file at a glance. */}
        <span aria-hidden="true" className="text-[20px] leading-none text-ink">
          {originMark(loop.origin)}
        </span>

        <span className="line-clamp-2 min-w-0 break-words">{label}</span>

        <span className={`text-[9px] ${takenOver ? 'text-bubble-pale' : 'text-ink'}`}>{originLabel(loop)}</span>

        <span className="text-[9px] text-ink">
          {formatClock(loop.positionSeconds)}
          {loop.plays > 1 ? ` :: ${loop.plays}x` : ''}
        </span>
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
