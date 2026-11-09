'use client';

import { GLYPHS } from "./keyHelp";
import { glyphKey } from "./looks";

/** The bar being shown, out of how many, with a key either side to go to the one before or after. */
export function BarKeys({ bar, barCount, onStep }: { bar: number; barCount: number; onStep: (direction: 1 | -1) => void }) {
  return (
    <div role="group" aria-label="This bar" className="flex items-center">
      <button type="button" aria-label="Previous bar" title="Previous bar" onClick={() => onStep(-1)} className={glyphKey()}>
        {GLYPHS.barBack}
      </button>
      <span className="flex min-w-bb-target-min items-center justify-center text-display font-bold whitespace-nowrap">
        <span className="sr-only">Bar </span>
        {bar + 1}/{barCount}
      </span>
      <button type="button" aria-label="Next bar" title="Next bar" onClick={() => onStep(1)} className={glyphKey()}>
        {GLYPHS.barOn}
      </button>
    </div>
  );
}
