import { buildStationGraph } from './graph';
import type { StationGraph, StationRow } from './types';

/**
 * The built map, kept in the server's memory (SPEC-tag-station.md): the words change at most every three hours, and the
 * same answer suits every signed-in reader. The route checks the session BEFORE asking here, so this holds nothing a
 * signed-out visitor can reach. A failed read is never kept.
 */
const KEEP_MS = 60 * 60 * 1000;

let held: { graph: StationGraph; at: number } | null = null;
let building: Promise<StationGraph> | null = null;

export async function stationGraph(read: () => Promise<readonly StationRow[]>, now: number = Date.now(), limitReached: () => Promise<boolean> = async () => false): Promise<StationGraph> {
  if (held !== null && now - held.at < KEEP_MS) return held.graph;
  // Two readers at once share one build.
  building ??= Promise.all([read(), limitReached()])
    .then(([rows, reached]) => {
      const graph: StationGraph = { ...buildStationGraph(rows), ...(reached ? { limitReached: true } : {}) };
      held = { graph, at: now };
      return graph;
    })
    .finally(() => {
      building = null;
    });
  return building;
}
