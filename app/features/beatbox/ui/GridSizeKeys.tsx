'use client';

import { useRef, type KeyboardEvent } from "react";
import { nextChoiceIndex } from "./ChoiceGroup";
import { GRID_SIZES, type GridSize } from "./gridView";
import { focusOnly } from "./looks";

/** How many notes the grid shows: a row of small numbers, one Tab stop, and the arrow keys change it. */
export function GridSizeKeys({ size, shortcut, onChoose }: { size: GridSize; shortcut: string; onChoose: (size: GridSize) => void }) {
  const group = useRef<HTMLDivElement>(null);
  const chosen = GRID_SIZES.findIndex((option) => option.size === size);

  function keyDown(event: KeyboardEvent) {
    const next = nextChoiceIndex(event.key, chosen, GRID_SIZES.length);
    const option = next === null ? undefined : GRID_SIZES[next];
    if (!option || next === null) return;
    event.preventDefault();
    event.stopPropagation();
    onChoose(option.size);
    group.current?.querySelectorAll("button")[next]?.focus();
  }

  return (
    <div ref={group} role="radiogroup" aria-label="Notes on the grid" onKeyDown={keyDown} className="flex items-center">
      {GRID_SIZES.map((option) => {
        const on = option.size === size;
        return (
          <button
            key={option.size}
            type="button"
            role="radio"
            aria-checked={on}
            aria-label={option.words}
            tabIndex={on ? 0 : -1}
            title={`${option.words} (${shortcut})`}
            onClick={() => onChoose(option.size)}
            className={`flex min-h-bb-target-min min-w-bb-target-min cursor-pointer items-center justify-center text-display font-bold uppercase ${focusOnly} active:translate-y-(--press-drop) active:bg-bb-pink active:text-bb-black ${on ? "bg-bb-emerald text-bb-black" : "text-bb-daffodil hover:bg-bb-daffodil hover:text-bb-nigrosine"}`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
