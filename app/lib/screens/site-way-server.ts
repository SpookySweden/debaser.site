import { createHmac, randomBytes } from 'node:crypto';
import { isLoopbackHost, ownerIsAsking, realDeps, type ScreensDeps, type ScreensEnv } from './host-server';

/**
 * REMOTE's slowest way, THROUGH THE SITE (SPEC-screens.md, "Away from home with no setup"; Luke, 2026-11-28: "okay but
 * make sure it doesnt cost and look into it", then "Build, capped, 20 GB (Recommended)").
 *
 * HIDDEN (Luke, 2026-11-28: "Wait until sound works too"): no page asks this route yet. It is here so the gateway's
 * door can be proved with real passes before anything shows.
 *
 * The picture does not come through here. The browser opens a websocket to `/api/screens/site-socket`, which the site's
 * own program passes to the gateway on this PC (`scripts/host/screens-site-gateway.cjs`, 127.0.0.1:8481), which holds
 * one line to the gaming PC's engine. This file only says whether that way is there and how much of the month's
 * allowance is used, and hands the owner a pass for it: signed with the secret the site already keeps for its other
 * gateway (with this way's own words mixed in, so a Remote Desktop pass opens nothing here and the other way round),
 * good for 60 seconds, once. The engine's key is not read here at all: only the gateway uses it.
 *
 * SERVER ONLY. Settings (in site.env on the PC):
 *   SCREENS_RDP_SECRET            the secret passes are signed with. Unset: this way is off for everyone.
 *   SCREENS_SITE_WAY_GATEWAY_URL  where the gateway answers /health. Default http://127.0.0.1:8481; anything not on
 *                                 this PC is refused.
 *   SCREENS_SITE_WAY_SOCKET_URL   where the browser opens the websocket. Default `/api/screens/site-socket` on the
 *                                 site's own address; a local drive points it straight at a gateway.
 *
 *   GET  /api/screens/site-way  -> { available, usedUp, month: { name, usedBytes, limitBytes }, socket }
 *                                  (everyone but the owner, and when the gateway is not running: { available: false })
 *   POST /api/screens/site-way  -> { pass, socket, month }   (409 when the month's allowance is used up; 502 when the
 *                                  gateway does not answer or does not know the PC's engine; 403 for everyone else)
 *
 * The allowance is the GATEWAY's own count and its own stop: what is said here is only what the gateway says, and a
 * pass handed out by mistake still opens nothing once the month is used up.
 */

export const DEFAULT_SITE_GATEWAY_URL = 'http://127.0.0.1:8481';
export const DEFAULT_SITE_SOCKET_PATH = '/api/screens/site-socket';
export const SITE_PASS_SECONDS = 60;
/** Mixed into the signature, so a pass made for another gateway is not one here (the gateway's `PASS_WORDS`). */
export const SITE_PASS_WORDS = 'site-way:';
const GATEWAY_TIMEOUT_MS = 2000;

export type SiteMonth = { name: string; usedBytes: number; limitBytes: number };

/** The gateway's health address when it is a plain http address on this PC; null otherwise. */
export function siteGatewayOrigin(env: ScreensEnv): string | null {
  const text = (env.SCREENS_SITE_WAY_GATEWAY_URL ?? '').trim() || DEFAULT_SITE_GATEWAY_URL;
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' || url.username !== '' || url.password !== '') return null;
  if ((url.pathname !== '/' && url.pathname !== '') || url.search !== '' || url.hash !== '') return null;
  return isLoopbackHost(url.hostname) ? url.origin : null;
}

export function sitePassSecret(env: ScreensEnv): string | null {
  const secret = (env.SCREENS_RDP_SECRET ?? '').trim();
  return secret.length >= 32 ? secret : null;
}

