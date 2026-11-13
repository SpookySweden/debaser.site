'use client';

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
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
 * Every frame is a write to `transform` through a ref, ten a second in whole steps (the site's no-easing rule), so
 * nothing re-renders as it walks. Clicks pass straight through everything but the figure itself. Under reduced motion
 * it stands still in one frame.
 *
 * The figure is a placeholder field for now: it will wear the owner's SHOWN character's baked picture strip once
 * SPEC-profile-characters.md is live (`CompanionWire.c` carries which strip). The code never draws a character.
 */

/** The figure's box, in CSS pixels. The baked strips will be drawn to it. */
export const COMPANION_W = 32;
export const COMPANION_H = 32;
/** One frame: ten a second. */
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
/** The hop: how high the figure is on each frame, then back down. */
const HOP = [-4, -8, -10, -8, -4, 0];

/** Whether the music bar is playing, without re-rendering the strip on every tick of the track's clock. */
function MusicWatch({ onChange }: { onChange: (playing: boolean) => void }) {
  const { playing } = useMusicPlayer();
  useEffect(() => onChange(playing), [playing, onChange]);
  return null;
}

/** The floor, measured at most once a second (and at once when the screen changes size), shared by every figure. */
let floorCache: { at: number; w: number; h: number; floor: Floor } | null = null;
function floorNow(): Floor {
  const now = Date.now();
  const w = window.innerWidth;
  const h = window.innerHeight;
  if (floorCache === null || now - floorCache.at > 1_000 || floorCache.w !== w || floorCache.h !== h) {
    floorCache = { at: now, w, h, floor: measureFloor(COMPANION_W, COMPANION_H) };
  }
  return floorCache.floor;
}

function draw(place: HTMLDivElement | null, body: HTMLSpanElement | null, x: number, floorY: number, lift: number, facing: 1 | -1, mood: CompanionMood) {
  if (place !== null) {
    // Its name opens toward the middle of the screen, so it is never cut off at either edge.
    const side = x > window.innerWidth / 2 ? 'right' : 'left';
    if (place.dataset.side !== side) {
      place.dataset.side = side;
      const tag = place.querySelector<HTMLElement>('[data-companion-name]');
      if (tag !== null) {
        tag.style.left = side === 'left' ? '0' : 'auto';
        tag.style.right = side === 'right' ? '0' : 'auto';
      }
    }
    place.style.transform = `translate3d(${Math.round(x)}px, ${Math.round(floorY - COMPANION_H)}px, 0)`;
    place.style.visibility = 'visible';
    if (place.dataset.mood !== mood) place.dataset.mood = mood;
    const face = facing === 1 ? 'right' : 'left';
    if (place.dataset.facing !== face) place.dataset.facing = face;
  }
  if (body !== null) body.style.transform = lift === 0 ? '' : `translateY(${lift}px)`;
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
};

/** One figure on the strip: the placeholder field, its name on hover, and the `!` over its head. */
function Figure({ placeRef, bodyRef, markRef, label, own }: FigureProps) {
  return (
    <div
      ref={placeRef}
      role="img"
      aria-label={own ? 'Your companion' : `${label}'s companion`}
      className="group pointer-events-auto invisible absolute left-0 top-0"
      style={{ width: COMPANION_W, height: COMPANION_H }}
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
        className="invisible absolute bottom-full right-0 mb-1 border border-ink bg-sun-pale px-1 font-mono text-label leading-none text-ink"
        data-companion-mark
      >
        !
      </span>
      {/* The figure: a placeholder field until the owner's SHOWN character's baked strip is wired in. */}
      <span ref={bodyRef} className={`${SPRITE_SLOT} block h-full w-full`} data-companion-figure="placeholder" />
    </div>
  );
}

/** A share of the strip's width, rounded so a pixel's wobble is not a new message. */
function share(x: number, floor: Floor): number {
  const room = Math.max(1, floor.screen - COMPANION_W);
  return Math.round(Math.min(1, Math.max(0, x / room)) * 1000) / 1000;
}

/**
 * How many reactions this tab's companion has had, kept outside the figure's loop: a viewer hops when it sees a bigger
 * number than last time, so the count must never go back down when the loop restarts (the switch, reduced motion).
 */
let reactions = 0;
let reactionKind: CompanionWire['k'] = null;

function OwnCompanion({ label, musicPlaying, still }: { label: string; musicPlaying: boolean; still: boolean }) {
  const placeRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLSpanElement>(null);
  const markRef = useRef<HTMLSpanElement>(null);
  const music = useRef(musicPlaying);
  useEffect(() => {
    music.current = musicPlaying;
  }, [musicPlaying]);

  useEffect(() => {
    const place = placeRef.current;
    const body = bodyRef.current;
    const mark = markRef.current;
    const now = Date.now();
    let brain: BrainState = startBrain(now);
    let lastActivity = now;
    let pointer: { x: number; y: number } | null = null;
    let x: number | null = null;
    let facing: 1 | -1 = 1;
    let frame = 0;
    let hop = -1;
    let markTimer: ReturnType<typeof setTimeout> | null = null;
    let lastSaid: { mood: CompanionMood; target: number | null; at: number } | null = null;

    const say = (floor: Floor, force: boolean) => {
      const target = brain.target ?? x ?? 0;
      const changed = lastSaid === null || lastSaid.mood !== brain.mood || lastSaid.target !== brain.target;
      if (!changed && !force) return;
      if (!force && brain.mood === 'chase' && lastSaid?.mood === 'chase' && Date.now() - lastSaid.at < CHASE_SAY_MS) return;
      lastSaid = { mood: brain.mood, target: brain.target, at: Date.now() };
      sayCompanion({ x: share(target, floor), m: brain.mood, r: reactions, k: reactionKind, c: null });
    };

    const tick = () => {
      const floor = floorNow();
      const span: Span | null = spanFor(floor.spans, x ?? floor.screen - COMPANION_W - 48);
      if (span === null) {
        hide(place);
        return;
      }
      if (x === null) x = span.right;
      if (x < span.left || x > span.right) x = Math.min(span.right, Math.max(span.left, x));

      if (still) {
        brain = { mood: 'stand', target: null, until: Infinity, chaseUntil: 0 };
        draw(place, body, x, floor.y, 0, facing, 'stand');
        say(floor, false);
        return;
      }

      const near = pointer !== null && pointer.y >= floor.y - NEAR_PX ? pointer.x - COMPANION_W / 2 : null;
      const was = brain.mood;
      brain = think(brain, { now: Date.now(), lastActivity, musicPlaying: music.current, pointerX: near, x, span, random: Math.random });
      if (was === 'sleep' && brain.mood !== 'sleep') react('wake');

      if (brain.target !== null && (brain.mood === 'walk' || brain.mood === 'chase')) {
        const step = brain.mood === 'chase' ? CHASE_STEP : WALK_STEP;
        const gap = brain.target - x;
        if (Math.abs(gap) >= 1) {
          facing = gap > 0 ? 1 : -1;
          x += Math.sign(gap) * Math.min(step, Math.abs(gap));
        }
      }

      frame += 1;
      let lift = 0;
      if (hop >= 0) {
        lift = HOP[hop];
        hop = hop + 1 < HOP.length ? hop + 1 : -1;
      } else if (brain.mood === 'dance') {
        // A stepped bob, turning every half second: motion only, the strip will carry the dance itself.
        lift = frame % 4 < 2 ? -2 : 0;
        if (frame % 5 === 0) facing = facing === 1 ? -1 : 1;
      }
      draw(place, body, x, floor.y, lift, facing, brain.mood);
      say(floor, false);
    };

    const react = (kind: NonNullable<CompanionWire['k']>) => {
      reactions += 1;
      reactionKind = kind;
      if (!still) hop = 0;
      if (reactionShowsMark(kind)) markTimer = showMark(mark, markTimer);
      say(floorNow(), true);
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

  return <Figure placeRef={placeRef} bodyRef={bodyRef} markRef={markRef} label={label} own />;
}

/** Somebody else's companion in the room: walks to where its owner's browser says, and plays the rest itself. */
function RoomFigure({ companion, still }: { companion: RoomCompanion; still: boolean }) {
  const placeRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLSpanElement>(null);
  const markRef = useRef<HTMLSpanElement>(null);
  const wire = useRef(companion.wire);
  useEffect(() => {
    wire.current = companion.wire;
  }, [companion.wire]);

  useEffect(() => {
    const place = placeRef.current;
    const body = bodyRef.current;
    const mark = markRef.current;
    let x: number | null = null;
    let facing: 1 | -1 = 1;
    let frame = 0;
    let hop = -1;
    let seen: number | null = null;
    let markTimer: ReturnType<typeof setTimeout> | null = null;

    const tick = () => {
      const floor = floorNow();
      const now = wire.current;
      const target = now.x * Math.max(1, floor.screen - COMPANION_W);
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
        draw(place, body, x, floor.y, 0, facing, 'stand');
        return;
      }

      const moving = now.m === 'walk' || now.m === 'chase' || Math.abs(goal - x) >= 1;
      if (moving && Math.abs(goal - x) >= 1) {
        const step = now.m === 'chase' ? CHASE_STEP : WALK_STEP;
        facing = goal > x ? 1 : -1;
        x += Math.sign(goal - x) * Math.min(step, Math.abs(goal - x));
      }
      frame += 1;
      let lift = 0;
      if (hop >= 0) {
        lift = HOP[hop];
        hop = hop + 1 < HOP.length ? hop + 1 : -1;
      } else if (now.m === 'dance') {
        lift = frame % 4 < 2 ? -2 : 0;
        if (frame % 5 === 0) facing = facing === 1 ? -1 : 1;
      }
      draw(place, body, x, floor.y, lift, facing, Math.abs(goal - x) >= 1 && now.m !== 'chase' ? 'walk' : now.m);
    };

    tick();
    const timer = setInterval(tick, TICK_MS);
    return () => {
      clearInterval(timer);
      if (markTimer !== null) clearTimeout(markTimer);
    };
  }, [still]);

  return <Figure placeRef={placeRef} bodyRef={bodyRef} markRef={markRef} label={companion.name || 'SOMEONE'} own={false} />;
}

export default function Companion() {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const choices = useSyncExternalStore(subscribeToCompanionChoices, companionChoicesState, serverCompanionChoices);
  const others = useSyncExternalStore(subscribeToRoomCompanions, roomCompanionsState, serverRoomCompanions);
  const phone = usePhone();
  const still = useReducedMotion();
  const [musicPlaying, setMusicPlaying] = useState(false);

  useEffect(() => {
    void setCompanionAccount(userId);
  }, [userId]);

  // TODO(SPEC-profile-characters.md): true once the account has a SHOWN character; it makes the companion on by default.
  const hasShown = false;
  // Nothing until the device and the motion setting can be read: never one frame on a guess.
  if (phone === null || still === null) return null;
  const mine = companionOut(choices, { signedIn: userId !== null, phone, hasShown });
  const drawn = companionsToDraw(others, mine);

  if (!mine && drawn.length === 0) return null;

  return (
    // Under the music bar (z-50) and every window, over the page. Only the figures take the pointer.
    <div className="pointer-events-none fixed inset-0 z-40 overflow-hidden" data-companion-strip>
      {mine ? (
        <>
          <MusicWatch onChange={setMusicPlaying} />
          <CompanionReactions />
          <OwnCompanion label={user?.displayName ?? 'YOU'} musicPlaying={musicPlaying} still={still} />
        </>
      ) : null}
      {drawn.map((companion) => (
        <RoomFigure key={companion.key} companion={companion} still={still} />
      ))}
    </div>
  );
}

