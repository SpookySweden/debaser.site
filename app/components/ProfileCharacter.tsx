'use client';

import dynamic from 'next/dynamic';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type PointerEvent as ReactPointerEvent, type ReactNode, type RefObject } from 'react';
import type { ShownCharacter } from '../lib/character/profile-character-repository';
import type { CharacterSheet, Mood } from '../lib/character/sheet';
import { SPRITE_SLOT } from '../lib/ui/controls';
import { useShownCharacter } from '../lib/character/use-shown-character';
import { DANCES, type MotionId } from '../lib/character/motion';
import {
  catchIt,
  findLanes,
  greet,
  react,
  startWalker,
  stepWalker,
  WALK_BLOCKS_PER_TICK,
  type Box,
  type Lane,
  type WalkerState,
} from '../lib/character/walker';
import { befriend, kissAfter, kissPhase, kissWalk, sideOf, tiesLeft, type KissPhase } from '../lib/character/friends';
import { onCompanionCatch } from '../lib/companion/events';
import type { Sample } from '../lib/companion/throw';
import CharacterSprite from './CharacterSprite';
import type { LooseGrab } from './LooseCharacter';

/**
 * A character taken out of the room is drawn by `./LooseCharacter.tsx`, fetched only in the browser and only once
 * somebody takes one out (a press starts fetching it): imported up front it broke the production prerender of every
 * page (2026-11-16), and nobody needs it before a press.
 */
const LooseCharacter = dynamic(() => import('./LooseCharacter'), { ssr: false });
import NoteTrail from './NoteTrail';
import { explain } from '../lib/ui/explain';

/**
 * The character a person shows on their profile, living in the page's empty space (SPEC-profile-characters.md).
 *
 * **It walks only where nothing is.** The page is measured - every run of text, picture, key and field inside it - and the
 * character keeps its whole box inside an empty strip (`findLanes`): the gap under a column, along the bottom. It is
 * measured again whenever the page changes size or content. With no strip big enough (a narrow phone, a full page) it
 * isn't shown at all. The layer it lives on lets every click through; only the character itself takes one.
 *
 * **It plays stepped frames** from the strip its owner's browser baked, at the sheet's rate, with nothing blended between
 * them. It dances while the profile's track plays and waves, hops or turns to face you when clicked. Under reduced motion
 * it stands still in its idle frame and nothing ticks.
 */

/** Screen pixels per strip pixel, biggest first: it shrinks before it gives up on a page. */
const SCALES = [3, 2] as const;

const REDUCED = '(prefers-reduced-motion: reduce)';
function subscribeReduced(change: () => void): () => void {
  const query = window.matchMedia(REDUCED);
  query.addEventListener('change', change);
  return () => query.removeEventListener('change', change);
}
const reducedNow = () => window.matchMedia(REDUCED).matches;
const reducedOnServer = () => true;

/** Whether the reader has asked their system for less motion (true on the server, so nothing moves before a browser says it may). */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribeReduced, reducedNow, reducedOnServer);
}

/** Elements whose own box counts as something on the page, besides runs of text. */
const SOLID = 'img, svg, canvas, video, iframe, audio, picture, input, textarea, select, button, a, label, [role="button"], [tabindex]';

/** The boxes of everything on the page inside `root`, relative to it: text, pictures, keys, fields. */
export function measureObstacles(root: HTMLElement, skip: HTMLElement | null): Box[] {
  const origin = root.getBoundingClientRect();
  const boxes: Box[] = [];
  const push = (rect: DOMRect) => {
    if (rect.width === 0 || rect.height === 0) return;
    boxes.push({ left: rect.left - origin.left, top: rect.top - origin.top, right: rect.right - origin.left, bottom: rect.bottom - origin.top });
  };
  const inSkipped = (node: Node) => skip !== null && skip.contains(node);

  for (const element of root.querySelectorAll<HTMLElement>(SOLID)) {
    if (!inSkipped(element)) push(element.getBoundingClientRect());
  }
  // A picture drawn as a background is a picture too.
  for (const element of root.querySelectorAll<HTMLElement>('[style*="background-image"]')) {
    if (!inSkipped(element)) push(element.getBoundingClientRect());
  }
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    if ((node.textContent ?? '').trim().length === 0 || inSkipped(node)) continue;
    range.selectNodeContents(node);
    for (const rect of range.getClientRects()) push(rect);
  }
  return boxes;
}

