'use client';

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { TITLE_BAR_INACTIVE } from '../lib/ui/controls';
import { formatClock } from '../lib/audio/format';
import {
  CAPTION_DELAY_MS,
  GLOBE,
  clearAllLoops,
  clearLoop,
  loopLabel,
  loopServerState,
  loopState,
  originInk,
  originLabel,
  originMark,
  originWhereLabel,
  subscribeToLoops,
  type LoopSource,
} from '../lib/audio/loops';
import { useMusicPlayer } from './MusicPlayerProvider';
import LoopPopout from './LoopPopout';

/**
 * RADI-OH: everything you have been listening to lately, as **icons you press to jump back in**.
 *
 * A quick access grid, like the recent files a desktop keeps: up to `MAX_LOOPS` icons, newest first, each
 * one returning you to where you actually were in it rather than to its beginning. Anything that plays
 * lands here - a file from the music window, somebody's profile song, a track heard by following a queue.
 *
 * **An icon is only an icon.** The resting cell is the glyph and nothing else, and the glyph *is* the
 * button: there is no plate around it. A cell carrying a title, a clock and an origin line is a list
 * wearing a grid's clothes, which is what this was before the brief corrected it.
 *
 * What the grid withholds is said in two places:
 *
 *   - **the caption, on hover.** Pointing at an icon lights it immediately; after `CAPTION_DELAY_MS` of
 *     staying there, a caption appears carrying the title, where it came from, the position, the play
 *     count, and a globe link to the place the reader first started it from.
 *   - **the pop-out, on a press.** `LoopPopout` is the fuller card, for the two things you can do with an
 *     entry rather than for reading it.
 *
 * **The caption is positioned `fixed`, from the icon's own rectangle, and that is not a style choice.** It
 * lives inside `DockWindow`'s `overflow-y-auto` scroller, and an absolutely positioned box *cannot escape a
 * scrolling ancestor* - which is why the first attempt at this was clipped by the window's foot and had to
 * be rewritten. `position: fixed` takes the box out of that clip, and measuring the icon is what keeps it
 * beside the right one. It also means the caption must be re-measured on scroll and on resize, or it
 * detaches from its icon the moment the reader moves the window's contents.
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
        EVERYTHING YOU HAD ON, NEWEST FIRST - UP TO 30. POINT AT AN ICON TO SEE WHERE YOU GOT IT FROM, AND
        PRESS IT TO GO BACK TO WHERE YOU WERE IN IT.
      </p>

      {loops.length === 0 ? (
        <p className="p-3 text-[11px] font-bold text-ink">
          NOTHING HERE YET. PUT SOMETHING ON - FROM THE MUSIC WINDOW, OR SOMEBODY&apos;S PROFILE - AND IT
          WILL APPEAR, KEEPING YOUR PLACE.
        </p>
      ) : (
        <div className="p-2">
          <div className="grid grid-cols-5 gap-2 sm:grid-cols-7 lg:grid-cols-10">
            {loops.map((loop) => (
              <LoopIcon
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
 * One icon: the glyph, its X, and - after a second of pointing - the caption.
 *
 * **The glyph is the button.** No plate, no padded box: the mark sits on the site's own bevel and the cell
 * is only as big as the mark needs. The X hangs off that mark's corner rather than off a larger box, which
 * is what makes the two read as one control with a delete key on it.
 *
 * **The caption is `fixed`, measured from the icon.** `absolute` cannot escape `DockWindow`'s
 * `overflow-y-auto`, so the first attempt was clipped by the window's foot; `fixed` is outside that clip.
 * The cost is that the position has to be maintained - the icon's rectangle changes when the window
 * scrolls, when the reader drags it, and when the viewport resizes - so all three are listened for while a
 * caption is up. The rectangle is read in the handlers rather than in render, because a layout read during
 * render is what makes a component jitter.
 */
