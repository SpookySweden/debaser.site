/**
 * The stream room's strip (Luke, 2026-11-02): who is watching goes past like the newswire, and after every
 * three of them - or after everybody, when fewer are in - the strip says what is on (CURRENT VIDEO), and the
 * next time what plays next (NEXT VIDEO), taking turns. Pure, so the order is checked without a browser.
 */

export type CrawlStop = { kind: 'account'; id: string } | { kind: 'current' } | { kind: 'next' };

/** How many people pass between two video lines. */
export const CRAWL_GROUP = 3;

/**
 * One full loop of the strip: the people in groups of three, a video line after each group, CURRENT and NEXT
 * in turn. An odd number of groups would end the loop on CURRENT and start it again on CURRENT, so then the
 * people go round twice and the loop always ends on NEXT. With nobody signed in, just the two video lines.
 */
export function crawlStops(accountIds: readonly string[], group = CRAWL_GROUP): CrawlStop[] {
  const groups: string[][] = [];
  for (let at = 0; at < accountIds.length; at += group) groups.push(accountIds.slice(at, at + group));
  if (groups.length === 0) return [{ kind: 'current' }, { kind: 'next' }];

  const rounds = groups.length % 2 === 0 ? 1 : 2;
  const stops: CrawlStop[] = [];
  let say: 'current' | 'next' = 'current';
  for (let round = 0; round < rounds; round += 1) {
    for (const people of groups) {
      for (const id of people) stops.push({ kind: 'account', id });
      stops.push({ kind: say });
      say = say === 'current' ? 'next' : 'current';
    }
  }
  return stops;
}

/** The still strip, for anybody who has asked for less motion: everybody once, then both video lines. */
export function stillStops(accountIds: readonly string[]): CrawlStop[] {
  return [...accountIds.map((id): CrawlStop => ({ kind: 'account', id })), { kind: 'current' }, { kind: 'next' }];
}
