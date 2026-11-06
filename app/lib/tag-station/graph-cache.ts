import { buildStationGraph } from './graph';
import type { StationGraph, StationRow, SweptCounts } from './types';
import type { WordFact } from './word-facts';

/**
 * The built map, kept in the server's memory for three hours (SPEC-tag-station.md): the words change at most that often, and the
 * same answer suits every signed-in reader. The route checks the session BEFORE asking here, so this holds nothing a
 * signed-out visitor can reach. A failed read is never kept.
 */
const KEEP_MS = 3 * 60 * 60 * 1000;
/** A map built while part of the pool couldn't be read: good enough to show, not to keep. */
const KEEP_INCOMPLETE_MS = 5 * 60 * 1000;

let held: { graph: StationGraph; at: number; keep: number } | null = null;
let building: Promise<StationGraph> | null = null;
let heldFacts: readonly WordFact[] = [];
let heldIncomplete = false;

/** Whether the last map built couldn't read part of the pool, so it isn't one to share. */
export function stationIncomplete(): boolean {
  return heldIncomplete;
}

/** The word pass's answers as of the last build, so a list's extra items are joined the way the map's are. */
export function stationFacts(): readonly WordFact[] {
  return heldFacts;
}

export async function stationGraph(read: () => Promise<readonly StationRow[]>, now: number = Date.now(), limitReached: () => Promise<boolean> = async () => false, wordFacts: () => Promise<readonly WordFact[]> = async () => [], pool: () => Promise<{ rows: readonly StationRow[]; swept: SweptCounts; incomplete?: boolean }> = async () => ({ rows: [], swept: { counted: 0, words: [] } })): Promise<StationGraph> {
  if (held !== null && now - held.at < held.keep) return held.graph;
  // Two readers at once share one build.
  building ??= Promise.all([read(), limitReached(), wordFacts(), pool()])
    .then(([rows, reached, facts, swept]) => {
      // A swept item saved since is the saved item: listed once.
      const saved = new Set(rows.map((row) => row.item.id));
      const listed = swept.rows.filter((row) => !saved.has(row.item.id));
      const graph: StationGraph = { ...buildStationGraph([...rows, ...listed], facts, swept.swept), ...(reached ? { limitReached: true } : {}) };
      held = { graph, at: now, keep: swept.incomplete ? KEEP_INCOMPLETE_MS : KEEP_MS };
      heldFacts = facts;
      heldIncomplete = swept.incomplete === true;
      return graph;
    })
    .finally(() => {
      building = null;
    });
  return building;
}
