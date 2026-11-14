'use client';

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { DANCES, type MotionId } from '../lib/character/motion';
import { cellAt, type CharacterSheet } from '../lib/character/sheet';
import { useShownCharacter } from '../lib/character/use-shown-character';
import { fallStep, spanFor, startBrain, think, throwOf, type BrainScene, type BrainState, type Fall, type Span } from '../lib/companion/brain';
import { companionOut } from '../lib/companion/choices';
import {
  companionChoicesState,
  serverCompanionChoices,
  setCompanionAccount,
  subscribeToCompanionChoices,
} from '../lib/companion/companion-slot';
import { onCompanionCatch, onCompanionPoke, onCompanionSpoke } from '../lib/companion/events';
import { LEDGE_SELECTOR, measureFloor, type Floor } from '../lib/companion/floor';
import { holdLedgeHeight } from '../lib/companion/ledge';
import { companionScene } from '../lib/companion/scene';
import { floatingState } from '../lib/ui/floating-player';
import { usePhone, useReducedMotion } from '../lib/companion/use-phone';
import {
  boxOf,
  clipOf,
  climbToward,
  noteRoomSpot,
  PORTAL_AFTER_MS,
  PORTAL_OPEN_MS,
  PORTAL_SIZE,
  PORTAL_STEP_OUT_MS,
  roomFloor,
  roomSpot,
  setCompanionInRoom,
  setCompanionOut,
  visitRoomState,
  whenRoomGoes,
  type VisitLook,
  type VisitPhase,
  type VisitRoom,
} from '../lib/companion/visit';
import {
  COMPANION_POSES,
  companionsToDraw,
  loopMotion,
  reactionIsLocal,
  reactionMark,
  reactionMotion,
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
import NoteTrail from './NoteTrail';
import SpriteSlot from './SpriteSlot';

/**
 * Your companion: your character, living along the bottom of the site on every page (SPEC-companion.md).
 *
 * It walks the top edge of the music bar (or the window's foot when the bar is folded), steps around the folded
 * player, the floating video and the stream's TV box, wanders, sits, falls asleep when nothing has happened for a
 * minute, dances while the music bar plays, chases the pointer when it comes down to the strip, and hops (with a `!`
 * over its head for a reply, a message or someone coming online). In a stream or music room everyone's companions
 * share the strip, each with its owner's name on hover; outside rooms only you see yours.
 *
 * A life of its own (Luke, 2026-11-14): press and drag it and it dangles from the pointer, then drops back to its strip
 * and lands; a press without a drag gets a hop, a wave or a spin in turn. Asleep, little `z`s drift up from it, and left
 * alone for five minutes it curls right up; it stretches when you come back (and waves, after a long sleep). Bored, it
 * stretches, spins or runs back and forth. It runs after the pointer, and changes its dance with the track.
 *
 * It wears its owner's SHOWN character (Luke, 2026-11-13: "Only the shown one"): the picture strip the owner's browser
 * baked from their own hand-built character (SPEC-profile-characters.md, `bake.ts`), played a cell at a time from the
 * strip's own motions (walk, idle, sit, sleep, the dances, hop). With no SHOWN character it is a placeholder field.
 * The code never draws a character.
 *
 * On a profile it climbs up into the room at the foot of the page once the room is on screen, and the room draws it there
 * (`ProfileRoom.tsx`, `../lib/companion/visit.ts`; Luke, 2026-11-13). Leaving the page, it climbs back down from where it
 * stood; if the page changes again before it is down, or it was still climbing up, it vanishes and pops out of a portal on
 * its strip a moment later. Under reduced motion it appears in the room, or back on its strip, standing still.
 *
 * It takes part (2026-11-14, `docs/companion.md`): types along, watches a game or a video, reads along with a book; in a
 * stream room whose window covers its strip it stands on that window's top edge; it waves at newcomers, hops when its
 * owner speaks in a room's chat, and wears a different text mark for each kind of news.
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
/** The placeholder's hop: how high it is on each frame, then back down. A character plays its own one-off motions. */
const HOP = [-4, -8, -10, -8, -4, 0];
/** Two presses on it within this long are a double press: it is picked up, and follows the pointer with no key held. */
const DOUBLE_MS = 400;
/** It waves at a newcomer to the room at most this often. */
const GREET_QUIET_MS = 5_000;
/** A pointer that has not moved for this long is no longer chased. */
const CHASE_FRESH_MS = 8_000;
/** How far a press must move before it is a pick-up, not a poke. */
const GRAB_SLOP = 5;
/** A dance lasts this long before it changes to another (a new track changes it at once). */
const DANCE_MS: readonly [number, number] = [20_000, 40_000];
/** The book's box on its lap while it reads, in CSS pixels (its art slot, `sprite-companion-book`). */
const BOOK_SIZE = 24;
/** How long after the page settles a strip missing the newer motions is baked again. */
const REBAKE_AFTER_MS = 6_000;
/** What a press without a drag gets, in turn. */
const POKES: readonly NonNullable<CompanionWire['k']>[] = ['poke', 'wave', 'spin'];

/** What a figure wears: a SHOWN character's baked strip, or nothing (the placeholder field). */
type Look = { stripUrl: string; sheet: CharacterSheet } | null;

type Size = { w: number; h: number };

/** The box: a cell of the strip, cut at the feet (the spare row under them is margin), or the placeholder's. */
function sizeOf(look: Look): Size {
  return look === null ? PLACEHOLDER : { w: look.sheet.cell.w * SCALE, h: look.sheet.floor * SCALE };
}

/** A dance at random, never the one it is doing now. */
function pickDance(not?: MotionId): MotionId {
  const others = DANCES.filter((dance) => dance !== not);
  return others[Math.floor(Math.random() * others.length)] ?? 'dance1';
}

/** Whether the music bar is playing, and which track, without re-rendering the strip on every tick of the track's clock. */
function MusicWatch({ onChange }: { onChange: (playing: boolean, track: string | null) => void }) {
  const { playing, track } = useMusicPlayer();
  const id = track?.id ?? null;
  useEffect(() => onChange(playing, id), [playing, id, onChange]);
  return null;
}

/** The floor, measured at most once a second (and at once when the screen changes size), shared by figures of a size. */
const floorCache = new Map<string, { at: number; w: number; h: number; ledge: string; floor: Floor }>();
/** Where the stream room's window is just now (its top and two sides, or that it is folded away or not there). */
function ledgeMark(): string {
  const ledge = document.querySelector<HTMLElement>(LEDGE_SELECTOR);
  if (ledge === null) return 'none';
  if (ledge.dataset.minimized === 'true') return 'folded';
  const box = ledge.getBoundingClientRect();
  return `${Math.round(box.left)},${Math.round(box.top)},${Math.round(box.right)}`;
}
function floorNow(size: Size): Floor {
  const now = Date.now();
  const key = `${size.w}x${size.h}`;
  const held = floorCache.get(key);
  // A stream room's window moving, folding or closing changes the floor at once: it is looked at every time (one box).
  const ledge = ledgeMark();
  if (held === undefined || now - held.at > 1_000 || held.w !== window.innerWidth || held.h !== window.innerHeight || held.ledge !== ledge) {
    const floor = measureFloor(size.w, size.h);
    floorCache.set(key, { at: now, w: window.innerWidth, h: window.innerHeight, ledge: ledgeMark(), floor });
    return floor;
  }
  return held.floor;
}

/** Where on the floor a share of it is, and back: the whole screen on the strip, between a room window's two corners on top of one. */
const floorRoom = (floor: Floor, size: Size): number => Math.max(1, floor.right - floor.left - size.w);

/**
 * The middle of what it is watching, across the screen, so it sits facing it: a room's picture, a floating video, the
 * arcade. Null when there is nothing on screen to face. Read once a second at most.
 */
const FOCUS_SELECTOR = '[data-room-picture], [data-floating-player], [data-dock-window="arcade"]';
let focusHeld: { at: number; x: number | null } = { at: 0, x: null };
function focusNow(): number | null {
  const now = Date.now();
  if (now - focusHeld.at <= 1_000) return focusHeld.x;
  let x: number | null = null;
  for (const element of document.querySelectorAll(FOCUS_SELECTOR)) {
    const box = element.getBoundingClientRect();
    if (box.width === 0 || box.height === 0) continue;
    x = box.left + box.width / 2;
    break;
  }
  focusHeld = { at: now, x };
  return x;
}

/**
 * On top of a stream room's window the video is under its feet, not up in front of it: watching from there is a plain
 * sit on the edge, not the looking-up it does from the floor.
 */
const onLedge = (loop: MotionId, floor: Floor): MotionId => (floor.ledge && loop === 'watch' ? 'sit' : loop);

/** Which way to face to look at what it watches; as it was when there is nothing on screen to face. */
function facingFocus(x: number, size: Size, facing: 1 | -1): 1 | -1 {
  const focus = focusNow();
  if (focus === null) return facing;
  return focus >= x + size.w / 2 ? 1 : -1;
}

/** Where a key press was typed into: a text box, or a page being written (DOCS, the board, comms). */
const WRITING = 'input:not([type]), input[type="text"], input[type="search"], input[type="email"], input[type="url"], textarea, [contenteditable="true"]';
/** It types along for this long after the last key. */
const TYPING_MS = 1_500;

/** Places the figure and paints its body: a cell of the strip (mirrored when it faces left), or the placeholder. */
function draw(
  place: HTMLDivElement | null,
  body: HTMLSpanElement | null,
  look: Look,
  frame: { x: number; floorY: number; facing: 1 | -1; mood: CompanionMood; motion: MotionId; tick: number; lift: number; held?: boolean },
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
    // Off its strip in the reader's hand, or falling back to it.
    const held = frame.held === true ? 'true' : 'false';
    if (place.dataset.held !== held) place.dataset.held = held;
    // Up at the top of the screen (on a room's window) its name opens under it: over its head would be off the screen.
    const tag = frame.floorY - size.h < 28 ? 'under' : 'over';
    if (place.dataset.tag !== tag) place.dataset.tag = tag;
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

/** What a press is meant for when it lands on one: a key, a link, a field, a slider. */
const KEYS = 'button, a[href], input, select, textarea, label, summary, [role="button"], [role="slider"], [role="link"], [contenteditable="true"]';

/**
 * A figure standing over a key lets presses through to it (Luke's first rule for it: it never blocks a click). Where its
 * strip runs over a page's own keys (the reader's page keys and seek bar sit right along the foot of the screen), a press
 * on the figure goes to the key under it instead of to the figure, for as long as it stands there; it can be picked up
 * again once it has moved off. Looked at twice a second, at six spots across its box.
 */
function yieldToKeys(place: HTMLDivElement | null): void {
  if (place === null || place.style.visibility !== 'visible') return;
  const box = place.getBoundingClientRect();
  let over = false;
  for (const fx of [0.2, 0.5, 0.8]) {
    for (const fy of [0.45, 0.85]) {
      const under = document.elementsFromPoint(box.left + box.width * fx, box.top + box.height * fy).find((element) => element.closest('[data-companion-strip]') === null);
      if (under !== undefined && under.closest(KEYS) !== null) over = true;
    }
  }
  const want = over ? 'none' : '';
  if (place.style.pointerEvents !== want) place.style.pointerEvents = want;
}

/** Opens the portal (an art slot, `sprite-portal`) with its foot on the strip, centred on `middle`. */
function openPortal(portal: HTMLDivElement | null, middle: number, floorY: number) {
  if (portal === null) return;
  portal.style.transform = `translate3d(${Math.round(middle - PORTAL_SIZE / 2)}px, ${Math.round(floorY - PORTAL_SIZE)}px, 0)`;
  portal.style.visibility = 'visible';
  portal.dataset.open = 'true';
}
function closePortal(portal: HTMLDivElement | null) {
  if (portal === null) return;
  portal.style.visibility = 'hidden';
  portal.dataset.open = 'false';
}

/**
 * Where it is: on its strip, climbing up into a profile's room, in it, climbing down, gone, stepping out of the portal,
 * held up by the reader's pointer, or falling back to its strip.
 */
type Phase = VisitPhase | 'portal' | 'held' | 'fall';

/** A press on the figure: a poke until it moves, then a pick-up. `off` is where on the figure it was taken hold of. */
type Grab = { id: number; startX: number; startY: number; offX: number; offY: number; moved: boolean; px: number; py: number; dx: number; carried: boolean };

/** Puts a text mark (`!`, `VS`, a heart, `...`) up over its head for a moment. */
function showMark(mark: HTMLSpanElement | null, timer: ReturnType<typeof setTimeout> | null, text: string): ReturnType<typeof setTimeout> | null {
  if (mark === null) return timer;
  if (mark.textContent !== text) mark.textContent = text;
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
  /** Whose it is, written on the figure (`data-companion-of`) so a thing dropped on it can find its owner. */
  ownerId: string | null;
  look: Look;
};

/** One figure on the strip: the character (or the placeholder field), its name on hover, and the `!` over its head. */
function Figure({ placeRef, bodyRef, markRef, label, own, ownerId, look }: FigureProps) {
  const size = sizeOf(look);
  const rows = look === null ? 0 : Math.ceil(look.sheet.cells / look.sheet.columns);
  // The `!` sits just over the head (`sheet.head`), not over the box's empty top.
  const markBottom = look === null ? undefined : size.h - look.sheet.head * SCALE + 2;
  // A stream room's window leaves this much room above itself for the companions being drawn (`../lib/companion/ledge.ts`).
  useEffect(() => holdLedgeHeight(size.h), [size.h]);
  return (
    <div
      ref={placeRef}
      role="img"
      aria-label={own ? 'Your companion' : `${label}'s companion`}
      // Yours can be picked up: a grabbing hand over it, and a touch drags it rather than scrolling the page.
      className={`group pointer-events-auto invisible absolute left-0 top-0 overflow-visible ${own ? 'cursor-grab touch-none select-none' : ''}`}
      style={{ width: size.w, height: size.h }}
      data-companion={own ? 'own' : 'room'}
      data-companion-of={ownerId ?? undefined}
      data-mood="stand"
      data-facing="right"
      data-held="false"
    >
      {/* Its owner's name, over its head on hover (not while it is being carried): absolutely placed, so it moves nothing. */}
      <span
        className="invisible absolute bottom-full left-0 mb-1 whitespace-nowrap border border-ink bg-ink px-1 font-mono text-label text-paper group-hover:group-data-[held=false]:visible group-data-[tag=under]:bottom-auto group-data-[tag=under]:top-full group-data-[tag=under]:mt-1 group-data-[tag=under]:mb-0"
        data-companion-name
      >
        {label}
      </span>
      {/* Colourful music notes while it dances (Luke, 2026-11-13) and little `z`s while it sleeps (2026-11-14), from
          about where its sunk head is: text, not art, and none under reduced motion. */}
      <NoteTrail watch={placeRef} sleepAt={look === null ? size.h : Math.round((size.h - look.sheet.head * SCALE) * 0.6)} />
      {/* The `!`: text, not art (SPEC-companion.md, decision 3). */}
      <span
        ref={markRef}
        className={`invisible absolute right-0 border border-ink bg-sun-pale px-1 font-mono text-label leading-none text-ink ${look === null ? 'bottom-full mb-1' : ''}`}
        style={markBottom === undefined ? undefined : { bottom: markBottom }}
        data-companion-mark
      >
        !
      </span>
      {/* Typing along (Luke, 2026-11-14): `...` over its head for as long as it plays `type`. Text, not art. */}
      <span
        className={`invisible absolute right-0 border border-ink bg-sun-pale px-1 font-mono text-label leading-none text-ink group-data-[motion=type]:visible ${look === null ? 'bottom-full mb-1' : ''}`}
        style={markBottom === undefined ? undefined : { bottom: markBottom }}
        data-companion-typing
      >
        ...
      </span>
      {/* The book it reads along from: Luke's to draw (an art slot), an empty dithered field on its lap until it is filed.
          There only while it plays `read` or turns a page, on the side it faces. */}
      <span
        aria-hidden="true"
        className="absolute bottom-1 hidden group-data-[motion=flick]:block group-data-[motion=read]:block group-data-[facing=left]:left-1 group-data-[facing=left]:-scale-x-100 group-data-[facing=right]:right-1"
        data-companion-book
      >
        <SpriteSlot src="/assets/sprites/companion-book.gif" alt="" width={BOOK_SIZE} height={BOOK_SIZE} title="Its book appears here once assets/sprites/companion-book.gif is drawn" />
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
  return Math.round(Math.min(1, Math.max(0, (x - floor.left) / floorRoom(floor, size))) * 1000) / 1000;
}

/**
 * How many reactions this tab's companion has had, kept outside the figure's loop: a viewer hops when it sees a bigger
 * number than last time, so the count must never go back down when the loop restarts (the switch, reduced motion).
 */
let reactions = 0;
let reactionKind: CompanionWire['k'] = null;

/** How long a one-off motion plays, in ticks: the strip's own, or the placeholder's hop. */
const actLength = (look: Look, motion: MotionId): number => (look === null ? HOP.length : look.sheet.motions[motion].ticks.length);

/** A one-off motion being played through once: which, and how far in. */
type Act = { motion: MotionId; tick: number };

type OwnProps = {
  label: string;
  /** Whose it is: it hops when this account speaks in a room's chat. */
  userId: string | null;
  /** The other companions in the room just now, as their keys joined up: it waves at a new one. */
  roomKeys: string;
  musicPlaying: boolean;
  track: string | null;
  still: boolean;
  look: Look;
  lookRef: string | null;
};

function OwnCompanion({ label, userId, roomKeys, musicPlaying, track, still, look, lookRef }: OwnProps) {
  const placeRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLSpanElement>(null);
  const markRef = useRef<HTMLSpanElement>(null);
  const portalRef = useRef<HTMLDivElement>(null);
  const music = useRef({ playing: musicPlaying, track });
  const wearing = useRef<{ look: Look; ref: string | null }>({ look, ref: lookRef });
  useEffect(() => {
    music.current = { playing: musicPlaying, track };
  }, [musicPlaying, track]);
  const company = useRef({ userId, keys: roomKeys });
  useEffect(() => {
    company.current = { userId, keys: roomKeys };
  }, [userId, roomKeys]);
  useEffect(() => {
    wearing.current = { look, ref: lookRef };
  }, [look, lookRef]);

  useEffect(() => {
    const place = placeRef.current;
    const mark = markRef.current;
    const portal = portalRef.current;
    const now = Date.now();
    let brain: BrainState = startBrain(now);
    let lastActivity = now;
    let pointer: { x: number; y: number; at: number } | null = null;
    let x: number | null = null;
    let facing: 1 | -1 = 1;
    let frame = 0;
    /** The one-off it is playing through (a hop, a stretch, a cheer), and any waiting their turn after it. */
    let act: Act | null = null;
    const queue: MotionId[] = [];
    let dance = pickDance();
    let danceUntil = 0;
    /** The track its dance was picked for; undefined before its first dance. */
    let dancedTrack: string | null | undefined;
    let motion: MotionId = 'idle';
    let motionTick = 0;
    /** The loop it is in, and that loop as the room hears it (`CompanionWire.p`: not every pose is the room's business). */
    let looping: MotionId = 'idle';
    let posing: MotionId | null = null;
    let pokes = 0;
    /** How far into its start at being lifted it is; -1 once it hangs. */
    let lifting = -1;
    /** When it was last pressed without a drag: a second press soon after picks it up. */
    let lastTap = 0;
    let wasOnLedge = false;
    /** The room's companions it has waved at, and when it last waved (a busy door is not a flapping arm). */
    const greeted = new Set<string>();
    let greetedKeys = '';
    let lastGreet = 0;
    /** It types along until then: a moment after the last key typed into a text box. */
    let typingUntil = 0;
    /** A press on it, and the fall after it is let go. */
    let grab: Grab | null = null;
    let fall: Fall | null = null;
    let markTimer: ReturnType<typeof setTimeout> | null = null;
    let lastSaid: { mood: CompanionMood; target: number | null; ref: string | null; pose: MotionId | null; share: number; at: number } | null = null;
    // Visiting a profile's room.
    let phase: Phase = 'strip';
    /** Its feet while it climbs, from the top of the screen. */
    let y = 0;
    /** The room it is climbing into, or is in. */
    let visiting: VisitRoom | null = null;
    let path = window.location.pathname;
    /** The page it started climbing down on: another page before it is down, and it vanishes. */
    let downFrom = path;
    let goneUntil = 0;
    let stepOutAt = 0;
    let portalUntil = 0;

    const leaveRoom = () => {
      visiting = null;
      setCompanionInRoom(false);
    };
    const vanish = () => {
      phase = 'gone';
      goneUntil = Date.now() + PORTAL_AFTER_MS;
      leaveRoom();
      hide(place);
    };

    const say = (floor: Floor, size: Size, force: boolean) => {
      const target = brain.target ?? x ?? 0;
      const ref = wearing.current.ref;
      // Where along its floor, as the room hears it. Standing or sitting it has no target, and this only changes when it
      // is put somewhere else (carried, or its floor changed under it: up onto a room's window), which the room is told once.
      const at = share(target, floor, size);
      const changed =
        lastSaid === null || lastSaid.mood !== brain.mood || lastSaid.target !== brain.target || lastSaid.ref !== ref || lastSaid.pose !== posing || lastSaid.share !== at;
      if (!changed && !force) return;
      if (!force && brain.mood === 'chase' && lastSaid?.mood === 'chase' && lastSaid.ref === ref && Date.now() - lastSaid.at < CHASE_SAY_MS) return;
      lastSaid = { mood: brain.mood, target: brain.target, ref, pose: posing, share: at, at: Date.now() };
      sayCompanion({ x: at, m: brain.mood, r: reactions, k: reactionKind, c: ref, p: posing });
    };

    /** The next frame of a loop: on from where it was, or from its start when it is a new one. */
    const play = (next: MotionId) => {
      motionTick = next === motion ? motionTick + 1 : 0;
      motion = next;
    };

    const tick = () => {
      const look = wearing.current.look;
      const size = sizeOf(look);
      const floor = floorNow(size);
      const now = Date.now();
      const room = visitRoomState();
      const pathNow = window.location.pathname;
      const pageChanged = pathNow !== path;
      path = pathNow;
      if (portalUntil !== 0 && now >= portalUntil) {
        portalUntil = 0;
        closePortal(portal);
      }

      // In the reader's hand: it hangs where the pointer has it, swinging, never off the screen or under its own floor.
      if (phase === 'held' && grab !== null) {
        const nx = Math.round(Math.min(Math.max(0, floor.screen - size.w), Math.max(0, grab.px - grab.offX)));
        // (From on top of a room's window it can be carried anywhere down the screen; let go, it is back up on the window.)
        const ny = Math.round(Math.min(floor.ledge ? window.innerHeight : floor.y, Math.max(size.h, grab.py + grab.offY)));
        grab.dx = x === null ? 0 : nx - x;
        x = nx;
        y = ny;
        // Just lifted: a start and a wriggle (`lifted`), once, and then it hangs.
        if (lifting >= 0 && lifting < actLength(look, 'lifted')) {
          motion = 'lifted';
          motionTick = lifting;
          lifting += 1;
        } else {
          lifting = -1;
          play('dangle');
        }
        draw(place, bodyRef.current, look, { x, floorY: y, facing, mood: 'stand', motion, tick: motionTick, lift: 0, held: true });
        return;
      }
      // Let go: down it comes, onto the nearest stretch of its strip it can stand on, and lands.
      if (phase === 'held' || phase === 'fall') {
        const from: Fall = fall ?? { x: x ?? 0, y, vx: 0, vy: 0, landed: false };
        const next = fallStep(from, floor.y, floor.screen - size.w);
        const under = spanFor(floor.spans, next.x);
        // Over something it steps around (the folded player, a floating video): it slides off to the side as it falls.
        const slid = under === null ? next.x : Math.min(under.right, Math.max(under.left, next.x));
        x = next.landed ? slid : next.x + Math.sign(slid - next.x) * Math.min(16, Math.abs(slid - next.x));
        y = next.y;
        fall = { ...next, x };
        if (!next.landed) {
          phase = 'fall';
          play('dangle');
          draw(place, bodyRef.current, look, { x, floorY: y, facing, mood: 'stand', motion, tick: motionTick, lift: 0, held: true });
          return;
        }
        fall = null;
        phase = 'strip';
        if (place !== null) place.style.cursor = '';
        brain = startBrain(now);
        lastActivity = now;
        react('land');
      }

      if (still) {
        // Reduced motion: nothing climbs. It is in a profile's room while there is one, and back on its strip when it goes.
        if (room !== null) {
          if (visiting !== room) {
            visiting = room;
            phase = 'room';
            noteRoomSpot(null);
            setCompanionInRoom(true, Math.max(0, room.stage.clientWidth - size.w - 16));
          }
          hide(place);
          return;
        }
        if (phase === 'room') {
          phase = 'strip';
          leaveRoom();
        }
      } else {
        // In a profile's room, the room draws it. When the room goes (the page changed) it climbs down from where it stood,
        // or vanishes when that spot was off screen.
        if (phase === 'room') {
          if (room !== null && room === visiting) {
            hide(place);
            return;
          }
          const spot = roomSpot();
          phase = whenRoomGoes('room', spot !== null && spot.onScreen && spot.bottom <= floor.y);
          leaveRoom();
          if (phase === 'down' && spot !== null) {
            x = spot.left;
            y = spot.bottom;
            downFrom = pathNow;
          } else {
            vanish();
            return;
          }
        }
        // The room went (or the page changed) while it was still climbing up; another page while it climbs down.
        if (phase === 'up' && (room === null || room !== visiting || pageChanged)) {
          vanish();
          return;
        }
        if (phase === 'down' && pathNow !== downFrom) {
          vanish();
          return;
        }
        if (phase === 'gone') {
          if (now < goneUntil) {
            hide(place);
            return;
          }
          // Back on its strip, out of a portal.
          const back = spanFor(floor.spans, x ?? floor.screen - size.w - 48);
          if (back === null) {
            hide(place);
            return;
          }
          x = Math.min(back.right, Math.max(back.left, x ?? back.right));
          openPortal(portal, x + size.w / 2, floor.y);
          portalUntil = now + PORTAL_OPEN_MS;
          stepOutAt = now + PORTAL_STEP_OUT_MS;
          phase = 'portal';
        }
        if (phase === 'portal') {
          if (now < stepOutAt) {
            hide(place);
            return;
          }
          phase = 'strip';
          brain = startBrain(now);
          act = { motion: 'hop', tick: 0 };
        }
        // Climbing, a step a frame with its own climbing frames: up into the room (walking along its strip to under it
        // first), or back down to its strip.
        if (phase === 'up' && visiting !== null) {
          const into = roomFloor(boxOf(visiting.stage), clipOf(visiting.stage), size, floor.y);
          if (into === null) {
            // Scrolled away above it: back down.
            visiting = null;
            phase = 'down';
            downFrom = pathNow;
          } else {
            const from = x ?? into.left;
            const column = Math.min(into.right, Math.max(into.left, from));
            const strip = spanFor(floor.spans, column);
            const below = strip === null ? column : Math.min(strip.right, Math.max(strip.left, column));
            if (y >= floor.y && Math.abs(below - from) >= 1) {
              facing = below > from ? 1 : -1;
              x = from + Math.sign(below - from) * Math.min(WALK_STEP, Math.abs(below - from));
            } else {
              if (Math.abs(column - from) >= 1) {
                facing = column > from ? 1 : -1;
                x = from + Math.sign(column - from) * Math.min(WALK_STEP, Math.abs(column - from));
              } else x = from;
              y = climbToward(y, into.floor);
            }
            if (y === into.floor && Math.abs(column - (x ?? column)) < 1) {
              phase = 'room';
              noteRoomSpot(null);
              setCompanionInRoom(true, (x ?? column) - boxOf(visiting.stage).left);
              hide(place);
              return;
            }
          }
        }
        if (phase === 'down') y = climbToward(y, floor.y);
        if (phase === 'up' || phase === 'down') {
          // Off its strip it climbs, its back to you, reaching up (Luke, 2026-11-14); along the strip to under the room it walks.
          play(y < floor.y ? 'climb' : 'walk');
          draw(place, bodyRef.current, look, { x: x ?? 0, floorY: y, facing, mood: 'walk', motion, tick: motionTick, lift: 0 });
          if (phase === 'down' && y >= floor.y) phase = 'strip';
          return;
        }
      }

      const span: Span | null = spanFor(floor.spans, x ?? floor.screen - size.w - 48);
      if (span === null) {
        hide(place);
        return;
      }
      if (x === null) x = span.right;
      // Up onto a room's window: somewhere along its edge, so a room's companions do not all land on one corner.
      if (floor.ledge && !wasOnLedge) x = Math.round(span.left + Math.random() * (span.right - span.left));
      wasOnLedge = floor.ledge;
      if (x < span.left || x > span.right) x = Math.min(span.right, Math.max(span.left, x));

      // A profile's room on screen: up it goes.
      // (Not from on top of a stream room's window: there is no way down from there but the window going.)
      if (!still && phase === 'strip' && !floor.ledge && room !== null && roomFloor(boxOf(room.stage), clipOf(room.stage), size, floor.y) !== null) {
        phase = 'up';
        visiting = room;
        y = floor.y;
      }

      if (still) {
        brain = { mood: 'stand', target: null, until: Infinity, chaseUntil: 0, pose: null, act: null, laps: 0, home: 0 };
        posing = null;
        draw(place, bodyRef.current, look, { x, floorY: floor.y, facing, mood: 'stand', motion: 'idle', tick: 0, lift: 0 });
        if (Math.floor(now / TICK_MS) % 5 === 0) yieldToKeys(place);
        say(floor, size, false);
        return;
      }

      // The pointer near its strip is chased while it is moving about there. Left resting (or gone into a book's or a
      // video's own frame, whose moves are not heard out here), it is let be after a while: it wanders off, or sits to read.
      // (On top of a room's window "near" is a band about that edge: the whole window is below it, and is not near.)
      const close = pointer !== null && pointer.y >= floor.y - NEAR_PX && (!floor.ledge || pointer.y <= floor.y + NEAR_PX / 2);
      const near = pointer !== null && close && now - pointer.at < CHASE_FRESH_MS ? pointer.x - size.w / 2 : null;
      const was = brain;
      // What you are doing that it can join in with: typing (it hears the keys itself), a game, a book, a video
      // (`../lib/companion/scene.ts`; a video in the floating player counts as one being watched).
      const scene: BrainScene | null = now < typingUntil ? 'type' : (companionScene() ?? (floatingState().entry !== null ? 'watch' : null));
      brain = think(brain, {
        now,
        lastActivity,
        musicPlaying: music.current.playing,
        pointerX: near,
        x,
        span,
        random: Math.random,
        hour: new Date(now).getHours(),
        scene,
      });
      if (was.mood === 'sleep' && brain.mood !== 'sleep') {
        // Awake: a stretch, and after a long sleep a wave for whoever came back.
        react('wake');
        if (was.pose === 'curl') queue.push('wave');
      }
      // Bored: the brain asks for a stretch or a spin, once.
      if (brain.act !== null && act === null) act = { motion: brain.act, tick: 0 };
      // Somebody's companion new to the room (or you new to theirs): a wave, which they see, and theirs waves too.
      const keys = company.current.keys;
      if (keys !== greetedKeys) {
        const present = new Set(keys.split(',').filter((key) => key.length > 0));
        // One that has gone is forgotten, so it gets a wave when it comes back.
        for (const key of greeted) if (!present.has(key)) greeted.delete(key);
        const fresh = [...present].filter((key) => !greeted.has(key));
        if (fresh.length === 0) greetedKeys = keys;
        else if (now - lastGreet >= GREET_QUIET_MS) {
          for (const key of fresh) greeted.add(key);
          greetedKeys = keys;
          lastGreet = now;
          react('wave');
        }
        // (Too soon after its last wave: looked at again next frame, so nobody arriving in that quiet goes unwaved at.)
      }
      // A dance changes with the track, and after a while of the same one: always to a different dance, even when the
      // music stopped for a moment between two tracks. The same track paused and played again keeps its dance.
      const trackNow = music.current.track;
      if (brain.mood === 'dance' && (trackNow !== dancedTrack || now >= danceUntil)) {
        dance = pickDance(dance);
        dancedTrack = trackNow;
        danceUntil = now + DANCE_MS[0] + Math.random() * (DANCE_MS[1] - DANCE_MS[0]);
      }

      if (act === null && queue.length > 0) act = { motion: queue.shift() ?? 'hop', tick: 0 };
      // A hop goes on walking; anything longer (a stretch, a cheer) is done standing where it is.
      const held = act !== null && act.motion !== 'hop';
      if (!held && brain.target !== null && (brain.mood === 'walk' || brain.mood === 'chase')) {
        const step = brain.mood === 'chase' || brain.pose === 'run' ? CHASE_STEP : WALK_STEP;
        const gap = brain.target - x;
        if (Math.abs(gap) >= 1) {
          facing = gap > 0 ? 1 : -1;
          x += Math.sign(gap) * Math.min(step, Math.abs(gap));
        }
      }
      const walking = brain.target !== null && Math.abs(brain.target - x) >= 1;

      frame += 1;
      let lift = 0;
      const loop = onLedge(loopMotion(brain.mood === 'walk' && !walking ? 'stand' : brain.mood, brain.pose, dance), floor);
      looping = loop;
      posing = COMPANION_POSES.includes(loop) ? loop : null;
      // Watching, it sits facing what it watches.
      if (loop === 'watch') facing = facingFocus(x, size, facing);
      if (act !== null) {
        motion = act.motion;
        motionTick = act.tick;
        if (look === null) lift = HOP[act.tick] ?? 0;
        act = act.tick + 1 < actLength(look, act.motion) ? { motion: act.motion, tick: act.tick + 1 } : null;
      } else {
        play(loop);
        // The placeholder has no dance of its own: a stepped bob, turning every half second.
        if (look === null && brain.mood === 'dance') {
          lift = frame % 4 < 2 ? -2 : 0;
          if (frame % 5 === 0) facing = facing === 1 ? -1 : 1;
        }
      }
      draw(place, bodyRef.current, look, { x, floorY: floor.y, facing, mood: brain.mood, motion, tick: motionTick, lift });
      if (frame % 5 === 0 && grab === null) yieldToKeys(place);
      say(floor, size, false);
    };

    const react = (kind: NonNullable<CompanionWire['k']>) => {
      // A page turned is its head flicking across the book, while it reads along. Yours to see only: the room is never
      // told when you turn a page.
      if (kind === 'flick') {
        // A page turned is you being here: a book's keys and taps are heard inside its own frame, not out on the page.
        lastActivity = Date.now();
        if (looping === 'read' && !still) act = { motion: 'flick', tick: 0 };
        return;
      }
      const text = reactionMark(kind);
      if (!still) act = { motion: reactionMotion(kind), tick: 0 };
      if (text !== null) markTimer = showMark(mark, markTimer, text);
      // A look round at a new theme, a hop as you speak in a room's chat: played here, and the room is told nothing (it
      // has the chat line itself, and works the hop out from that).
      if (reactionIsLocal(kind)) return;
      reactions += 1;
      reactionKind = kind;
      const size = sizeOf(wearing.current.look);
      say(floorNow(size), size, true);
    };

    const active = () => {
      lastActivity = Date.now();
    };
    // A key typed into a text box or a page being written: it types along for a moment after each.
    const onKey = (event: KeyboardEvent) => {
      active();
      const into = event.target instanceof Element ? event.target.closest(WRITING) : null;
      if (into !== null && (event.key.length === 1 || event.key === 'Backspace' || event.key === 'Enter') && !event.ctrlKey && !event.metaKey) typingUntil = Date.now() + TYPING_MS;
      // Carried after a double press: Escape puts it down where it hangs.
      if (event.key === 'Escape' && grab !== null && grab.carried) letGo(0);
    };
    const onMove = (event: PointerEvent) => {
      active();
      if (event.pointerType === 'touch') return;
      pointer = { x: event.clientX, y: event.clientY, at: Date.now() };
    };
    const onOut = (event: PointerEvent) => {
      // Off the page, or into a frame (a book's pages, a video): its moves in there are not heard out here, so it is
      // gone as far as the companion can tell, rather than left where it was last seen for it to chase for good.
      if (event.relatedTarget === null || event.relatedTarget instanceof HTMLIFrameElement) pointer = null;
    };
    /** Let go of, from where it hangs: down it comes (the frame loop does the falling), with whatever throw it was given. */
    const letGo = (throwX: number) => {
      grab = null;
      fall = { x: x ?? 0, y, vx: throwX, vy: 0, landed: false };
      phase = 'fall';
    };
    /** Lifted off its strip: whatever it was doing (a hop, a climb up to a room) is dropped, and it starts at being picked up. */
    const liftOff = () => {
      phase = 'held';
      leaveRoom();
      act = null;
      queue.length = 0;
      lifting = still ? -1 : 0;
      // A `!` as it is lifted: text, not art.
      markTimer = showMark(mark, markTimer, '!');
      if (place !== null) {
        // Its own to take presses again (it may have been letting them through to a key under it), and held in the hand.
        place.style.pointerEvents = '';
        place.style.cursor = 'grabbing';
      }
    };
    const onBlur = () => {
      pointer = null;
      // The window lost the pointer mid-carry: it is let go where it hangs.
      if (grab !== null && grab.moved) letGo(0);
      grab = null;
    };
    /** A press without a drag: a hop, a wave, a spin, in turn. */
    const poke = () => {
      react(POKES[pokes % POKES.length]);
      pokes += 1;
    };
    // A press on the figure: a poke if it is let go where it was pressed, a pick-up once it is dragged. Under reduced
    // motion nothing is carried about: a press is a poke (its mark, with no hop).
    /** It can be taken hold of on its strip, or on its way up to or down from a room: not in one, gone, or already held. */
    const canGrab = () => phase === 'strip' || phase === 'up' || phase === 'down';
    const onFigure = (event: PointerEvent) => {
      if (event.button !== 0 || place === null || grab !== null) return;
      if (still || !canGrab()) {
        if (phase === 'strip') poke();
        return;
      }
      const box = place.getBoundingClientRect();
      grab = {
        id: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        offX: event.clientX - box.left,
        offY: box.bottom - event.clientY,
        moved: false,
        px: event.clientX,
        py: event.clientY,
        dx: 0,
        carried: false,
      };
      // The figure keeps hearing the pointer wherever it goes, and the drag selects no text on the page.
      event.preventDefault();
      try {
        place.setPointerCapture(event.pointerId);
      } catch {
        // No capture (the pointer went away already): the moves still reach the window's own listener.
      }
    };
    const onDrag = (event: PointerEvent) => {
      if (grab === null) return;
      // Carried after a double press: it follows the pointer, whichever pointer, with nothing held down.
      if (grab.carried) {
        grab.px = event.clientX;
        grab.py = event.clientY;
        return;
      }
      if (event.pointerId !== grab.id) return;
      grab.px = event.clientX;
      grab.py = event.clientY;
      if (grab.moved || Math.hypot(event.clientX - grab.startX, event.clientY - grab.startY) < GRAB_SLOP) return;
      // Pressed while it climbed, and it has since gone into the room (or vanished): there is nothing here to pick up.
      if (!canGrab()) {
        grab = null;
        return;
      }
      // Picked up.
      grab.moved = true;
      liftOff();
    };
    // Carried after a double press, the next press anywhere puts it down there (Luke, 2026-11-14: "double click to pick
    // up and drag the companion around"). It is under the pointer, so the press lands on it and on nothing behind it.
    const onPutDown = (event: PointerEvent) => {
      if (grab === null || !grab.carried || event.button !== 0) return;
      grab.px = event.clientX;
      grab.py = event.clientY;
      // A finger has no hover: it is put down where the finger next touches, from there.
      if (place !== null) {
        const box = place.getBoundingClientRect();
        x = Math.round(Math.min(Math.max(0, window.innerWidth - box.width), Math.max(0, grab.px - grab.offX)));
        y = Math.round(Math.max(box.height, grab.py + grab.offY));
      }
      letGo(0);
    };
    const onDrop = (event: PointerEvent) => {
      // Carried after a double press, nothing is held down: letting a key go is not letting it go.
      if (grab === null || grab.carried || event.pointerId !== grab.id) return;
      const released = grab;
      grab = null;
      if (!released.moved) {
        // A press let go where it was made is a poke, on its strip only: a climb has no frames to play one in.
        if (event.type !== 'pointerup' || phase !== 'strip') return;
        const at = Date.now();
        if (at - lastTap <= DOUBLE_MS && place !== null) {
          // The second press of two: picked up, to follow the pointer until the next press puts it down. The first
          // press's poke is given back, so the turn of hop, wave, spin is not used up by a pick-up.
          lastTap = 0;
          pokes = Math.max(0, pokes - 1);
          const box = place.getBoundingClientRect();
          grab = { id: -1, startX: event.clientX, startY: event.clientY, offX: box.width / 2, offY: box.height / 2, moved: true, px: event.clientX, py: event.clientY, dx: 0, carried: true };
          liftOff();
          return;
        }
        lastTap = at;
        poke();
        return;
      }
      letGo(throwOf(released.dx));
    };

    const offPoke = onCompanionPoke(react);
    // You speaking in a stream room's chat: it hops with `...` (`../lib/companion/events.ts`).
    const offSpoke = onCompanionSpoke((who) => {
      if (who === company.current.userId) react('spoke');
    });
    place?.addEventListener('pointerdown', onFigure);
    // On the window, not the figure: a let-go is heard wherever it happens, so it can never be left hanging.
    window.addEventListener('pointermove', onDrag, { passive: true });
    window.addEventListener('pointerup', onDrop, { passive: true });
    window.addEventListener('pointercancel', onDrop, { passive: true });
    window.addEventListener('pointerdown', onPutDown, { passive: true });
    // Something handed to you (a letter dropped on your character): it catches it (`../lib/companion/events.ts`).
    const offCatch = onCompanionCatch((who) => {
      if (who === company.current.userId && phase === 'strip') react('catch');
    });
    window.addEventListener('pointermove', onMove, { passive: true });
    window.addEventListener('pointerdown', active, { passive: true });
    window.addEventListener('keydown', onKey, { passive: true });
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
      offSpoke();
      offCatch();
      window.removeEventListener('pointerdown', onPutDown);
      // Gone while it was in the hand (the motion setting changed): nothing of the carry is left on the figure.
      if (place !== null) {
        place.style.cursor = '';
        place.style.pointerEvents = '';
      }
      place?.removeEventListener('pointerdown', onFigure);
      window.removeEventListener('pointermove', onDrag);
      window.removeEventListener('pointerup', onDrop);
      window.removeEventListener('pointercancel', onDrop);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerdown', active);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', active, { capture: true });
      window.removeEventListener('wheel', active);
      document.removeEventListener('pointerout', onOut);
      window.removeEventListener('blur', onBlur);
      sayCompanion(null);
      setCompanionInRoom(false);
      closePortal(portal);
    };
  }, [still]);

  return (
    <>
      {/* The portal it pops back out of: Luke's drawing (an art slot), an empty dithered field until it is filed. Drawn
          first, so the figure stepping out is in front of it. */}
      <div
        ref={portalRef}
        aria-hidden="true"
        className="invisible absolute left-0 top-0"
        style={{ width: PORTAL_SIZE, height: PORTAL_SIZE }}
        data-companion-portal
        data-open="false"
      >
        <SpriteSlot
          src="/assets/sprites/portal.gif"
          alt=""
          width={PORTAL_SIZE}
          height={PORTAL_SIZE}
          title="A portal opens here once assets/sprites/portal.gif is drawn"
        />
      </div>
      <Figure placeRef={placeRef} bodyRef={bodyRef} markRef={markRef} label={label} own ownerId={userId} look={look} />
    </>
  );
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
  const owner = useRef(companion.userId);
  useEffect(() => {
    wire.current = companion.wire;
    owner.current = companion.userId;
  }, [companion.wire, companion.userId]);
  useEffect(() => {
    wearing.current = look;
  }, [look]);

  useEffect(() => {
    const place = placeRef.current;
    const mark = markRef.current;
    let x: number | null = null;
    let facing: 1 | -1 = 1;
    let frame = 0;
    let act: Act | null = null;
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
      const target = floor.left + now.x * floorRoom(floor, size);
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
        if (!still) act = { motion: reactionMotion(now.k), tick: 0 };
        const text = reactionMark(now.k);
        if (text !== null) markTimer = showMark(mark, markTimer, text);
      }

      if (still) {
        draw(place, bodyRef.current, lookNow, { x, floorY: floor.y, facing, mood: 'stand', motion: 'idle', tick: 0, lift: 0 });
        return;
      }

      // As on its owner's screen: a hop goes on walking, anything longer is done standing where it is.
      const busy = act !== null && act.motion !== 'hop';
      const walking = !busy && Math.abs(goal - x) >= 1;
      if (walking) {
        const step = now.m === 'chase' || now.p === 'run' ? CHASE_STEP : WALK_STEP;
        facing = goal > x ? 1 : -1;
        x += Math.sign(goal - x) * Math.min(step, Math.abs(goal - x));
      }
      const mood: CompanionMood = walking ? (now.m === 'chase' ? 'chase' : 'walk') : now.m === 'walk' || now.m === 'chase' ? 'stand' : now.m;
      if (mood === 'dance' && motion !== dance && !DANCES.includes(motion)) dance = pickDance();

      frame += 1;
      let lift = 0;
      if (act !== null) {
        motion = act.motion;
        motionTick = act.tick;
        if (lookNow === null) lift = HOP[act.tick] ?? 0;
        act = act.tick + 1 < actLength(lookNow, act.motion) ? { motion: act.motion, tick: act.tick + 1 } : null;
      } else {
        // The loop its owner's browser says it is in (which dance, a run, a curled-up sleep), when that goes with its mood.
        const next = onLedge(loopMotion(mood, now.p, dance), floor);
        motionTick = next === motion ? motionTick + 1 : 0;
        motion = next;
        if (next === 'watch') facing = facingFocus(x, size, facing);
        if (lookNow === null && mood === 'dance') {
          lift = frame % 4 < 2 ? -2 : 0;
          if (frame % 5 === 0) facing = facing === 1 ? -1 : 1;
        }
      }
      draw(place, bodyRef.current, lookNow, { x, floorY: floor.y, facing, mood, motion, tick: motionTick, lift });
      if (frame % 5 === 0) yieldToKeys(place);
    };

    // Its owner speaking in the room's chat: a hop with `...`, worked out here from the chat line this browser already has.
    const offSpoke = onCompanionSpoke((who) => {
      if (who !== owner.current) return;
      if (!still) act = { motion: 'hop', tick: 0 };
      markTimer = showMark(mark, markTimer, '...');
    });
    // Something handed to its owner (a letter dropped on it here): it catches it, on this screen.
    const offCatch = onCompanionCatch((who) => {
      if (who === owner.current && !still) act = { motion: 'catch', tick: 0 };
    });
    tick();
    const timer = setInterval(tick, TICK_MS);
    return () => {
      clearInterval(timer);
      offSpoke();
      offCatch();
      if (markTimer !== null) clearTimeout(markTimer);
    };
  }, [still]);

  return <Figure placeRef={placeRef} bodyRef={bodyRef} markRef={markRef} label={companion.name || 'SOMEONE'} own={false} ownerId={companion.userId} look={look} />;
}

