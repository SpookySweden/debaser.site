'use client';

import { useEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from 'react';
import { roomScreenSound, subscribeToRoomScreenSound } from '../lib/audio/room-screen-sound';
import { stillIndex, tvShows, type TvFile, type TvFloat, type TvRoom, type TvShows } from '../lib/player-tv/source';
import { floatingClock, floatingState, onFloatingEnded, subscribeToFloating } from '../lib/ui/floating-player';
import { youtubeStills } from '../lib/watch/bar-watch';

/**
 * The little TV in the player bar (SPEC-player-tv.md): while a video plays, a set at a three-quarter angle with the
 * picture on its screen, and beside it the seat the companion watches from.
 *
 * The set is plain blocks built here in code: a case, its screen, two aerials, two feet and one knob, in the site's inks.
 * That is allowed for this one thing only (`.claude/rules/art.md`, "The player bar's TV"). The blocks are flat boxes
 * placed in 3D by CSS, so the browser does the perspective, and the screen's canvas lies on the case's front face.
 *
 * The picture is copied from the one `<video>` already playing (nothing is fetched or decoded twice), a dozen times a
 * second while it plays and the tab is seen. Another site's player cannot be read: YouTube shows its stills, the rest a
 * dark screen.
 */

/** The picture's rate: enough to follow, a fraction of the video's own. */
const FRAME_MS = 1000 / 12;
/** How often the TV looks at what is on, while anything is. */
const LOOK_MS = 400;
/** A queue moving to its next video does not blink the TV out. */
const HOLD_MS = 1500;
/** The canvas's own pixels, twice the screen's size on the page. */
const PICTURE = { w: 120, h: 68 } as const;

function useReducedMotion(): boolean {
  return useSyncExternalStore(
    (listener) => {
      const query = window.matchMedia('(prefers-reduced-motion: reduce)');
      query.addEventListener('change', listener);
      return () => query.removeEventListener('change', listener);
    },
    () => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    () => true,
  );
}

function usePageHidden(): boolean {
  return useSyncExternalStore(
    (listener) => {
      document.addEventListener('visibilitychange', listener);
      return () => document.removeEventListener('visibilitychange', listener);
    },
    () => document.hidden,
    () => true,
  );
}

function floatVideo(): HTMLVideoElement | null {
  return document.querySelector<HTMLVideoElement>('[data-floating-player] video');
}

function roomVideo(): HTMLVideoElement | null {
  const element = roomScreenSound()?.element ?? null;
  return element instanceof HTMLVideoElement ? element : null;
}

const fileOf = (video: HTMLVideoElement): TvFile => ({ ready: video.readyState >= 1, width: video.videoWidth });

/** The PLAY of the floating video that has said it ended: its frame stays up, the TV does not. */
let endedPlay = 0;

function look(): TvShows | null {
  const screen = roomScreenSound();
  const roomFile = roomVideo();
  const room: TvRoom | null =
    screen === null
      ? null
      : { playing: screen.playing, ended: screen.element?.ended ?? false, youtubeId: screen.youtubeId, file: roomFile === null ? null : fileOf(roomFile) };

  const entry = floatingState().entry;
  let float: TvFloat | null = null;
  if (entry !== null) {
    const kind = entry.player.kind;
    const video = kind === 'file' ? floatVideo() : null;
    const clock = floatingClock();
    float = {
      playing: video !== null ? !video.paused : !(clock?.paused ?? false),
      kind,
      shape: entry.shape,
      src: entry.player.src,
      ended: video?.ended ?? endedPlay === entry.play,
      file: video === null ? null : fileOf(video),
    };
  }
  return tvShows(room, float);
}

const same = (a: TvShows | null, b: TvShows | null) => a === b || (a !== null && b !== null && a.from === b.from && a.picture === b.picture && a.youtubeId === b.youtubeId);

/** What the TV shows now. Nothing is watched or timed while neither player holds anything. */
function useTvShows(): TvShows | null {
  const [shows, setShows] = useState<TvShows | null>(null);

  useEffect(() => {
    let now: TvShows | null = null;
    let timer: number | undefined;
    let leaving: number | undefined;
    const put = (next: TvShows | null) => {
      now = next;
      setShows(next);
    };
    const update = () => {
      const next = look();
      if (next !== null) {
        window.clearTimeout(leaving);
        leaving = undefined;
        if (!same(now, next)) put(next);
      } else if (now !== null && leaving === undefined) {
        leaving = window.setTimeout(() => {
          leaving = undefined;
          put(look());
        }, HOLD_MS);
      }
      const anything = floatingState().entry !== null || roomScreenSound() !== null;
      if (anything && timer === undefined) timer = window.setInterval(update, LOOK_MS);
      if (!anything && timer !== undefined) {
        window.clearInterval(timer);
        timer = undefined;
      }
    };
    const offFloat = subscribeToFloating(update);
    const offRoom = subscribeToRoomScreenSound(update);
    const offEnded = onFloatingEnded((id) => {
      const entry = floatingState().entry;
      if (entry?.id === id) endedPlay = entry.play;
      update();
    });
    update();
    return () => {
      offFloat();
      offRoom();
      offEnded();
      window.clearInterval(timer);
      window.clearTimeout(leaving);
    };
  }, []);

  return shows;
}

/** Draws a source into the canvas whole, with the screen's dark showing round it where the shapes differ. */
function paint(canvas: HTMLCanvasElement, source: CanvasImageSource, width: number, height: number): boolean {
  const context = canvas.getContext('2d');
  if (context === null || width === 0 || height === 0) return false;
  const scale = Math.min(canvas.width / width, canvas.height / height);
  const w = Math.round(width * scale);
  const h = Math.round(height * scale);
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.drawImage(source, Math.round((canvas.width - w) / 2), Math.round((canvas.height - h) / 2), w, h);
  return true;
}

function Picture({ shows }: { shows: TvShows }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const reduced = useReducedMotion();
  const hidden = usePageHidden();
  const { from, picture, youtubeId } = shows;

  // What was on the screen goes when the source changes, so one video's last frame is never left under the next's name.
  useEffect(() => {
    const canvas = ref.current;
    canvas?.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height);
  }, [from, picture, youtubeId]);

  useEffect(() => {
    const canvas = ref.current;
    if (canvas === null || hidden || picture !== 'video') return;
    let drawn = -1;
    let frames = 0;
    let drawnFrom: HTMLVideoElement | null = null;
    const draw = () => {
      const video = from === 'room' ? roomVideo() : floatVideo();
      if (video === null || video.readyState < 2) return;
      // Paused, the same moment is not drawn again. Under reduced motion one still is all there is.
      if (video === drawnFrom && (video.currentTime === drawn || reduced)) return;
      if (!paint(canvas, video, video.videoWidth, video.videoHeight)) return;
      drawn = video.currentTime;
      drawnFrom = video;
      frames += 1;
      canvas.dataset.tvFrames = String(frames);
    };
    draw();
    const timer = window.setInterval(draw, FRAME_MS);
    return () => window.clearInterval(timer);
  }, [from, picture, hidden, reduced]);

  useEffect(() => {
    const canvas = ref.current;
    if (canvas === null || hidden || picture !== 'stills' || youtubeId === null) return;
    const stills = youtubeStills(`https://www.youtube.com/watch?v=${youtubeId}`);
    const since = Date.now();
    let asked = -1;
    let over = false;
    const show = () => {
      const player = from === 'room' ? (roomScreenSound()?.element ?? null) : null;
      const clock = from === 'float' ? floatingClock() : null;
      const index = stillIndex(
        player?.currentTime ?? clock?.seconds ?? Number.NaN,
        player?.duration ?? clock?.duration ?? Number.NaN,
        (Date.now() - since) / 1000,
      );
      if (index === asked || (reduced && asked !== -1)) return;
      asked = index;
      const image = new Image();
      image.onload = () => {
        if (!over && asked === index && paint(canvas, image, image.naturalWidth, image.naturalHeight)) canvas.dataset.tvStill = String(index);
      };
      image.src = stills[index] ?? '';
    };
    show();
    const timer = window.setInterval(show, LOOK_MS);
    return () => {
      over = true;
      window.clearInterval(timer);
    };
  }, [from, picture, youtubeId, hidden, reduced]);

  return <canvas ref={ref} width={PICTURE.w} height={PICTURE.h} className="block h-full w-full" data-tv-picture />;
}

