'use client';

import { useRef, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { clampToKnob, shownValue, type RangeKnob } from '../../lib/backdrops/knobs';
import { explain } from '../../lib/ui/explain';

/**
 * The settings windows' own controls, for where a plain slider says too little (SPEC-backgrounds.md): a strip with two handles
 * for a from-to pair, and a square that sets two knobs at once. Plain elements and pointer events, in the site's look; each
 * works from the keyboard and reads its values out.
 */

/** A small key at the end of a knob's row: sway, roll, lock. */
export const MINI = 'key cursor-pointer px-1 text-label leading-none';
export const MINI_ON = 'key key-fill key-on [--key-fill:var(--color-ink)] cursor-pointer px-1 text-label leading-none text-paper';

const share = (knob: RangeKnob, value: number) => (knob.max === knob.min ? 0 : (value - knob.min) / (knob.max - knob.min));
const fromShare = (knob: RangeKnob, part: number) => clampToKnob(knob, knob.min + Math.min(1, Math.max(0, part)) * (knob.max - knob.min));

type BandProps = {
  /** The knob both ends are measured on (for a pair of knobs: the lower one's range, which the upper shares). */
  low: RangeKnob;
  high: RangeKnob;
  values: readonly [number, number];
  /** How near the two ends may come. */
  gap: number;
  onChange: (low: number, high: number) => void;
  /** What the two handles are called, for a screen reader. */
  names: readonly [string, string];
  id: string;
};

/**
 * One strip, two handles: the ends of a stretch. A press on the strip takes the nearer handle; the arrow keys move the handle
 * that has focus by one step.
 */
export function BandStrip({ low, high, values, gap, onChange, names, id }: BandProps) {
  const track = useRef<HTMLDivElement>(null);
  const held = useRef<0 | 1 | null>(null);

  const move = (which: 0 | 1, value: number) => {
    if (which === 0) onChange(Math.min(clampToKnob(low, value), values[1] - gap), values[1]);
    else onChange(values[0], Math.max(clampToKnob(high, value), values[0] + gap));
  };
  const at = (event: ReactPointerEvent<HTMLDivElement>): number => {
    const box = track.current?.getBoundingClientRect();
    return box === undefined || box.width === 0 ? 0 : (event.clientX - box.left) / box.width;
  };
  const press = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const part = at(event);
    held.current = Math.abs(part - share(low, values[0])) <= Math.abs(part - share(high, values[1])) ? 0 : 1;
    event.currentTarget.setPointerCapture(event.pointerId);
    move(held.current, held.current === 0 ? fromShare(low, part) : fromShare(high, part));
  };
  const drag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (held.current === null || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
    move(held.current, held.current === 0 ? fromShare(low, at(event)) : fromShare(high, at(event)));
  };
  const release = () => {
    held.current = null;
  };
  const key = (which: 0 | 1) => (event: KeyboardEvent<HTMLButtonElement>) => {
    const knob = which === 0 ? low : high;
    const step = event.key === 'ArrowLeft' || event.key === 'ArrowDown' ? -knob.step : event.key === 'ArrowRight' || event.key === 'ArrowUp' ? knob.step : 0;
    if (step === 0) return;
    event.preventDefault();
    move(which, values[which] + step);
  };

  const [from, to] = [share(low, values[0]) * 100, share(high, values[1]) * 100];
  return (
    <div
      ref={track}
      onPointerDown={press}
      onPointerMove={drag}
      onPointerUp={release}
      onPointerCancel={release}
      className="relative h-5 w-full cursor-pointer touch-none select-none"
      data-backdrop-band={id}
    >
      <div className="absolute inset-x-0 top-2 h-1 bg-chrome-dark" />
      <div className="absolute top-2 h-1 bg-bubble" style={{ left: `${from}%`, width: `${Math.max(0, to - from)}%` }} />
      {([0, 1] as const).map((which) => {
        const knob = which === 0 ? low : high;
        return (
          <button
            key={which}
            type="button"
            role="slider"
            aria-label={names[which]}
            aria-valuemin={knob.min}
            aria-valuemax={knob.max}
            aria-valuenow={values[which]}
            aria-valuetext={shownValue(knob, values[which])}
            onKeyDown={key(which)}
            {...explain(`The ${which === 0 ? 'low' : 'high'} end of this stretch: drag it along the strip, or press the arrow keys, to move it.`, 'The background uses what lies between the two ends.')}
            className="absolute top-0 h-5 w-2 -translate-x-1/2 cursor-pointer bg-ink focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-bubble"
            style={{ left: `${which === 0 ? from : to}%` }}
            data-backdrop-band-handle={which === 0 ? 'low' : 'high'}
          />
        );
      })}
    </div>
  );
}