type Placed = { lane: Lane; scale: number };

/** The longest lane at the biggest scale that has one; the lane it is on now, while that still fits. */
function placeOn(root: HTMLElement, skip: HTMLElement | null, shown: ShownCharacter, current: Placed | null): Placed | null {
  const obstacles = measureObstacles(root, skip);
  const { width, height } = root.getBoundingClientRect();
  for (const scale of SCALES) {
    const w = shown.sheet.cell.w * scale;
    const h = shown.sheet.floor * scale;
    const lanes = findLanes(width, height, obstacles, w, h);
    if (lanes.length === 0) continue;
    const same =
      current === null || current.scale !== scale
        ? undefined
        : lanes.find((lane) => lane.floor === current.lane.floor && lane.from <= current.lane.from + w && lane.to >= current.lane.to - w);
    return { lane: same ?? lanes[0], scale };
  }
  return null;
}

/** Screen pixels per strip pixel in a profile's room: the companion's own scale, so it hands over without a jump. */
export const ROOM_SCALE = 2;
/** The placeholder field's box, when a figure has no SHOWN character to wear (the companion's own size). */
const ROOM_PLACEHOLDER = { w: 32, h: 32 } as const;

/** What a figure in the room wears: a baked strip, or nothing (the placeholder field). */
export type RoomLook = { stripUrl: string; sheet: CharacterSheet } | null;

/** How far a press on a room's character must move before it is taken out of the room, not a hello. */
const GRAB_SLOP = 5;
/** How long after a companion arrives the room's own character waves back. */
const HELLO_BACK_MS = 900;

/** A figure's box in the room: a cell of its strip cut at the feet, or the placeholder's. */
export function roomFigureSize(look: RoomLook): { w: number; h: number } {
  return look === null ? ROOM_PLACEHOLDER : { w: look.sheet.cell.w * ROOM_SCALE, h: look.sheet.floor * ROOM_SCALE };
}

/**
 * One figure living in a profile's room (`ProfileRoom.tsx`; Luke, 2026-11-13): the owner's shown character, or your
 * companion once it has climbed up into it. It walks, idles and dances along the room's floor by its mood, dances while
 * `music` plays (with colourful notes trailing up from it), and waves, hops or turns when pressed. Drawn at the companion's
 * scale, cut at its feet. Under reduced motion it stands still in its idle frame and nothing ticks.
 *
 * `onSpot` hears where it stands on screen after every step (the companion climbs down from there when the page changes).
 *
 * **It can be given something to say** (`speech`; SPEC-character-speech.md, 2026-11-14): it then stops where it is, stands
 * in its idle frame facing the reader, and the bubble is drawn over its head, until `speech` is taken away again. A
 * one-off it is in the middle of (a wave, a hop, a catch) is finished first: speech never breaks a motion off, only a
 * walk, a stand or a dance.
 */
/** The motions something to say may break off: the loops. Anything else is a one-off, and is let finish. */
function breaksOffFor(motion: MotionId): boolean {
  return motion === 'walk' || motion === 'idle' || DANCES.includes(motion);
}

