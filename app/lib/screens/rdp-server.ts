import { createHash, createHmac, randomBytes } from 'node:crypto';
import { bodyText, isLoopbackHost, ownerIsAsking, realDeps, type ScreensDeps, type ScreensEnv } from './host-server';

/**
 * SCREENS, the server by Windows Remote Desktop (SPEC-screens.md, Luke 2026-11-21: "I have no spare keyboard and mouse
 * for the server. I need to control it now"; "remote desktop is likely less efficient than our solution, make it a
 * clear toggle").
 *
 * The picture does not come through here. The browser opens a websocket to `/api/screens/rdp-socket`, which the PC's
 * tunnel sends to the gateway (`scripts/host/rdp-gateway.cjs`, 127.0.0.1:8479), which talks to guacd, which talks
 * Remote Desktop to the server. This file only says whether that way in is there, and hands the owner a pass for it:
 * signed with the secret the site and the gateway share, good for 60 seconds, once. The server's address and Windows
 * sign-in live only in the gateway's settings file on the PC; this server never sees them.
 *
 * SERVER ONLY. Settings (in site.env on the PC):
 *   SCREENS_RDP_SECRET       the shared secret. Unset: the way in is off for everyone.
 *   SCREENS_RDP_GATEWAY_URL  where the gateway answers /health. Default http://127.0.0.1:8479; anything not on this PC
 *                            is refused, as the engine's address is.
 *   SCREENS_RDP_SOCKET_URL   where the browser opens the websocket. Default `/api/screens/rdp-socket` on the site's own
 *                            address (the tunnel's route); a local drive points it straight at a gateway.
 *
 *   GET  /api/screens/rdp  -> { available, serverSet, on, locked, route, socket, door }   (everyone but the owner:
 *                             { available: false })
 *   POST /api/screens/rdp  { width, height, dpi }  -> { pass, socket }   (409 while switched off)
 *   POST /api/screens/rdp  { switch: true | false } -> the GET answer, after the gateway has switched
 *                             (everyone but the owner: 403 for both)
 *
 * `route` says which way the picture goes: `tunnel` (the browser -> Cloudflare -> this PC's tunnel -> the gateway, then
 * the home network to the server: over the internet even from home) or `direct` (a local drive's own gateway).
 * `locked`: the extra lock (Cloudflare Access) is set up in the gateway; `door` is the page that unlocks it.
 */

export const DEFAULT_GATEWAY_URL = 'http://127.0.0.1:8479';
export const DEFAULT_SOCKET_PATH = '/api/screens/rdp-socket';
export const DOOR_PATH = '/api/screens/rdp-door';
export const PASS_SECONDS = 60;
const GATEWAY_TIMEOUT_MS = 2000;

export type RdpEnv = ScreensEnv;

/** The gateway's health address when it is a plain http address on this PC; null otherwise. */
export function gatewayOrigin(env: RdpEnv): string | null {
  const text = (env.SCREENS_RDP_GATEWAY_URL ?? '').trim() || DEFAULT_GATEWAY_URL;
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

export function rdpSecret(env: RdpEnv): string | null {
  const secret = (env.SCREENS_RDP_SECRET ?? '').trim();
  return secret.length >= 32 ? secret : null;
}

/** Where the browser opens the websocket: the tunnel's route on the site's own address, or a drive's gateway. */
export function socketAddress(env: RdpEnv): string {
  const text = (env.SCREENS_RDP_SOCKET_URL ?? '').trim();
  return /^(wss?:\/\/[^\s?#]+|\/[^\s?#]*)$/.test(text) ? text : DEFAULT_SOCKET_PATH;
}

/** A pass the gateway takes: `<claims>.<signature>`, both base64url (rdp-gateway.cjs, `passIsGood`). */
export function makePass(secret: string, size: { width: number; height: number; dpi: number }, now: number): string {
  const claims = { exp: Math.floor(now / 1000) + PASS_SECONDS, nonce: randomBytes(12).toString('base64url'), ...size };
  const body = Buffer.from(JSON.stringify(claims), 'utf8').toString('base64url');
  return `${body}.${createHmac('sha256', secret).update(body).digest('base64url')}`;
}

/** The size the browser asks for, kept to what a screen can be. */
export function sizeFrom(text: string | null): { width: number; height: number; dpi: number } {
  let asked: Record<string, unknown> = {};
  try {
    const value: unknown = JSON.parse(text ?? '{}');
    if (typeof value === 'object' && value !== null) asked = value as Record<string, unknown>;
  } catch {
    /* the defaults */
  }
  const whole = (v: unknown, low: number, high: number, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(high, Math.max(low, Math.round(v))) : fallback);
  return { width: whole(asked.width, 320, 7680, 1920), height: whole(asked.height, 240, 4320, 1080), dpi: whole(asked.dpi, 48, 384, 96) };
}

const NEVER_KEPT = { 'Cache-Control': 'private, no-store' };
function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...NEVER_KEPT } });
}

type Health = { ok: boolean; serverSet: boolean; passesSet: boolean; on: boolean; locked: boolean };

async function askGateway(deps: ScreensDeps, origin: string): Promise<Health | null> {
  try {
    const response = await deps.fetch(`${origin}/health`, { cache: 'no-store', redirect: 'manual', signal: AbortSignal.timeout(GATEWAY_TIMEOUT_MS) });
    if (response.status !== 200) return null;
    const body: unknown = JSON.parse((await response.text()).slice(0, 2000));
    if (typeof body !== 'object' || body === null) return null;
    const b = body as Record<string, unknown>;
    return { ok: b.ok === true, serverSet: b.serverSet === true, passesSet: b.passesSet === true, on: b.on === true, locked: b.locked === true };
  } catch {
    return null;
  }
}

