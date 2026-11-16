import type { WebItem } from '../types';
import type { BriefRow, ReadingKind } from './feeds';

/**
 * The reading the mock site shows (SPEC-media-feed.md): invented rows, titles starting `MOCK READING nn`, on real listed
 * addresses so every link passes the page's check. Dated relative to the visit, so they stay on their shelves; a local
 * drive needs no internet. `scripts/check-web-brief.cjs` holds the real adapters; `Temp/check-media-feed-mix.cjs` these.
 */
const OUTLETS: readonly { kind: ReadingKind; platform: WebItem['platform']; outlet: string; url: (n: number) => string; creator?: string; tags: string[] }[] = [
  { kind: 'paper', platform: 'paper', outlet: 'ARXIV', url: (n) => `https://arxiv.org/abs/2611.${String(10000 + n)}v1`, creator: 'A. Author, B. Author, C. Author ET AL.', tags: ['artificial intelligence'] },
  { kind: 'paper', platform: 'paper', outlet: 'BIORXIV', url: (n) => `https://europepmc.org/article/PPR/PPR${900000 + n}`, creator: 'D. Author', tags: ['neuroscience'] },
  { kind: 'news', platform: 'news', outlet: 'BBC NEWS', url: (n) => `https://www.bbc.co.uk/news/articles/mock${String(n).padStart(6, '0')}`, tags: [] },
  { kind: 'news', platform: 'news', outlet: 'NPR', url: (n) => `https://www.npr.org/2026/11/16/nx-s1-${n}/mock-story-${n}`, tags: [] },
  { kind: 'news', platform: 'news', outlet: 'WIKIPEDIA', url: (n) => `https://en.wikipedia.org/wiki/Mock_story_${n}`, tags: ['science'] },
  { kind: 'longread', platform: 'longread', outlet: 'QUANTA MAGAZINE', url: (n) => `https://www.quantamagazine.org/mock-long-read-${n}/`, creator: 'E. Writer', tags: ['physics'] },
  { kind: 'longread', platform: 'longread', outlet: 'AEON', url: (n) => `https://aeon.co/essays/mock-essay-${n}`, creator: 'F. Writer', tags: [] },
  { kind: 'tech', platform: 'tech', outlet: 'HACKER NEWS', url: (n) => `https://example.org/mock-story-${n}`, creator: 'EXAMPLE.ORG', tags: [] },
  { kind: 'tech', platform: 'tech', outlet: 'HACKADAY', url: (n) => `https://hackaday.com/2026/11/16/mock-hack-${n}/`, creator: 'G. Maker', tags: ['microcontrollers'] },
];

const KEYS: Readonly<Record<string, string>> = { 'HACKER NEWS': 'hn', HACKADAY: 'hackaday', 'BBC NEWS': 'bbc', NPR: 'npr', WIKIPEDIA: 'wiki', 'QUANTA MAGAZINE': 'quanta', AEON: 'aeon', ARXIV: 'arxiv', BIORXIV: 'epmc' };

/** Three rows per outlet, an hour apart, newest first. */
export function mockBrief(now: number): BriefRow[] {
  const rows: BriefRow[] = [];
  let n = 1;
  for (const outlet of OUTLETS) {
    for (let i = 0; i < 3; i += 1, n += 1) {
      const externalId = `${KEYS[outlet.outlet]}-mock${String(n).padStart(2, '0')}`;
      const at = new Date(now - (n + i) * 3_600_000).toISOString();
      rows.push({
        kind: outlet.kind,
        item: {
          id: `${outlet.platform}:${externalId}`,
          platform: outlet.platform,
          externalId,
          kind: 'text',
          url: outlet.url(n),
          canonicalUrl: outlet.url(n),
          title: `MOCK READING ${String(n).padStart(2, '0')}: an invented ${outlet.kind === 'longread' ? 'long read' : outlet.kind} from ${outlet.outlet}`,
          ...(outlet.creator ? { creator: outlet.creator } : {}),
          description: 'An invented summary, so the mock site shows how a reading row reads.',
          ...(outlet.tags.length > 0 ? { tags: outlet.tags } : {}),
          outlet: outlet.outlet,
          publishedAt: at,
          fetchedAt: new Date(now).toISOString(),
        },
      });
    }
  }
  return rows;
}
