'use client';

import { useSyncExternalStore } from "react";
import type { PlayheadSpot, Transport } from "./app";

/** A note the playhead is on right now. */
export interface HitNote {
  /** Which visible row it's in, counting from the top. */
  readonly row: number;
  readonly name: string;
}

/** The thick outline over the column being played. It jumps; it never slides. */
export function Playhead({
  transport,
  columnOf,
  headerCells = 0,
  hitsAt,
  across = false,
}: {
  transport: Transport;
  /** Which visible column this spot falls in, or null if it isn't showing. */
  columnOf: (spot: PlayheadSpot) => number | null;
  /** How many cells wide the row names are, when it isn't given as --name-w. */
  headerCells?: number;
  /** The notes to light up at this spot, if this grid shows notes. */
  hitsAt?: (spot: PlayheadSpot) => readonly HitNote[];
  /** The bars run down the screen, so the playhead is a band across. */
  across?: boolean;
}) {
  const spot = useSyncExternalStore(transport.subscribe, transport.getSpot);
  const column = spot && columnOf(spot);
  if (!spot || column === null || column === undefined) return null;
  if (across) {
    return (
      <div
        aria-hidden="true"
        data-playhead={`${spot.bar}:${spot.step}`}
        className="pointer-events-none absolute right-0 left-0 z-20 border-(length:--playhead-width) border-bb-flavine"
        style={{ top: `calc(var(--head-h) + var(--cell) * ${column})`, height: "var(--cell)" }}
      />
    );
  }
  const left = `calc(var(--name-w, var(--cell) * ${headerCells}) + var(--cell-w, var(--cell)) * ${column})`;
  return (
    <>
      <div
        aria-hidden="true"
        className="pointer-events-none absolute top-0 bottom-0 z-20 border-(length:--playhead-width) border-bb-flavine"
        style={{ left, width: "var(--cell-w, var(--cell))" }}
      />
      {/* A note lights and sinks in the moment it's hit, like a contact closing. */}
      {hitsAt?.(spot).map((hit) => (
        <div
          key={hit.row}
          aria-hidden="true"
          className="pointer-events-none absolute z-10 flex items-center justify-center overflow-hidden text-center leading-none font-bold wrap-anywhere text-bb-black bb-sunk motion-safe:bg-bb-flavine"
          style={{
            left,
            top: `calc(var(--head-h, var(--cell)) + var(--cell-h, var(--cell)) * ${hit.row})`,
            width: "var(--cell-w, var(--cell))",
            height: "var(--cell-h, var(--cell))",
          }}
        >
          <span className="motion-reduce:hidden">{hit.name}</span>
        </div>
      ))}
    </>
  );
}
