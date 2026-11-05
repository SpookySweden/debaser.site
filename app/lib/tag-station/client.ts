import { webSessionHeaders } from '../web/web-session';
import { buildIndex, type StationIndex } from './query';
import type { StationGraph } from './types';

/** The map, from the server with the reader's session. Throws in plain words; the page shows them. Shared within a page load. */
let held: Promise<StationIndex> | null = null;

export function loadStationIndex(): Promise<StationIndex> {
  held ??= (async () => {
    const headers = await webSessionHeaders();
    if (headers === null) throw new Error('Sign in to use Discover.');
    const response = await fetch('/api/tag-station/graph', { headers });
    const body = (await response.json()) as StationGraph & { error?: string };
    if (!response.ok) throw new Error(body.error ?? 'The map could not be loaded.');
    return buildIndex(body);
  })().catch((problem) => {
    // A failure isn't kept: the next try asks again.
    held = null;
    throw problem;
  });
  return held;
}