/**
 * One block: its front face where it is put, a top and a right side going back from it. Only the faces the set's angle
 * can show are made.
 */
function Block({ at, size, front, top, side, turn, children }: {
  at: { x: number; y: number; z?: number };
  size: { w: number; h: number; d: number };
  front: string;
  top: string;
  side: string;
  /** Leans the whole block about the middle of its foot, in degrees (the aerials). */
  turn?: number;
  children?: ReactNode;
}) {
  const box: CSSProperties = {
    left: at.x,
    top: at.y,
    width: size.w,
    height: size.h,
    transformStyle: 'preserve-3d',
    transformOrigin: '50% 100%',
    transform: `translateZ(${at.z ?? 0}px) rotateZ(${turn ?? 0}deg)`,
  };
  return (
    <span className="absolute block" style={box}>
      <span className={`absolute inset-0 block ${front}`}>{children}</span>
      <span className={`absolute left-0 top-0 block ${top}`} style={{ width: size.w, height: size.d, transformOrigin: 'top', transform: 'rotateX(-90deg)' }} />
      <span className={`absolute top-0 block ${side}`} style={{ left: size.w, width: size.d, height: size.h, transformOrigin: 'left', transform: 'rotateY(90deg)' }} />
    </span>
  );
}

const CASE = { w: 78, h: 44, d: 18 } as const;
const SCREEN = { x: 4, y: 5, w: 60, h: 34 } as const;

