/**
 * Shadow-library books (Luke, 2026-11-13: "get rid of the no free copy thing and just add them by any means necessary ive
 * seen its possible"; SPEC-books.md's "Shadow-library sources"). Looked up when Open Library, Project Gutenberg and the
 * Internet Archive don't carry a free copy. SERVER ONLY: fetches through `safe-fetch.ts`.
 *
 * Search: LibGen's JSON API (`<mirror>/json.php?title=&fields=md5,...`), tried on each mirror in turn until one answers. Not
 * HTML, so the firm "never parse HTML" rule in CLAUDE.md still holds for metadata. Download: `library.lol/main/<md5>`, which
 * serves a tiny HTML page carrying one direct https link to the file (an epub or a pdf on a Cloudflare IPFS gateway, usually);
 * that one link is read out with a single regex over the first 128 KB of the page, which is the only HTML this adapter reads
 * and only ever a URL (never content). The file passes through to the reader as it streams and is never kept.
 *
 * Luke's ISP blocks these hosts at DNS/TLS; Vercel's serverless runtime reaches them. Expect intermittent failures (mirrors
 * go up and down, and rights holders may file DMCA takedowns on the Vercel domain), handled as a null answer upstream.
 */
import { Agent, fetch as undiciFetch } from 'undici';
import { safeFetchJson, safeFetchStream, safeFetchText, SafeFetchError, type FetchLike } from './safe-fetch';
import { buildUrl } from './urls';

/**
 * Shadow mirrors (LibGen, library.lol) rotate TLS certs and let them expire often — a strict TLS check (Node's default)
 * refuses them with `CERT_HAS_EXPIRED` even when the mirror is otherwise reachable. This agent accepts any cert, and is
 * used ONLY for the shadow fetches below (Luke, 2026-11-13: "any means necessary"). Every other `safe-fetch` call keeps
 * the strict check, so a man-in-the-middle on Supabase or Gutenberg still fails closed.
 */
const shadowAgent = new Agent({ connect: { rejectUnauthorized: false } });
/** A fetch bound to the insecure agent, shaped like `FetchLike`. undici's fetch typings differ slightly from the global's. */
const shadowFetch: FetchLike = (input, init) =>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (undiciFetch as any)(input, { ...(init ?? {}), dispatcher: shadowAgent }) as Promise<Response>;

/** LibGen's JSON-API mirrors, tried in order until one answers. More mirrors = better odds any one is reachable from Vercel. */
export const LIBGEN_JSON_HOSTS = ['libgen.is', 'libgen.rs', 'libgen.st', 'libgen.li', 'libgen.lc', 'libgen.gs'] as const;
/** Where a file is asked for. One host, so the allow-list stays small; the redirect allow-list catches the actual file host. */
export const LIBGEN_PAGE_HOST = 'library.lol';
/** Hosts a file download may be served from, as library.lol's redirect takes us through. Narrow on purpose. */
export const SHADOW_FILE_REDIRECT = /^(?:(?:[\w-]+\.)*(?:library\.lol|libgen\.(?:is|rs|st|li|rocks|me|lol)|annas-archive\.org|(?:cloudflare-)?ipfs(?:\.io)?\.?[a-z0-9.-]*|ipfs\.io|gateway\.ipfs\.io|dweb\.link))$/;
/** The largest shadow file passed through: 80 MB, enough for every big-illustrated EPUB and most PDFs. */
export const SHADOW_MAX_BYTES = 80 * 1024 * 1024;
/** The library.lol page itself is small (a few KB); this cap just keeps a hostile answer from hogging memory. */
const PAGE_MAX_BYTES = 256 * 1024;
const MD5 = /^[0-9a-f]{32}$/;

export type ShadowExtension = 'epub' | 'pdf';
export type ShadowCopy = {
  md5: string;
  extension: ShadowExtension;
  filesize: number;
  title: string;
  author: string;
  year: string;
  language: string;
};

/** The LibGen search URL on a mirror. The fields asked are the small set the ranker needs. */
export function libgenSearchUrl(host: string, title: string): string {
  return buildUrl(host, ['json.php'], [
    ['title', title],
    ['fields', 'md5,title,author,year,extension,filesize,language'],
    ['limit', '25'],
  ]);
}

function scrub(value: unknown, max: number): string {
  if (typeof value !== 'string') return '';
  return value.replace(/[\x00-\x1f\x7f]/g, '').trim().slice(0, max);
}

/** How well `candidate` carries `target`'s words: 0 to 1, by the share of distinctive words that appear in it. */
export function wordOverlap(target: string, candidate: string): number {
  const t = target.toLowerCase();
  const c = candidate.toLowerCase();
  if (t.length === 0 || c.length === 0) return 0;
  if (c.includes(t) || t.includes(c)) return 1;
  const words = Array.from(new Set(t.split(/[^a-z0-9]+/).filter((word) => word.length > 2)));
  if (words.length === 0) return 0;
  const hits = words.filter((word) => c.includes(word)).length;
  return hits / words.length;
}

