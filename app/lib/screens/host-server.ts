import { createClient } from '@supabase/supabase-js';

/**
 * SCREENS on the site's server (SPEC-screens.md, phase 3, first slice): the owner's PC screen in his own room.
 *
 * The site's server runs on the same PC as the engine (`engine/`, `debaser-engine serve`, 127.0.0.1 only), so it is
 * the introducer: a browser never talks to the engine's web address. It asks these routes, the server checks who is
 * asking, and only then passes the "hello" (a WebRTC offer) and the settings on to the engine on this PC. The picture
 * and CONTROL then travel by WebRTC straight between the browser and the engine.
 *
 * SERVER ONLY. No browser file may import this one: it reads the two settings below, which never reach a browser.
 *
 *   SCREENS_ENGINE_URL   where the engine listens. Default http://127.0.0.1:8478. Anything that is not a plain http
 *                        address on this PC itself (127.x.x.x, localhost, [::1]) is refused outright, so this can never
 *                        be pointed at another machine.
 *   SCREENS_OWNER_ID     the one account id that owns this PC's screen. Unset: the feature is off for everyone.
 *
 * Who is asking comes from the session token only (`Authorization: Bearer`, checked with `auth.getUser`, as
 * `app/api/profile/avatar/route.ts` does), never from an id in the request.
 *
 * With the mock accounts (no Supabase auth) there is no session to check, so the feature is off, with ONE exception
 * for proving it locally: when NODE_ENV is not "production" AND SCREENS_DEV_OPEN=1, whoever asks is treated as the
 * owner (`scripts/drive-screens.cjs` starts a dev server that way, with the engine in its dry run). A production
 * build can never do that: see `devOpen`.
 *
 * Everybody who is not the owner gets one answer, the same whether an engine is running or not, so nobody else can
 * tell that one exists: `{ available: false }` from /host, and one flat refusal from /offer and /settings.
 */

export type ScreensEnv = Record<string, string | undefined>;
/** The `fetch` shape, so the check can hand in a fake engine. */
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export type ScreensDeps = {
  env: ScreensEnv;
  /** The account a session token belongs to, asked of the auth server; null when it is nobody's, or a guest's. */
  accountOf: (token: string) => Promise<string | null>;
  /** How the engine is reached. */
  fetch: FetchLike;
  now: () => number;
};

export const DEFAULT_ENGINE_URL = 'http://127.0.0.1:8478';
/** The engine is on this PC: it answers at once or it is not there. */
export const ENGINE_TIMEOUT_MS = 2000;
/**
 * A change of settings is the one slow answer: the engine waits (up to five seconds) for its encoder to have made the
 * change, so that it can say what is really being sent. Normally a few milliseconds.
 */
export const ENGINE_CHANGE_TIMEOUT_MS = 6000;
/** The engine's own limits (engine/src/serve.rs): an offer of 64 KiB, settings of 4 KiB. */
export const MAX_OFFER_BYTES = 64 * 1024;
export const MAX_SETTINGS_BYTES = 4 * 1024;
const MAX_ENGINE_ANSWER_BYTES = 256 * 1024;
/** A modest limit on "hello"s: a viewer makes one each time the screen is switched on. */
export const OFFERS_PER_MINUTE = 12;

/* --- the rules ---------------------------------------------------------------------------------- */

/**
 * The engine's address, when it is a plain http address on this PC; null (refused) when it is anything else: another
 * machine, https, a path, a name and password, or not an address at all.
 */
export function engineOrigin(env: ScreensEnv): string | null {
  const text = (env.SCREENS_ENGINE_URL ?? '').trim() || DEFAULT_ENGINE_URL;
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:') return null;
  if (url.username !== '' || url.password !== '') return null;
  if ((url.pathname !== '/' && url.pathname !== '') || url.search !== '' || url.hash !== '') return null;
  if (!isLoopbackHost(url.hostname)) return null;
  return url.origin;
}

