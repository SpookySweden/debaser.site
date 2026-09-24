'use client';

import { useState, useSyncExternalStore } from 'react';
import { formatClock, formatClockOrNothing } from '../lib/audio/format';
import { trackCaption } from '../lib/audio/tracks';
import { ACCENT_COLOUR, PLATE, PLATE_HARDWARE, PLATE_TAP } from '../lib/ui/controls';
import { useCompactViewport } from '../lib/ui/use-compact-viewport';
import { useMusicPlayer } from './MusicPlayerProvider';
import MarqueeText from './MarqueeText';
import MusicOptionsPrompt from './MusicOptionsPrompt';
import PopoutWindow from './PopoutWindow';

/**
 * The station: the site's player, pinned to the bottom of every page.
 *
 * It is the face of `MusicPlayerProvider`, which owns the audio element up in
 * `app/layout.tsx` - so the bar can be drawn, hidden and re-drawn by any page without
 * the music ever noticing. Nothing here starts playing by itself: browsers require a
 * gesture, so the bar opens on a loaded track with `[ ▶ ]` waiting to be pressed (the
 * account page asks for one exception, and the provider arms it - see
 * ./MusicPlayerProvider.tsx).
 *
 * Two shapes, because a wide bar and a phone are not the same instrument:
 *
 * - A wide window gets the Win95 bar: the shelf badge, the LED display (track, running
 *   time, where it came from), the transport, the volume slider, the loop switch, the
 *   shelf and the fold.
 * - A phone gets a small card in the corner shaped the way a phone's player is shaped -
 *   what is playing at the top, a bar you can drag to seek, one big play button with the
 *   two skips beside it, repeat and volume under it - in the same retro chrome, because
 *   the shape is the part that has to be a phone player and the colour is the part that
 *   has to be this site. It is folded away to a `♪` button until it is asked for: a card
 *   sitting over the page it is playing to is not what a phone wants first.
 */

/** The card's buttons: thumb-sized, because a phone is what is pressing them. */
/** Where the bar remembers whether it is folded down. */
const BAR_KEY = 'debaser.audio.bar.v1';

/** What that setting can say: open, folded, or nothing said yet. */
type BarSetting = 'open' | 'closed';

/**
 * What the listener last said about the bar, read the way the side panel reads its own
 * setting: a tiny external store rather than state in an effect, so React never renders a
 * component twice to find that out (see ./DesktopSidebar.tsx, which does the same).
 *
 * Nothing said yet is kept as `null` rather than guessed at here, because the answer
 * differs by window: a wide one starts with the bar showing, a phone starts with it folded
 * away. Whoever draws the bar knows which it is; this only remembers what was chosen.
 */
const listeners = new Set<() => void>();

function readStoredSetting(): BarSetting | null {
  try {
    const stored = window.localStorage.getItem(BAR_KEY);
    return stored === 'open' || stored === 'closed' ? stored : null;
  } catch {
    // No storage (private mode, blocked cookies): the window's own default stands.
    return null;
  }
}

let barSetting: BarSetting | null = typeof window === 'undefined' ? null : readStoredSetting();

function subscribeBar(listener: () => void): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

function getBarSnapshot(): BarSetting | null {
  return barSetting;
}

/** The server render is the wide-window answer, which is also what hydration matches. */
function getBarServerSnapshot(): BarSetting {
  return 'open';
}

function setBarOpen(next: boolean): void {
  barSetting = next ? 'open' : 'closed';

  try {
    window.localStorage.setItem(BAR_KEY, barSetting);
  } catch {
    // Storage blocked: the bar still folds for this visit.
  }

  for (const listener of listeners) listener();
}