/** Where the browser opens the websocket: the site's own address, or a drive's gateway. */
export function siteSocketAddress(env: ScreensEnv): string {
  const text = (env.SCREENS_SITE_WAY_SOCKET_URL ?? '').trim();
  return /^(wss?:\/\/[^\s?#]+|\/[^\s?#]*)$/.test(text) ? text : DEFAULT_SITE_SOCKET_PATH;
}

/** A pass the gateway takes: `<claims>.<signature>`, both base64url (screens-site-gateway.cjs, `passIsGood`). */
export function makeSitePass(secret: string, now: number): string {
  const claims = { exp: Math.floor(now / 1000) + SITE_PASS_SECONDS, nonce: randomBytes(12).toString('base64url'), way: 'site' };
  const body = Buffer.from(JSON.stringify(claims), 'utf8').toString('base64url');
  return `${body}.${createHmac('sha256', secret).update(SITE_PASS_WORDS + body).digest('base64url')}`;
}

const NEVER_KEPT = { 'Cache-Control': 'private, no-store' };
function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...NEVER_KEPT } });
}

type Health = { ok: boolean; real: boolean; engineSet: boolean; passesSet: boolean; month: SiteMonth | null };

/** The month as the gateway says it, or null when what it says is not a count. */
function monthFrom(value: unknown): SiteMonth | null {
  if (typeof value !== 'object' || value === null) return null;
  const m = value as Record<string, unknown>;
  const whole = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v >= 0;
  if (typeof m.name !== 'string' || !/^\d{4}-\d{2}$/.test(m.name) || !whole(m.usedBytes) || !whole(m.limitBytes)) return null;
  return { name: m.name, usedBytes: m.usedBytes as number, limitBytes: m.limitBytes as number };
}

async function askGateway(deps: ScreensDeps, origin: string): Promise<Health | null> {
  try {
    const response = await deps.fetch(`${origin}/health`, { cache: 'no-store', redirect: 'manual', signal: AbortSignal.timeout(GATEWAY_TIMEOUT_MS) });
    if (response.status !== 200) return null;
    const body: unknown = JSON.parse((await response.text()).slice(0, 2000));
    if (typeof body !== 'object' || body === null) return null;
    const b = body as Record<string, unknown>;
    // `gate: true` is the measuring gateway (made-up frames): it is not this way, and takes no pass.
    return { ok: b.ok === true, real: b.gate === false, engineSet: b.engineSet === true, passesSet: b.passesSet === true, month: monthFrom(b.month) };
  } catch {
    return null;
  }
}

export function siteWayDeps(): ScreensDeps {
  const deps = realDeps();
  return {
    ...deps,
    env: {
      ...deps.env,
      SCREENS_RDP_SECRET: process.env.SCREENS_RDP_SECRET,
      SCREENS_SITE_WAY_GATEWAY_URL: process.env.SCREENS_SITE_WAY_GATEWAY_URL,
      SCREENS_SITE_WAY_SOCKET_URL: process.env.SCREENS_SITE_WAY_SOCKET_URL,
    },
  };
}

export async function siteWayAnswer(request: Request, deps: ScreensDeps = siteWayDeps()): Promise<Response> {
  const post = request.method === 'POST';
  if (!(await ownerIsAsking(request, deps))) return post ? json(403, { error: 'Not available.' }) : json(200, { available: false });
  const secret = sitePassSecret(deps.env);
  const origin = siteGatewayOrigin(deps.env);
  const health = secret !== null && origin !== null ? await askGateway(deps, origin) : null;
  if (secret === null || health === null || !health.ok || !health.real || !health.passesSet || health.month === null) {
    return post ? json(502, { error: 'The way through the site is not running on the server.' }) : json(200, { available: false });
  }
  const socket = siteSocketAddress(deps.env);
  const month = health.month;
  const usedUp = month.usedBytes >= month.limitBytes;
  if (!post) return json(200, { available: health.engineSet, usedUp, month, socket });
  if (!health.engineSet) return json(502, { error: "The server does not know where the PC's engine is." });
  if (usedUp) return json(409, { error: "This month's allowance through the site is used up.", month });
  return json(200, { pass: makeSitePass(secret, deps.now()), socket, month });
}