/** 127.x.x.x, localhost or [::1], and nothing that merely starts or ends like one. */
export function isLoopbackHost(hostname: string): boolean {
  const name = hostname.toLowerCase();
  if (name === 'localhost' || name === '[::1]') return true;
  const parts = /^127\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(name);
  return parts !== null && parts.slice(1).every((part) => Number(part) <= 255);
}

/** The one account that owns this PC's screen, or null when none is set (the feature is then off). */
export function ownerId(env: ScreensEnv): string | null {
  const id = (env.SCREENS_OWNER_ID ?? '').trim();
  return id.length >= 8 && id.length <= 64 ? id : null;
}

/** True when there is a session worth asking about: the site's auth switch, plus a project (as the avatar route reads it). */
export function authIsSupabase(env: ScreensEnv): boolean {
  return env.NEXT_PUBLIC_AUTH_BACKEND === 'supabase' && (env.NEXT_PUBLIC_SUPABASE_URL ?? '').length > 0 && (env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '').length > 0;
}

/**
 * The local-proof exception: with the mock accounts, on a server that is not a production one, started with
 * SCREENS_DEV_OPEN=1, whoever asks is the owner.
 *
 * Impossible in production twice over. `process.env.NODE_ENV` is written into a production build as the word
 * "production", so there the first line is `return false` before anything else is read; and `next start` sets
 * NODE_ENV to "production" itself, which the second line reads from the running server.
 */
export function devOpen(env: ScreensEnv): boolean {
  if (process.env.NODE_ENV === 'production') return false;
  if (env.NODE_ENV === 'production') return false;
  return !authIsSupabase(env) && env.SCREENS_DEV_OPEN === '1';
}

function bearerOf(request: Request): string {
  const header = request.headers.get('authorization') ?? '';
  return header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : '';
}

/**
 * The account a session token SAYS it is, read without checking it. Only ever used to say no early (a signed-in
 * visitor who is plainly somebody else costs the auth server nothing); a yes always waits for `accountOf`.
 * Null when the token cannot be read this way.
 */
export function claimedAccount(token: string): string | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const claims: unknown = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    if (typeof claims !== 'object' || claims === null) return null;
    const subject = (claims as { sub?: unknown }).sub;
    return typeof subject === 'string' && subject.length > 0 ? subject : null;
  } catch {
    return null;
  }
}

/** Whether the request comes from the owner of this PC's screen. Everything else in this file hangs off this. */
export async function ownerIsAsking(request: Request, deps: ScreensDeps): Promise<boolean> {
  // For this site's own pages only: another site's page asking through a visitor's browser is not the owner.
  const site = request.headers.get('sec-fetch-site');
  if (site !== null && site !== 'same-origin') return false;
  if (!authIsSupabase(deps.env)) return devOpen(deps.env);
  const owner = ownerId(deps.env);
  if (owner === null) return false;
  const token = bearerOf(request);
  if (token.length === 0 || token.length > 4000) return false;
  const claimed = claimedAccount(token);
  if (claimed !== null && claimed !== owner) return false;
  const account = await deps.accountOf(token);
  return account !== null && account === owner;
}

/* --- the real world ------------------------------------------------------------------------------ */

/**
 * The account the session belongs to, or null. The token is checked against the project, not trusted; the client is
 * made per call and keeps no session of its own (the avatar route's pattern).
 */
async function accountOfToken(token: string): Promise<string | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';
  if (url.length === 0 || key.length === 0) return null;
  try {
    const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data, error } = await client.auth.getUser(token);
    if (error !== null || data.user?.is_anonymous === true) return null;
    return data.user?.id ?? null;
  } catch {
    // The project could not be reached: refused, not waved through.
    return null;
  }
}

/** Read when a request arrives, never when the file loads, so the settings file is the only place they live. */
export function realDeps(): ScreensDeps {
  return {
    env: {
      NODE_ENV: process.env.NODE_ENV,
      NEXT_PUBLIC_AUTH_BACKEND: process.env.NEXT_PUBLIC_AUTH_BACKEND,
      NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      SCREENS_ENGINE_URL: process.env.SCREENS_ENGINE_URL,
      SCREENS_OWNER_ID: process.env.SCREENS_OWNER_ID,
      SCREENS_DEV_OPEN: process.env.SCREENS_DEV_OPEN,
    },
    accountOf: accountOfToken,
    fetch: (input, init) => fetch(input, init),
    now: () => Date.now(),
  };
}