export default function MusicPlayer() {
  const player = useMusicPlayer();
  const compact = useCompactViewport();
  const setting = useSyncExternalStore(subscribeBar, getBarSnapshot, getBarServerSnapshot);
  const [shelfOpen, setShelfOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  // What the listener chose, or - if they have never touched it - what this window wants:
  // showing in a wide one, folded away on a phone.
  const open = setting === null ? !compact : setting === 'open';

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setBarOpen(true)}
        title="Open the player"
        className={`fixed bottom-2 left-2 z-50 ${PLATE}`}
      >
        ♪ {player.playing ? 'PLAYING' : 'PLAYER'}
      </button>
    );
  }

  return (
    <>
      {compact ? (
        <CompactBar onHide={() => setBarOpen(false)} onShelf={() => setShelfOpen(true)} onSettings={() => setSettingsOpen(true)} />
      ) : (
        <DockedBar onHide={() => setBarOpen(false)} onShelf={() => setShelfOpen(true)} onSettings={() => setSettingsOpen(true)} />
      )}

      {shelfOpen ? <ShelfWindow onClose={() => setShelfOpen(false)} /> : null}
      {settingsOpen ? <MusicOptionsPrompt onClose={() => setSettingsOpen(false)} /> : null}
    </>
  );
}

/** What either shape of bar needs from the component that draws it. */
type BarControls = {
  onHide: () => void;
  onShelf: () => void;
  onSettings: () => void;
};

/**
 * The wide window's bar.
 *
 * One line, left to right: the badge, the LED display, the transport, the volume, the loop,
 * the shelf and the fold. The display carries the track, where it came from, the running
 * time and a bar that shows how far in it is - everything a reader wants to know about what
 * is coming out of the speakers, at a glance, without leaving the page they are reading.
 */
function DockedBar({ onHide, onShelf, onSettings }: BarControls) {
  const player = useMusicPlayer();
  const { track, playing, loading, error, elapsed, duration, volume, loop } = player;
  const progress = Number.isFinite(duration) && duration > 0 ? elapsed / duration : 0;

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 border-t-2 border-white bg-sun-pale px-2 py-1 font-mono text-ink shadow-[0_-2px_0_theme(colors.ena-deep)]">
      <div className="mx-auto flex max-w-[95vw] flex-wrap items-center gap-2">
          <span className="rounded-none border-t border-l border-white border-r-2 border-b-2 border-black bg-ena px-2 py-[2px] text-[10px] font-bold text-paper">
            ♪ DEBASER PLAYER
          </span>

          {/* The LED: a black inset panel, the way a shelf stereo reads out. */}
          <span className="min-w-0 flex-1 rounded-none border-2 border-t-black border-l-black border-r-white border-b-white bg-ink px-2 py-1">
            <span className="flex flex-wrap items-baseline gap-x-2 text-[11px] font-bold text-acid">
              <MarqueeText
                className="min-w-0 flex-1"
                text={loading ? 'READING THE SHELF...' : (track?.title ?? 'NO TRACKS ON THE SHELF')}
              />
              <span className="shrink-0">
                <span className={playing ? 'animate-blip' : undefined}>{playing ? '▶' : '❚❚'}</span>{' '}
                {formatClock(elapsed)} /{' '}
                {formatClockOrNothing(Number.isFinite(duration) ? duration : undefined)}
              </span>
            </span>
            <MarqueeText
              className="mt-1 block text-[9px] text-ena-deep"
              durationSeconds={22}
              text={`${error ?? trackCaption(track)}${loop ? ' :: LOOPING THIS ONE' : ''}`}
            />
            <span className="mt-1 block h-1 w-full bg-ena-deep">
              <span className="block h-1 bg-acid" style={{ width: `${Math.round(progress * 100)}%` }} />
            </span>
          </span>

          {/* The transport, in a recess: keys bolted into the panel rather than plates floating on
              it, and the word written out on every one of them - a row of bare triangles is a
              puzzle, and the house rule is that a mark is only ever drawn beside its own name. */}
          <span className="rounded-none border-2 border-t-black border-l-black border-r-white border-b-white bg-sun-pale p-1">
            <span className="flex flex-wrap items-center gap-1">
              <button type="button" onClick={player.previous} className={PLATE_HARDWARE} title="Previous track">
                [ PREV ]
              </button>
              <button
                type="button"
                onClick={player.toggle}
                className={`${PLATE_HARDWARE} min-w-[7rem]`}
                title={playing ? 'Pause' : 'Play'}
              >
                {playing ? '[ PAUSE ]' : '[ PLAY ]'}
              </button>
              <button type="button" onClick={player.next} className={PLATE_HARDWARE} title="Next track">
                [ NEXT ]
              </button>
              <button
                type="button"
                onClick={() => player.setLoop(!loop)}
                className={`${PLATE_HARDWARE} ${loop ? 'border-t-2 border-l-2 border-black border-r-2 border-b-2 border-white' : ''}`}
                title="Repeat this track when it ends"
                aria-pressed={loop}
              >
                {loop ? '[ LOOP ON ]' : '[ LOOP OFF ]'}
              </button>
            </span>
          </span>

          <label className="flex items-center gap-1 text-[10px] font-bold text-ink">
            VOL
            <input
              type="range"
              min={0}
              max={100}
              value={Math.round(volume * 100)}
              onChange={(event) => player.setVolume(Number(event.target.value) / 100)}
              className="h-4 w-20 cursor-pointer"
              style={{ accentColor: ACCENT_COLOUR }}
              aria-label="Volume"
            />
            <span className="w-7 text-right">{Math.round(volume * 100)}</span>
          </label>

          <button type="button" onClick={onSettings} className={PLATE_HARDWARE} title="Player options">
            [ OPTIONS ]
          </button>

          <button type="button" onClick={onShelf} className={PLATE_HARDWARE}>
            [ SHELF ({player.queue.length}) ]
          </button>

          <button type="button" onClick={onHide} className={PLATE_HARDWARE} title="Fold the player away">
            [ HIDE ]
          </button>
        </div>
      </div>
    );
}

