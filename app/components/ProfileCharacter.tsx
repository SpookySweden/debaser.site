'use client';

import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type RefObject } from 'react';
import type { ShownCharacter } from '../lib/character/profile-character-repository';
import { useShownCharacter } from '../lib/character/use-shown-character';
import { DANCES, type MotionId } from '../lib/character/motion';
import {
  findLanes,
  react,
  REACTIONS,
  startWalker,
  stepWalker,
  WALK_BLOCKS_PER_TICK,
  type Box,
  type Lane,
  type WalkerState,
} from '../lib/character/walker';
import CharacterSprite from './CharacterSprite';

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

/**
 * The character standing in the profile's status-bar sprite spot instead of walking the page (Luke, 2026-11-13): its idle
 * loop, one of its dances while the profile's track plays, and a wave, hop or turn when pressed. Drawn at one screen pixel
 * per strip pixel, cut at its feet. Under reduced motion it stands still in its idle frame and nothing ticks.
 */
export function ProfileCharacterLoop({ shown, music }: { shown: ShownCharacter; music: boolean }) {
  const reduced = useSyncExternalStore(subscribeReduced, reducedNow, reducedOnServer);
  const [state, setState] = useState<{ motion: MotionId; tick: number; reacted: number }>({ motion: 'idle', tick: 0, reacted: 0 });

  useEffect(() => {
    if (reduced) return;
    const every = Math.round(1000 / shown.sheet.fps);
    const timer = setInterval(() => {
      setState((current) => {
        const playing = shown.sheet.motions[current.motion];
        const tick = current.tick + 1;
        const dancing = DANCES.includes(current.motion);
        // A one-off (a reaction, or a dance that doesn't loop) plays to its end; then it dances while the track plays, else idles.
        const ended = !playing.loop && tick >= playing.ticks.length;
        if (!playing.loop && !ended) return { ...current, tick };
        if (music && (ended || !dancing)) return { ...current, motion: DANCES[Math.floor(Math.random() * DANCES.length)], tick: 0 };
        if (!music && (ended || dancing)) return { ...current, motion: 'idle', tick: 0 };
        return { ...current, tick };
      });
    }, every);
    return () => clearInterval(timer);
  }, [reduced, shown, music]);

  const motion = reduced ? 'idle' : state.motion;
  return (
    <button
      type="button"
      data-profile-character=""
      data-motion={motion}
      aria-label="THEIR CHARACTER: PRESS TO SAY HELLO"
      title="SAY HELLO"
      onClick={() => {
        if (!reduced) setState((current) => ({ motion: REACTIONS[current.reacted % REACTIONS.length], tick: 0, reacted: current.reacted + 1 }));
      }}
      className="block shrink-0 cursor-pointer overflow-hidden focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-acid"
      style={{ width: shown.sheet.cell.w, height: shown.sheet.floor }}
    >
      <CharacterSprite stripUrl={shown.stripUrl} sheet={shown.sheet} motion={motion} tick={reduced ? 0 : state.tick} dir={1} scale={1} />
    </button>
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
