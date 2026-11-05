import type { Partner } from './types';

/**
 * How close two words are (SPEC-tag-station.md). Pure and client-safe: the graph builder, the layout and the page all
 * score through here, so the map and the lists can't disagree.
 */

/** A pair only counts as close once it shares this many items: with fewer, chance alone gives a high score. */
export const MIN_SHARED = 3;

/** How much more often two words meet than chance, from -1 to 1 (normalised pointwise mutual information). */
export function npmi(shared: number, countA: number, countB: number, total: number): number {
  if (shared <= 0 || total <= 0) return -1;
  const pair = shared / total;
  if (pair >= 1) return 1;
  return Math.log(pair / ((countA / total) * (countB / total))) / -Math.log(pair);
}

/**
 * NPMI, marked down when few items back it. A pair on one item scores a perfect NPMI by chance whenever both words are
 * rare, so NPMI alone would put every rare word next to every other. From 0 to just under 1.
 */
export function strength(partner: Pick<Partner, 'shared' | 'npmi'>): number {
  return Math.max(0, partner.npmi) * (partner.shared / (partner.shared + MIN_SHARED - 1));
}

/** Trusted pairs first, by NPMI; the rest after them, by strength. Names break ties, so the order is fixed. */
export function comparePartners(a: Partner, b: Partner): number {
  if (a.close !== b.close) return a.close ? -1 : 1;
  const difference = a.close ? b.npmi - a.npmi : strength(b) - strength(a);
  if (difference !== 0) return difference;
  return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
}
