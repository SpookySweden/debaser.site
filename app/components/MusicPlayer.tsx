'use client';

import { useState, useSyncExternalStore } from 'react';
import { formatClock, formatClockOrNothing } from '../lib/audio/format';
import { trackCaption } from '../lib/audio/tracks';
import { useMusicPlayer } from './MusicPlayerProvider';
import PopoutWindow from './PopoutWindow';

/**
 * The station: a Win95 bar pinned to the bottom of every page.
 *
 * It is the face of `MusicPlayerProvider`, which owns the audio element up in
 * `app/layout.tsx` - so the bar can be drawn, hidden and re-drawn by any page without
 * the music ever noticing. Nothing here starts playing by itself: browsers require a
 * gesture, so the bar opens on a loaded track with `[ ▶ ]` waiting to be pressed.
 *
 * Left to right: the shelf badge, the LED display (track, running time, where it came
 * from), the transport, the volume slider, the loop switch and the shelf list.
 * `[ HIDE ]` folds the whole thing down to one button in the corner; the choice is
 * remembered.
 */

const BUTTON =
  'cursor-pointer rounded-none border-t border-l border-white border-r-2 border-b-2 border-black bg-[#c0c0c0] px-2 py-[2px] text-[10px] font-bold text-black hover:bg-gray-300 disabled:cursor-wait disabled:opacity-60';

/** Where the bar remembers whether it is folded down. */
const BAR_KEY = 'debaser.audio.bar.v1';

/**
 * Whether the bar is open, read the way the side panel reads its own setting.
 *
 * A tiny external store rather than state in an effect: the server renders the bar
 * open, the browser swaps in what it remembered, and React never renders a component
 * twice to find that out (see ./DesktopSidebar.tsx, which does the same for the panel).
 */
const listeners = new Set<() => void>();

function readStoredOpen(): boolean {
  try {
    return window.localStorage.getItem(BAR_KEY) !== 'closed';
  } catch {
    // No storage (private mode, blocked cookies): the bar just starts open.
    return true;
  }
}

let barOpen = typeof window === 'undefined' ? true : readStoredOpen();

function subscribeBar(listener: () => void): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

function getBarSnapshot(): boolean {
  return barOpen;
}

function getBarServerSnapshot(): boolean {
  return true;
}

function setBarOpen(next: boolean): void {
  barOpen = next;

  try {
    window.localStorage.setItem(BAR_KEY, next ? 'open' : 'closed');
  } catch {
    // Storage blocked: the bar still folds for this visit.
  }

  for (const listener of listeners) listener();
}