/**
 * The shelf: everything the player can play, in the order it will play it.
 *
 * A window rather than a list in the bar, because the bar is a line - and a phone's card
 * is smaller than a line. Reload after dropping a file into the `mp3` bucket and it is on
 * the shelf, which is the whole point of reading the bucket rather than a fixed list.
 */
function ShelfWindow({ onClose }: { onClose: () => void }) {
  const player = useMusicPlayer();

  return (
    <PopoutWindow
      title="THE SHELF"
      badge={`[ ${player.queue.length} TRACKS ]`}
      onClose={onClose}
      maxWidth="max-w-2xl"
      status="PICK A ROW TO PLAY IT"
      actions={
        <button type="button" onClick={player.refresh} className={PLATE}>
          [ RELOAD SHELF ]
        </button>
      }
    >
      {player.queue.length === 0 ? (
        <p className="text-[10px] font-bold text-ink">
          NOTHING ON THE SHELF YET - FILE A TRACK ON THE MUSIC PAGE.
        </p>
      ) : (
        <ol className="space-y-1">
          {player.queue.map((entry, position) => {
            const playingThis = position === player.index;

            return (
              <li
                key={`${entry.id}-${position}`}
                className={`flex flex-wrap items-center gap-2 rounded-none border border-ink p-2 text-[10px] font-bold text-ink ${
                  playingThis ? 'bg-sun-pale' : 'bg-paper'
                }`}
              >
                <span className="w-5 shrink-0 text-right text-ink">{position + 1}.</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{entry.title}</span>
                  <span className="block truncate text-ink">
                    {entry.kind} :: {entry.credit} :: {entry.length}
                  </span>
                </span>
                <button
                  type="button"
                  onClick={() => player.playAt(position)}
                  disabled={playingThis && player.playing}
                  className={PLATE}
                >
                  {playingThis && player.playing ? '[ PLAYING ]' : '[ ▶ PLAY ]'}
                </button>
              </li>
            );
          })}
        </ol>
      )}
    </PopoutWindow>
  );
}

/**
 * The phone's player.
 *
 * Shaped the way a phone's player is shaped rather than shrunk down from the bar: what is
 * playing at the top, a bar that can be dragged to seek, one big play button with the two
 * skips either side of it, and repeat and volume underneath. Every control is a thumb wide,
 * and the card is as narrow as the corner it sits in - a player that has to be hunted
 * through is a player nobody uses.
 *
 * The retro part is kept where it does not cost anything: the readout is the same green
 * LED on black the bar has, because that is what this site's music looks like, and the
 * surrounding chrome is the same grey. What is *not* retro is the layout, deliberately: a
 * phone's player is a solved shape.
 */
