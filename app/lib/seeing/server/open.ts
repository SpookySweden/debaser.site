/**
 * The server's eye answering (SPEC-seeing-machine.md, "SERVER EYE"): a page opened, a page's later files signed, and what its scripts ask
 * for. Each asks the gate first, before anything else of the request is read. SERVER ONLY.
 */
import { bodyText } from '../../screens/host-server';
import { AnySiteRefusal, safeFetchAnySite, type AnySiteWay } from '../../web/safe-fetch';
import type { SeenDocument } from '../engine';
import { ASSET_KINDS, type AssetKind } from './assets';
import { cache } from './cache';
import { ASSET_PATH, askAnswer, assetAnswer, fileAddress, resolveOn, type FileDeps } from './files';
import { passStands, realGate, seeingOwner, whoMaySee, type GateDeps } from './gate';
import { escapeText, escapeValue } from './html';
import { counter, LIMITS, type Counter } from './limits';
import { readingOf } from './reading';
import { rewritePage } from './rewrite';
import { refusesSignIn } from './sign-ins';
import { visitLog, type VisitLog } from './visits';
import { watcherAt } from './watchers-list';
import { wayOut } from './way-out';
import { wordsOf } from './words';

export type SeeDeps = { gate: GateDeps; way: AnySiteWay | null; counter: Counter; cache: FileDeps['cache']; visits: VisitLog; now: () => number };

export function realSee(): SeeDeps {
  const gate = realGate();
  return { gate, way: wayOut(gate.env), counter, cache, visits: visitLog, now: Date.now };
}

const HEADERS = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'X-Robots-Tag': 'noindex' };
const said = (status: number, reason: string): Response => Response.json({ ok: false, reason }, { status, headers: HEADERS });

const PAGE_TYPES = /^(?:text\/html|application\/xhtml\+xml|text\/plain|text\/markdown|text\/csv|application\/json|text\/xml|application\/xml|application\/rss\+xml|application\/atom\+xml|image\/(?:png|jpeg|gif|webp|avif|svg\+xml)|application\/pdf|application\/epub\+zip)$/;

/** Where this site's signed files are: the setting, or wherever the request came to. */
function assetOrigin(request: Request, env: Record<string, string | undefined>): string {
  const set = (env.SEEING_ASSET_ORIGIN ?? '').trim().replace(/\/$/, '');
  if (/^https:\/\/[a-z0-9.-]+$/.test(set)) return set;
  // Behind the tunnel the server is spoken to as http://localhost; the browser's own word for where it is, checked to be a plain address.
  const origin = request.headers.get('origin') ?? '';
  return /^https?:\/\/[a-z0-9.:-]+$/i.test(origin) ? origin : new URL(request.url).origin;
}

function filesFor(request: Request, deps: SeeDeps, way: AnySiteWay): FileDeps {
  return { way, counter: deps.counter, cache: deps.cache, now: deps.now, assetOrigin: assetOrigin(request, deps.gate.env), stands: (person) => passStands(person, deps.gate.env) };
}

type Ready = { ok: true; person: string; way: AnySiteWay; body: Record<string, unknown> } | { ok: false; response: Response };

