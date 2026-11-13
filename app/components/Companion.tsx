'use client';

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { DANCES, type MotionId } from '../lib/character/motion';
import { cellAt, type CharacterSheet } from '../lib/character/sheet';
import { useShownCharacter } from '../lib/character/use-shown-character';
import { spanFor, startBrain, think, type BrainState, type Span } from '../lib/companion/brain';
import { companionOut } from '../lib/companion/choices';
import {
  companionChoicesState,
  serverCompanionChoices,
  setCompanionAccount,
  subscribeToCompanionChoices,
} from '../lib/companion/companion-slot';
import { onCompanionPoke } from '../lib/companion/events';
import { measureFloor, type Floor } from '../lib/companion/floor';
import { usePhone, useReducedMotion } from '../lib/companion/use-phone';
import {
  companionsToDraw,
  reactionShowsMark,
  roomCompanionsState,
  sayCompanion,
  serverRoomCompanions,
  subscribeToRoomCompanions,
  type CompanionMood,
  type CompanionWire,
  type RoomCompanion,
} from '../lib/companion/wire';
import { SPRITE_SLOT } from '../lib/ui/controls';
import { useAuth } from './AuthProvider';
import CompanionReactions from './CompanionReactions';
import { useMusicPlayer } from './MusicPlayerProvider';

/**
 * Your companion: your character, living along the bottom of the site on every page (SPEC-companion.md).
 *
 * It walks the top edge of the music bar (or the window's foot when the bar is folded), steps around the folded
 * player, the floating video and the stream's TV box, wanders, sits, falls asleep when nothing has happened for a
 * minute, dances while the music bar plays, chases the pointer when it comes down to the strip, and hops (with a `!`
 * over its head for a reply, a message or someone coming online). In a stream or music room everyone's companions
 * share the strip, each with its owner's name on hover; outside rooms only you see yours.
 *
 * It wears its owner's SHOWN character (Luke, 2026-11-13: "Only the shown one"): the picture strip the owner's browser
 * baked from their own hand-built character (SPEC-profile-characters.md, `bake.ts`), played a cell at a time from the
 * strip's own motions (walk, idle, sit, sleep, the dances, hop). With no SHOWN character it is a placeholder field.
 * The code never draws a character.
 *
 * Every frame is a write to the figure's style through a ref, ten a second in whole steps (the site's no-easing rule),
 * so nothing re-renders as it walks. Clicks pass straight through everything but the figure itself. Under reduced
 * motion it stands still in one frame.
 */

/** The placeholder's box, in CSS pixels, when there is no SHOWN character to wear. */
const PLACEHOLDER = { w: 32, h: 32 } as const;
/** Screen pixels per strip pixel: a whole number, so every block of the character is the same size. */
const SCALE = 2;
/** One frame: ten a second, as the strips are baked (`sheet.fps`). */
const TICK_MS = 100;
/** Pixels a frame, walking and chasing. */
const WALK_STEP = 3;
const CHASE_STEP = 6;
/** How far above the strip the pointer counts as near. */
const NEAR_PX = 120;
/** A chase re-says where it is headed at most this often. */
const CHASE_SAY_MS = 2_000;
/** How long the `!` stays up. */
const MARK_MS = 1_600;
/** The placeholder's hop: how high it is on each frame, then back down. A character plays its own `hop`. */
const HOP = [-4, -8, -10, -8, -4, 0];

/** What a figure wears: a SHOWN character's baked strip, or nothing (the placeholder field). */
type Look = { stripUrl: string; sheet: CharacterSheet } | null;

type Size = { w: number; h: number };

/** The box: a cell of the strip, cut at the feet (the spare row under them is margin), or the placeholder's. */
function sizeOf(look: Look): Size {
  return look === null ? PLACEHOLDER : { w: look.sheet.cell.w * SCALE, h: look.sheet.floor * SCALE };
}

