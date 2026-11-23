/**
 * A page's files (SPEC-seeing-machine.md, "Signed assets" and "Scripts on"): the address the rewriter writes for one, what answers it, and
 * what a page's own script asks for while it runs. SERVER ONLY.
 */
import { AnySiteRefusal, safeFetchAnySite, type AnySiteAnswer, type AnySiteWay } from '../../web/safe-fetch';
import { ASSET_TYPES, assetHeaders, looksLikeFont, looksLikeMarkup, openPass, PASS_LASTS_MS, sealPass, type AssetKind } from './assets';
import type { createCache } from './cache';
import { rewriteCss } from './css';
import type { Counter } from './limits';
import { LIMITS } from './limits';
import { rewriteImports, rewriteLocation } from './modules';
import { refusesSignIn } from './sign-ins';
import { watcherAt } from './watchers-list';
import { wordsOf } from './words';

export const ASSET_PATH = '/api/see/asset/';

export type FileDeps = {
  way: AnySiteWay;
  counter: Counter;
  cache: ReturnType<typeof createCache>;
  now: () => number;
  /** Where files are served from: the site itself, or `see.debaser.site` when that exists. */
  assetOrigin: string;
  /** Whether a pass made for this person still stands (`gate.ts`). */
  stands: (person: string) => boolean;
};

/** An address on a page, against the page it is on; null when it can't be one that is fetched. */
export function resolveOn(text: string, page: string): string | null {
  try {
    const url = new URL(text.trim(), page);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    url.hash = '';
    return url.href;
  } catch {
    return null;
  }
}

/** A file's signed address, or null for one that is refused: a known watcher's, or one that is no address. */
export function fileAddress(text: string, page: string, kind: AssetKind, person: string, deps: FileDeps): string | null {
  const address = resolveOn(text, page);
  if (address === null || address.length > 3000) return null;
  if (watcherAt(new URL(address).hostname) !== null) return null;
  return `${deps.assetOrigin}${ASSET_PATH}${sealPass({ address, kind, person, until: deps.now() + PASS_LASTS_MS })}`;
}

const ACCEPTS: Record<AssetKind, string> = {
  picture: 'image/avif,image/webp,image/png,image/svg+xml,image/*;q=0.8',
  style: 'text/css,*/*;q=0.1',
  font: 'font/woff2,font/woff,*/*;q=0.5',
  script: '*/*',
  module: '*/*',
  data: 'application/json,text/plain,*/*',
};

const refuseWatchers = (url: URL): string | null => {
  const watcher = watcherAt(url.hostname);
  return watcher === null ? refusesSignIn(url) : `REFUSED: ${watcher.company.toUpperCase()}`;
};

export async function fetchFile(address: string, kind: AssetKind, deps: FileDeps, signal?: AbortSignal): Promise<AnySiteAnswer> {
  const answer = await safeFetchAnySite(address, {
    way: deps.way,
    accept: ACCEPTS[kind],
    maxBytes: LIMITS.assetBytes,
    timeoutMs: LIMITS.timeoutMs,
    maxRedirects: LIMITS.redirects,
    types: ASSET_TYPES[kind],
    refuses: refuseWatchers,
    signal,
  });
  if (kind !== 'data') {
    if (answer.status !== 200) throw new AnySiteRefusal(`HTTP ${answer.status}`, answer.status);
    if (kind !== 'picture' || answer.type !== 'image/svg+xml') if (looksLikeMarkup(answer.body)) throw new AnySiteRefusal('NOT WHAT IT SAYS IT IS');
    if (kind === 'font' && answer.type === 'application/octet-stream' && !looksLikeFont(answer.body)) throw new AnySiteRefusal('NOT WHAT IT SAYS IT IS');
  }
  return answer;
}

/** What a sheet, a module or any other file is sent on as: sheets and modules name more files, and those are signed too. */
function prepared(answer: AnySiteAnswer, kind: AssetKind, person: string, deps: FileDeps): { type: string; body: Uint8Array } {
  if (kind === 'style') {
    const css = rewriteCss(wordsOf(answer.body, answer.charset), (text, of) => fileAddress(text, answer.url, of, person, deps));
    return { type: 'text/css; charset=utf-8', body: new TextEncoder().encode(css) };
  }
  if (kind === 'script' || kind === 'module') {
    const words = rewriteLocation(wordsOf(answer.body, answer.charset));
    const script = kind === 'module' ? rewriteImports(words, (text) => fileAddress(text, answer.url, 'module', person, deps)) : words;
    return { type: 'text/javascript; charset=utf-8', body: new TextEncoder().encode(script) };
  }
  return { type: kind === 'font' && answer.type === 'application/octet-stream' ? 'font/woff2' : answer.type, body: answer.body };
}

const no = (status: number, words: string): Response => new Response(words, { status, headers: { ...assetHeaders('text/plain; charset=utf-8'), 'Cache-Control': 'no-store' } });

/** GET a signed file. No token: the pass is the whole of who is asking and what for. */
export async function assetAnswer(pass: string, deps: FileDeps, signal?: AbortSignal): Promise<Response> {
  const opened = openPass(pass, deps.now());
  if (opened === null || !deps.stands(opened.person)) return no(403, 'NO PASS');
  if (!deps.counter.file(opened.person)) return no(429, 'TOO MANY FILES');
  // Sheets, and modules, have the person's own passes written into them, so they are kept apart for each.
  const own = opened.kind === 'style' || opened.kind === 'module';
  const key = `${opened.kind} ${own ? opened.person : ''} ${opened.address}`;
  try {
    let file = deps.cache.get(key);
    if (file === null) {
      file = await deps.counter.turn(opened.person, async () => prepared(await fetchFile(opened.address, opened.kind, deps, signal), opened.kind, opened.person, deps), signal);
      if (file === null) return no(429, 'TOO MANY FILES');
      deps.cache.put(key, file);
    }
    deps.counter.sent(opened.person, file.body.byteLength);
    return new Response(file.body as BodyInit, { headers: { ...assetHeaders(file.type), 'Content-Length': String(file.body.byteLength) } });
  } catch (error) {
    return no(error instanceof AnySiteRefusal ? 403 : 502, error instanceof AnySiteRefusal ? error.message : 'THE SOURCE DID NOT ANSWER');
  }
}

export type Asked = { ok: true; status: number; type: string; url: string; body: Uint8Array } | { ok: false; reason: string };

/** What a page's own script asks for while it runs: GET only, with nothing of the reader's. Never cached: a script asks to hear what is new. */
export async function askAnswer(address: string, page: string, person: string, deps: FileDeps, signal?: AbortSignal): Promise<Asked> {
  const wanted = resolveOn(address, page);
  if (wanted === null) return { ok: false, reason: "THAT ISN'T AN ADDRESS" };
  const watcher = watcherAt(new URL(wanted).hostname);
  if (watcher !== null) return { ok: false, reason: `REFUSED: ${watcher.company.toUpperCase()}` };
  if (!deps.counter.file(person)) return { ok: false, reason: 'TOO MANY FILES' };
  try {
    const answer = await deps.counter.turn(person, () => fetchFile(wanted, 'data', deps, signal), signal);
    if (answer === null) return { ok: false, reason: 'TOO MANY FILES' };
    deps.counter.sent(person, answer.body.byteLength);
    return { ok: true, status: answer.status, type: answer.type, url: answer.url, body: answer.body };
  } catch (error) {
    return { ok: false, reason: error instanceof AnySiteRefusal ? error.message : 'THE SOURCE DID NOT ANSWER' };
  }
}