export function RoomWalker({
  look,
  mood,
  music,
  width,
  startX,
  startFacing,
  who,
  label,
  onSpot,
  hello = false,
  person,
  speech,
  onPress,
  friendId,
  spots,
  kiss = null,
}: {
  look: RoomLook;
  mood: Mood;
  music: boolean;
  /** The room's width: how far it may walk. */
  width: number;
  /** Where its left edge starts; somewhere at random when not given. */
  startX?: number;
  /** Which way it faces as it starts (a companion stepping in from the strip faces the way it climbed). */
  startFacing?: 1 | -1;
  /** The owner's character, your companion visiting, or the character of somebody who commented, come to visit. */
  who: 'owner' | 'visitor' | 'guest';
  label: string;
  onSpot?: (figure: HTMLElement) => void;
  /** Somebody to say hello to has just arrived (a companion climbing into the room): it waves back, a moment later. */
  hello?: boolean;
  /** Whose character it is: written on the figure (`data-character-of`), and it catches what is handed to that person. */
  person?: string;
  /** What it is saying: drawn over its head, handed its box in the room, once it is standing still. */
  speech?: ((at: { x: number; w: number; h: number }) => ReactNode) | undefined;
  /** It was pressed (besides its own wave or hop): under reduced motion this is how it is asked to speak. */
  onPress?: () => void;
  /** A friend of its person is in the room too (`../lib/character/friends.ts`): it drifts over to hang out with them. */
  friendId?: string | null;
  /** Where each figure in the room stands, by whose it is (left edges): it writes its own, and reads its friend's. */
  spots?: Map<string, number>;
  /**
   * A kiss with its friend (Luke, 2026-11-22; `../lib/character/friends.ts`): the moment it started, in ms since 1970, or
   * null. It steps in close, faces its friend, leans in with hearts rising, and after it hops or cheers.
   */
  kiss?: number | null;
}) {
  const reduced = useSyncExternalStore(subscribeReduced, reducedNow, reducedOnServer);
  const { w, h } = roomFigureSize(look);
  // Read by the loop below without restarting it: the kiss under way, and the one it is in the middle of playing.
  const kissAt = useRef<number | null>(kiss);
  useEffect(() => {
    kissAt.current = kiss;
  }, [kiss]);
  const kissing = useRef<number | null>(null);
  /** Where its kiss is up to just now (stepping in, or how far it leans toward its friend), else null. */
  const [kissNow, setKissNow] = useState<KissPhase>(null);
  const room = Math.max(0, width - w);
  const [state, setState] = useState<WalkerState>(() => {
    const start = startWalker(room, Math.random);
    // A companion arriving (it starts where it climbed in) waves hello as it steps in.
    return startX === undefined ? start : greet({ ...start, x: Math.round(startX), dir: startFacing ?? start.dir });
  });
  // Something handed to its owner (a letter dropped on it): it catches it (`../lib/companion/events.ts`).
  useEffect(() => {
    if (person === undefined || reduced) return;
    return onCompanionCatch((who) => {
      if (who === person) setState((current) => catchIt(current));
    });
  }, [person, reduced]);
  // The room's own character waves back, a moment after (nothing under reduced motion: it stands still).
  useEffect(() => {
    if (!hello || reduced) return;
    const timer = setTimeout(() => setState((current) => greet(current)), HELLO_BACK_MS);
    return () => clearTimeout(timer);
  }, [hello, reduced]);
  const figure = useRef<HTMLButtonElement>(null);
  const wrap = useRef<HTMLDivElement>(null);

  /**
   * Taken out of the room (Luke, 2026-11-16: "anyone can grab one out of its window; let go, it walks and climbs back in by
   * itself"): pressed and dragged by anybody, it leaves the room for a layer over the page (`./LooseCharacter.tsx`) and
   * comes back by itself. Not your own companion visiting (it is yours to pick up off its strip), not under reduced motion.
   */
  const [loose, setLoose] = useState<{ grab: LooseGrab; stage: HTMLElement } | null>(null);
  /** A drag just took it out: the click that ends the press is not a hello. */
  const dragged = useRef(false);
  const takeOut = (event: ReactPointerEvent<HTMLButtonElement>) => {
    // A fresh press: whatever an earlier drag left behind is forgotten (its release may never have reached this key).
    dragged.current = false;
    if (reduced || who === 'visitor' || event.button !== 0 || loose !== null) return;
    // Fetched now, so it is there by the time the press has moved far enough to take it out.
    void import('./LooseCharacter');
    const button = event.currentTarget;
    const stage = wrap.current?.parentElement ?? null;
    if (stage === null) return;
    const id = event.pointerId;
    const from = { x: event.clientX, y: event.clientY };
    const trail: Sample[] = [{ x: from.x, y: from.y, t: performance.now() }];
    const stop = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', stop);
      window.removeEventListener('pointercancel', stop);
    };
    const onMove = (move: PointerEvent) => {
      if (move.pointerId !== id) return;
      trail.push({ x: move.clientX, y: move.clientY, t: performance.now() });
      if (Math.hypot(move.clientX - from.x, move.clientY - from.y) < GRAB_SLOP) return;
      stop();
      const box = button.getBoundingClientRect();
      dragged.current = true;
      setLoose({
        grab: { pointerId: id, px: move.clientX, py: move.clientY, offX: from.x - box.left, offY: box.bottom - from.y, x: box.left, feet: box.bottom, trail },
        stage,
      });
    };
    window.addEventListener('pointermove', onMove, { passive: true });
    window.addEventListener('pointerup', stop, { passive: true });
    window.addEventListener('pointercancel', stop, { passive: true });
  };
  /** Back in: it steps in where it climbed up, with a wave. */
  const backIn = (left: number | null) => {
    const stage = loose?.stage ?? null;
    setLoose(null);
    // Its release landed on the page, not on this key, so no click came to clear it: the next press is a hello again.
    dragged.current = false;
    if (left === null || stage === null) return;
    const into = Math.round(left - stage.getBoundingClientRect().left);
    setState((current) => greet({ ...current, x: Math.min(Math.max(0, into), room) }));
  };

  const ticksOf = useCallback((motion: MotionId) => (look === null ? 6 : look.sheet.motions[motion].ticks.length), [look]);

  // Read by the loop below without restarting it: whether there is something to say just now.
  const hasSpeech = useRef(false);
  useEffect(() => {
    hasSpeech.current = speech !== undefined;
  });

  useEffect(() => {
    if (reduced || width === 0) return;
    const every = Math.round(1000 / (look?.sheet.fps ?? 10));
    const timer = setInterval(() => {
      const friendX = friendId && spots ? (spots.get(friendId) ?? null) : null;
      // A kiss with its friend (Luke, 2026-11-22: "kiss sometimes with hearts and cutely"): timed from its moment, so the
      // two of them lean in on the same tick.
      const at = kissAt.current;
      const phase = at === null ? null : kissPhase(Date.now() - at);
      if (phase !== null && friendX !== null && at !== null) {
        kissing.current = at;
        setKissNow(phase);
        setState((current) => kissWalk(current, phase, { friendX, w, room, step: WALK_BLOCKS_PER_TICK * ROOM_SCALE, tieLeft: tiesLeft(person, friendId) }));
        return;
      }
      if (kissing.current !== null) {
        // Over: upright again, and the one on the left hops while the other cheers.
        kissing.current = null;
        setKissNow(null);
        setState((current) => {
          const toward: 1 | -1 = friendX === null ? current.dir : sideOf(current.x, friendX, tiesLeft(person, friendId)) === -1 ? 1 : -1;
          return { ...current, activity: 'react', motion: kissAfter(toward), tick: 0, dir: toward };
        });
        return;
      }
      setState((current) => {
        // Talking: it stays where it stands. A one-off under way is stepped to its end first.
        if (hasSpeech.current && breaksOffFor(current.motion)) return current;
        const next = stepWalker(current, { mood, music, room, step: WALK_BLOCKS_PER_TICK * ROOM_SCALE, ticksOf, random: Math.random });
        // A friend in the room (Luke, 2026-11-21: "hang out with eachother in a jovial manner"): over it goes.
        return befriend(current, next, { friendX, w, room, random: Math.random, tieLeft: tiesLeft(person, friendId) });
      });
    }, every);
    return () => clearInterval(timer);
  }, [reduced, width, look, mood, music, room, ticksOf, friendId, spots, w, person]);

  useEffect(() => {
    if (onSpot !== undefined && figure.current !== null) onSpot(figure.current);
  });

  // Where it stands, for a friend in the room to come and stand beside it; forgotten when it leaves.
  const spotNow = Math.min(Math.max(0, state.x), room);
  useEffect(() => {
    if (spots === undefined || person === undefined) return;
    spots.set(person, spotNow);
  }, [spots, person, spotNow]);
  useEffect(() => {
    if (spots === undefined || person === undefined) return;
    return () => {
      spots.delete(person);
    };
  }, [spots, person]);

  const out = loose !== null;
  const talking = !out && speech !== undefined && (reduced || breaksOffFor(state.motion));
  const motion = reduced || talking ? 'idle' : state.motion;
  const dancing = !out && !reduced && DANCES.includes(motion);
  const visitor = who === 'visitor';
  const left = Math.min(Math.max(0, state.x), room);
  // Leaning in for a kiss: its own frame sheared toward its friend about its feet (the smear rules: nothing drawn).
  const lean = !out && !reduced && kissNow?.stage === 'lean' ? kissNow.lean : 0;
  const leaning = lean > 0;
  const shear = leaning ? -state.dir * lean : 0;
  /** About its mouth, in px up from its feet: where the hearts start. */
  const mouth = look === null ? undefined : Math.round((look.sheet.floor - look.sheet.head) * ROOM_SCALE * 0.85);
  return (
    <div ref={wrap} className={`absolute bottom-0 ${out ? 'invisible' : ''}`} style={{ left, width: w, height: h }} data-room-figure-out={out ? 'true' : undefined}>
      {loose !== null ? <LooseCharacter look={look} grab={loose.grab} facing={state.dir} stage={loose.stage} label={label} onHome={backIn} /> : null}
      <NoteTrail active={dancing} hearts={leaning ? (state.dir === 1 ? 'right' : 'left') : null} heartsAt={mouth} />
      {/* Reduced motion: nobody moves for a kiss, so a still heart over its head says it instead, for as long as the kiss. */}
      {reduced && kiss !== null && !out ? (
        <span aria-hidden="true" className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 font-bold leading-none text-label text-mark-pink" data-kiss-still>
          {'♥'}
        </span>
      ) : null}
      {talking && speech !== undefined ? speech({ x: left, w, h }) : null}
      <button
        ref={figure}
        type="button"
        onPointerDown={takeOut}
        draggable={false}
        {...(visitor ? { 'data-companion': 'visiting' } : { 'data-profile-character': who })}
        data-character-of={person}
        data-motion={motion}
        data-kiss={kissNow === null ? undefined : kissNow.stage}
        aria-label={visitor ? 'YOUR COMPANION: PRESS TO SAY HELLO' : `${label}: PRESS TO SAY HELLO`}
        {...explain(visitor ? 'Your companion, visiting this room: press it and it waves, hops or turns to say hello.' : 'Press this character and it waves, hops or turns to say hello.', visitor ? 'Just for fun: nothing is saved or sent.' : 'Hold and drag it to pull it out of the room and throw it; let go and it walks back and climbs in. Nothing is saved.')}
        title={who === 'guest' ? label : 'SAY HELLO'}
        onClick={() => {
          if (dragged.current) {
            dragged.current = false;
            return;
          }
          onPress?.();
          // While it is talking a press leaves it be: a wave would take its bubble away and start the line again.
          if (!reduced && speech === undefined) setState((current) => react(current));
        }}
        className="block cursor-pointer overflow-hidden focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-acid"
        style={shear === 0 ? { width: w, height: h } : { width: w, height: h, transform: `matrix(1, 0, ${shear.toFixed(3)}, 1, 0, 0)`, transformOrigin: 'bottom center' }}
      >
        {look === null ? (
          // No SHOWN character: the placeholder field, as the companion wears it. Code draws no figure.
          <span className={`${SPRITE_SLOT} block h-full w-full`} data-companion-figure="placeholder" />
        ) : (
          <CharacterSprite stripUrl={look.stripUrl} sheet={look.sheet} motion={motion} tick={reduced || talking ? 0 : state.tick} dir={state.dir} scale={ROOM_SCALE} />
        )}
      </button>
    </div>
  );
}