/** Which of the strip's motions a mood plays. */
function motionFor(mood: CompanionMood, dance: MotionId): MotionId {
  switch (mood) {
    case 'walk':
    case 'chase':
      return 'walk';
    case 'sit':
      return 'sit';
    case 'sleep':
      return 'sleep';
    case 'dance':
      return dance;
    default:
      return 'idle';
  }
}

const pickDance = (): MotionId => DANCES[Math.floor(Math.random() * DANCES.length)] ?? 'dance1';

/** Whether the music bar is playing, without re-rendering the strip on every tick of the track's clock. */
function MusicWatch({ onChange }: { onChange: (playing: boolean) => void }) {
  const { playing } = useMusicPlayer();
  useEffect(() => onChange(playing), [playing, onChange]);
  return null;
}

/** The floor, measured at most once a second (and at once when the screen changes size), shared by figures of a size. */
const floorCache = new Map<string, { at: number; w: number; h: number; floor: Floor }>();
function floorNow(size: Size): Floor {
  const now = Date.now();
  const key = `${size.w}x${size.h}`;
  const held = floorCache.get(key);
  if (held === undefined || now - held.at > 1_000 || held.w !== window.innerWidth || held.h !== window.innerHeight) {
    const floor = measureFloor(size.w, size.h);
    floorCache.set(key, { at: now, w: window.innerWidth, h: window.innerHeight, floor });
    return floor;
  }
  return held.floor;
}

/** Places the figure and paints its body: a cell of the strip (mirrored when it faces left), or the placeholder. */
function draw(
  place: HTMLDivElement | null,
  body: HTMLSpanElement | null,
  look: Look,
  frame: { x: number; floorY: number; facing: 1 | -1; mood: CompanionMood; motion: MotionId; tick: number; lift: number },
) {
  const size = sizeOf(look);
  if (place !== null) {
    // Its name opens toward the middle of the screen, so it is never cut off at either edge.
    const side = frame.x > window.innerWidth / 2 ? 'right' : 'left';
    if (place.dataset.side !== side) {
      place.dataset.side = side;
      const tag = place.querySelector<HTMLElement>('[data-companion-name]');
      if (tag !== null) {
        tag.style.left = side === 'left' ? '0' : 'auto';
        tag.style.right = side === 'right' ? '0' : 'auto';
      }
    }
    place.style.transform = `translate3d(${Math.round(frame.x)}px, ${Math.round(frame.floorY - size.h)}px, 0)`;
    place.style.visibility = 'visible';
    if (place.dataset.mood !== frame.mood) place.dataset.mood = frame.mood;
    if (place.dataset.motion !== frame.motion) place.dataset.motion = frame.motion;
    const face = frame.facing === 1 ? 'right' : 'left';
    if (place.dataset.facing !== face) place.dataset.facing = face;
  }
  if (body === null) return;
  if (look === null) {
    body.style.transform = frame.lift === 0 ? '' : `translateY(${frame.lift}px)`;
    return;
  }
  // The same arithmetic as CharacterSprite.tsx, written straight to the style so a frame re-renders nothing.
  const { sheet } = look;
  const playing = sheet.motions[frame.motion];
  const count = playing.ticks.length;
  const index = playing.ticks[playing.loop ? ((frame.tick % count) + count) % count : Math.min(Math.max(0, frame.tick), count - 1)];
  const at = cellAt(sheet, index);
  body.style.backgroundPosition = `${-at.x * SCALE}px ${-at.y * SCALE}px`;
  body.style.transform = frame.facing < 0 && playing.facing === 'side' ? 'scaleX(-1)' : '';
}

function hide(place: HTMLDivElement | null) {
  if (place !== null) place.style.visibility = 'hidden';
}

/** Puts the `!` up for a moment. */
function showMark(mark: HTMLSpanElement | null, timer: ReturnType<typeof setTimeout> | null): ReturnType<typeof setTimeout> | null {
  if (mark === null) return timer;
  mark.style.visibility = 'visible';
  if (timer !== null) clearTimeout(timer);
  return setTimeout(() => {
    mark.style.visibility = '';
  }, MARK_MS);
}

