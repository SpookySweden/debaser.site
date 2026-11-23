'use client';

import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import type { MotionId } from '../lib/character/motion';
import { fallStep, type Fall } from '../lib/companion/brain';
import { dropsInto, LOOSE_CLIMB, looseStep, startLoose, type Loose, type LooseHome } from '../lib/companion/loose';
import {
  dragLook,
  glideAt,
  isThrow,
  releaseVelocity,
  SAMPLE_WINDOW_MS,
  settleFrames,
  squashLook,
  startThrow,
  throwLook,
  throwStep,
  type Sample,
  type Thrown,
} from '../lib/companion/throw';
import { boxOf, clipOf, roomFloor } from '../lib/companion/visit';
import { SPRITE_SLOT } from '../lib/ui/controls';
import { draw, floorNow, measureInsets, NO_INSETS, sizeOf, type Insets, type Look } from '../lib/companion/draw';

/** One frame: ten a second, as the strips are baked; in the hand and in the air it is placed between frames too. */
const TICK_MS = 100;
/** Screen pixels per strip pixel: a room's own (`ROOM_SCALE`) and the companion's, so it leaves the room without a jump. */
const SCALE = 2;

/** Where it was taken hold of: the pointer, where on the figure it has it, and the figure's box on the screen. */
export type LooseGrab = { pointerId: number; px: number; py: number; offX: number; offY: number; x: number; feet: number; trail: Sample[] };

type Phase = 'held' | 'thrown' | 'fall' | 'loose';

/**
 * A character taken out of its window on a profile (Luke, 2026-11-16: "anyone can grab one out of its window; let go, it
 * walks and climbs back in by itself"). Anybody looking at the profile can press one of the room's characters and drag it
 * out: it hangs from the pointer (leaning back against the drag), can be thrown with the companion's own throw (wind-up,
 * flight, splats on the screen's edges, bounces, settling: `../lib/companion/throw.ts`), and once down on the site's floor
 * it walks to under its room and climbs back in on its climbing frames (`../lib/companion/loose.ts`). Pressed again on the
 * way, it is picked up again.
 *
 * Its own baked strip played a cell at a time, squashed, stretched, leaned and copied with plain 2D transforms: nothing is
 * drawn. It lives in a layer over the page (under the music bar and every window, as the companion does), and takes no
 * presses but on itself. Nothing is sent or saved: it is this reader's screen only. Never drawn under reduced motion (the
 * room does not let one be taken out then).
 *
 * **Dropped into a room** (Luke, 2026-11-23: "allow to drag into the profile room"): let go over a profile's ROOM, or thrown
 * so that it comes down through its floor, it lands on that floor (its landing played there) and is handed to the room,
 * instead of dropping to the site's floor and climbing back up (`dropsInto` in `../lib/companion/loose.ts`). Somebody's
 * companion picked up off the strip in a stream room (`RoomFigure` in `./Companion.tsx`) is carried by this too: it has
 * no room of its own to walk home to (`stage` null), so once down on the site's floor it is handed straight back.
 */
