'use client';

import { useCallback, useState, useSyncExternalStore } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { formatClock, formatClockOrNothing } from '../lib/audio/format';
import { trackCaption } from '../lib/audio/tracks';
import {
  musicAddressSpentByClose,
  musicScreenForHref,
  musicWindowState,
  toggleMusic,
} from '../lib/audio/music-window';
import { SIDE_MUSIC } from './SiteNav';
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
 * - A wide window gets the Win95 bar: the badge, the LED display (track, running time,
 *   where it came from), the transport, the volume slider, the loop switch, the music
 *   key and the fold.
 * - A phone gets a small card in the corner shaped the way a phone's player is shaped -
 *   what is playing at the top, a bar you can drag to seek, one big play button with the
 *   two skips beside it, repeat and volume under it - in the same retro chrome, because
 *   the shape is the part that has to be a phone player and the colour is the part that
 *   has to be this site. It is folded away to a `♪` button until it is asked for: a card
 *   sitting over the page it is playing to is not what a phone wants first.
 *
 * **`[ ♪ MUSIC ]`, and what it replaced.** The bar used to carry `[ SHELF (n) ]`, which opened
 * `ShelfWindow` - the queue, in the order it would play. That was the only door to the queue, so
 * removing it had to be a replacement rather than a deletion, and the question was what a *player*
 * should offer. A player is the one place a reader is certain to be thinking about music, and the two
 * things worth reaching from there are the two screens the music window already has: the reader's own
 * (what they liked, the lists they made) and the archive. This key opens the same window the side
 * panel's key does, on the same screen, through the same `toggleMusic` - so the panel and the bar are
 * one behaviour written once, not two that will disagree.
 *
 * The queue is not lost. The archive screen is a file browser whose every row has `[ ▶ PLAY ]`, which
 * hands that file to this player - so playing a specific track, which is what the shelf window was
 * mostly for, is reachable. What has genuinely gone is the *list of the queue itself*, and that is a
 * real subtraction rather than a tidy-up: it is noted here rather than hidden, because a reader who
 * wants to see what is coming next has no screen for it now.
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
  const pathname = usePathname();
  const router = useRouter();

  // What the listener chose, or - if they have never touched it - what this window wants:
  // showing in a wide one, folded away on a phone.
  const open = setting === null ? !compact : setting === 'open';

  /**
   * The music key on the bar.
   *
   * It is the side panel's press, to the letter: the same window, the screen `SIDE_MUSIC.href` names
   * (the reader's own), and the same spending of the address afterwards. Written as a second copy of
   * that logic rather than shared with `DesktopSidebar` because the two live in different trees - the
   * bar is drawn on every page including the phone, the panel only from `md` - and because the shared
   * part is one call plus one question, which is not enough to be worth a hook both must import. What
   * *is* shared is everything that could drift: the `toggleMusic` and the screen, both derived.
   *
   * The address is read off `window.location` for the reason the panel gives: `useSearchParams` would
   * opt every page that draws the bar out of static prerendering, and a click handler runs in the
   * browser anyway so the value is right there.
   */
  const pressMusic = useCallback(() => {
    const asked = window.location.search;
    const wasOpen = musicWindowState().open;

    toggleMusic(musicScreenForHref(SIDE_MUSIC.href));

    // Same rule as the panel's key: a press that *shuts* the window has to spend the address it opened
    // by, or the shut window disagrees with the URL and the window's own effect opens it straight back.
    if (wasOpen && musicAddressSpentByClose(asked)) router.replace(pathname);
  }, [pathname, router]);

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
        <CompactBar
          onHide={() => setBarOpen(false)}
          onMusic={pressMusic}
          onSettings={() => setSettingsOpen(true)}
        />
      ) : (
        <DockedBar
          onHide={() => setBarOpen(false)}
          onMusic={pressMusic}
          onSettings={() => setSettingsOpen(true)}
        />
      )}

      {shelfOpen ? <ShelfWindow onClose={() => setShelfOpen(false)} /> : null}
      {settingsOpen ? <MusicOptionsPrompt onClose={() => setSettingsOpen(false)} /> : null}
    </>
  );
}

/** What either shape of bar needs from the component that draws it. */
type BarControls = {
  onHide: () => void;
  /** Opens the music window - the reader's own screen, the same one the side panel's key opens. */
  onMusic: () => void;
  onSettings: () => void;
};