type FigureProps = {
  placeRef: React.RefObject<HTMLDivElement | null>;
  bodyRef: React.RefObject<HTMLSpanElement | null>;
  markRef: React.RefObject<HTMLSpanElement | null>;
  label: string;
  own: boolean;
  look: Look;
};

/** One figure on the strip: the character (or the placeholder field), its name on hover, and the `!` over its head. */
function Figure({ placeRef, bodyRef, markRef, label, own, look }: FigureProps) {
  const size = sizeOf(look);
  const rows = look === null ? 0 : Math.ceil(look.sheet.cells / look.sheet.columns);
  // The `!` sits just over the head (`sheet.head`), not over the box's empty top.
  const markBottom = look === null ? undefined : size.h - look.sheet.head * SCALE + 2;
  return (
    <div
      ref={placeRef}
      role="img"
      aria-label={own ? 'Your companion' : `${label}'s companion`}
      className="group pointer-events-auto invisible absolute left-0 top-0 overflow-visible"
      style={{ width: size.w, height: size.h }}
      data-companion={own ? 'own' : 'room'}
      data-mood="stand"
      data-facing="right"
    >
      {/* Its owner's name, over its head on hover: absolutely placed, so it moves nothing. */}
      <span
        className="invisible absolute bottom-full left-0 mb-1 whitespace-nowrap border border-ink bg-ink px-1 font-mono text-label text-paper group-hover:visible"
        data-companion-name
      >
        {label}
      </span>
      {/* The `!`: text, not art (SPEC-companion.md, decision 3). */}
      <span
        ref={markRef}
        className={`invisible absolute right-0 border border-ink bg-sun-pale px-1 font-mono text-label leading-none text-ink ${look === null ? 'bottom-full mb-1' : ''}`}
        style={markBottom === undefined ? undefined : { bottom: markBottom }}
        data-companion-mark
      >
        !
      </span>
      {look === null ? (
        // No SHOWN character: the placeholder field.
        <span ref={bodyRef} className={`${SPRITE_SLOT} block h-full w-full`} data-companion-figure="placeholder" />
      ) : (
        // A cell of the owner's baked strip, whole pixels, no smoothing; the loop moves the window onto each cell.
        <span
          ref={bodyRef}
          className="block h-full w-full overflow-hidden"
          style={{
            backgroundImage: `url("${look.stripUrl}")`,
            backgroundRepeat: 'no-repeat',
            backgroundSize: `${look.sheet.columns * look.sheet.cell.w * SCALE}px ${rows * look.sheet.cell.h * SCALE}px`,
            imageRendering: 'pixelated',
          }}
          data-companion-figure="character"
        />
      )}
    </div>
  );
}

/** A share of the strip's width, rounded so a pixel's wobble is not a new message. */
function share(x: number, floor: Floor, size: Size): number {
  const room = Math.max(1, floor.screen - size.w);
  return Math.round(Math.min(1, Math.max(0, x / room)) * 1000) / 1000;
}

/**
 * How many reactions this tab's companion has had, kept outside the figure's loop: a viewer hops when it sees a bigger
 * number than last time, so the count must never go back down when the loop restarts (the switch, reduced motion).
 */
let reactions = 0;
let reactionKind: CompanionWire['k'] = null;

/** The strip's own hop, in ticks, or the placeholder's. */
const hopLength = (look: Look): number => (look === null ? HOP.length : look.sheet.motions.hop.ticks.length);