export default function LooseCharacter({
  look,
  grab: taken,
  facing: faceFrom,
  stage,
  label,
  dropInto,
  onHome,
}: {
  look: Look;
  grab: LooseGrab;
  facing: 1 | -1;
  /** The room's floor it climbs back into; null when it has none to walk home to (handed back once it is down). */
  stage: HTMLElement | null;
  label: string;
  /** The room a drop lands in, looked at every frame it falls or flies; its own room when not given. */
  dropInto?: () => HTMLElement | null;
  /**
   * Done: in a room (`'room'`, walked and climbed home, or dropped in), with its left edge on the screen, or null when it
   * popped back in without getting there; or down on the site's floor (`'floor'`) with no room to go home to.
   */
  onHome: (left: number | null, how: 'room' | 'floor') => void;
}) {
  const placeRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLSpanElement>(null);
  const home = useRef(onHome);
  const into = useRef(dropInto);
  // What it wears and which way it faced, as they were when it was taken out: the room re-drawing (a new copy of the same
  // look, its walker still stepping underneath) must not start it over.
  const worn = useRef({ look, faceFrom });
  useEffect(() => {
    home.current = onHome;
    into.current = dropInto;
  });

  useEffect(() => {
    const place = placeRef.current;
    const { look, faceFrom } = worn.current;
    const size = sizeOf(look);
    let phase: Phase = 'held';
    let grab: LooseGrab | null = taken;
    let x = taken.x;
    let y = taken.feet;
    let facing = faceFrom;
    let motion: MotionId = 'lifted';
    let motionTick = 0;
    let lifting = 0;
    let thrown: Thrown | null = null;
    let fall: Fall | null = null;
    let loose: Loose | null = null;
    let settle: number[] = [];
    /** A one-off played through once it is down (its landing, or seeing stars after a splat). */
    let act: { motion: MotionId; tick: number } | null = null;
    let insets: Insets = NO_INSETS;
    let glide: { from: { x: number; y: number }; to: { x: number; y: number }; at: number } | null = null;
    let glideFrame = 0;
    let done = false;
    /** Dropped into a room: the stage it landed in, its landing played there before it is handed over. */
    let droppedIn: HTMLElement | null = null;
    if (look !== null) {
      void measureInsets(look, 'splat').then((found) => {
        insets = found;
      });
    }

    const ticksOf = (id: MotionId): number => (look === null ? 6 : look.sheet.motions[id].ticks.length);
    const play = (next: MotionId) => {
      motionTick = next === motion ? motionTick + 1 : 0;
      motion = next;
    };
    const paint = (extra: { held?: boolean; fx?: ReturnType<typeof throwLook> | null; thrown?: string; mood?: 'stand' | 'walk' }) =>
      draw(place, bodyRef.current, look, { x, floorY: y, facing, mood: extra.mood ?? 'stand', motion, tick: motionTick, lift: 0, held: extra.held, fx: extra.fx ?? null, thrown: extra.thrown });

    const glideLoop = () => {
      glideFrame = 0;
      if (place === null || glide === null || (phase !== 'thrown' && phase !== 'fall')) {
        glide = null;
        return;
      }
      const at = glideAt(glide.from, glide.to, (performance.now() - glide.at) / TICK_MS);
      place.style.transform = `translate3d(${at.x}px, ${at.y - size.h}px, 0)`;
      glideFrame = requestAnimationFrame(glideLoop);
    };
    const glideToward = (to: { x: number; y: number }) => {
      glide = { from: { x, y }, to, at: performance.now() };
      if (glideFrame === 0) glideFrame = requestAnimationFrame(glideLoop);
    };

    /**
     * Where it hangs for the pointer: under it, on the screen, never under the site's floor. Standing on a stream room's
     * window (its top edge the floor), it may be carried down past that edge only over a profile's ROOM beside the window,
     * no lower than the ROOM's floor, so it can be dropped in there (2026-11-23); anywhere else it is held at the edge, and
     * never let go below it with nothing to land on.
     */
    const hang = (held: LooseGrab) => {
      const floor = floorNow(size);
      x = Math.round(Math.min(Math.max(0, floor.screen - size.w), Math.max(0, held.px - held.offX)));
      const want = Math.max(size.h, held.py + held.offY);
      const under = floor.ledge && want > floor.y ? (dropFloor()?.room ?? null) : null;
      const lowest = under !== null && x >= under.left - 0.5 && x <= under.right + 0.5 ? Math.max(floor.y, under.floor) : floor.y;
      y = Math.round(Math.min(lowest, want));
    };
    /** In the hand: placed on every move of the pointer, leaning back against the drag. */
    const followHand = () => {
      if (phase !== 'held' || grab === null) return;
      hang(grab);
      const pull = releaseVelocity(grab.trail, performance.now());
      paint({ held: true, fx: dragLook(pull.vx, pull.vy) });
    };
    const onMove = (event: PointerEvent) => {
      if (grab === null || event.pointerId !== grab.pointerId) return;
      // Let go before this layer was listening (a very quick release as it left the room): no key is down, so it is
      // let go now rather than left stuck to the pointer.
      if (event.buttons === 0 && event.pointerType === 'mouse') {
        onUp(new PointerEvent('pointerup', { pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY }));
        return;
      }
      grab.px = event.clientX;
      grab.py = event.clientY;
      const at = performance.now();
      grab.trail.push({ x: event.clientX, y: event.clientY, t: at });
      while (grab.trail.length > 32 || (grab.trail.length > 0 && at - grab.trail[0].t > SAMPLE_WINDOW_MS * 2)) grab.trail.shift();
      followHand();
    };
    const onUp = (event: PointerEvent) => {
      if (grab === null || event.pointerId !== grab.pointerId) return;
      const released = grab;
      grab = null;
      hang(released);
      const toss = event.type === 'pointerup' ? releaseVelocity(released.trail, performance.now()) : { vx: 0, vy: 0 };
      if (isThrow(toss.vx, toss.vy)) {
        thrown = startThrow(x, y, toss.vx, toss.vy);
        phase = 'thrown';
        if (Math.abs(toss.vx) >= 2) facing = toss.vx > 0 ? 1 : -1;
        motion = 'dangle';
        motionTick = 0;
        paint({ held: true, fx: throwLook(thrown, { ...size, ...insets }), thrown: thrown.stage });
      } else {
        fall = { x, y, vx: 0, vy: 0, landed: false };
        phase = 'fall';
      }
      if (place !== null) place.style.cursor = '';
    };
    /** Pressed again on its way home (or caught out of the air): picked up again. */
    const onPress = (event: PointerEvent) => {
      if (event.button !== 0 || place === null || grab !== null || done) return;
      event.preventDefault();
      const box = place.getBoundingClientRect();
      grab = { pointerId: event.pointerId, px: event.clientX, py: event.clientY, offX: event.clientX - box.left, offY: box.bottom - event.clientY, x, feet: y, trail: [] };
      phase = 'held';
      thrown = null;
      fall = null;
      loose = null;
      act = null;
      settle = [];
      lifting = 0;
      place.style.cursor = 'grabbing';
      followHand();
    };
    /** The floor of the room a drop would land in, on the screen, or null when there is none on screen to land in. */
    // Any of a ROOM's floor showing in the page will do, below the line it stands on or not (a stream room's window edge).
    const dropFloor = (): { stage: HTMLElement; room: LooseHome } | null => {
      const target = (into.current ?? (() => stage))();
      if (target === null || !target.isConnected) return null;
      const room = roomFloor(boxOf(target), clipOf(target), size, Number.POSITIVE_INFINITY);
      return room === null ? null : { stage: target, room };
    };
    /** One frame of a fall or a flight from `from` to where it now is: true when that brought it down into a room. */
    const dropped = (from: { x: number; y: number }, impact: number): boolean => {
      const target = dropFloor();
      if (target === null || target.room === null) return false;
      const at = dropsInto(from, { x, y }, target.room);
      if (at === null) return false;
      x = at;
      y = target.room.floor;
      droppedIn = target.stage;
      landed(false, impact);
      return true;
    };
    /** Down on the floor: its landing (or stars after a splat) played once, then on its way home. */
    const landed = (dizzy: boolean, impact: number) => {
      settle = settleFrames(impact);
      act = { motion: dizzy ? 'dizzy' : 'land', tick: 0 };
      loose = startLoose(x, y, facing);
      phase = 'loose';
    };

    const tick = () => {
      if (done) return;
      const floor = floorNow(size);
      if (phase === 'held') {
        if (grab !== null) hang(grab);
        if (lifting >= 0 && lifting < ticksOf('lifted')) {
          motion = 'lifted';
          motionTick = lifting;
          lifting += 1;
        } else {
          lifting = -1;
          play('dangle');
        }
        const pull = grab === null ? { vx: 0, vy: 0 } : releaseVelocity(grab.trail, performance.now());
        paint({ held: true, fx: dragLook(pull.vx, pull.vy) });
        return;
      }
      if (phase === 'thrown' && thrown !== null) {
        const box = { ...size, ...insets };
        const arena = { left: -insets.left, right: floor.screen - size.w + insets.right, ceiling: size.h - insets.top, floor: floor.y, spans: floor.spans };
        const from = { x, y };
        thrown = throwStep(thrown, arena);
        x = thrown.x;
        y = thrown.y;
        if (Math.abs(thrown.vx) >= 2) facing = thrown.vx > 0 ? 1 : -1;
        if (thrown.stage !== 'wind' && dropped(from, Math.abs(thrown.vy))) {
          thrown = null;
          paint({});
          return;
        }
        if (thrown.stage !== 'landed') {
          const ahead = throwStep(thrown, arena);
          glideToward({ x: ahead.x, y: ahead.y });
          play(thrown.stage === 'wind' ? 'dangle' : thrown.stage === 'stuck' || thrown.stage === 'peel' ? 'splat' : 'flung');
          paint({ held: true, fx: throwLook(thrown, box), thrown: thrown.stage });
          return;
        }
        landed(thrown.splatted, thrown.impact);
        thrown = null;
      }
      if (phase === 'fall' && fall !== null) {
        const from = { x, y };
        // Let go below a stream room's window edge, over a ROOM's floor: that floor is what it falls to.
        const under = y > floor.y ? (dropFloor()?.room ?? null) : null;
        const ground = under !== null && x >= under.left - 0.5 && x <= under.right + 0.5 && y <= under.floor + 0.5 ? under.floor : floor.y;
        const next = fallStep(fall, ground, floor.screen - size.w);
        x = next.x;
        y = next.y;
        fall = next;
        if (dropped(from, Math.abs(next.vy))) {
          fall = null;
          paint({});
          return;
        }
        if (!next.landed) {
          const ahead = fallStep(next, floor.y, floor.screen - size.w);
          glideToward({ x: ahead.x, y: ahead.y });
          play('dangle');
          paint({ held: true });
          return;
        }
        fall = null;
        landed(false, 0);
      }
      if (phase !== 'loose' || loose === null) return;
      const tall = settle.shift();
      // Dropped into a room: it stands on that room's floor while its landing plays, then the room has it.
      const inRoom = droppedIn === null ? null : roomFloor(boxOf(droppedIn), clipOf(droppedIn), size, Number.POSITIVE_INFINITY);
      if (droppedIn !== null && (act === null || inRoom === null)) {
        done = true;
        home.current(inRoom === null ? null : x, 'room');
        return;
      }
      if (act !== null) {
        // Its landing, or its stars, played through where it came down.
        motion = act.motion;
        motionTick = act.tick;
        act = act.tick + 1 < ticksOf(act.motion) ? { motion: act.motion, tick: act.tick + 1 } : null;
        y = inRoom?.floor ?? floor.y;
        loose = { ...loose, y };
        paint({ fx: tall === undefined ? null : squashLook('floor', tall, size) });
        return;
      }
      // No room of its own (somebody's companion off the strip): down on the floor, it is handed straight back.
      if (stage === null) {
        done = true;
        home.current(x, 'floor');
        return;
      }
      const room = roomFloor(boxOf(stage), clipOf(stage), size, floor.y);
      loose = looseStep(loose, { y: floor.y, spans: floor.spans }, room);
      x = loose.x;
      y = loose.y;
      facing = loose.facing;
      if (loose.stage === 'home') {
        done = true;
        home.current(room === null ? null : x, 'room');
        return;
      }
      // Off the floor it climbs, its back to you; along the floor it walks; out of sight of its room it stands and waits.
      play(loose.stage === 'climb' ? 'climb' : loose.stage === 'walk' ? 'walk' : 'idle');
      paint({ mood: loose.stage === 'wait' ? 'stand' : 'walk', fx: tall === undefined ? null : squashLook('floor', tall, size) });
    };

    window.addEventListener('pointermove', onMove, { passive: true });
    window.addEventListener('pointerup', onUp, { passive: true });
    window.addEventListener('pointercancel', onUp, { passive: true });
    place?.addEventListener('pointerdown', onPress);
    if (place !== null) place.style.cursor = 'grabbing';
    followHand();
    const timer = setInterval(tick, TICK_MS);
    return () => {
      clearInterval(timer);
      if (glideFrame !== 0) cancelAnimationFrame(glideFrame);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      place?.removeEventListener('pointerdown', onPress);
    };
    // Started once, from where it was taken hold of: a new grab is a new figure.
  }, [taken, stage]);

  const size = sizeOf(look);
  const rows = look === null ? 0 : Math.ceil(look.sheet.cells / look.sheet.columns);
  const strip =
    look === null
      ? undefined
      : {
          backgroundImage: `url("${look.stripUrl}")`,
          backgroundRepeat: 'no-repeat',
          backgroundSize: `${look.sheet.columns * look.sheet.cell.w * SCALE}px ${rows * look.sheet.cell.h * SCALE}px`,
          imageRendering: 'pixelated' as const,
        };
  return createPortal(
    // Over the page, under the music bar and every window, as the companion's strip is. Only the figure takes the pointer.
    <div className="pointer-events-none fixed inset-0 z-40 overflow-hidden" data-loose-layer>
      <div
        ref={placeRef}
        role="img"
        aria-label={`${label}, OUT OF ITS ROOM`}
        className="pointer-events-auto invisible absolute left-0 top-0 cursor-grab touch-none select-none overflow-visible"
        style={{ width: size.w, height: size.h }}
        data-loose-character
        data-climb-step={LOOSE_CLIMB}
      >
        {strip === undefined ? (
          <span ref={bodyRef} className={`${SPRITE_SLOT} block h-full w-full`} data-companion-figure="placeholder" />
        ) : (
          <>
            {/* The smear: two fainter copies of the very frame it is showing, its own baked strip again, nothing drawn. */}
            {(['opacity-50', 'opacity-25'] as const).map((faint) => (
              <span key={faint} aria-hidden="true" className={`pointer-events-none invisible absolute inset-0 -z-10 block ${faint}`} style={strip} data-companion-smear />
            ))}
            <span ref={bodyRef} className="block h-full w-full overflow-hidden" style={strip} data-companion-figure="character" />
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}