/* --- talking to the engine ----------------------------------------------------------------------- */

type EngineAnswer = { status: number; text: string; viewer: string | null };

/**
 * One request to the engine on this PC. Null when it could not be asked: the address is refused, nothing answered in
 * time, or the answer was too large. No redirect is followed (the engine sends none), and nothing is kept.
 */
async function askEngine(deps: ScreensDeps, path: '/settings' | '/offer', viewer: string | null, init: { method: 'GET' | 'POST'; contentType?: string; body?: string }, timeoutMs: number): Promise<EngineAnswer | null> {
  const origin = engineOrigin(deps.env);
  if (origin === null) return null;
  try {
    const response = await deps.fetch(`${origin}${path}${viewer === null ? '' : `?viewer=${viewer}`}`, {
      method: init.method,
      headers: init.contentType === undefined ? undefined : { 'Content-Type': init.contentType },
      body: init.body,
      redirect: 'error',
      cache: 'no-store',
      signal: AbortSignal.timeout(timeoutMs),
    });
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > MAX_ENGINE_ANSWER_BYTES) return null;
    const number = response.headers.get('debaser-viewer') ?? '';
    return { status: response.status, text: new TextDecoder().decode(bytes), viewer: /^\d{1,12}$/.test(number) ? number : null };
  } catch {
    return null;
  }
}

/* --- the answers --------------------------------------------------------------------------------- */

const NEVER_KEPT = { 'Cache-Control': 'private, no-store' };

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...NEVER_KEPT } });
}

/** What everybody but the owner is told by /host, engine or no engine. */
const notAvailable = () => json(200, { available: false });
/** What everybody but the owner is told by /offer and /settings, engine or no engine. */
const refused = () => json(403, { error: 'Not available.' });
const engineSilent = () => json(502, { error: "The PC's screen engine did not answer." });

/** The engine's own plain words for why it would not, kept short and to one line. */
function engineWords(text: string, fallback: string): string {
  const line = text.replace(/\s+/g, ' ').trim().slice(0, 300);
  return line.length > 0 ? line : fallback;
}

/** A request's body as text when it is no longer than `most` bytes; null when it is longer. */
export async function bodyText(request: Request, most: number): Promise<string | null> {
  const declared = Number(request.headers.get('content-length') ?? '');
  if (Number.isFinite(declared) && declared > most) return null;
  const reader = request.body?.getReader();
  if (reader === undefined) return '';
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > most) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

/** `?viewer=N`: the number the engine gave this viewer's hello. It only decides whether control reads "yours". */
function viewerOf(request: Request): string | null {
  const number = new URL(request.url).searchParams.get('viewer') ?? '';
  return /^\d{1,12}$/.test(number) ? number : null;
}

/**
 * GET /api/screens/host: `{ available: true, settings }` for the owner while the engine answers, and
 * `{ available: false }` for everything else.
 */
export async function hostAnswer(request: Request, deps: ScreensDeps = realDeps()): Promise<Response> {
  if (!(await ownerIsAsking(request, deps))) return notAvailable();
  const answer = await askEngine(deps, '/settings', null, { method: 'GET' }, ENGINE_TIMEOUT_MS);
  if (answer === null || answer.status !== 200) return notAvailable();
  try {
    const settings: unknown = JSON.parse(answer.text);
    if (typeof settings !== 'object' || settings === null) return notAvailable();
    // `drive: true` only on a server opened for the local drive (never in production: `devOpen`). It lets the drive's
    // page be told to behave as a device that is NOT the PC, which a browser on the PC otherwise always is.
    return json(200, devOpen(deps.env) ? { available: true, settings, drive: true } : { available: true, settings });
  } catch {
    return notAvailable();
  }
}

