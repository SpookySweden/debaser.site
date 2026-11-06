'use client';

type AnimateSliderProps = {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (value: number) => void;
  /** Read it back as a percentage of 1. */
  percent?: boolean;
  /** Most of the track for the small sizes, where a pixel matters most. */
  curve?: boolean;
  unit?: string;
};

/** A labelled slider. Arrow keys work on it when it has focus, and its value is always written out. */
export default function AnimateSlider({ label, min, max, step, value, onChange, percent = false, curve = false, unit = '' }: AnimateSliderProps) {
  const toTrack = (v: number) => (curve ? Math.sqrt((v - min) / (max - min)) * 100 : v);
  const fromTrack = (t: number) => (curve ? min + (t / 100) ** 2 * (max - min) : t);
  const shown = percent ? `${Math.round(value * 100)}%` : `${Math.round(value * 100) / 100}${unit}`;
  return (
    <label className="flex w-full min-w-32 flex-col gap-0.5 text-key">
      <span className="flex justify-between">
        <span>{label}</span>
        <span>{shown}</span>
      </span>
      <input
        type="range"
        min={curve ? 0 : min}
        max={curve ? 100 : max}
        step={curve ? 0.5 : step}
        value={toTrack(value)}
        aria-label={label}
        aria-valuetext={shown}
        onChange={(event) => onChange(fromTrack(Number(event.target.value)))}
        className="h-5 w-full cursor-pointer accent-bubble"
      />
    </label>
  );
}