export default function Companion() {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const choices = useSyncExternalStore(subscribeToCompanionChoices, companionChoicesState, serverCompanionChoices);
  const others = useSyncExternalStore(subscribeToRoomCompanions, roomCompanionsState, serverRoomCompanions);
  const phone = usePhone();
  const still = useReducedMotion();
  const [music, setMusic] = useState<{ playing: boolean; track: string | null }>({ playing: false, track: null });
  const onMusic = useCallback((playing: boolean, track: string | null) => {
    setMusic((now) => (now.playing === playing && now.track === track ? now : { playing, track }));
  }, []);
  // Your SHOWN character: what your companion wears, and whether it is out by default (undefined while it is read).
  const shown = useShownCharacter(userId);

  useEffect(() => {
    void setCompanionAccount(userId);
  }, [userId]);

  // A strip baked before the newer motions is baked again here, once, quietly (Luke's OK, 2026-11-14): on a computer,
  // a few seconds after the page has settled. The baking code is fetched only then.
  const stale = shown !== null && shown !== undefined && shown.stale ? shown : null;
  useEffect(() => {
    if (stale === null || userId === null || phone !== false) return;
    const timer = setTimeout(() => {
      void import('../lib/character/rebake').then(({ rebakeShown }) => rebakeShown(userId, stale));
    }, REBAKE_AFTER_MS);
    return () => clearTimeout(timer);
  }, [stale, userId, phone]);

  const ready = phone !== null && still !== null && shown !== undefined;
  const mine = ready && companionOut(choices, { signedIn: userId !== null, phone, hasShown: shown !== null });
  // What a profile's room needs to know of your companion (`../lib/companion/visit.ts`): whether it is out, and what it wears.
  const visitLook = useMemo<VisitLook>(() => (shown ? { stripUrl: shown.stripUrl, sheet: shown.sheet, mood: shown.mood } : null), [shown]);
  useEffect(() => {
    setCompanionOut({ known: ready, out: mine, look: visitLook, still: still === true });
  }, [ready, mine, visitLook, still]);

  // Nothing until the device, the motion setting and your SHOWN character can be read: never one frame on a guess.
  if (phone === null || still === null || shown === undefined) return null;
  const look: Look = shown === null ? null : { stripUrl: shown.stripUrl, sheet: shown.sheet };
  const drawn = companionsToDraw(others, mine);

  if (!mine && drawn.length === 0) return null;

  return (
    // Under the music bar (z-50) and every window, over the page. Only the figures take the pointer.
    <div className="pointer-events-none fixed inset-0 z-40 overflow-hidden" data-companion-strip>
      {mine ? (
        <>
          <MusicWatch onChange={onMusic} />
          <CompanionReactions />
          {/* Re-made when the strip changes: a new character is a new box. */}
          <OwnCompanion
            key={shown?.bakedAt ?? 'placeholder'}
            label={user?.displayName ?? 'YOU'}
            userId={userId}
            roomKeys={drawn.map((companion) => companion.key).join(',')}
            musicPlaying={music.playing}
            track={music.track}
            still={still}
            look={look}
            lookRef={shown?.bakedAt ?? null}
          />
        </>
      ) : null}
      {drawn.map((companion) => (
        <RoomFigure key={`${companion.key}:${companion.wire.c ?? ''}`} companion={companion} still={still} />
      ))}
    </div>
  );
}