/** A request to switch the remote: `{ "switch": true }` or `{ "switch": false }`; null for anything else. */
export function switchAsked(text: string | null): boolean | null {
  try {
    const value: unknown = JSON.parse(text ?? '');
    const asked = typeof value === 'object' && value !== null ? (value as { switch?: unknown }).switch : undefined;
    return typeof asked === 'boolean' ? asked : null;
  } catch {
    return null;
  }
}

/** The signature the gateway's /switch takes (rdp-gateway.cjs, `switchIsSigned`). */
export function switchSignature(secret: string, on: boolean, at: number): string {
  return createHmac('sha256', secret).update(`switch:${on ? 1 : 0}:${at}`).digest('base64url');
}

async function askSwitch(deps: ScreensDeps, origin: string, secret: string, on: boolean): Promise<boolean> {
  const at = deps.now();
  try {
    const response = await deps.fetch(`${origin}/switch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Debaser-At': String(at), 'X-Debaser-Sign': switchSignature(secret, on, at) },
      body: JSON.stringify({ on }),
      cache: 'no-store',
      redirect: 'manual',
      signal: AbortSignal.timeout(GATEWAY_TIMEOUT_MS),
    });
    return response.status === 200;
  } catch {
    return false;
  }
}

export function rdpDeps(): ScreensDeps {
  const deps = realDeps();
  return {
    ...deps,
    env: {
      ...deps.env,
      SCREENS_RDP_SECRET: process.env.SCREENS_RDP_SECRET,
      SCREENS_RDP_GATEWAY_URL: process.env.SCREENS_RDP_GATEWAY_URL,
      SCREENS_RDP_SOCKET_URL: process.env.SCREENS_RDP_SOCKET_URL,
    },
  };
}

export async function rdpAnswer(request: Request, deps: ScreensDeps = rdpDeps()): Promise<Response> {
  const post = request.method === 'POST';
  if (!(await ownerIsAsking(request, deps))) return post ? json(403, { error: 'Not available.' }) : json(200, { available: false });
  const secret = rdpSecret(deps.env);
  const origin = gatewayOrigin(deps.env);
  const health = secret !== null && origin !== null ? await askGateway(deps, origin) : null;
  if (secret === null || health === null || !health.ok || !health.passesSet) {
    return post ? json(502, { error: "The PC's Remote Desktop gateway did not answer." }) : json(200, { available: false });
  }
  const socket = socketAddress(deps.env);
  const route = socket.startsWith('/') ? 'tunnel' : 'direct';
  const way = (h: Health) => ({ available: true, serverSet: h.serverSet, on: h.on, locked: h.locked, route, socket, door: route === 'tunnel' ? DOOR_PATH : null });
  if (!post) return json(200, way(health));
  const text = await bodyText(request, 1024);
  const asked = switchAsked(text);
  if (asked !== null) {
    const switched = await askSwitch(deps, origin as string, secret, asked);
    if (!switched) return json(502, { error: "The PC's Remote Desktop gateway did not switch." });
    return json(200, way({ ...health, on: asked }));
  }
  const setup = setupAsked(text);
  if (setup !== null) {
    const status = await askSetup(deps, origin as string, secret, setup);
    if (status === 400) return json(400, { error: 'Those cannot be saved: no line breaks, and the address is a name or a number.' });
    if (status !== 200) return json(502, { error: "The PC's Remote Desktop gateway did not save it." });
    return json(200, way({ ...health, serverSet: health.serverSet || typeof setup.host === 'string' }));
  }
  if (!health.on) return json(409, { error: 'The server remote is switched off.' });
  return json(200, { pass: makePass(secret, sizeFrom(text), deps.now()), socket });
}

/** The server's sign-in from the room's form: `{ "setup": { host?, user?, password? } }`; null for anything else. */
export function setupAsked(text: string | null): { host?: string; user?: string; password?: string } | null {
  try {
    const value: unknown = JSON.parse(text ?? '');
    const setup = typeof value === 'object' && value !== null ? (value as { setup?: unknown }).setup : undefined;
    if (typeof setup !== 'object' || setup === null) return null;
    const out: { host?: string; user?: string; password?: string } = {};
    for (const field of ['host', 'user', 'password'] as const) {
      const given = (setup as Record<string, unknown>)[field];
      if (typeof given === 'string' && given.length > 0) out[field] = given;
    }
    return Object.keys(out).length > 0 ? out : null;
  } catch {
    return null;
  }
}

/** The signature the gateway's /setup takes over the exact body (rdp-gateway.cjs, `setupIsSigned`). */
export function setupSignature(secret: string, body: string, at: number): string {
  const digest = createHash('sha256').update(body).digest('base64url');
  return createHmac('sha256', secret).update(`setup:${at}:${digest}`).digest('base64url');
}

/** Passes the sign-in on to the gateway on this PC; nothing of it is kept or logged here. The gateway's status. */
async function askSetup(deps: ScreensDeps, origin: string, secret: string, setup: { host?: string; user?: string; password?: string }): Promise<number> {
  const at = deps.now();
  const body = JSON.stringify(setup);
  try {
    const response = await deps.fetch(`${origin}/setup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Debaser-At': String(at), 'X-Debaser-Sign': setupSignature(secret, body, at) },
      body,
      cache: 'no-store',
      redirect: 'manual',
      signal: AbortSignal.timeout(GATEWAY_TIMEOUT_MS),
    });
    return response.status;
  } catch {
    return 0;
  }
}