/** The stamps of the hellos this server copy has passed on in the last minute. */
const offers: number[] = [];

function tooManyOffers(now: number): boolean {
  while (offers.length > 0 && now - offers[0] >= 60_000) offers.shift();
  if (offers.length >= OFFERS_PER_MINUTE) return true;
  offers.push(now);
  return false;
}

/** For the check: start counting hellos afresh. */
export function forgetOffers(): void {
  offers.length = 0;
}

/**
 * POST /api/screens/offer (owner only): the browser's WebRTC offer, as `application/sdp`, passed to the engine;
 * its answer comes back the same way, with the viewer's number in `Debaser-Viewer`.
 */
export async function offerAnswer(request: Request, deps: ScreensDeps = realDeps()): Promise<Response> {
  if (!(await ownerIsAsking(request, deps))) return refused();
  if (!(request.headers.get('content-type') ?? '').toLowerCase().startsWith('application/sdp')) return json(415, { error: 'Send the offer as application/sdp.' });
  if (tooManyOffers(deps.now())) return json(429, { error: 'Too many tries at once. Wait a minute and try again.' });
  const offer = await bodyText(request, MAX_OFFER_BYTES);
  if (offer === null) return json(413, { error: 'That offer is too large.' });
  if (!offer.startsWith('v=0')) return json(400, { error: 'That is not a WebRTC offer.' });
  const answer = await askEngine(deps, '/offer', null, { method: 'POST', contentType: 'application/sdp', body: offer }, ENGINE_TIMEOUT_MS);
  if (answer === null) return engineSilent();
  if (answer.status !== 201 && answer.status !== 200) {
    // The engine says why in plain words ("4 viewers are already watching"); its own faults read as "did not answer".
    if (answer.status >= 500 && answer.status !== 503) return engineSilent();
    return json(answer.status === 503 ? 503 : 400, { error: engineWords(answer.text, 'The PC would not take that offer.') });
  }
  return new Response(answer.text, { status: 201, headers: { 'Content-Type': 'application/sdp', ...(answer.viewer === null ? {} : { 'Debaser-Viewer': answer.viewer }), ...NEVER_KEPT } });
}

/**
 * GET /api/screens/settings (owner only): what the PC is sending now. POST: a change, as the engine's own small JSON
 * (`{"shape": "16:9", "lines": 720}`); the answer is what the PC is really sending afterwards. `?viewer=N` both ways.
 */
export async function settingsAnswer(request: Request, deps: ScreensDeps = realDeps()): Promise<Response> {
  if (!(await ownerIsAsking(request, deps))) return refused();
  const viewer = viewerOf(request);
  let answer: EngineAnswer | null;
  if (request.method === 'POST') {
    if (!(request.headers.get('content-type') ?? '').toLowerCase().startsWith('application/json')) return json(415, { error: 'Send the settings as application/json.' });
    const body = await bodyText(request, MAX_SETTINGS_BYTES);
    if (body === null) return json(413, { error: 'Those settings are too large.' });
    try {
      const asked: unknown = JSON.parse(body);
      if (typeof asked !== 'object' || asked === null || Array.isArray(asked)) throw new Error('not an object');
    } catch {
      return json(400, { error: 'Send the settings as a JSON object.' });
    }
    answer = await askEngine(deps, '/settings', viewer, { method: 'POST', contentType: 'application/json', body }, ENGINE_CHANGE_TIMEOUT_MS);
  } else {
    answer = await askEngine(deps, '/settings', viewer, { method: 'GET' }, ENGINE_TIMEOUT_MS);
  }
  if (answer === null) return engineSilent();
  if (answer.status !== 200) {
    if (answer.status >= 500) return engineSilent();
    return json(400, { error: engineWords(answer.text, 'The PC would not take those settings.') });
  }
  try {
    const settings: unknown = JSON.parse(answer.text);
    if (typeof settings !== 'object' || settings === null) return engineSilent();
    return json(200, settings);
  } catch {
    return engineSilent();
  }
}