/**
 * The wide window's bar.
 *
 * One line, left to right: the player's name and its fold, the LED display, the D-pad transport, the
 * volume, the settings, and the music key. The display carries the track, where it came from, the
 * running time and a bar that shows how far in it is - everything a reader wants to know about what
 * is coming out of the speakers, at a glance, without leaving the page they are reading.
 *
 * The fold is next to the name rather than at the end, which is the one ordering change this bar has
 * had: `[ HIDE ]` closed the strip from the opposite end to everything else, so the key that puts the
 * player away was the furthest thing from the key that plays it.
 */
function DockedBar({ onHide, onMusic, onSettings }: BarControls) {
  const player = useMusicPlayer();
  const { track, playing, loading, error, elapsed, duration, volume, loop } = player;
  const progress = Number.isFinite(duration) && duration > 0 ? elapsed / duration : 0;

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 border-t-2 border-white bg-sun-pale px-2 py-1 font-mono text-ink shadow-[0_-2px_0_theme(colors.ena-deep)]">
      <div className="mx-auto flex max-w-[95vw] flex-wrap items-center gap-2">
          {/* The player's own name, and its fold, together: they are the same thing said twice - what
              this strip is, and how to put it away. The fold used to sit at the far right, past the
              music key, which made it the last of six controls rather than part of the bar's identity -
              and a reader looking for it had to scan the whole line to find the one key that closes it.
              Kept in one recess so the two read as a unit. */}
          <span className="flex items-center gap-1 rounded-none border-2 border-t-black border-l-black border-r-white border-b-white bg-sun-pale p-[2px]">
            <span className="rounded-none border-t border-l border-white border-r-2 border-b-2 border-black bg-ena px-2 py-[3px] text-[10px] font-bold text-paper">
              ♪ DEBASER PLAYER
            </span>

            <button
              type="button"
              onClick={onHide}
              className={PLATE_HARDWARE}
              title="Fold the player away"
            >
              [ HIDE ]
            </button>
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

          {/* The transport, in a recess: the D-pad. Left and right step the queue; the middle cell
              is a live readout of what the player is doing rather than a label for a press, and it
              carries stop and loop beneath it - see `TransportPad` for why those are separate keys. */}
          <TransportPad
            playing={playing}
            loop={loop}
            disabled={loading || player.queue.length === 0}
            onPrevious={player.previous}
            onToggle={player.toggle}
            onStop={player.stop}
            onNext={player.next}
            onLoop={() => player.setLoop(!loop)}
          />

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

          {/* The music key, wearing the same mark and word the side panel's key wears, so one thing is
              one thing wherever it is pressed. It opens the reader's own music, which is what
              `SIDE_MUSIC.href` names - see the note at the top of the file for what it replaced and why
              the queue is still reachable. */}
          <button
            type="button"
            onClick={onMusic}
            className={PLATE_HARDWARE}
            title="Open your music"
            aria-haspopup="dialog"
          >
            [ {SIDE_MUSIC.mark} {SIDE_MUSIC.label} ]
          </button>
        </div>
      </div>
    );
}

/**
 * The transport as a D-pad: left, a live readout in the middle, right.
 *
 * The middle cell is the whole idea, and it is the opposite of a normal button. A normal button says
 * *what pressing it will do* (`[ PLAY ]` waits for a press and then becomes `[ PAUSE ]`), so it is
 * always naming a state the reader is not in. This one names the state they *are* in, and moves, so
 * it reads as a display rather than as something to press - which is what the brief asked for: the
 * symbol says what is happening, not what would happen.
 *
 * It is still pressable - a reader who wants to pause has to be able to - so the animation carries the
 * difference rather than the cursor or the border. `animate-blip` is a `steps(2)` blink and the `▶` on
 * the LED already wears it for exactly this reason: a thing that is *running* should look like it is
 * running. Paused sits still, because something that has stopped and is still blinking is lying about
 * itself.
 *
 * **Stopped is not paused**, which is why there are three states rather than two. Paused keeps the
 * position and play resumes from it; stopped returns to the start of the track. A shelf stereo has
 * both and a reader expects both, which is the reason the square key exists separately from the
 * triangle.
 *
 * The loop key is the fourth state and lives *inside* the pad rather than beside it, because loop is
 * about this track in this player, which is what the pad is showing. It is the one cell that names what
 * it *changes* rather than what is true, so it wears the lit bevel when it is on - the same trade
 * `PLATE_PRESSED` makes elsewhere - and every mark is drawn with its own word beside it, per the house
 * rule that a bare glyph is a puzzle.
 */