function OwnCompanion({ label, musicPlaying, still, look, lookRef }: { label: string; musicPlaying: boolean; still: boolean; look: Look; lookRef: string | null }) {
  const placeRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLSpanElement>(null);
  const markRef = useRef<HTMLSpanElement>(null);
  const music = useRef(musicPlaying);
  const wearing = useRef<{ look: Look; ref: string | null }>({ look, ref: lookRef });
  useEffect(() => {
    music.current = musicPlaying;
  }, [musicPlaying]);
  useEffect(() => {
    wearing.current = { look, ref: lookRef };
  }, [look, lookRef]);

  useEffect(() => {
    const place = placeRef.current;
    const mark = markRef.current;
    const now = Date.now();
    let brain: BrainState = startBrain(now);
    let lastActivity = now;
    let pointer: { x: number; y: number } | null = null;
    let x: number | null = null;
    let facing: 1 | -1 = 1;
    let frame = 0;
    let hop = -1;
    let dance = pickDance();
    let motion: MotionId = 'idle';
    let motionTick = 0;
    let markTimer: ReturnType<typeof setTimeout> | null = null;
    let lastSaid: { mood: CompanionMood; target: number | null; ref: string | null; at: number } | null = null;

    const say = (floor: Floor, size: Size, force: boolean) => {
      const target = brain.target ?? x ?? 0;
      const ref = wearing.current.ref;
      const changed = lastSaid === null || lastSaid.mood !== brain.mood || lastSaid.target !== brain.target || lastSaid.ref !== ref;
      if (!changed && !force) return;
      if (!force && brain.mood === 'chase' && lastSaid?.mood === 'chase' && lastSaid.ref === ref && Date.now() - lastSaid.at < CHASE_SAY_MS) return;
      lastSaid = { mood: brain.mood, target: brain.target, ref, at: Date.now() };
      sayCompanion({ x: share(target, floor, size), m: brain.mood, r: reactions, k: reactionKind, c: ref });
    };

    const tick = () => {
      const look = wearing.current.look;
      const size = sizeOf(look);
      const floor = floorNow(size);
      const span: Span | null = spanFor(floor.spans, x ?? floor.screen - size.w - 48);
      if (span === null) {
        hide(place);
        return;
      }
      if (x === null) x = span.right;
      if (x < span.left || x > span.right) x = Math.min(span.right, Math.max(span.left, x));

      if (still) {
        brain = { mood: 'stand', target: null, until: Infinity, chaseUntil: 0 };
        draw(place, bodyRef.current, look, { x, floorY: floor.y, facing, mood: 'stand', motion: 'idle', tick: 0, lift: 0 });
        say(floor, size, false);
        return;
      }

      const near = pointer !== null && pointer.y >= floor.y - NEAR_PX ? pointer.x - size.w / 2 : null;
      const was = brain.mood;
      brain = think(brain, { now: Date.now(), lastActivity, musicPlaying: music.current, pointerX: near, x, span, random: Math.random });
      if (was === 'sleep' && brain.mood !== 'sleep') react('wake');
      if (was !== 'dance' && brain.mood === 'dance') dance = pickDance();

      if (brain.target !== null && (brain.mood === 'walk' || brain.mood === 'chase')) {
        const step = brain.mood === 'chase' ? CHASE_STEP : WALK_STEP;
        const gap = brain.target - x;
        if (Math.abs(gap) >= 1) {
          facing = gap > 0 ? 1 : -1;
          x += Math.sign(gap) * Math.min(step, Math.abs(gap));
        }
      }
      const walking = brain.target !== null && Math.abs(brain.target - x) >= 1;

      frame += 1;
      let lift = 0;
      let next: MotionId;
      if (hop >= 0) {
        next = 'hop';
        if (look === null) lift = HOP[hop] ?? 0;
        hop = hop + 1 < hopLength(look) ? hop + 1 : -1;
      } else {
        next = motionFor(brain.mood === 'walk' && !walking ? 'stand' : brain.mood, dance);
        // The placeholder has no dance of its own: a stepped bob, turning every half second.
        if (look === null && brain.mood === 'dance') {
          lift = frame % 4 < 2 ? -2 : 0;
          if (frame % 5 === 0) facing = facing === 1 ? -1 : 1;
        }
      }
      motionTick = next === motion ? motionTick + 1 : 0;
      motion = next;
      draw(place, bodyRef.current, look, { x, floorY: floor.y, facing, mood: brain.mood, motion, tick: motionTick, lift });
      say(floor, size, false);
    };

    const react = (kind: NonNullable<CompanionWire['k']>) => {
      reactions += 1;
      reactionKind = kind;
      if (!still) hop = 0;
      if (reactionShowsMark(kind)) markTimer = showMark(mark, markTimer);
      const size = sizeOf(wearing.current.look);
      say(floorNow(size), size, true);
    };

    const active = () => {
      lastActivity = Date.now();
    };
    const onMove = (event: PointerEvent) => {
      active();
      if (event.pointerType === 'touch') return;
      pointer = { x: event.clientX, y: event.clientY };
    };
    const onOut = (event: PointerEvent) => {
      if (event.relatedTarget === null) pointer = null;
    };
    const onBlur = () => {
      pointer = null;
    };
    const onFigure = (event: PointerEvent) => {
      if (event.button === 0) react('poke');
    };

    const offPoke = onCompanionPoke(react);
    place?.addEventListener('pointerdown', onFigure);
    window.addEventListener('pointermove', onMove, { passive: true });
    window.addEventListener('pointerdown', active, { passive: true });
    window.addEventListener('keydown', active, { passive: true });
    window.addEventListener('scroll', active, { passive: true, capture: true });
    window.addEventListener('wheel', active, { passive: true });
    document.addEventListener('pointerout', onOut, { passive: true });
    window.addEventListener('blur', onBlur);
    tick();
    const timer = setInterval(tick, TICK_MS);

    return () => {
      clearInterval(timer);
      if (markTimer !== null) clearTimeout(markTimer);
      offPoke();
      place?.removeEventListener('pointerdown', onFigure);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerdown', active);
      window.removeEventListener('keydown', active);
      window.removeEventListener('scroll', active, { capture: true });
      window.removeEventListener('wheel', active);
      document.removeEventListener('pointerout', onOut);
      window.removeEventListener('blur', onBlur);
      sayCompanion(null);
    };
  }, [still]);

  return <Figure placeRef={placeRef} bodyRef={bodyRef} markRef={markRef} label={label} own look={look} />;
}