export default function MusicPlayer() {
  const player = useMusicPlayer();
  const open = useSyncExternalStore(subscribeBar, getBarSnapshot, getBarServerSnapshot);
  const [shelfOpen, setShelfOpen] = useState(false);

  const { track, playing, loading, error, elapsed, duration, volume, loop } = player;
  const progress = Number.isFinite(duration) && duration > 0 ? elapsed / duration : 0;

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setBarOpen(true)}
        title="Open the player"
        className={`fixed bottom-2 left-2 z-50 ${BUTTON}`}
      >
        ♪ {playing ? 'PLAYING' : 'PLAYER'}
      </button>
    );
  }

  return (
    <>
      <div className="fixed bottom-0 left-0 right-0 z-50 border-t-2 border-white bg-[#c0c0c0] px-2 py-1 font-mono text-black shadow-[0_-2px_0_#808080]">
        <div className="mx-auto flex max-w-[95vw] flex-wrap items-center gap-2">
          <span className="rounded-none border-t border-l border-white border-r-2 border-b-2 border-black bg-[#000080] px-2 py-[2px] text-[10px] font-bold text-white">
            ♪ DEBASER PLAYER
          </span>

          {/* The LED: a black inset panel, the way a shelf stereo reads out. */}
          <span className="min-w-0 flex-1 rounded-none border-2 border-t-gray-600 border-l-gray-600 border-r-white border-b-white bg-black px-2 py-1">
            <span className="flex flex-wrap items-baseline gap-x-2 text-[11px] font-bold text-[#33ff33]">
              <span className="truncate">
                {loading ? 'READING THE SHELF...' : (track?.title ?? 'NO TRACKS ON THE SHELF')}
              </span>
              <span className="shrink-0">
                {playing ? '▶' : '❚❚'} {formatClock(elapsed)} /{' '}
                {formatClockOrNothing(Number.isFinite(duration) ? duration : undefined)}
              </span>
            </span>
            <span className="mt-1 block truncate text-[9px] text-[#1f9f1f]">
              {error ?? trackCaption(track)}
              {loop ? ' :: LOOPING THIS ONE' : ''}
            </span>
            <span className="mt-1 block h-1 w-full bg-[#0b2b0b]">
              <span className="block h-1 bg-[#33ff33]" style={{ width: `${Math.round(progress * 100)}%` }} />
            </span>
          </span>

          <span className="flex items-center gap-1">
            <button type="button" onClick={player.previous} className={BUTTON} title="Previous track">
              [ ‹‹ ]
            </button>
            <button type="button" onClick={player.toggle} className={BUTTON} title={playing ? 'Pause' : 'Play'}>
              {playing ? '[ ❚❚ ]' : '[ ▶ ]'}
            </button>
            <button type="button" onClick={player.next} className={BUTTON} title="Next track">
              [ ›› ]
            </button>
          </span>

          <label className="flex items-center gap-1 text-[10px] font-bold text-black">
            VOL
            <input
              type="range"
              min={0}
              max={100}
              value={Math.round(volume * 100)}
              onChange={(event) => player.setVolume(Number(event.target.value) / 100)}
              className="h-4 w-20 cursor-pointer"
              style={{ accentColor: '#000080' }}
              aria-label="Volume"
            />
            <span className="w-7 text-right">{Math.round(volume * 100)}</span>
          </label>

          <button
            type="button"
            onClick={() => player.setLoop(!loop)}
            className={BUTTON}
            title="Repeat this track when it ends"
          >
            {loop ? '[ LOOP: ON ]' : '[ LOOP: OFF ]'}
          </button>

          <button type="button" onClick={() => setShelfOpen(true)} className={BUTTON}>
            [ SHELF ({player.queue.length}) ]
          </button>

          <button
            type="button"
            onClick={() => setBarOpen(false)}
            className={BUTTON}
            title="Fold the player away"
          >
            [ HIDE ]
          </button>
        </div>
      </div>

      {shelfOpen ? (
        <PopoutWindow
          title="THE SHELF"
          badge={`[ ${player.queue.length} TRACKS ]`}
          onClose={() => setShelfOpen(false)}
          maxWidth="max-w-2xl"
          status="A ROW PLAYS IT :: RELOAD AFTER DROPPING A FILE INTO THE mp3 BUCKET"
          actions={
            <button type="button" onClick={player.refresh} className={BUTTON}>
              [ RELOAD SHELF ]
            </button>
          }
        >
          {player.queue.length === 0 ? (
            <p className="text-[10px] font-bold text-black">
              NOTHING ON THE SHELF YET - UPLOAD A TRACK ON THE MUSIC PAGE, OR DROP A FILE INTO THE mp3 BUCKET.
            </p>
          ) : (
            <ol className="space-y-1">
              {player.queue.map((entry, position) => {
                const playingThis = position === player.index;

                return (
                  <li
                    key={`${entry.id}-${position}`}
                    className={`flex flex-wrap items-center gap-2 rounded-none border border-gray-500 p-2 text-[10px] font-bold text-black ${
                      playingThis ? 'bg-[#ffffcc]' : 'bg-white'
                    }`}
                  >
                    <span className="w-5 shrink-0 text-right text-gray-700">{position + 1}.</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{entry.title}</span>
                      <span className="block truncate text-gray-700">
                        {entry.kind} :: {entry.credit} :: {entry.length}
                      </span>
                    </span>
                    <button
                      type="button"
                      onClick={() => player.playAt(position)}
                      disabled={playingThis && player.playing}
                      className={BUTTON}
                    >
                      {playingThis && player.playing ? '[ PLAYING ]' : '[ ▶ PLAY ]'}
                    </button>
                  </li>
                );
              })}
            </ol>
          )}
        </PopoutWindow>
      ) : null}
    </>
  );
}