function TransportPad({
  playing,
  loop,
  disabled,
  onPrevious,
  onToggle,
  onStop,
  onNext,
  onLoop,
}: {
  playing: boolean;
  loop: boolean;
  disabled: boolean;
  onPrevious: () => void;
  onToggle: () => void;
  onStop: () => void;
  onNext: () => void;
  onLoop: () => void;
}) {
  return (
    <span className="rounded-none border-2 border-t-black border-l-black border-r-white border-b-white bg-sun-pale p-1">
      <span className="flex items-stretch gap-1">
        <button
          type="button"
          onClick={onPrevious}
          disabled={disabled}
          className={`${PLATE_HARDWARE} min-w-[2.25rem]`}
          title="Previous track"
          aria-label="Previous track"
        >
          <span aria-hidden="true" className="text-[13px] leading-none">
            ◀
          </span>
        </button>

        {/* The live cell: the readout on top, stop and loop under it, in one recess. */}
        <span className="flex flex-col rounded-none border-2 border-t-black border-l-black border-r-white border-b-white bg-ink p-[2px]">
          <button
            type="button"
            onClick={onToggle}
            disabled={disabled}
            aria-pressed={playing}
            title={playing ? 'Pause' : 'Play'}
            className="flex min-w-[5.5rem] cursor-pointer items-center justify-center gap-1 rounded-none px-2 py-[3px] text-[12px] font-bold text-acid hover:bg-ena hover:text-sun focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-bubble active:animate-flash active:bg-bubble active:text-ink disabled:cursor-not-allowed disabled:text-chrome-dark"
          >
            {/* The animation is the message: blipping while audio runs, still while it does not. */}
            <span aria-hidden="true" className={playing ? 'animate-blip' : undefined}>
              {playing ? '▶' : '❚❚'}
            </span>
            <span className="text-[9px] leading-none">{playing ? 'PLAYING' : 'PAUSED'}</span>
          </button>

          <span className="mt-[2px] flex items-stretch gap-[2px]">
            <button
              type="button"
              onClick={onStop}
              disabled={disabled}
              title="Stop, and go back to the start of the track"
              className="flex-1 cursor-pointer rounded-none px-1 py-[2px] text-[10px] font-bold text-ena-deep hover:bg-ena hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-bubble active:animate-flash active:bg-bubble active:text-ink disabled:cursor-not-allowed"
            >
              ■<span className="sr-only">Stop</span>
            </button>

            <button
              type="button"
              onClick={onLoop}
              disabled={disabled}
              aria-pressed={loop}
              title={loop ? 'Repeating this track: press to play on through the shelf' : 'Repeat this track when it ends'}
              className={`flex-1 cursor-pointer rounded-none border px-1 py-[2px] text-[10px] font-bold focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-bubble active:animate-flash active:bg-bubble active:text-ink disabled:cursor-not-allowed ${
                loop
                  ? 'border-black bg-acid text-ink'
                  : 'border-ena-deep bg-ink text-ena-deep hover:bg-ena hover:text-ink'
              }`}
            >
              ↻<span className="sr-only">{loop ? 'Loop on' : 'Loop off'}</span>
            </button>
          </span>
        </span>

        <button
          type="button"
          onClick={onNext}
          disabled={disabled}
          className={`${PLATE_HARDWARE} min-w-[2.25rem]`}
          title="Next track"
          aria-label="Next track"
        >
          <span aria-hidden="true" className="text-[13px] leading-none">
            ▶
          </span>
        </button>
      </span>
    </span>
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
function CompactBar({ onHide, onMusic, onSettings }: BarControls) {
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

          {/* The same key the bar and the side panel carry: the mark, the word, and the thumb's own
              affordances - the card's controls are text rather than plates, so this is underlined and
              sized by the surrounding row rather than drawn as a button. */}
          <button
            type="button"
            onClick={onMusic}
            className="cursor-pointer underline underline-offset-2 hover:bg-sun-pale hover:text-ena"
            title="Open your music"
            aria-haspopup="dialog"
          >
            {SIDE_MUSIC.mark} music
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