function CompactBar({ onHide, onShelf, onSettings }: BarControls) {
  const player = useMusicPlayer();
  const { track, playing, loading, error, elapsed, duration, volume, loop } = player;
  const lengthSeconds = Number.isFinite(duration) ? Math.floor(duration) : 0;
  const seekable = lengthSeconds > 0;

  return (
    <section className="fixed bottom-2 left-2 z-50 w-[min(19rem,calc(100vw-1rem))] rounded-none border-2 border-t-white border-l-white border-r-black border-b-black bg-sun-pale font-mono text-ink shadow-[3px_3px_0_rgba(0,0,0,0.4)]">
      <div className="flex items-center justify-between gap-2 bg-ena px-2 py-1 text-[10px] font-bold text-paper">
        <span className="truncate">♪ DEBASER PLAYER</span>

        <span className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={onSettings}
            className="cursor-pointer px-1 leading-none hover:bg-sun-pale hover:text-ena"
            title="Player options"
          >
            ⚙
          </button>

          <button
            type="button"
            onClick={onShelf}
            className="cursor-pointer underline underline-offset-2 hover:bg-sun-pale hover:text-ena"
          >
            shelf ({player.queue.length})
          </button>

          <button
            type="button"
            onClick={onHide}
            className="cursor-pointer px-1 leading-none hover:bg-sun-pale hover:text-ena"
            title="Fold the player away"
          >
            ▾
          </button>
        </span>
      </div>

      <div className="p-2">
        {/* The readout, the same green on black the bar has. */}
        <div className="rounded-none border-2 border-t-black border-l-black border-r-white border-b-white bg-ink px-2 py-1">
          <p className="truncate text-[12px] font-bold text-acid">
            {loading ? 'READING THE SHELF...' : (track?.title ?? 'NO TRACKS ON THE SHELF')}
          </p>
          <p className="truncate text-[9px] text-ena-deep">
            {error ?? trackCaption(track)}
            {loop ? ' :: LOOPING' : ''}
          </p>
        </div>

        {/* Draggable: a phone expects to be able to scrub, so the bar is the control. */}
        <input
          type="range"
          min={0}
          max={seekable ? lengthSeconds : 1}
          step={1}
          value={Math.min(Math.floor(elapsed), seekable ? lengthSeconds : 1)}
          onChange={(event) => player.seek(Number(event.target.value))}
          disabled={!seekable}
          className="mt-2 h-5 w-full cursor-pointer disabled:opacity-60"
          style={{ accentColor: ACCENT_COLOUR }}
          aria-label="Seek"
        />

        <div className="flex items-center justify-between text-[10px] font-bold text-ink">
          <span>{formatClock(elapsed)}</span>
          <span>{formatClockOrNothing(seekable ? duration : undefined)}</span>
        </div>

        <div className="mt-1 flex flex-wrap items-center justify-center gap-2">
          <button type="button" onClick={player.previous} className={PLATE_TAP} title="Previous track">
            [ PREV ]
          </button>

          <button
            type="button"
            onClick={player.toggle}
            className={`${PLATE_TAP} min-w-[8rem] text-base`}
            title={playing ? 'Pause' : 'Play'}
          >
            {playing ? '[ PAUSE ]' : '[ PLAY ]'}
          </button>

          <button type="button" onClick={player.next} className={PLATE_TAP} title="Next track">
            [ NEXT ]
          </button>
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => player.setLoop(!loop)}
            className={PLATE_TAP}
            title="Repeat this track when it ends"
            aria-pressed={loop}
          >
            {loop ? '[ LOOP ON ]' : '[ LOOP OFF ]'}
          </button>

          <label className="ml-auto flex items-center gap-1 text-[10px] font-bold text-ink">
            VOL
            <input
              type="range"
              min={0}
              max={100}
              value={Math.round(volume * 100)}
              onChange={(event) => player.setVolume(Number(event.target.value) / 100)}
              className="h-5 w-20 cursor-pointer"
              style={{ accentColor: ACCENT_COLOUR }}
              aria-label="Volume"
            />
          </label>
        </div>
      </div>
    </section>
  );
}