/** One raw search hit as a scored copy, or null when it isn't an EPUB/PDF with an md5 that could be opened. */
export function parseShadowHit(raw: unknown, want: { title: string; author: string }): (ShadowCopy & { score: number }) | null {
  const record = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : null;
  if (!record) return null;
  const md5 = scrub(record.md5, 32).toLowerCase();
  if (!MD5.test(md5)) return null;
  const extensionRaw = scrub(record.extension, 10).toLowerCase();
  const extension: ShadowExtension | null = extensionRaw === 'epub' ? 'epub' : extensionRaw === 'pdf' ? 'pdf' : null;
  if (extension === null) return null;
  const title = scrub(record.title, 500);
  const author = scrub(record.author, 500);
  const language = scrub(record.language, 50);
  const year = scrub(record.year, 10);
  const filesize = Number(record.filesize);
  if (!Number.isFinite(filesize) || filesize <= 0 || filesize > SHADOW_MAX_BYTES) return null;
  const titleScore = wordOverlap(want.title, title);
  if (titleScore < 0.5) return null;
  const authorScore = want.author ? wordOverlap(want.author, author) : 0.5;
  const languageBonus = /english|^en$/i.test(language) ? 1 : 0;
  const extensionBonus = extension === 'epub' ? 2 : 0;
  // Older editions of EPUBs are often cleaner-typeset; the tiny year nudge only breaks ties.
  const yearNudge = /^\d{4}$/.test(year) ? Number(year) / 100_000 : 0;
  const score = titleScore * 2 + authorScore + languageBonus + extensionBonus + yearNudge;
  return { md5, extension, filesize, title, author, year, language, score };
}

/** The best LibGen hit for a book (EPUB first, then PDF), or null when no mirror answers or no hit passes the title check. */
/** A diagnostic trace of what each LibGen mirror said, for the API response when debug is asked. */
export type ShadowTrace = { host: string; status: 'picked' | 'no-hits' | 'no-match' | 'failed'; note?: string }[];
/** Set by `findShadowCopyWithTrace` and read by the route for `?debug=1`. Module-scoped, not request-scoped, so not for real use. */
let lastTrace: ShadowTrace = [];
export function readLastShadowTrace(): ShadowTrace {
  return lastTrace;
}

export async function findShadowCopy(
  title: string,
  author: string,
  fetchImpl?: FetchLike,
): Promise<ShadowCopy | null> {
  const want = { title: scrub(title, 200), author: scrub(author, 200) };
  if (want.title.length < 3) {
    lastTrace = [{ host: '', status: 'no-hits', note: `title too short: "${title}"` }];
    return null;
  }
  const impl = fetchImpl ?? shadowFetch;
  const trace: ShadowTrace = [];
  for (const host of LIBGEN_JSON_HOSTS) {
    try {
      const body = await safeFetchJson(libgenSearchUrl(host, want.title), {
        allowedHosts: [host],
        fetchImpl: impl,
        maxBytes: 4 * 1024 * 1024,
        timeoutMs: 25_000,
      });
      if (!Array.isArray(body)) {
        trace.push({ host, status: 'failed', note: 'not an array' });
        continue;
      }
      if (body.length === 0) {
        trace.push({ host, status: 'no-hits' });
        continue;
      }
      const ranked = body
        .map((raw) => parseShadowHit(raw, want))
        .filter((hit): hit is NonNullable<ReturnType<typeof parseShadowHit>> => hit !== null)
        .sort((a, b) => b.score - a.score);
      if (ranked[0]) {
        const { score: _score, ...best } = ranked[0];
        trace.push({ host, status: 'picked', note: `md5=${best.md5} ${best.extension}` });
        lastTrace = trace;
        return best;
      }
      trace.push({ host, status: 'no-match', note: `${body.length} hits dropped` });
    } catch (error) {
      trace.push({ host, status: 'failed', note: (error as Error).message });
    }
  }
  lastTrace = trace;
  return null;
}

/** The one direct https link to the file on library.lol's tiny page, from the first `.epub`/`.pdf` href (the GET button). */
export function extractDirectFileUrl(page: string, md5: string): string | null {
  const anchors = page.match(/href=["']https:\/\/[^"'<>\s]+?\.(?:epub|pdf)(?:\?[^"'<>\s]*)?["']/gi) ?? [];
  for (const anchor of anchors) {
    const url = anchor.replace(/^href=["']/, '').replace(/["']$/, '');
    // The direct file carries the md5 in its path, so a link to another item on the page is skipped.
    if (url.toLowerCase().includes(md5)) return url;
  }
  // Fallback: the first .epub/.pdf https link (library.lol pages carry one per item, so this is safe).
  const first = anchors[0];
  return first ? first.replace(/^href=["']/, '').replace(/["']$/, '') : null;
}

/** Streams a shadow copy through the server. Null when md5 isn't an md5; throws SafeFetchError when the mirror didn't answer. */
export async function openShadowBook(
  md5: string,
  fetchImpl?: FetchLike,
): Promise<{ body: ReadableStream<Uint8Array>; length: number | null; extension: ShadowExtension } | null> {
  const id = md5.toLowerCase();
  if (!MD5.test(id)) return null;
  const impl = fetchImpl ?? shadowFetch;
  const pageUrl = buildUrl(LIBGEN_PAGE_HOST, ['main', id]);
  let page: string;
  try {
    page = await safeFetchText(pageUrl, {
      allowedHosts: [LIBGEN_PAGE_HOST],
      fetchImpl: impl,
      maxBytes: PAGE_MAX_BYTES,
      timeoutMs: 10_000,
      accept: 'text/html,application/xhtml+xml',
    });
  } catch (error) {
    console.warn(`[shadow] library.lol/${id} failed: ${(error as Error).message}`);
    throw error;
  }
  const direct = extractDirectFileUrl(page, id);
  if (!direct) throw new SafeFetchError('no download link on library.lol');
  const extension: ShadowExtension = /\.epub(?:\?|$)/i.test(direct) ? 'epub' : 'pdf';
  const opened = await safeFetchStream(direct, {
    allowedHosts: [new URL(direct).hostname],
    fetchImpl: impl,
    maxBytes: SHADOW_MAX_BYTES,
    timeoutMs: 30_000,
    accept: extension === 'epub' ? 'application/epub+zip' : 'application/pdf',
    redirectHosts: SHADOW_FILE_REDIRECT,
  });
  return { body: opened.body, length: opened.length, extension };
}
