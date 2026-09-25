'use client';

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { TITLE_BAR_INACTIVE } from '../lib/ui/controls';
import { formatClock } from '../lib/audio/format';
import {
  CAPTION_DELAY_MS,
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
 * RADI-OH: everything you have been listening to lately, as **icons you press to jump back in**.
 *
 * A quick access grid, like the recent files a desktop keeps: one icon per track, newest first, each one
 * returning you to where you actually were in it rather than to its beginning. Anything that plays lands
 * here - a file off the archive, somebody's profile song, a track heard by following a queue.
 *
 * **An icon is only an icon.** The resting cell is the glyph and nothing else: no title, no clock, no
 * origin line. That is the whole point of a quick-access grid - many things at once, recognisable at a
 * glance - and a cell carrying four lines of text is a list wearing a grid's clothes. Everything the grid
 * withholds is said in one of two places:
 *
 *   - **a caption on hover.** Pointing at an icon lights it and grows it immediately; after
 *     `CAPTION_DELAY_MS` of *staying* there, a half-opacity caption says where the track came from. Half
 *     opacity because it is an annotation rather than a control - the reader is still pointing at the
 *     icon, and a solid box would read as a dialogue they have to dismiss.
 *   - **the pop-out, on a press.** `LoopPopout` is where the whole entry is: the title, the origin, the
 *     position, and the two things you can do with it.
 *
 * **The delay is not decoration.** A caption that appeared instantly would flash under the pointer on
 * every sweep across the grid, and a reader crossing four icons would see four captions strobe. A second
 * is long enough that only a deliberate stop earns one.
 *
 * The X is per icon, as the brief asks, and it is a real button: labelled with the track, reachable by
 * keyboard, and it stops its own events so a press aimed at the X never opens the entry instead.
 */
export default function RadioLoops() {
  const loops = useSyncExternalStore(subscribeToLoops, loopState, loopServerState);
  const player = useMusicPlayer();
  const [open, setOpen] = useState<LoopSource | null>(null);
  const [caption, setCaption] = useState<LoopSource | null>(null);

  /**
   * The caption's timer, held in a ref so a sweep across the grid cancels cleanly.
   *
   * A `setTimeout` per icon rather than one shared timer: the pointer entering a second icon has to
   * cancel the first icon's pending caption, or a fast sweep leaves captions appearing behind the
   * pointer. Clearing on every enter and leave is what makes "a second of *staying* there" true.
   */
  const pending = useRef<number | null>(null);

  const clearPending = useCallback(() => {
    if (pending.current !== null) {
      window.clearTimeout(pending.current);
      pending.current = null;
    }
  }, []);

  const startCaption = useCallback(
    (loop: LoopSource) => {
      clearPending();
      pending.current = window.setTimeout(() => setCaption(loop), CAPTION_DELAY_MS);
    },
    [clearPending],
  );

  const stopCaption = useCallback(() => {
    clearPending();
    setCaption(null);
  }, [clearPending]);

  // Nothing may be left pending when the window goes: a timer that fires after the grid has unmounted
  // would call `setState` on a component that is gone.
  useEffect(() => clearPending, [clearPending]);

  return (
    <section className="rounded-none border-2 border-t-white border-l-white border-r-black border-b-black bg-sun-pale">
      <div className={TITLE_BAR_INACTIVE}>
        <span>RADI-OH // WHERE YOU WERE</span>
        <span>[ {loops.length} ]</span>
      </div>

      <p className="border-b border-ink px-2 py-1 text-[10px] text-ink-plate">
        EVERYTHING YOU HAD ON, NEWEST FIRST. POINT AT AN ICON TO SEE WHERE YOU GOT IT FROM, AND PRESS IT
        TO GO BACK TO WHERE YOU WERE IN IT.
      </p>

      {loops.length === 0 ? (
        <p className="p-3 text-[11px] font-bold text-ink">
          NOTHING HERE YET. PUT SOMETHING ON - FROM THE ARCHIVE, OR SOMEBODY&apos;S PROFILE - AND IT WILL
          APPEAR, KEEPING YOUR PLACE.
        </p>
      ) : (
        <div className="p-2">
          <div className="grid grid-cols-4 gap-2 sm:grid-cols-6 lg:grid-cols-8">
            {loops.map((loop) => (
              <LoopIcon
                key={loop.id}
                loop={loop}
                label={loopLabel(loop, player.queue)}
                caption={caption === null ? null : caption.id === loop.id ? caption : null}
                onEnter={() => startCaption(loop)}
                onLeave={stopCaption}
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
/**
 * One icon in the grid: the glyph, its X, and - after a second of pointing - the caption.
 *
 * **Everything the entry knows is out of flow.** The resting cell is a square holding one glyph, and the
 * caption sits *inside* that square as an absolutely positioned annotation rather than being laid out
 * beside the icon. That is the first of the two legal reveal shapes (`AGENTS.md`, "Reveals take their
 * space in both states"): an out-of-flow box cannot push its siblings, so a caption appearing under one
 * icon in an eight-wide grid moves nothing at all. This is the shape `Temp/check-reveals.cjs` exists to
 * police, and it is why the caption is `absolute` rather than another child of the button.
 *
 * **The grow is not a layout change either.** `scale` is a transform, so a lit icon stays in its cell and
 * its neighbours stay where they are - the same reason the plate's wobble is safe.
 *
 * **Reduced motion keeps the caption and drops the movement.** The site's rule is that the animations go
 * quiet when the reader has asked for that; a *delay* is not an animation, so the caption still arrives,
 * after the same second. Turning the caption off as well would take information away rather than calm it -
 * and a reader who cannot use a pointer would then have no way to see where an entry came from at all.
 */
function LoopIcon({
  loop,
  label,
  caption,
  onEnter,
  onLeave,
  onOpen,
  onClear,
}: {
  loop: LoopSource;
  label: string;
  /** The entry to caption, or null - the parent owns which one is showing so only one can be. */
  caption: LoopSource | null;
  onEnter: () => void;
  onLeave: () => void;
  onOpen: () => void;
  onClear: () => void;
}) {
  const [overX, setOverX] = useState(false);
  const takenOver = loop.kind === 'taken-over';

  return (
    <div className="relative">
      {/* `group` so the glyph and the caption can both answer the pointer. The glyph is the whole of the
          resting cell: an icon-sized button with nothing in it but the mark and an accessible name. */}
      <button
        type="button"
        onClick={onOpen}
        onPointerEnter={onEnter}
        onPointerLeave={onLeave}
        onFocus={onEnter}
        onBlur={onLeave}
        aria-label={`${label} - press to go back to where you were in it`}
        title={label}
        className="group flex aspect-square w-full cursor-pointer items-center justify-center rounded-none border-t border-l border-white border-r-2 border-b-2 border-black bg-sun text-ink-plate hover:bg-ice focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-bubble"
      >
        <span
          aria-hidden="true"
          className="text-[26px] leading-none text-ink group-hover:animate-wobble group-hover:text-ena motion-reduce:group-hover:animate-none"
        >
          {originMark(loop.origin)}
        </span>
      </button>

      {/* The X: on the icon's corner, and growing *away* from it when pointed at. The two targets touch,
          so the movement is what makes "I mean the X" aimable - without it the X is just part of the
          icon the reader is already pointing at. */}
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
        aria-label={`Clear ${label} from your recent listening`}
        title="Clear this one"
        className={`absolute -right-1 -top-1 flex h-5 w-5 cursor-pointer items-center justify-center rounded-none border border-black bg-bubble-pale text-[11px] font-bold leading-none text-paper hover:bg-bubble focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-bubble motion-reduce:transition-none ${
          overX ? 'origin-bottom-left translate-x-1 -translate-y-1 scale-[1.6]' : ''
        }`}
        style={{ transition: 'transform 90ms steps(2, jump-none)' }}
      >
        ×
      </button>

      {/* The caption. Out of flow, so it cannot move the cell or the row - and half-opacity, because it is
          an annotation on a control the reader is still pointing at rather than a thing to dismiss. */}
      {caption === null ? null : (
        <div
          data-caption="loop"
          className="pointer-events-none absolute inset-x-0 top-full z-10 mt-1 rounded-none border border-black bg-sun-pale p-1 opacity-60"
        >
          <p className="line-clamp-2 break-words text-[9px] font-bold leading-tight text-ink">{label}</p>
          <p className={`text-[9px] leading-tight ${takenOver ? 'text-bubble-pale' : 'text-ink'}`}>
            {originLabel(loop)}
          </p>
          <p className="text-[9px] leading-tight text-ink">
            {formatClock(loop.positionSeconds)}
            {loop.plays > 1 ? ` :: ${loop.plays}x` : ''}
          </p>
        </div>
      )}
    </div>
  );
}
