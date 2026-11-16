/**
 * Papers from Europe PMC (SPEC-media-feed.md): its public REST search, one JSON request for the newest preprints with an
 * abstract (bioRxiv, medRxiv, Research Square and the rest it gathers). Free, keyless, fair use. Server-only.
 *
 * Not narrowed to OPEN_ACCESS:y: Europe PMC sets that flag on preprints weeks late (2026-11-16: its newest flagged
 * preprint was six weeks old, past the papers' 30-day shelf). A preprint server posts every abstract openly, so a
 * preprint's abstract is shown; any other record's only when it is marked open access.
 *
 * Kept: title, the first three authors, the preprint server or journal, the abstract (open access only), the keywords as
 * words, the date, the Europe PMC article page built from the record's source and id. Its citation count is in every
 * record and is never read.
 */
import { safeFetchJson, type FetchLike } from '../safe-fetch';
import { buildUrl, isSafeIdentifier } from '../urls';
import { MAX_TEXT_LENGTH, plausibleIsoDate, sanitiseText } from '../sanitise';
import type { WebItem } from '../types';
import { EUROPE_PMC_API_HOST, EUROPE_PMC_PAGE_HOST, EUROPE_PMC_PAGE_PATH } from './feeds';
import { authorLine } from './arxiv';

export const EUROPE_PMC_PAGE_SIZE = 40;
const SOURCES = /^(?:PPR|MED|PMC|AGR|CBA|CTX|ETH|HIR|NBK|PAT)$/;

export function europePmcUrl(): string {
  return buildUrl(EUROPE_PMC_API_HOST, ['europepmc', 'webservices', 'rest', 'search'], [
    ['query', 'SRC:PPR AND HAS_ABSTRACT:y'],
    ['sort', 'P_PDATE_D desc'],
    ['format', 'json'],
    ['pageSize', String(EUROPE_PMC_PAGE_SIZE)],
    ['resultType', 'core'],
  ]);
}

const text = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined);

export function toEuropePaper(record: unknown, fetchedAt: string): WebItem | null {
  if (!record || typeof record !== 'object') return null;
  const doc = record as Record<string, unknown>;
  const source = text(doc.source);
  const id = text(doc.id);
  if (!source || !SOURCES.test(source) || !isSafeIdentifier(id, 20)) return null;
  const page = buildUrl(EUROPE_PMC_PAGE_HOST, ['article', source, id]);
  if (!EUROPE_PMC_PAGE_PATH.test(new URL(page).pathname)) return null;
  const publishedAt = plausibleIsoDate(text(doc.firstPublicationDate), fetchedAt);
  if (!publishedAt) return null;

  const title = sanitiseText(doc.title, 300).replace(/\.$/, '') || id;
  const creator = authorLine((text(doc.authorString) ?? '').replace(/\.$/, '').split(/,\s*/));
  const openAccess = text(doc.isOpenAccess) === 'Y' || source === 'PPR';
  const description = openAccess ? sanitiseText(doc.abstractText, MAX_TEXT_LENGTH) || undefined : undefined;
  const report = doc.bookOrReportDetails as { publisher?: unknown } | undefined;
  const journal = (doc.journalInfo as { journal?: { title?: unknown } } | undefined)?.journal?.title;
  const server = sanitiseText(text(report?.publisher) ?? text(journal) ?? '', 60).toUpperCase();
  const keywords = (doc.keywordList as { keyword?: unknown } | undefined)?.keyword;
  const tags = Array.isArray(keywords)
    ? [...new Set(keywords.map((word) => sanitiseText(word, 60).toLowerCase()).filter(Boolean))].slice(0, 6)
    : [];

  return {
    id: `paper:epmc-${id}`,
    platform: 'paper',
    externalId: `epmc-${id}`,
    kind: 'text',
    url: page,
    canonicalUrl: page,
    title,
    ...(creator ? { creator } : {}),
    ...(description ? { description } : {}),
    ...(tags.length > 0 ? { tags } : {}),
    outlet: server || 'EUROPE PMC',
    publishedAt,
    fetchedAt,
  };
}

/** The papers out of a search answer, or a thrown error when the shape is wrong. */
export function parseEuropePmc(body: unknown, fetchedAt: string): WebItem[] {
  const results = (body as { resultList?: { result?: unknown } } | null)?.resultList?.result;
  if (!Array.isArray(results)) throw new Error('unexpected response shape');
  const seen = new Set<string>();
  const items: WebItem[] = [];
  for (const record of results.slice(0, EUROPE_PMC_PAGE_SIZE)) {
    const item = toEuropePaper(record, fetchedAt);
    if (!item || seen.has(item.id)) continue;
    seen.add(item.id);
    items.push(item);
  }
  return items;
}

export async function fetchEuropePmc(deps: { fetch?: FetchLike; now?: () => Date } = {}): Promise<WebItem[]> {
  const body = await safeFetchJson(europePmcUrl(), { allowedHosts: [EUROPE_PMC_API_HOST], fetchImpl: deps.fetch });
  return parseEuropePmc(body, (deps.now?.() ?? new Date()).toISOString());
}
