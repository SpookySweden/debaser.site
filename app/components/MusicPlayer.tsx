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

  /**
   * The middle cell's press: on to the next state, walking playing -> paused -> looping -> playing.
   *
   * Written out here rather than pushed into the provider, because the three states are genuinely made
   * of two switches (`playing` and `loop`) and the *pairing* of them is a presentation choice - the
   * provider should not learn about the cell. What each state means:
   *
   *   playing  audio on,  repeat off - the shelf walks on when the track ends
   *   paused   audio off, repeat off - silence, and the position is kept
   *   looping  audio on,  repeat on  - this track repeats
   *
   * The reading order is `loop` first, then `playing` - the same order the cell uses, and it has to be
   * the same or the key would act on a different state than the one it is showing. Only the two presses
   * that change the audio call `toggle`; leaving looping must not, because the music is already audible
   * and a press that silenced it would do the opposite of what the symbol promised.
   */
  const cycleState = useCallback(() => {
    const state = loop ? 'looping' : playing ? 'playing' : 'paused';

    if (state === 'playing') {
      // -> paused: silence. Repeat is already off.
      player.toggle();
      return;
    }

    if (state === 'paused') {
      // -> looping: audible and repeating. Both switches move.
      player.setLoop(true);
      player.toggle();
      return;
    }

    // 'looping' -> playing: repeat off, audio untouched.
    player.setLoop(false);
  }, [loop, playing, player]);

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

          {/* The transport, in a recess: the D-pad. Left and right step the queue; the middle is one
              symbol showing which of the three states the player is in, and a press moves to the next -
              see `TransportPad` for the cycle and why the symbol reports rather than promises. */}
          <TransportPad
            playing={playing}
            loop={loop}
            disabled={loading || player.queue.length === 0}
            onPrevious={player.previous}
            onCycle={cycleState}
            onNext={player.next}
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
 * The transport as a D-pad: left, one cycling symbol, right.
 *
 * The middle is one cell with **one symbol**, showing which of three states the player is in, and a
 * press moves to the next. That is the whole idea, and it is the opposite of a normal button: `[ PLAY ]`
 * names what pressing it would *do*, so it is always describing a state the reader is not in. This
 * names the state they *are* in.
 *
 *   ▶   playing    - blipping, because something running should look like it is running
 *   ❚❚  paused     - still, because something stopped that kept blinking would be lying about itself
 *   ↻   looping    - also moving, and this is the one that repeats rather than advancing
 *
 * The cycle is playing -> paused -> looping -> playing. Looping sits *in* the cycle rather than beside
 * it because loop is about this track in this player, which is what the cell is showing - and because
 * one cell with one symbol is what the brief asked for: no secondary row, no fourth key.
 *
 * `animate-blip` is the site's `steps(2)` blink and the LED's own play mark already wears it for
 * exactly this reason. Each state gets a different animation so the cell is legible at a glance and
 * without reading the glyph: `blip` for playing, `wobble` for looping, nothing for paused. Stillness is
 * a state too, and it is the one that says "the silence is deliberate".
 *
 * Every mark is drawn with its own word for a screen reader (`sr-only`), per the house rule that a bare
 * glyph is a puzzle - and the word comes from the state, so it says what is true rather than what a
 * press would do.
 */
function TransportPad({
  playing,
  loop,
  disabled,
  onPrevious,
  onCycle,
  onNext,
}: {
  playing: boolean;
  loop: boolean;
  disabled: boolean;
  onPrevious: () => void;
  /** Moves to the next state: playing -> paused -> looping -> playing. */
  onCycle: () => void;
  onNext: () => void;
}) {
  /**
   * Which state the cell is in.
   *
   * `loop` wins over `playing` when both are set, and the order is the whole reason this is written
   * down: with a repeating track the audio *is* running, so "playing" would be true as well - and if
   * `playing` took precedence the `↻` symbol could never appear at all. Looping is the more specific
   * statement, so it is the one the cell reports.
   */
  const state: 'playing' | 'paused' | 'looping' = loop ? 'looping' : playing ? 'playing' : 'paused';

  const MARK = { playing: '▶', paused: '❚❚', looping: '↻' } as const;
  const WORD = { playing: 'Playing', paused: 'Paused', looping: 'Looping' } as const;
  const ANIMATION = { playing: 'animate-blip', paused: undefined, looping: 'animate-wobble' } as const;

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

        {/* The one cell: a single symbol, the state it is showing, and the next state as the tooltip -
            so a reader who is unsure gets the answer from the title rather than from guessing. */}
        <span className="flex items-center rounded-none border-2 border-t-black border-l-black border-r-white border-b-white bg-ink px-1 py-[2px]">
          <button
            type="button"
            onClick={onCycle}
            disabled={disabled}
            title={`${WORD[state]} - press for ${WORD[state === 'playing' ? 'paused' : state === 'paused' ? 'looping' : 'playing']}`}
            className="flex min-w-[3rem] cursor-pointer items-center justify-center rounded-none px-2 py-1 text-[20px] font-bold leading-none text-acid hover:bg-ena hover:text-sun focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-bubble active:animate-flash active:bg-bubble active:text-ink disabled:cursor-not-allowed disabled:text-chrome-dark"
          >
            <span aria-hidden="true" className={ANIMATION[state]}>
              {MARK[state]}
            </span>
            <span className="sr-only">{WORD[state]}</span>
          </button>
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
