'use client';

import { useEffect, useRef, useSyncExternalStore } from 'react';
import { cursorState, subscribeToCursor } from '../lib/ui/cursor-slot';

/**
 * The CAT cursor: Luke's two cats, drawn as an element that follows the pointer.
 *
 * A browser cursor is a still picture, so the wobble, the heart and the right-click flash cannot be
 * one. This hides the browser's pointer (`data-cat-cursor`, read by globals.css) and moves the cat itself.
 * Three limits come with that, all accepted: over another site's embed (a YouTube player) the page gets
 * no pointer events, so the cat hides and the browser's pointer shows; over a text field the I-beam
 * shows instead, so typing lands where it looks; and a touch has no pointer, so nothing is drawn for it.
 *
 * Every move is a write to `transform` through a ref, never React state, so following the pointer does
 * not re-render anything. Motion is in whole frames (`steps`), as everywhere else on the site, and the
 * wobble and the heart stop under `prefers-reduced-motion`; the right-click flash is a colour, not a
 * movement, so it stays.
 */

/** The drawings, one drawn pixel per screen pixel (`app/lib/ui/art/slots.ts`). */
const REST = '/assets/cursors/cat-rest.png';
const PAW = '/assets/cursors/cat-paw.png';
const HEART = '/assets/cursors/cat-heart.png';
const SIZE = 30;
const HEART_SIZE = 8;
/** The pixel that clicks: the tip of the cat's left ear. */
const HOT_X = 5;
const HOT_Y = 1;
/** Where the heart sat in the drawing, beside the cat's head, before it floats up. */
const HEART_X = 21;
const HEART_Y = -4;

/** What the paw comes up for: the same list globals.css gives the pointing hand, plus `cursor-pointer`. */
const CLICKABLE =
  "a[href], button, label, summary, select, [role='button'], [role='menuitem'], [role='tab'], [role='option'], [role='link'], input[type='checkbox'], input[type='radio'], input[type='range'], input[type='button'], input[type='submit'], .cursor-pointer";
/** Where the browser's I-beam shows and the cat steps aside. */
const FIELD =
  "input:not([type='checkbox'], [type='radio'], [type='range'], [type='button'], [type='submit'], [type='reset'], [type='color'], [type='file'], [type='image']), textarea, [contenteditable='true']";

const STEP = 'steps(1, end)';

function frames(list: Keyframe[]): Keyframe[] {
  return list.map((frame) => ({ easing: STEP, ...frame }));
}

/** A little wobble when the paw comes up. */
const HOVER = frames([
  { transform: 'scale(1) rotate(0deg)' },
  { transform: 'scale(1.08) rotate(-6deg)' },
  { transform: 'scale(1.08) rotate(5deg)' },
  { transform: 'scale(1.04) rotate(-2deg)' },
  { transform: 'scale(1) rotate(0deg)' },
]);

/** A bigger one on a click: the cat swells and shakes it off. */
const CLICK = frames([
  { transform: 'scale(1) rotate(0deg)' },
  { transform: 'scale(1.3) rotate(-10deg)' },
  { transform: 'scale(1.3) rotate(9deg)' },
  { transform: 'scale(1.18) rotate(-5deg)' },
  { transform: 'scale(1.08) rotate(3deg)' },
  { transform: 'scale(1) rotate(0deg)' },
]);

/** The heart pops, rises and fades. */
const RISE = frames([
  { transform: 'translateY(0) scale(0.5)', opacity: 1 },
  { transform: 'translateY(-4px) scale(1.25)', opacity: 1 },
  { transform: 'translateY(-10px) scale(1)', opacity: 1 },
  { transform: 'translateY(-16px) scale(1)', opacity: 1 },
  { transform: 'translateY(-22px) scale(1)', opacity: 0.6 },
  { transform: 'translateY(-28px) scale(1)', opacity: 0 },
]);

/** The right-click: every colour flips to its opposite, then back. */
const INVERT: Keyframe[] = [{ filter: 'invert(1)' }, { filter: 'invert(1)' }];

function isClickable(target: Element): boolean {
  const control = target.closest(CLICKABLE);
  if (control === null) return false;
  return !control.matches(':disabled, [aria-disabled="true"]');
}

