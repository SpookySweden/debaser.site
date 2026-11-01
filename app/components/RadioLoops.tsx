'use client';

import { useState, useSyncExternalStore } from 'react';
import { TITLE_BAR_INACTIVE } from '../lib/ui/controls';
import {
  clearAllLoops,
  clearLoop,
  loopFace,
  loopLabel,
  loopNotes,
  loopServerState,
  loopState,
  originWhereLabel,
  subscribeToLoops,
  type LoopMood,
  type LoopSource,
} from '../lib/audio/loops';
import { lengthSeconds, trackContext } from '../lib/audio/track-context';
import { useMusicPlayer } from './MusicPlayerProvider';
import LoopPopout from './LoopPopout';
import TrackDetails from './TrackDetails';

/**
 * RADI-OH: everything you have been listening to lately, as **faces you press to jump back in**.
 *
 * A quick access grid, like the recent files a desktop keeps: up to `MAX_LOOPS` faces, newest first, each
 * one returning you to where you actually were in it rather than to its beginning. Anything that plays
 * lands here - a file from the music window, somebody's profile song, a track heard by following a queue.
 *
 * **A face is only a face.** The resting cell is a text-character face and nothing else (`loopFace`): its
 * frame says where the track came from (headphones, a picture frame, radio waves) and its expression
 * answers the pointer - it perks up and hops when pointed at, winces when pressed, panics when the pointer
 * is on its X, and sings while its track is the one playing.
 *
 * **What a face withholds is said in the details strip**, left of `[ CLEAR ALL ]`: the uploader's picture,
 * what it was heard as part of, its name, and where you were in it out of its length (`TrackDetails`, the
 * same block the player bar uses). It replaced a floating caption that waited a second and then covered
 * the window's foot. The strip is always there and always the same size, so pointing at a face can answer
 * at once without anything moving; it keeps showing the last face pointed at, so the reader can move
 * across to its globe link, and before anything is pointed at it shows what is playing, or the newest.
 */
export default function RadioLoops() {
  const loops = useSyncExternalStore(subscribeToLoops, loopState, loopServerState);
  const player = useMusicPlayer();
  const [open, setOpen] = useState<LoopSource | null>(null);
  const [pointedId, setPointedId] = useState<string | null>(null);

  const playingSrc = player.track?.src;
  const shown =
    loops.find((loop) => loop.id === pointedId) ??
    loops.find((loop) => loop.trackId === playingSrc) ??
    loops[0];

  return (
    <section>
      {/* How the faces work is the title line's tip rather than a paragraph under it, and the count is
          gone - the faces are right there to be counted (SPEC-efficiency.md). */}
      <div className={TITLE_BAR_INACTIVE}>
        <span title="Recently played. Press a face to resume.">RADI-OH</span>
      </div>

      {loops.length === 0 ? (
        <p className="p-3 text-key font-bold text-ink">
          NOTHING PLAYED YET.
        </p>
      ) : (
        <div className="p-2">
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {loops.map((loop) => (
              <LoopIcon
                key={loop.id}
                loop={loop}
                label={loopLabel(loop, player.queue)}
                singing={player.playing && playingSrc === loop.trackId}
                onPoint={() => setPointedId(loop.id)}
                onOpen={() => setOpen(loop)}
                onClear={() => clearLoop(loop.id)}
              />
            ))}
          </div>

          <div className="mt-2 flex items-end gap-2 border-t border-dotted border-ink pt-2">
            <div className="min-w-0 flex-1" data-details="loop">
              {shown === undefined ? null : <LoopDetails loop={shown} />}
            </div>

            <button
              type="button"
              onClick={clearAllLoops}
              className="shrink-0 cursor-pointer key px-1 py-1 text-label font-bold max-sm:min-h-tap"
            >
              [ CLEAR ALL ]
            </button>
          </div>
        </div>
      )}

      {open === null ? null : (
        <LoopPopout
          loop={open}
          label={loopLabel(open, player.queue)}
          onRemove={() => {
            clearLoop(open.id);
            setOpen(null);
          }}
          onClose={() => setOpen(null)}
        />
      )}
    </section>
  );
}

/**
 * One entry, in the shared details format.
 *
 * The entry playing right now reads the player's live clock and the file's real length; any other reads
 * where you left it and the length the shelf filed for it. A displaced track says who displaced it in
 * the context line when nothing else was recorded, because that is the most useful thing to know about it.
 */
