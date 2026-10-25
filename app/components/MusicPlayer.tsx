'use client';

import { useCallback, useRef, useState, useSyncExternalStore } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import type { AudioTrack } from '../lib/audio/tracks';
import { followState, subscribeToFollow, type FollowState } from '../lib/audio/follow';
import {
  musicAddressSpentByClose,
  musicScreenForHref,
  musicWindowState,
  toggleMusic,
} from '../lib/audio/music-window';
import {
  queueWindowState,
  queuesAddressSpentByClose,
  toggleQueues,
} from '../lib/audio/queue-window';
import { SIDE_MUSIC, SIDE_QUEUES } from './SiteNav';
import { ACCENT_COLOUR, PLATE, PLATE_HARDWARE, PLATE_PRESSED, PLATE_TAP } from '../lib/ui/controls';
import { useCompactViewport } from '../lib/ui/use-compact-viewport';
import { useEdgeReserve } from '../lib/ui/use-edge-reserve';
import { useMusicPlayer } from './MusicPlayerProvider';
import MarqueeText from './MarqueeText';
import TrackDetails from './TrackDetails';
import { lengthSeconds, queueContext, trackContext } from '../lib/audio/track-context';
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
 * - A wide window gets the bar: the name and its fold, the LED display (track, running time,
 *   who uploaded it), the transport, the volume slider and the options.
 * - A phone gets a small card in the corner shaped the way a phone's player is shaped -
 *   what is playing at the top, a bar you can drag to seek, one big play button with the
 *   two skips beside it, repeat and volume under it, and the music and queue keys - in the
 *   same retro chrome, because the shape is the part that has to be a phone player and the
 *   colour is the part that has to be this site. It is folded away to a `♪` button until it
 *   is asked for: a card sitting over the page it is playing to is not what a phone wants first.
 *
 * **`[ ♪ MUSIC ]`, and what it replaced.** The bar used to carry `[ SHELF (n) ]`, which opened
 * `ShelfWindow` - the queue, in the order it would play. That was the only door to the queue, so
 * removing it had to be a replacement rather than a deletion, and the question was what a *player*
 * should offer. A player is the one place a reader is certain to be thinking about music, and the two
 * things worth reaching from there are the two screens the music window already has: the reader's own
 * (what they liked, the lists they made) and the archive. The key opens the same window the side
 * panel's key does, on the same screen, through the same `toggleMusic` - so the panel and the player
 * are one behaviour written once, not two that will disagree.
 *
 * Only the phone card carries `[ ♪ MUSIC ]` and `[ ⟳ QUEUES ]` now (SPEC-efficiency.md): on a wide
 * screen the side panel's shelf is the one launcher for both, and the wide bar is the tightest strip on
 * the site, so it gave them up for room.
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
   * The music key on the phone card.
   *
   * It is the side panel's press, to the letter: the same window, the screen `SIDE_MUSIC.href` names
   * (the reader's own), and the same spending of the address afterwards. Written as a second copy of
   * that logic rather than shared with `DesktopSidebar` because the two live in different trees - the
   * card is drawn on the phone, the panel only from `md` - and because the shared
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

  /**
   * The queue key on the phone card.
   *
   * The same press as the panel's QUEUES key and the same shape as `pressMusic` just above, deliberately:
   * a phone has no side panel, so a reader who has just been displaced by somebody's queue needs the way
   * to RADI-OH within reach of the transport. It opens whichever tab the window last had, which for the
   * panel's key and this one is the same answer - a key that says QUEUES and nothing more opens the window.
   */
  const pressQueues = useCallback(() => {
    const asked = window.location.search;
    const wasOpen = queueWindowState().open;

    toggleQueues();

    if (wasOpen && queuesAddressSpentByClose(asked)) router.replace(pathname);
  }, [pathname, router]);

  if (!open) {
    return (
      // Folded, the player is a window put away: a small framed tile on the desktop, its one key inside.
      // A bare bracket key would sit straight on the desktop, and Royal Blue on the bright theme's pink
      // desktop is under 3:1.
      <span className="fixed bottom-2 left-2 z-50 frame bg-sun-pale p-0.5">
        <button type="button" onClick={() => setBarOpen(true)} className={PLATE}>
          [ ♪ {player.playing ? 'PLAYING' : 'PLAYER'} ]
        </button>
      </span>
    );
  }

  return (
    <>
      {compact ? (
        <CompactBar
          onHide={() => setBarOpen(false)}
          onMusic={pressMusic}
          onQueues={pressQueues}
          onSettings={() => setSettingsOpen(true)}
        />
      ) : (
        <DockedBar onHide={() => setBarOpen(false)} onSettings={() => setSettingsOpen(true)} />
      )}

      {shelfOpen ? <ShelfWindow onClose={() => setShelfOpen(false)} /> : null}
      {settingsOpen ? <MusicOptionsPrompt onClose={() => setSettingsOpen(false)} /> : null}
    </>
  );
}

