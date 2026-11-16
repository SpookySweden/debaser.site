'use client';

import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import type { MotionId } from '../lib/character/motion';
import { fallStep, type Fall } from '../lib/companion/brain';
import { LOOSE_CLIMB, looseStep, startLoose, type Loose } from '../lib/companion/loose';
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
 */
export default function LooseCharacter({
  look,
  grab: taken,
  facing: faceFrom,
  stage,
  label,
  onHome,
}: {
  look: Look;
  grab: LooseGrab;
  facing: 1 | -1;
  /** The room's floor it climbs back into. */
  stage: HTMLElement;
  label: string;
  /** Back in its room: where its left edge is on the screen, or null when it popped back in without getting there. */
  onHome: (left: number | null) => void;
}) {
  const placeRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLSpanElement>(null);
  const home = useRef(onHome);
  // What it wears and which way it faced, as they were when it was taken out: the room re-drawing (a new copy of the same
  // look, its walker still stepping underneath) must not start it over.
  const worn = useRef({ look, faceFrom });
  useEffect(() => {
    home.current = onHome;
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

    /** Where it hangs for the pointer: under it, on the screen, never under the site's floor. */
    const hang = (held: LooseGrab) => {
      const floor = floorNow(size);
      x = Math.round(Math.min(Math.max(0, floor.screen - size.w), Math.max(0, held.px - held.offX)));
      y = Math.round(Math.min(floor.y, Math.max(size.h, held.py + held.offY)));
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
        thrown = throwStep(thrown, arena);
        x = thrown.x;
        y = thrown.y;
        if (Math.abs(thrown.vx) >= 2) facing = thrown.vx > 0 ? 1 : -1;
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
        const next = fallStep(fall, floor.y, floor.screen - size.w);
        x = next.x;
        y = next.y;
        fall = next;
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
      if (act !== null) {
        // Its landing, or its stars, played through where it came down.
        motion = act.motion;
        motionTick = act.tick;
        act = act.tick + 1 < ticksOf(act.motion) ? { motion: act.motion, tick: act.tick + 1 } : null;
        y = floor.y;
        loose = { ...loose, y };
        paint({ fx: tall === undefined ? null : squashLook('floor', tall, size) });
        return;
      }
      const room = roomFloor(boxOf(stage), clipOf(stage), size, floor.y);
      loose = looseStep(loose, { y: floor.y, spans: floor.spans }, room);
      x = loose.x;
      y = loose.y;
      facing = loose.facing;
      if (loose.stage === 'home') {
        done = true;
        home.current(room === null ? null : x);
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