function LoopDetails({ loop }: { loop: LoopSource }) {
  const player = useMusicPlayer();
  const track = player.queue.find((entry) => entry.src === loop.trackId);
  const live = player.track?.src === loop.trackId;

  const recorded =
    loop.originContext ??
    (loop.kind === 'taken-over' ? `TAKEN OVER BY ${(loop.displacedBy ?? 'SOMEONE').toUpperCase()}` : undefined);

  return (
    <TrackDetails
      tone="field"
      src={loop.trackId}
      context={trackContext(recorded, track?.folderPath)}
      title={loopLabel(loop, player.queue)}
      position={live ? player.elapsed : loop.positionSeconds}
      length={
        live && Number.isFinite(player.duration)
          ? player.duration
          : (loop.lengthSeconds ?? lengthSeconds(track?.length))
      }
      href={loop.originHref}
      where={originWhereLabel(loop)}
      extra={loop.plays > 1 ? <span className="shrink-0">PLAYED {loop.plays}x ::</span> : undefined}
    />
  );
}

/**
 * Each mood's ink. There is no tile: the face sits straight on the window's field, because a box around
 * it fenced the hop in and read as a button wearing a face rather than a face (the owner's call,
 * 2026-10-12). So the inks are the two that read on the field in *both* themes - the field's own ink
 * (Black, or White in the dark theme) and the brand ink (Royal Blue, or Flavine in the dark theme) - and
 * the mood is carried by the expression and the movement more than by colour.
 */
const MOOD_INK: Record<LoopMood, string> = {
  rest: 'text-ink',
  hover: 'text-accent-ink',
  press: 'text-accent-ink',
  scared: 'text-ink',
  playing: 'text-accent-ink',
};

/**
 * One face, and its X.
 *
 * **The face is the button.** No plate, no padded box: the X hangs off the face's corner, which is what
 * makes the two read as one control with a delete key on it. Pointing at it (or reaching it with the
 * keyboard) tells the strip to show it.
 */
function LoopIcon({
  loop,
  label,
  singing,
  onPoint,
  onOpen,
  onClear,
}: {
  loop: LoopSource;
  label: string;
  /** True while this entry's track is the one playing - the face sings. */
  singing: boolean;
  /** This face is being pointed at, so the details strip should show it. */
  onPoint: () => void;
  onOpen: () => void;
  onClear: () => void;
}) {
  const [overX, setOverX] = useState(false);
  const [pointed, setPointed] = useState(false);
  const [pressed, setPressed] = useState(false);

  const takenOver = loop.kind === 'taken-over';

  /** One expression at a time, the most urgent first: the X beats a press beats a point beats a song. */
  const mood: LoopMood = overX ? 'scared' : pressed ? 'press' : pointed ? 'hover' : singing ? 'playing' : 'rest';
  const notes = loopNotes(mood);
  const ink = MOOD_INK[mood];

  return (
    <div className="relative w-fit" onPointerEnter={onPoint}>
      {/* The notes line: what floats over the face. Absolutely placed in the top of the button, whose
          height reserves it, so notes arriving never push the face or a neighbour. */}
      <span
        aria-hidden="true"
        className={`pointer-events-none absolute inset-x-0 top-[3px] z-10 text-center text-label font-bold leading-none ${ink} ${
          mood === 'playing' ? 'animate-blip' : mood === 'hover' ? 'animate-hop' : ''
        }`}
      >
        {notes}
      </span>

      <button
        type="button"
        onClick={onOpen}
        onFocus={(event) => {
          // The keyboard's own pointing: a click also focuses, so only a visible focus counts, or a
          // mouse press would leave the face perked up after the pointer had gone (CLAUDE.md).
          if (event.currentTarget.matches(':focus-visible')) {
            setPointed(true);
            onPoint();
          }
        }}
        onBlur={() => setPointed(false)}
        onPointerEnter={() => setPointed(true)}
        onPointerLeave={() => {
          setPointed(false);
          setPressed(false);
        }}
        onPointerDown={() => setPressed(true)}
        onPointerUp={() => setPressed(false)}
        aria-label={`Resume ${label}`}
        className="group flex h-tap cursor-pointer items-end justify-center rounded-none px-1 pb-1.25 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-bubble"
      >
        <span
          aria-hidden="true"
          className={`whitespace-pre font-emote text-prose font-bold leading-none tracking-tighter ${ink} ${
            mood === 'hover' ? 'animate-hop' : mood === 'scared' ? 'animate-shake' : mood === 'press' ? 'translate-y-0.5' : ''
          }`}
        >
          {loopFace(loop.origin, mood, takenOver)}
        </span>
      </button>

      {/* The X, on the face's corner since the face is the button. It grows away from the mark when
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
        aria-label={`Remove ${label}`}
        className={`absolute -right-3 top-[5px] flex h-4 w-4 cursor-pointer items-center justify-center rounded-none border border-ink-plate bg-bubble-pale text-label font-bold leading-none text-ink-bar hover:bg-bubble hover:text-ink-plate focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-bubble motion-reduce:transition-none ${
          overX ? 'origin-bottom-left translate-x-1 -translate-y-1 scale-150' : ''
        }`}
        style={{ transition: 'transform 90ms steps(2, jump-none)' }}
      >
        ×
      </button>
    </div>
  );
}
