/**
 * Papers from arXiv (SPEC-media-feed.md): its public API, one Atom request for the newest submissions in a few fields
 * picked for a general reader. Keyless; the metadata is CC0, and the API asks for at most one request every 3 seconds,
 * which a single request every half hour keeps well inside. Server-only (it fetches through `safe-fetch`).
 *
 * Kept: title, the first three authors, the abstract's opening, the subjects as words, the date, the abstract page.
 * The page address is built from the paper's id, never taken from the feed.
 */
import { safeFetchText, type FetchLike } from '../safe-fetch';
import { buildUrl, isSafeIdentifier } from '../urls';
import { MAX_TEXT_LENGTH, plausibleIsoDate, sanitiseText } from '../sanitise';
import type { WebItem } from '../types';
import { child, childText, children, parseXml, type XmlElement } from '../adapters/xml';
import { ARXIV_API_HOST, ARXIV_ID, ARXIV_PAGE_HOST } from './feeds';

/** The fields asked for: AI, computers and society, neuroscience, planets, popular physics, general economics. */
export const ARXIV_CATEGORIES = ['cs.AI', 'cs.CY', 'q-bio.NC', 'astro-ph.EP', 'physics.pop-ph', 'econ.GN'] as const;
export const ARXIV_MAX_RESULTS = 60;

/** A subject's words, for steering the feed (never shown). A code not listed gives its field's word, or nothing. */
const SUBJECT_WORDS: Readonly<Record<string, string>> = {
  'cs.AI': 'artificial intelligence',
  'cs.LG': 'machine learning',
  'cs.CL': 'language',
  'cs.CV': 'computer vision',
  'cs.CY': 'society',
  'cs.HC': 'design',
  'cs.RO': 'robotics',
  'q-bio.NC': 'neuroscience',
  'astro-ph.EP': 'planets',
  'astro-ph.GA': 'galaxies',
  'astro-ph.SR': 'stars',
  'physics.pop-ph': 'physics',
  'physics.soc-ph': 'society',
  'econ.GN': 'economics',
  'stat.ML': 'machine learning',
};
const FIELD_WORDS: Readonly<Record<string, string>> = {
  cs: 'computing',
  'q-bio': 'biology',
  'astro-ph': 'astronomy',
  physics: 'physics',
  econ: 'economics',
  math: 'mathematics',
  stat: 'statistics',
  'cond-mat': 'physics',
  quant: 'quantum',
  'quant-ph': 'quantum',
};

export function subjectWord(code: string): string | undefined {
  return SUBJECT_WORDS[code] ?? FIELD_WORDS[code.split('.')[0]];
}

export function arxivUrl(): string {
  return buildUrl(ARXIV_API_HOST, ['api', 'query'], [
    ['search_query', ARXIV_CATEGORIES.map((code) => `cat:${code}`).join(' OR ')],
    ['sortBy', 'submittedDate'],
    ['sortOrder', 'descending'],
    ['max_results', String(ARXIV_MAX_RESULTS)],
  ]);
}

/** The paper's id out of its `<id>` (`http://arxiv.org/abs/2611.18561v1`), or null when it is not one. */
export function paperId(value: string | undefined): string | null {
  const match = value?.trim().match(/^https?:\/\/arxiv\.org\/abs\/(.+)$/);
  const id = match?.[1];
  return id && ARXIV_ID.test(id) && isSafeIdentifier(id, 40) ? id : null;
}

/** The first three authors, then ET AL. */
export function authorLine(names: readonly string[]): string | undefined {
  const clean = names.map((name) => sanitiseText(name, 80)).filter(Boolean);
  if (clean.length === 0) return undefined;
  const line = clean.slice(0, 3).join(', ') + (clean.length > 3 ? ' ET AL.' : '');
  return sanitiseText(line, 200) || undefined;
}

export function toPaper(entry: XmlElement, fetchedAt: string): WebItem | null {
  if (entry.name !== 'entry') return null;
  const id = paperId(childText(entry, 'id'));
  if (!id) return null;
  const publishedAt = plausibleIsoDate(childText(entry, 'published'), fetchedAt);
  if (!publishedAt) return null;
  const page = buildUrl(ARXIV_PAGE_HOST, ['abs', id]);
  const title = sanitiseText(childText(entry, 'title'), 300) || id;
  const creator = authorLine(children(entry, 'author').map((author) => childText(author, 'name') ?? ''));
  const description = sanitiseText(childText(entry, 'summary'), MAX_TEXT_LENGTH) || undefined;
  const codes = [child(entry, 'arxiv:primary_category')?.attrs.term, ...children(entry, 'category').map((one) => one.attrs.term)];
  const tags = [...new Set(codes.flatMap((code) => (typeof code === 'string' && subjectWord(code) ? [subjectWord(code) as string] : [])))].slice(0, 6);
  return {
    id: `paper:arxiv-${id}`,
    platform: 'paper',
    externalId: `arxiv-${id}`,
    kind: 'text',
    url: page,
    canonicalUrl: page,
    title,
    ...(creator ? { creator } : {}),
    ...(description ? { description } : {}),
    ...(tags.length > 0 ? { tags } : {}),
    outlet: 'ARXIV',
    publishedAt,
    fetchedAt,
  };
}

/** The papers out of an arXiv Atom answer, or a thrown error when it is not one. */
export function parseArxiv(xml: string, fetchedAt: string): WebItem[] {
  const root = parseXml(xml);
  if (root.name !== 'feed') throw new Error('not an Atom feed');
  const seen = new Set<string>();
  const items: WebItem[] = [];
  for (const entry of children(root, 'entry').slice(0, ARXIV_MAX_RESULTS)) {
    const item = toPaper(entry, fetchedAt);
    if (!item || seen.has(item.id)) continue;
    seen.add(item.id);
    items.push(item);
  }
  return items;
}

export async function fetchArxiv(deps: { fetch?: FetchLike; now?: () => Date } = {}): Promise<WebItem[]> {
  const xml = await safeFetchText(arxivUrl(), { allowedHosts: [ARXIV_API_HOST], fetchImpl: deps.fetch, accept: 'application/atom+xml, application/xml;q=0.9' });
  return parseArxiv(xml, (deps.now?.() ?? new Date()).toISOString());
}