function LoopIcon({
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
  const [spot, setSpot] = useState<{ left: number; top: number } | null>(null);
  const icon = useRef<HTMLDivElement | null>(null);
  const timer = useRef<number | null>(null);

  const takenOver = loop.kind === 'taken-over';
  const where = originWhereLabel(loop);

  /** Puts the caption just under the icon, clamped so it cannot run off either side of the screen. */
  const place = useCallback(() => {
    const box = icon.current?.getBoundingClientRect();
    if (box === undefined) return;

    const width = Math.min(240, window.innerWidth - 16);
    const left = Math.min(Math.max(box.left, 8), Math.max(8, window.innerWidth - width - 8));

    setSpot({ left, top: box.bottom + 4 });
  }, []);

  const start = useCallback(() => {
    if (timer.current !== null) window.clearTimeout(timer.current);

    timer.current = window.setTimeout(place, CAPTION_DELAY_MS);
  }, [place]);

  const stop = useCallback(() => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }

    setSpot(null);
  }, []);

  // A caption that is up has to follow its icon. Scrolling the window, dragging it and resizing the
  // viewport all move the icon, and a fixed box that is not re-measured simply drifts away from it.
  useEffect(() => {
    if (spot === null) return;

    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);

    return () => {
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
    };
  }, [place, spot]);

  // Nothing may be left pending when the grid goes: a timer that fired after unmount would set state on a
  // component that is gone.
  useEffect(() => stop, [stop]);

  return (
    // `onPointerMove` restarts the timer for the same reason `onPointerEnter` does: the caption is `fixed`,
    // so it sits outside this box's hit area, and a pointer travelling from the mark toward the globe would
    // otherwise read as a leave and take the caption away before it could be pressed.
    <div ref={icon} className="relative" onPointerEnter={start} onPointerMove={start} onPointerLeave={stop}>
      <button
        type="button"
        onClick={onOpen}
        onFocus={start}
        onBlur={stop}
        aria-label={`${label} - press to go back to where you were in it`}
        className="group flex w-full cursor-pointer items-center justify-center rounded-none border-t border-l border-white border-r-2 border-b-2 border-black bg-sun py-1 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-bubble"
      >
        <span
          aria-hidden="true"
          className={`text-[22px] leading-none group-hover:animate-wobble motion-reduce:group-hover:animate-none ${originInk(loop.origin)}`}
        >
          {originMark(loop.origin)}
        </span>
      </button>

      {/* The X, on the *icon's* corner since the icon is the button now. It grows away from the mark when
          pointed at, because the two targets touch and the movement is what makes "I mean the X" aimable. */}
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
        className={`absolute -right-1 -top-1 flex h-4 w-4 cursor-pointer items-center justify-center rounded-none border border-black bg-bubble-pale text-[10px] font-bold leading-none text-paper hover:bg-bubble focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-bubble motion-reduce:transition-none ${
          overX ? 'origin-bottom-left translate-x-1 -translate-y-1 scale-150' : ''
        }`}
        style={{ transition: 'transform 90ms steps(2, jump-none)' }}
      >
        Ã—
      </button>

      {spot === null ? null : (
        <div
          data-caption="loop"
          style={{ left: spot.left, top: spot.top }}
          onPointerEnter={start}
          onPointerLeave={stop}
          className="fixed z-[130] w-[min(15rem,calc(100vw-1rem))] rounded-none border-2 border-t-white border-l-white border-r-black border-b-black bg-sun-pale p-1 opacity-60"
        >
          <p className="line-clamp-2 break-words text-[10px] font-bold leading-tight text-ink">{label}</p>
          <p className={`text-[9px] leading-tight ${takenOver ? 'text-bubble-pale' : 'text-ink'}`}>
            {originLabel(loop)}
          </p>
          <p className="text-[9px] leading-tight text-ink">
            {formatClock(loop.positionSeconds)}
            {loop.plays > 1 ? ` :: PLAYED ${loop.plays}x` : ''}
          </p>

          {/* The globe: a real link, and only when there is somewhere true to go. An entry with no recorded
              source draws nothing here rather than a link to a guess. */}
          {where === null ? null : (
            <a
              href={loop.originHref}
              title={where}
              className="mt-[2px] flex items-center gap-1 text-[9px] font-bold leading-tight text-ena underline underline-offset-2 hover:text-bubble-pale"
            >
              <span aria-hidden="true">{GLOBE}</span>
              {where}
            </a>
          )}
        </div>
      )}
    </div>
  );
}