/** Somebody else's companion in the room: wears their SHOWN character, walks where their browser says, plays the rest. */
function RoomFigure({ companion, still }: { companion: RoomCompanion; still: boolean }) {
  const placeRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLSpanElement>(null);
  const markRef = useRef<HTMLSpanElement>(null);
  // Anyone may read anyone's SHOWN character (SPEC-profile-characters.md); the figure is keyed by the strip the owner
  // says it wears, so a new one is read again.
  const shown = useShownCharacter(companion.wire.c === null ? null : companion.userId);
  const look = useMemo<Look>(() => (shown === null || shown === undefined ? null : { stripUrl: shown.stripUrl, sheet: shown.sheet }), [shown]);
  const wire = useRef(companion.wire);
  const wearing = useRef(look);
  useEffect(() => {
    wire.current = companion.wire;
  }, [companion.wire]);
  useEffect(() => {
    wearing.current = look;
  }, [look]);

  useEffect(() => {
    const place = placeRef.current;
    const mark = markRef.current;
    let x: number | null = null;
    let facing: 1 | -1 = 1;
    let frame = 0;
    let hop = -1;
    let dance = pickDance();
    let motion: MotionId = 'idle';
    let motionTick = 0;
    let seen: number | null = null;
    let markTimer: ReturnType<typeof setTimeout> | null = null;

    const tick = () => {
      const lookNow = wearing.current;
      const size = sizeOf(lookNow);
      const floor = floorNow(size);
      const now = wire.current;
      const target = now.x * Math.max(1, floor.screen - size.w);
      const span = spanFor(floor.spans, x ?? target);
      if (span === null) {
        hide(place);
        return;
      }
      const goal = Math.min(span.right, Math.max(span.left, target));
      if (x === null || still) x = goal;

      // A bigger reaction count than last seen is a hop (and maybe a `!`); the first sight only notes it.
      if (seen === null) seen = now.r;
      else if (now.r > seen) {
        seen = now.r;
        if (!still) hop = 0;
        if (now.k !== null && reactionShowsMark(now.k)) markTimer = showMark(mark, markTimer);
      }

      if (still) {
        draw(place, bodyRef.current, lookNow, { x, floorY: floor.y, facing, mood: 'stand', motion: 'idle', tick: 0, lift: 0 });
        return;
      }

      const walking = Math.abs(goal - x) >= 1;
      if (walking) {
        const step = now.m === 'chase' ? CHASE_STEP : WALK_STEP;
        facing = goal > x ? 1 : -1;
        x += Math.sign(goal - x) * Math.min(step, Math.abs(goal - x));
      }
      const mood: CompanionMood = walking ? (now.m === 'chase' ? 'chase' : 'walk') : now.m === 'walk' || now.m === 'chase' ? 'stand' : now.m;
      if (mood === 'dance' && motion !== dance && !DANCES.includes(motion)) dance = pickDance();

      frame += 1;
      let lift = 0;
      let next: MotionId;
      if (hop >= 0) {
        next = 'hop';
        if (lookNow === null) lift = HOP[hop] ?? 0;
        hop = hop + 1 < hopLength(lookNow) ? hop + 1 : -1;
      } else {
        next = motionFor(mood, dance);
        if (lookNow === null && mood === 'dance') {
          lift = frame % 4 < 2 ? -2 : 0;
          if (frame % 5 === 0) facing = facing === 1 ? -1 : 1;
        }
      }
      motionTick = next === motion ? motionTick + 1 : 0;
      motion = next;
      draw(place, bodyRef.current, lookNow, { x, floorY: floor.y, facing, mood, motion, tick: motionTick, lift });
    };

    tick();
    const timer = setInterval(tick, TICK_MS);
    return () => {
      clearInterval(timer);
      if (markTimer !== null) clearTimeout(markTimer);
    };
  }, [still]);

  return <Figure placeRef={placeRef} bodyRef={bodyRef} markRef={markRef} label={companion.name || 'SOMEONE'} own={false} look={look} />;
}