/** The gate, the way out, and then the body: a small JSON object and nothing else. */
async function ready(request: Request, deps: SeeDeps): Promise<Ready> {
  const gate = await whoMaySee(request, deps.gate);
  if (!gate.ok) return { ok: false, response: said(gate.status, gate.reason) };
  if (deps.way === null) return { ok: false, response: said(503, 'THE MACHINE IS OFF') };
  if (!/^application\/json\b/i.test(request.headers.get('content-type') ?? '')) return { ok: false, response: said(415, 'NOT UNDERSTOOD') };
  const text = await bodyText(request, 64 * 1024);
  let body: unknown = null;
  try {
    body = text === null ? null : JSON.parse(text);
  } catch {
    // Not JSON: not understood, below.
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return { ok: false, response: said(400, 'NOT UNDERSTOOD') };
  return { ok: true, person: gate.person, way: deps.way, body: body as Record<string, unknown> };
}

/** A page that isn't HTML, as one that is: a picture, or words. */
function plainPage(type: string, words: string, picture: string | null): string {
  if (type.startsWith('image/')) return picture === null ? '' : `<img src="${escapeValue(picture)}" alt="" style="max-width:100%">`;
  return `<pre style="white-space:pre-wrap;overflow-wrap:anywhere">${escapeText(words)}</pre>`;
}

/** POST /api/see/open { address, scripts } */
export async function openAnswer(request: Request, deps: SeeDeps = realSee()): Promise<Response> {
  const asked = await ready(request, deps);
  if (!asked.ok) return asked.response;
  const { person, way, body } = asked;
  const address = typeof body.address === 'string' ? body.address : '';
  const scripts = body.scripts !== false;
  const tooMany = deps.counter.page(person);
  if (tooMany !== null) return said(429, tooMany);
  if (!(await recorded(person, [siteName(address)], deps))) return said(503, 'THE MACHINE IS OFF');
  try {
    const answer = await deps.counter.turn(person, () =>
      safeFetchAnySite(address, {
        way,
        accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        maxBytes: LIMITS.pageBytes,
        timeoutMs: LIMITS.timeoutMs,
        maxRedirects: LIMITS.redirects,
        types: PAGE_TYPES,
        refuses: (url) => {
          const watcher = watcherAt(url.hostname);
          return watcher !== null && watcher.ad ? `REFUSED: ${watcher.company.toUpperCase()}` : refusesSignIn(url);
        },
        signal: request.signal,
      }),
      request.signal,
    );
    if (answer === null) return said(429, 'TOO MANY PAGES AT ONCE: WAIT A MINUTE');
    if (answer.type === 'application/pdf' || answer.type === 'application/epub+zip') return said(403, 'A BOOK: READ OPENS THOSE');
    deps.counter.sent(person, answer.body.byteLength);
    const files = filesFor(request, deps, way);
    const sign = (text: string, kind: AssetKind) => fileAddress(text, answer.url, kind, person, files);
    const isPage = /html/.test(answer.type);
    const words = answer.type.startsWith('image/') ? '' : wordsOf(answer.body, answer.charset);
    const page = isPage
      ? rewritePage(words, answer.url, sign, scripts)
      : { html: plainPage(answer.type, words, answer.type.startsWith('image/') ? sign(answer.url, 'picture') : null), title: null, watchers: [], files: 0, refused: 0, signIn: false, refresh: null };
    const document: SeenDocument = {
      address: answer.url,
      title: page.title ?? '',
      eye: 'SERVER EYE',
      html: page.html,
      reading: isPage ? readingOf(words, answer.url, page.title, sign) : null,
      watchers: page.watchers,
      files: page.files,
      refused: page.refused,
      status: answer.status,
      signIn: page.signIn,
      refresh: page.refresh,
      assets: `${files.assetOrigin}${ASSET_PATH}`,
      scripts: scripts && isPage,
    };
    return Response.json({ ok: true, document }, { headers: HEADERS });
  } catch (error) {
    // Its own words say why; anything else is ours to keep.
    return said(error instanceof AnySiteRefusal ? 403 : 502, error instanceof AnySiteRefusal ? error.message : 'THE SOURCE DID NOT ANSWER');
  }
}

/**
 * Anybody but the owner is written down, by site, before anything is fetched or signed for them (D3), and nothing is fetched that could not
 * be. A site is written once in a while for each person, not for each of a page's files.
 */
const WRITTEN_AGAIN_MS = 10 * 60_000;
const WRITTEN_MOST = 5000;
const holder = globalThis as typeof globalThis & { debaserSeeingWritten?: WeakMap<VisitLog, Map<string, number>> };
const writtenBy = (holder.debaserSeeingWritten ??= new WeakMap());

async function recorded(person: string, sites: readonly (string | null)[], deps: SeeDeps): Promise<boolean> {
  if (person === seeingOwner(deps.gate.env) || person === 'dev') return true;
  let written = writtenBy.get(deps.visits);
  if (written === undefined) writtenBy.set(deps.visits, (written = new Map<string, number>()));
  for (const site of new Set(sites)) {
    if (site === null) return false;
    const key = `${person} ${site}`;
    const last = written.get(key);
    if (last !== undefined && deps.now() - last < WRITTEN_AGAIN_MS) continue;
    if (!(await deps.visits.write(person, site))) return false;
    if (written.size >= WRITTEN_MOST) written.clear();
    written.set(key, deps.now());
  }
  return true;
}

/** The site's name and no more: what a visit record may hold (D3). */
export function siteName(address: string): string | null {
  try {
    const url = new URL(address);
    return /^https?:$/.test(url.protocol) && url.hostname.length <= 253 ? url.hostname.toLowerCase() : null;
  } catch {
    return null;
  }
}

const FILES_AT_ONCE = 60;

/** POST /api/see/seal { page, files: [{ address, kind }] }: what a script put on the page since. */
export async function sealAnswer(request: Request, deps: SeeDeps = realSee()): Promise<Response> {
  const asked = await ready(request, deps);
  if (!asked.ok) return asked.response;
  const { page, files } = asked.body;
  if (typeof page !== 'string' || !Array.isArray(files) || files.length > FILES_AT_ONCE) return said(400, 'NOT UNDERSTOOD');
  const own = filesFor(request, deps, asked.way);
  const named = files.map((file: unknown) => resolveOn(String((file as { address?: unknown } | null)?.address ?? ''), page)).filter((each) => each !== null);
  if (!(await recorded(asked.person, named.map(siteName), deps))) return said(503, 'THE MACHINE IS OFF');
  const addresses = files.map((file: unknown) => {
    const { address, kind } = (typeof file === 'object' && file !== null ? file : {}) as { address?: unknown; kind?: unknown };
    const known = ASSET_KINDS.find((each) => each === kind && each !== 'data');
    return typeof address === 'string' && known !== undefined ? fileAddress(address, page, known, asked.person, own) : null;
  });
  return Response.json({ ok: true, addresses }, { headers: HEADERS });
}

/** POST /api/see/ask { page, address }: a script's own request, its bytes as they came. */
export async function askedAnswer(request: Request, deps: SeeDeps = realSee()): Promise<Response> {
  const asked = await ready(request, deps);
  if (!asked.ok) return asked.response;
  const { page, address } = asked.body;
  if (typeof page !== 'string' || typeof address !== 'string') return said(400, 'NOT UNDERSTOOD');
  const wanted = resolveOn(address, page);
  if (wanted === null || !(await recorded(asked.person, [siteName(wanted)], deps))) return said(403, "THAT ISN'T AN ADDRESS");
  const answer = await askAnswer(address, page, asked.person, filesFor(request, deps, asked.way), request.signal);
  if (!answer.ok) return said(403, answer.reason);
  return new Response(answer.body as BodyInit, {
    headers: { ...HEADERS, 'Content-Type': 'application/octet-stream', 'Content-Disposition': 'attachment; filename="asked"', 'X-See-Type': answer.type, 'X-See-Status': String(answer.status), 'X-See-Url': encodeURIComponent(answer.url) },
  });
}

/** GET /api/see/asset/<pass> */
export async function assetRoute(request: Request, pass: string, deps: SeeDeps = realSee()): Promise<Response> {
  if (deps.way === null) return said(503, 'THE MACHINE IS OFF');
  return assetAnswer(pass, filesFor(request, deps, deps.way), request.signal);
}
