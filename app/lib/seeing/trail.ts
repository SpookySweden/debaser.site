/**
 * TRAIL (SPEC-seeing-machine.md, idea ix): your own walk as a map, from your private history. Sites are the places, and a step from one to
 * another is a line between them. Pure, and the same walk always makes the same map.
 */
import type { Seen } from './history';

export type Place = { site: string; visits: number; last: string; x: number; y: number };
export type Step = { from: string; to: string; times: number };
export type Trail = { places: Place[]; steps: Step[] };

const PLACES_MOST = 60;
const ROUNDS = 220;

const siteOf = (address: string): string | null => {
  try {
    return new URL(address).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
};

/** Laid out in a square from 0 to 1: joined places drawn together, all places pushed apart. */
export function trailOf(rows: readonly Seen[]): Trail {
  const visits = new Map<string, { count: number; last: string }>();
  for (const row of rows) {
    const site = siteOf(row.address);
    if (site === null) continue;
    const known = visits.get(site);
    // Newest first: the first seen of a site is where it was last looked at.
    if (known === undefined) visits.set(site, { count: 1, last: row.address });
    else known.count += 1;
  }
  const kept = [...visits].sort((a, b) => b[1].count - a[1].count || a[0].localeCompare(b[0])).slice(0, PLACES_MOST);
  const index = new Map(kept.map(([site], at) => [site, at]));

  const times = new Map<string, Step>();
  for (const row of rows) {
    const [to, from] = [siteOf(row.address), row.from === null ? null : siteOf(row.from)];
    if (to === null || from === null || from === to || !index.has(to) || !index.has(from)) continue;
    const key = `${from} ${to}`;
    const known = times.get(key);
    if (known === undefined) times.set(key, { from, to, times: 1 });
    else known.times += 1;
  }
  const steps = [...times.values()];

  // Begun on a spiral, so no two start in one place and nothing is left to chance.
  const at = kept.map((_, i) => ({ x: 0.5 + 0.42 * Math.sqrt((i + 0.5) / Math.max(1, kept.length)) * Math.cos(i * 2.399963), y: 0.5 + 0.42 * Math.sqrt((i + 0.5) / Math.max(1, kept.length)) * Math.sin(i * 2.399963) }));
  const room = 0.9 / Math.sqrt(Math.max(1, kept.length));
  for (let round = 0; round < ROUNDS; round += 1) {
    const cool = 0.04 * (1 - round / ROUNDS);
    const push = at.map(() => ({ x: 0, y: 0 }));
    for (let i = 0; i < at.length; i += 1) {
      for (let j = i + 1; j < at.length; j += 1) {
        const [dx, dy] = [at[i].x - at[j].x, at[i].y - at[j].y];
        const far = Math.max(0.001, Math.hypot(dx, dy));
        const by = (room * room) / far;
        push[i].x += (dx / far) * by;
        push[i].y += (dy / far) * by;
        push[j].x -= (dx / far) * by;
        push[j].y -= (dy / far) * by;
      }
    }
    for (const step of steps) {
      const [i, j] = [index.get(step.from) ?? 0, index.get(step.to) ?? 0];
      const [dx, dy] = [at[i].x - at[j].x, at[i].y - at[j].y];
      const far = Math.max(0.001, Math.hypot(dx, dy));
      const by = ((far * far) / room) * Math.min(2, 0.6 + step.times * 0.2);
      push[i].x -= (dx / far) * by;
      push[i].y -= (dy / far) * by;
      push[j].x += (dx / far) * by;
      push[j].y += (dy / far) * by;
    }
    for (let i = 0; i < at.length; i += 1) {
      const far = Math.max(0.001, Math.hypot(push[i].x, push[i].y));
      at[i].x = Math.min(0.94, Math.max(0.06, at[i].x + (push[i].x / far) * Math.min(far, cool)));
      at[i].y = Math.min(0.94, Math.max(0.06, at[i].y + (push[i].y / far) * Math.min(far, cool)));
    }
  }
  // Put in the middle of the map, as wide as it came out.
  for (const way of ['x', 'y'] as const) {
    const [least, most] = [Math.min(...at.map((each) => each[way])), Math.max(...at.map((each) => each[way]))];
    for (const each of at) each[way] += 0.5 - (least + most) / 2;
  }
  return { places: kept.map(([site, { count, last }], i) => ({ site, visits: count, last, x: at[i].x, y: at[i].y })), steps };
}