export default function Companion() {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const choices = useSyncExternalStore(subscribeToCompanionChoices, companionChoicesState, serverCompanionChoices);
  const others = useSyncExternalStore(subscribeToRoomCompanions, roomCompanionsState, serverRoomCompanions);
  const phone = usePhone();
  const still = useReducedMotion();
  const [musicPlaying, setMusicPlaying] = useState(false);
  // Your SHOWN character: what your companion wears, and whether it is out by default (undefined while it is read).
  const shown = useShownCharacter(userId);

  useEffect(() => {
    void setCompanionAccount(userId);
  }, [userId]);

  // Nothing until the device, the motion setting and your SHOWN character can be read: never one frame on a guess.
  if (phone === null || still === null || shown === undefined) return null;
  const look: Look = shown === null ? null : { stripUrl: shown.stripUrl, sheet: shown.sheet };
  const mine = companionOut(choices, { signedIn: userId !== null, phone, hasShown: shown !== null });
  const drawn = companionsToDraw(others, mine);

  if (!mine && drawn.length === 0) return null;

  return (
    // Under the music bar (z-50) and every window, over the page. Only the figures take the pointer.
    <div className="pointer-events-none fixed inset-0 z-40 overflow-hidden" data-companion-strip>
      {mine ? (
        <>
          <MusicWatch onChange={setMusicPlaying} />
          <CompanionReactions />
          {/* Re-made when the strip changes: a new character is a new box. */}
          <OwnCompanion key={shown?.bakedAt ?? 'placeholder'} label={user?.displayName ?? 'YOU'} musicPlaying={musicPlaying} still={still} look={look} lookRef={shown?.bakedAt ?? null} />
        </>
      ) : null}
      {drawn.map((companion) => (
        <RoomFigure key={`${companion.key}:${companion.wire.c ?? ''}`} companion={companion} still={still} />
      ))}
    </div>
  );
}