/** What either shape of bar needs from the component that draws it. */
type BarControls = {
  onHide: () => void;
  onSettings: () => void;
};

/** What the phone card needs on top: the two doors a wide screen keeps in the side panel's shelf. */
type CardControls = BarControls & {
  /** Opens the music window - the reader's own screen, the same one the side panel's key opens. */
  onMusic: () => void;
  /**
   * Opens the queue window - RADI-OH and the people broadcasting. The press is the side panel's
   * (`pressQueues`), so the two cannot disagree about what QUEUES means.
   */
  onQueues: () => void;
};

/**
 * The line under the song: who uploaded it, and nothing else.
 *
 * It used to read `UPLOADED :: UPLOADED TO THE SHELF :: sweden :: LOOPING THIS ONE`; the shelf and the
 * kind were furniture, and the `↻` already says looping (SPEC-efficiency.md). The caller still puts a
 * follow note in front of it, and an error in its place.
 */
function uploaderCaption(track: AudioTrack | undefined): string {
  return track === undefined ? 'NOTHING QUEUED' : track.credit;
}

/**
 * The wide window's bar.
 *
 * One line, left to right: the player's name and its fold, the LED display, the D-pad transport, the
 * volume and the options. The display carries the track, who uploaded it, the running time and a bar
 * that shows how far in it is - everything a reader wants to know about what is coming out of the
 * speakers, at a glance, without leaving the page they are reading. No music or queue key: the side
 * panel's shelf has both on a wide screen, and this strip is kept with room to spare for the wider face.
 *
 * The fold is next to the name rather than at the end, which is the one ordering change this bar has
 * had: `[ HIDE ]` closed the strip from the opposite end to everything else, so the key that puts the
 * player away was the furthest thing from the key that plays it.
 */
/**
 * The track on the display, in the shared details format - on the bar's black LED.
 *
 * Its context is what the play recorded (a queue, a playlist, a profile), else the name of whoever is
 * being followed, else the file's own folder - which is where an album or a project lives.
 */
function NowPlaying({ marquee = false, extra }: { marquee?: boolean; extra?: React.ReactNode }) {
  const player = useMusicPlayer();
  const follow = useSyncExternalStore(subscribeToFollow, followState, followState);
  const { track, loading, elapsed, duration } = player;

  const recorded = player.heardFrom?.context ?? (follow.hostId === null ? undefined : queueContext(follow.hostName));

  return (
    <TrackDetails
      tone="led"
      marquee={marquee}
      src={track?.src ?? null}
      context={trackContext(recorded, track?.folderPath)}
      title={loading ? 'READING THE SHELF...' : (track?.title ?? 'NO TRACKS ON THE SHELF')}
      position={elapsed}
      length={Number.isFinite(duration) ? duration : lengthSeconds(track?.length)}
      extra={extra}
    />
  );
}

/**
 * What the bar says about following, ahead of the track's own caption.
 *
 * Said on the bar because that is where a reader looks when the music changes under them - a follow
 * moves the player on its own, and a bar that did not say why would look like a player with a mind of
 * its own. The end of a follow is said once too, so a reader who pressed pause knows they let go.
 */
function followNote(follow: FollowState): string {
  if (follow.hostId !== null) {
    return `FOLLOWING ${follow.hostName}${follow.catchingUp ? ' >> CATCHING UP' : ''} :: `;
  }

  if (follow.ended === null) return '';
  return follow.ended.length === 0 ? 'STOPPED FOLLOWING :: ' : `STOPPED FOLLOWING - ${follow.ended} :: `;
}