type PadProps = {
  x: RangeKnob;
  y: RangeKnob;
  /** Where the puck is, as shares of the pad from its left and its top. */
  puck: { x: number; y: number };
  onChange: (x: number, y: number) => void;
  /** Let go after catching a bouncing puck: where, and how fast it was going (shares of the pad a second). A flick sends it off again. */
  onFling: (puck: { x: number; y: number; vx: number; vy: number }) => void;
  /** A press on the pad while its puck is bouncing: the puck is caught. Not given while it is at rest. */
  onCatch?: () => void;
  label: string;
  id: string;
  /** A small square of a set size, for a line of the settings sheet, rather than one as wide as its box. */
  compact?: boolean;
};

/**
 * Two knobs on one square: across is one, down is the other. Dragged with one finger; the arrow keys move the puck a step; a
 * double-click puts it back in the middle.
 */
export function XYPad({ x, y, puck, onChange, onFling, onCatch, label, id, compact = false }: PadProps) {
  const pad = useRef<HTMLDivElement>(null);
  /** The last few places of the drag, to tell how fast the puck was going when it was let go. */
  const trail = useRef<{ x: number; y: number; at: number }[]>([]);
  /** Whether this press caught a bouncing puck. Remembered here because, once caught, the pad is drawn again as one at rest. */
  const caught = useRef(false);

  const at = (event: ReactPointerEvent<HTMLDivElement>): { x: number; y: number } => {
    const box = pad.current?.getBoundingClientRect();
    if (box === undefined || box.width === 0 || box.height === 0) return { x: 0.5, y: 0.5 };
    return { x: Math.min(1, Math.max(0, (event.clientX - box.left) / box.width)), y: Math.min(1, Math.max(0, (event.clientY - box.top) / box.height)) };
  };
  const put = (spot: { x: number; y: number }) => onChange(fromShare(x, spot.x), fromShare(y, spot.y));
  const press = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    caught.current = onCatch !== undefined;
    onCatch?.();
    event.currentTarget.setPointerCapture(event.pointerId);
    const spot = at(event);
    trail.current = [{ ...spot, at: performance.now() }];
    put(spot);
  };
  const drag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
    const spot = at(event);
    trail.current = [...trail.current.slice(-4), { ...spot, at: performance.now() }];
    put(spot);
  };
  const release = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
    event.currentTarget.releasePointerCapture(event.pointerId);
    const [first, last] = [trail.current[0], trail.current[trail.current.length - 1]];
    trail.current = [];
    const wasCaught = caught.current;
    caught.current = false;
    if (!wasCaught || first === undefined || last === undefined) return;
    const seconds = Math.max(0.016, (last.at - first.at) / 1000);
    // Held still for a moment before letting go: it stays caught. Let go on the move: it is flung.
    if (performance.now() - last.at > 120 || Math.hypot(last.x - first.x, last.y - first.y) < 0.02) return;
    onFling({ x: last.x, y: last.y, vx: (last.x - first.x) / seconds, vy: (last.y - first.y) / seconds });
  };
  const key = (event: KeyboardEvent<HTMLDivElement>) => {
    const dx = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0;
    const dy = event.key === 'ArrowUp' ? -1 : event.key === 'ArrowDown' ? 1 : 0;
    if (dx === 0 && dy === 0) return;
    event.preventDefault();
    onCatch?.();
    onChange(clampToKnob(x, fromShare(x, puck.x) + dx * x.step), clampToKnob(y, fromShare(y, puck.y) + dy * y.step));
  };

  const words = `${x.label} ${shownValue(x, fromShare(x, puck.x))}, ${y.label} ${shownValue(y, fromShare(y, puck.y))}`;
  return (
    <div
      ref={pad}
      role="group"
      tabIndex={0}
      aria-label={`${label}: ${words}. Arrow keys move it.`}
      onPointerDown={press}
      onPointerMove={drag}
      onPointerUp={release}
      onPointerCancel={release}
      onKeyDown={key}
      onDoubleClick={() => {
        onCatch?.();
        put({ x: 0.5, y: 0.5 });
      }}
      className={`relative aspect-square ${compact ? 'w-22 shrink-0' : 'w-full max-w-48'} cursor-pointer touch-none select-none border border-ink bg-paper focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-bubble`}
      data-backdrop-pad={id}
    >
      {/* The middle, where both knobs are at rest: two dotted lines. */}
      <div className="pointer-events-none absolute inset-y-0 left-1/2 border-l border-dotted border-ink opacity-40" />
      <div className="pointer-events-none absolute inset-x-0 top-1/2 border-t border-dotted border-ink opacity-40" />
      <div
        className="pointer-events-none absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 bg-bubble"
        style={{ left: `${puck.x * 100}%`, top: `${puck.y * 100}%` }}
        data-backdrop-puck=""
      />
    </div>
  );
}

/** A live strip: the last readings of a number as 1-pixel-wide columns, the newest on the right. */
export function Sparkline({ readings, most }: { readings: readonly number[]; most: number }) {
  return (
    <span aria-hidden="true" className="flex h-4 items-end gap-px" data-backdrop-sparkline="">
      {readings.map((reading, n) => (
        <span key={n} className="w-px bg-ink" style={{ height: `${Math.max(6, Math.min(100, most <= 0 ? 0 : (reading / most) * 100))}%` }} />
      ))}
    </span>
  );
}