export default function CatCursor() {
  const { id } = useSyncExternalStore(subscribeToCursor, cursorState, cursorState);
  const on = id === 'cat';

  const place = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const rest = useRef<HTMLImageElement>(null);
  const paw = useRef<HTMLImageElement>(null);
  const hearts = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!on) return;
    // A computer with no mouse or pen at all (a phone) keeps its own behaviour.
    if (!window.matchMedia('(any-pointer: fine)').matches) return;

    const root = document.documentElement;
    const still = window.matchMedia('(prefers-reduced-motion: reduce)');
    let pointing = false;
    let visible = false;
    /** True while the pointer is known to be over this page, so a re-check may show the cat. */
    let inside = false;
    let x = -100;
    let y = -100;

    const show = (shown: boolean) => {
      visible = shown;
      if (place.current) place.current.style.visibility = shown ? 'visible' : 'hidden';
    };

    const setPaw = (up: boolean) => {
      if (up === pointing) return;
      pointing = up;
      if (rest.current) rest.current.style.visibility = up ? 'hidden' : 'visible';
      if (paw.current) paw.current.style.visibility = up ? 'visible' : 'hidden';
      if (up && !still.matches) body.current?.animate(HOVER, { duration: 280 });
    };

    const onMove = (event: PointerEvent) => {
      if (event.pointerType === 'touch') return;
      x = event.clientX;
      y = event.clientY;
      if (place.current) place.current.style.transform = `translate3d(${x - HOT_X}px, ${y - HOT_Y}px, 0)`;
      inside = true;
      look(event.target instanceof Element ? event.target : null);
    };

    /** What is under the pointer decides the cat: hidden over a field or an embed, paw up over a control. */
    const look = (target: Element | null) => {
      if (target === null || target.closest('iframe, embed, object') !== null || target.closest(FIELD) !== null) {
        show(false);
        return;
      }
      show(true);
      setPaw(isClickable(target));
    };

    // The page can change under a still pointer (a click opens a window, a scroll moves the list), and
    // no move arrives to say so - so look again at whatever is under it now. The cat itself is never
    // found there: it takes no pointer events.
    const recheck = () => {
      if (inside) look(document.elementFromPoint(x, y));
    };
    const recheckSoon = () => requestAnimationFrame(recheck);

    const heart = () => {
      const layer = hearts.current;
      if (layer === null) return;
      const img = document.createElement('img');
      img.src = HEART;
      img.alt = '';
      img.width = HEART_SIZE;
      img.height = HEART_SIZE;
      img.className = 'absolute';
      img.style.left = `${x - HOT_X + HEART_X}px`;
      img.style.top = `${y - HOT_Y + HEART_Y}px`;
      layer.appendChild(img);
      img.animate(RISE, { duration: 600, fill: 'forwards' }).finished.then(
        () => img.remove(),
        () => img.remove(),
      );
    };

    const onDown = (event: PointerEvent) => {
      // A press over a field or an embed, where the cat has stepped aside, sends up nothing.
      if (event.pointerType === 'touch' || !visible) return;
      if (event.button === 2) {
        body.current?.animate(INVERT, { duration: 320 });
        return;
      }
      if (event.button !== 0 || still.matches) return;
      body.current?.animate(CLICK, { duration: 360 });
      heart();
    };

    // Leaving the window, or crossing into an embed, hides the cat: no events arrive from there.
    const onOut = (event: PointerEvent) => {
      if (event.relatedTarget !== null) return;
      inside = false;
      show(false);
    };
    const onBlur = () => {
      inside = false;
      show(false);
    };

    root.dataset.catCursor = '';
    window.addEventListener('pointermove', onMove, { passive: true });
    window.addEventListener('pointerdown', onDown, { passive: true });
    window.addEventListener('pointerup', recheckSoon, { passive: true });
    window.addEventListener('click', recheckSoon, { passive: true });
    window.addEventListener('scroll', recheck, { passive: true, capture: true });
    document.addEventListener('pointerout', onOut, { passive: true });
    window.addEventListener('blur', onBlur);

    return () => {
      delete root.dataset.catCursor;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointerup', recheckSoon);
      window.removeEventListener('click', recheckSoon);
      window.removeEventListener('scroll', recheck, { capture: true });
      document.removeEventListener('pointerout', onOut);
      window.removeEventListener('blur', onBlur);
    };
  }, [on]);

  if (!on) return null;

  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-0 z-cursor overflow-hidden">
      <div ref={hearts} className="absolute inset-0" />
      <div ref={place} className="invisible absolute left-0 top-0" style={{ width: SIZE, height: SIZE }}>
        <div ref={body} className="relative h-full w-full">
          {/* eslint-disable-next-line @next/next/no-img-element -- a 30px sprite, never optimised */}
          <img ref={rest} src={REST} alt="" width={SIZE} height={SIZE} className="absolute inset-0" />
          {/* eslint-disable-next-line @next/next/no-img-element -- loaded with the resting cat, so the swap never blinks */}
          <img ref={paw} src={PAW} alt="" width={SIZE} height={SIZE} className="invisible absolute inset-0" />
        </div>
      </div>
    </div>
  );
}