function DockedBar({ onHide, onSettings }: BarControls) {
  // The page window keeps clear of this strip (`--bottom-bar`, read by ./SiteWindow.tsx).
  const strip = useRef<HTMLDivElement>(null);
  useEdgeReserve(strip, '--bottom-bar', true);
  const player = useMusicPlayer();
  const { track, playing, loading, error, elapsed, duration, volume, loop } = player;
  const follow = useSyncExternalStore(subscribeToFollow, followState, followState);
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
    <div ref={strip} className="fixed bottom-0 left-0 right-0 z-50 border-t-line border-ink bg-sun-pale px-2 py-1 font-mono text-ink">
      <div className="mx-auto flex max-w-[95vw] flex-wrap items-center gap-2">
          {/* The player's own name, and its fold, together: they are the same thing said twice - what
              this strip is, and how to put it away. The fold used to sit at the far right, past the
              music key, which made it the last of six controls rather than part of the bar's identity -
              and a reader looking for it had to scan the whole line to find the one key that closes it.
              Kept in one recess so the two read as a unit. `♪ PLAYER`, not `♪ DEBASER PLAYER`: the
              site's name is already on the window above it. */}
          <span className="flex items-center gap-1">
            <span className="px-1 text-label text-ink">
              ♪ PLAYER
            </span>

            <button
              type="button"
              onClick={onHide}
              className={PLATE_HARDWARE}
            >
              [ HIDE ]
            </button>
          </span>

          {/* The LED: a black inset panel, the way a shelf stereo reads out. */}
          <span className="min-w-0 flex-1 frame bg-hardware px-2 py-1">
            {/* The song, in the same details format RADI-OH uses (`TrackDetails`): the uploader's picture,
                what it is being heard as part of, the name, and where it is out of its length. */}
            <NowPlaying
              marquee
              extra={<span className={`shrink-0 ${playing ? 'animate-blip' : ''}`}>{playing ? '▶' : '❚❚'}</span>}
            />
            {/* The caption is on the black LED above, which is Black in *both* themes - so it takes the
                bar ink. `ena-deep` was Nigrosine on Black (1.18:1) and went Black-on-Black in the dark
                theme; the quiet ink is no better here, because Nigrosine on Black is the same 1.18:1.
                Pure White is 21:1 either way, and it still reads as the screen's second line beside the
                Emerald title. */}
            <MarqueeText
              className="mt-1 block text-label leading-readout-tight text-ink-bar"
              durationSeconds={22}
              text={`${followNote(follow)}${error ?? uploaderCaption(track)}`}
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

          {/* No number beside the slider: where the thumb sits is the reading. */}
          <label className="flex items-center gap-1 text-label font-bold text-ink">
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
          </label>

          <button type="button" onClick={onSettings} className={PLATE_HARDWARE}>
            [ OPTIONS ]
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
    <span>
      <span className="flex items-stretch gap-1">
        <button
          type="button"
          onClick={onPrevious}
          disabled={disabled}
          className={`${PLATE_HARDWARE} min-w-[2.25rem]`}
          title="Previous track"
          aria-label="Previous track"
        >
          <span aria-hidden="true" className="text-label leading-none">
            ◀
          </span>
        </button>

        {/* The one cell: a single symbol, the state it is showing, and the next state as the tooltip -
            so a reader who is unsure gets the answer from the title rather than from guessing. */}
        <span className="flex items-center frame bg-hardware px-1 py-0.5">
          <button
            type="button"
            onClick={onCycle}
            disabled={disabled}
            title={WORD[state]}
            className="flex min-w-[3rem] cursor-pointer items-center justify-center rounded-none px-2 py-1 text-display font-bold leading-none text-acid hover:bg-ena hover:text-sun focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-bubble active:animate-flash active:bg-bubble active:text-ink-plate disabled:cursor-not-allowed disabled:text-ink-bar"
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
          <span aria-hidden="true" className="text-label leading-none">
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
        <p className="text-label font-bold text-ink">
          NOTHING ON THE SHELF YET - FILE A TRACK ON THE MUSIC PAGE.
        </p>
      ) : (
        <ol className="space-y-1">
          {player.queue.map((entry, position) => {
            const playingThis = position === player.index;

            return (
              <li
                key={`${entry.id}-${position}`}
                className={`flex flex-wrap items-center gap-2 p-2 text-label font-bold text-ink ${
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
function CompactBar({ onHide, onMusic, onQueues, onSettings }: CardControls) {
  const player = useMusicPlayer();
  const { track, playing, error, elapsed, duration, volume, loop } = player;
  const follow = useSyncExternalStore(subscribeToFollow, followState, followState);
  const lengthSeconds = Number.isFinite(duration) ? Math.floor(duration) : 0;
  const seekable = lengthSeconds > 0;

  return (
    <section className="fixed bottom-2 left-2 z-50 w-[min(19rem,calc(100vw-1rem))] frame bg-sun-pale font-mono text-ink">
      {/* Every key on this row is a thumb's 44px, so the row is as tall as they are and the keys sit
          edge to edge: their own boxes are the spacing. Only the two glyph keys sit here: the music and
          queue keys became bracket keys (SPEC-efficiency.md), and as words in brackets they no longer fit
          beside the name in a 304px card, so they have a row of their own at the foot. The right edge
          has no padding because the fold key's box already holds its glyph off the edge. */}
      {/* No bar behind the row: the card's own fill, the name in the accent ink the way a window is
          titled, and a rule under it - the last Royal Blue strip left from the Win95 chrome. */}
      <div className="flex items-center justify-between gap-1 border-b-line border-ink pl-2 text-label font-bold">
        <span className="truncate text-accent-ink">♪ PLAYER</span>

        <span className="flex shrink-0 items-center">
          <button
            type="button"
            onClick={onSettings}
            className="min-h-tap min-w-tap cursor-pointer px-1 text-sm leading-none hover:bg-sun-pale hover:text-accent-ink"
            title="Player options"
          >
            ⚙
          </button>

          <button
            type="button"
            onClick={onHide}
            className="min-h-tap min-w-tap cursor-pointer px-1 text-sm leading-none hover:bg-sun-pale hover:text-accent-ink"
            title="Hide player"
          >
            ▾
          </button>
        </span>
      </div>

      <div className="p-2">
        {/* The readout, the same green on black the bar has. */}
        <div className="frame bg-hardware px-2 py-1">
          <NowPlaying />
          {/* The same black screen as the bar's LED, so the same bar ink - see the note up there. The
              uploader only, as on the bar: the `[ ↻ ]` key below says whether it loops. */}
          <p className="truncate text-label text-ink-bar">
            {followNote(follow)}
            {error ?? uploaderCaption(track)}
          </p>
        </div>

        {/* Draggable: a phone expects to be able to scrub, so the bar is the control. No clock under
            it: the readout above already says `1:19 / 5:12`. */}
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

        <div className="mt-1 flex flex-wrap items-center justify-center gap-2">
          <button type="button" onClick={player.previous} className={PLATE_TAP}>
            [ PREV ]
          </button>

          <button
            type="button"
            onClick={player.toggle}
            className={`${PLATE_TAP} min-w-[8rem] text-base`}
          >
            {playing ? '[ PAUSE ]' : '[ PLAY ]'}
          </button>

          <button type="button" onClick={player.next} className={PLATE_TAP}>
            [ NEXT ]
          </button>
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-2">
          {/* One `[ ↻ ]` key, drawn as a switch: the filled pill while it loops, a plain key while it
              does not - the way every switch on the site says on (SPEC-efficiency.md). */}
          <button
            type="button"
            onClick={() => player.setLoop(!loop)}
            className={loop ? `${PLATE_PRESSED} cursor-pointer` : PLATE}
            title="Loop"
            aria-label="Loop this track"
            aria-pressed={loop}
          >
            [ ↻ ]
          </button>

          <label className="ml-auto flex items-center gap-1 text-label font-bold text-ink">
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

        {/* The two doors the side panel's shelf holds on a wide screen, here because a phone has no
            panel. They wear `SIDE_MUSIC`' and `SIDE_QUEUES`' own mark and word, so one thing is one
            thing wherever it is pressed; the card's foot is the only row with room for them as words. */}
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <button type="button" onClick={onMusic} className={PLATE} aria-haspopup="dialog">
            [ {SIDE_MUSIC.mark} {SIDE_MUSIC.label} ]
          </button>

          <button
            type="button"
            onClick={onQueues}
            className={PLATE}
            aria-haspopup="dialog"
          >
            [ {SIDE_QUEUES.mark} {SIDE_QUEUES.label} ]
          </button>
        </div>
      </div>
    </section>
  );
}
