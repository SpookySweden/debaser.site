/**
 * The window's door to LEAGUEBOT's routes (SPEC-leaguebot.md). On the mock site (`LEAGUEBOT_DATA_SOURCE` is mock) it answers
 * from recorded, renamed answers in `./fixtures/` instead, so the whole window can be built and proved with no network and
 * no live source. Browser-side; it never imports the server's fetching code.
 */

import { LEAGUEBOT_DATA_SOURCE } from './riot-id-store';
import type { RegionId } from './regions';
import type { RiotId } from './riot-id';
import type { PlayerAnswer } from './types';

export class LookupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LookupError';
  }
}

async function getAnswer<T>(path: string, query: Record<string, string>): Promise<T> {
  const params = new URLSearchParams(query);
  let response: Response;
  try {
    response = await fetch(`${path}?${params.toString()}`, { cache: 'no-store' });
  } catch {
    throw new LookupError("Couldn't reach the site. Check your connection.");
  }
  const body = (await response.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!response.ok || body === null) throw new LookupError(body?.error ?? 'Something went wrong. Try again in a minute.');
  return body;
}

export async function lookUpPlayer(id: RiotId, region: RegionId, refresh = false): Promise<PlayerAnswer> {
  if (LEAGUEBOT_DATA_SOURCE === 'mock') {
    const { mockPlayer } = await import('./fixtures/mock-answers');
    return mockPlayer(id, region);
  }
  return getAnswer<PlayerAnswer>('/api/leaguebot/player', { region, name: id.name, tag: id.tag, ...(refresh ? { refresh: '1' } : {}) });
}