export default function ProfileCharacter({ userId, root, music }: { userId: string; root: RefObject<HTMLElement | null>; music: boolean }) {
  const shown = useShownCharacter(userId);
  if (shown === null || shown === undefined) return null;
  return <Walking key={`${shown.person}:${shown.bakedAt}`} shown={shown} root={root} music={music} />;
}

function Walking({ shown, root, music }: { shown: ShownCharacter; root: RefObject<HTMLElement | null>; music: boolean }) {
  const layer = useRef<HTMLDivElement>(null);
  const reduced = useSyncExternalStore(subscribeReduced, reducedNow, reducedOnServer);
  const [placed, setPlaced] = useState<Placed | null>(null);
  const [state, setState] = useState<WalkerState | null>(null);

  // Measured on mount, and again whenever the page changes size or what is on it (gathered up, a few times a second at most).
  useEffect(() => {
    const area = root.current;
    if (area === null) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const measure = () => {
      timer = null;
      setPlaced((current) => {
        const next = placeOn(area, layer.current, shown, current);
        if (next === null) return null;
        const same = current !== null && current.scale === next.scale && current.lane.floor === next.lane.floor && current.lane.from === next.lane.from && current.lane.to === next.lane.to;
        return same ? current : next;
      });
    };
    const soon = () => {
      if (timer === null) timer = setTimeout(measure, 300);
    };
    measure();
    const sizes = new ResizeObserver(soon);
    sizes.observe(area);
    const content = new MutationObserver((changes) => {
      if (changes.some((change) => layer.current === null || !layer.current.contains(change.target))) soon();
    });
    content.observe(area, { childList: true, subtree: true, characterData: true });
    window.addEventListener('resize', soon);
    return () => {
      if (timer !== null) clearTimeout(timer);
      sizes.disconnect();
      content.disconnect();
      window.removeEventListener('resize', soon);
    };
  }, [root, shown]);

  const room = placed === null ? 0 : Math.max(0, placed.lane.to - placed.lane.from - shown.sheet.cell.w * placed.scale);
  const step = placed === null ? 0 : WALK_BLOCKS_PER_TICK * placed.scale;

  // A fresh start whenever it lands on a lane it wasn't on.
  const laneKey = placed === null ? null : `${placed.scale}:${placed.lane.floor}:${placed.lane.from}`;
  const [startedOn, setStartedOn] = useState<string | null>(null);
  if (laneKey !== startedOn) {
    setStartedOn(laneKey);
    setState(laneKey === null ? null : startWalker(room, Math.random));
  }

  const ticksOf = useCallback((motion: keyof ShownCharacter['sheet']['motions']) => shown.sheet.motions[motion].ticks.length, [shown]);

  useEffect(() => {
    if (reduced || laneKey === null) return;
    const every = Math.round(1000 / shown.sheet.fps);
    const timer = setInterval(() => {
      setState((current) => (current === null ? current : stepWalker(current, { mood: shown.mood, music, room, step, ticksOf, random: Math.random })));
    }, every);
    return () => clearInterval(timer);
  }, [reduced, laneKey, shown, music, room, step, ticksOf]);

  if (placed === null || state === null) return <div ref={layer} aria-hidden="true" className="pointer-events-none absolute inset-0" />;

  const motion = reduced ? 'idle' : state.motion;
  const tick = reduced ? 0 : state.tick;
  const left = placed.lane.from + Math.min(state.x, room);
  const top = placed.lane.floor - shown.sheet.floor * placed.scale;

  return (
    <div ref={layer} className="pointer-events-none absolute inset-0 overflow-hidden">
      <button
        type="button"
        data-profile-character=""
        data-motion={motion}
        aria-label="THEIR CHARACTER: PRESS TO SAY HELLO"
        {...explain('Press their character and it waves, hops or turns to say hello.', 'Just for fun: nothing is saved or sent.')}
        title="SAY HELLO"
        onClick={() => {
          if (!reduced) setState((current) => (current === null ? current : react(current)));
        }}
        // Cut at the feet: the strip's spare row under them would hang below the floor it found.
        className="pointer-events-auto absolute block cursor-pointer overflow-hidden focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-acid"
        style={{ left, top, width: shown.sheet.cell.w * placed.scale, height: shown.sheet.floor * placed.scale }}
      >
        <CharacterSprite stripUrl={shown.stripUrl} sheet={shown.sheet} motion={motion} tick={tick} dir={state.dir} scale={placed.scale} />
      </button>
    </div>
  );
}