/** The set. Its sizes are the page's pixels; it takes `100 x 64` of the bar whatever the angle does inside it. */
function Set({ children }: { children: ReactNode }) {
  return (
    <span className="relative block shrink-0" style={{ width: 100, height: 64, perspective: 260 }}>
      <span className="absolute block" style={{ left: 6, top: 14, width: CASE.w, height: CASE.h, transformStyle: 'preserve-3d', transform: 'rotateX(-12deg) rotateY(-26deg)' }}>
        <Block at={{ x: 0, y: 0 }} size={CASE} front="bg-sun" top="bg-ink-bar" side="bg-ena">
          <span className="absolute block bg-ink-plate" style={{ left: SCREEN.x, top: SCREEN.y, width: SCREEN.w, height: SCREEN.h }} data-tv-screen>
            {children}
          </span>
        </Block>
        <Block at={{ x: 69, y: 9, z: 3 }} size={{ w: 5, h: 5, d: 3 }} front="bg-bubble" top="bg-ink-bar" side="bg-ena" />
        <Block at={{ x: 27, y: -13, z: -8 }} size={{ w: 2, h: 13, d: 2 }} turn={-34} front="bg-ink-bar" top="bg-ink-bar" side="bg-ena" />
        <Block at={{ x: 45, y: -13, z: -8 }} size={{ w: 2, h: 13, d: 2 }} turn={34} front="bg-ink-bar" top="bg-ink-bar" side="bg-ena" />
        <Block at={{ x: 8, y: CASE.h, z: -3 }} size={{ w: 9, h: 4, d: 9 }} front="bg-ink-bar" top="bg-ink-bar" side="bg-ena" />
        <Block at={{ x: 61, y: CASE.h, z: -3 }} size={{ w: 9, h: 4, d: 9 }} front="bg-ink-bar" top="bg-ink-bar" side="bg-ena" />
      </span>
    </span>
  );
}

/**
 * Drawn in each of the bar's black displays, at their right end: the seat, then the set. Nothing while no video is on,
 * and nothing at phone width. Its own opaque ground, so the sound graph stops at its edge.
 */
export default function PlayerTv() {
  const shows = useTvShows();
  if (shows === null) return null;

  return (
    <span className="pointer-events-none relative hidden items-end self-stretch bg-hardware md:flex" data-player-tv={shows.picture} aria-hidden="true">
      {/* Where the companion sits to watch, left of the set (`app/lib/companion/`). */}
      <span className="block w-10 self-stretch" data-tv-seat />
      <span className="self-center">
        <Set>
          <Picture shows={shows} />
        </Set>
      </span>
    </span>
  );
}
