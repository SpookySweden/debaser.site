import { promises as fs } from 'node:fs';
import { bodyText, ownerIsAsking, realDeps, type ScreensDeps, type ScreensEnv } from './host-server';

/**
 * SCREENS, the relay for anywhere (SPEC-screens.md, 2026-11-22: a phone on mobile data got stuck connecting; Luke:
 * "I need our own engine to work on any device signed in"). Cloudflare's TURN relay carries the picture when the two
 * devices cannot reach each other directly (a phone behind its carrier's network).
 *
 * The relay key (a TURN key id and its API token, made in Luke's Cloudflare account) is typed by Luke into the
 * room's RELAY KEY form once, and kept only in a file on the PC that serves the site (SCREENS_RELAY_FILE). It never
 * reaches a browser: the site asks Cloudflare for short-lived relay passes with it (24 hours) and hands those out,
 * to the owner only.
 *
 * SERVER ONLY.
 *   GET  /api/screens/ice    -> { iceServers, relay }: Cloudflare's STUN always; its TURN relay too when a key is set
 *   GET  /api/screens/relay  -> { set }
 *   POST /api/screens/relay  { keyId, token } -> { set: true } once Cloudflare has accepted the key (it is tried first)
 *   Everyone but the owner: GET ice -> STUN only; relay -> 403.
 */

export const STUN_ONLY = [{ urls: 'stun:stun.cloudflare.com:3478' }];
const CLOUDFLARE = 'https://rtc.live.cloudflare.com/v1/turn/keys';
const PASS_SECONDS = 24 * 60 * 60;
const ASK_TIMEOUT_MS = 5000;

type IceServer = { urls: string | string[]; username?: string; credential?: string };

const NEVER_KEPT = { 'Cache-Control': 'private, no-store' };
function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...NEVER_KEPT } });
}

export function relayDeps(): ScreensDeps {
  const deps = realDeps();
  return { ...deps, env: { ...deps.env, SCREENS_RELAY_FILE: process.env.SCREENS_RELAY_FILE } };
}

/** Where the key lives: an absolute path set on the PC that serves the site; null when it is not set. */
export function relayFile(env: ScreensEnv): string | null {
  const file = (env.SCREENS_RELAY_FILE ?? '').trim();
  return /^([A-Za-z]:\\|\/)/.test(file) ? file : null;
}

/** A TURN key id is 32 hexadecimal characters; its API token is letters, digits, - and _. */
export function plainKey(keyId: unknown, token: unknown): { keyId: string; token: string } | null {
  if (typeof keyId !== 'string' || typeof token !== 'string') return null;
  const id = keyId.trim();
  const secret = token.trim();
  if (!/^[A-Fa-f0-9]{32}$/.test(id) || !/^[A-Za-z0-9_-]{16,256}$/.test(secret)) return null;
  return { keyId: id, token: secret };
}

export function keyFromText(text: string): { keyId: string; token: string } | null {
  const line = (name: string) => text.split(/\r?\n/).find((l) => l.startsWith(`${name}=`))?.slice(name.length + 1) ?? '';
  return plainKey(line('RELAY_KEY_ID'), line('RELAY_TOKEN'));
}

async function readKey(env: ScreensEnv): Promise<{ keyId: string; token: string } | null> {
  const file = relayFile(env);
  if (file === null) return null;
  try {
    return keyFromText(await fs.readFile(file, 'utf8'));
  } catch {
    return null;
  }
}

/** Cloudflare's answer, kept to well-formed entries, without port 53 (browsers block it). */
export function iceServersFrom(body: unknown): IceServer[] | null {
  const list = typeof body === 'object' && body !== null ? (body as { iceServers?: unknown }).iceServers : undefined;
  const entries = Array.isArray(list) ? list : list !== undefined ? [list] : [];
  const out: IceServer[] = [];
  for (const entry of entries) {
    if (typeof entry !== 'object' || entry === null) continue;
    const e = entry as Record<string, unknown>;
    const urls = (Array.isArray(e.urls) ? e.urls : [e.urls]).filter((u): u is string => typeof u === 'string' && /^(stun|turns?):/.test(u) && !/:53(\?|$)/.test(u));
    if (urls.length === 0) continue;
    const server: IceServer = { urls };
    if (typeof e.username === 'string' && typeof e.credential === 'string') {
      server.username = e.username;
      server.credential = e.credential;
    }
    out.push(server);
  }
  return out.some((s) => s.username !== undefined) ? out : null;
}

async function askCloudflare(deps: ScreensDeps, key: { keyId: string; token: string }, seconds: number): Promise<IceServer[] | null> {
  try {
    const response = await deps.fetch(`${CLOUDFLARE}/${key.keyId}/credentials/generate-ice-servers`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ttl: seconds }),
      cache: 'no-store',
      redirect: 'manual',
      signal: AbortSignal.timeout(ASK_TIMEOUT_MS),
    });
    if (response.status !== 200 && response.status !== 201) return null;
    return iceServersFrom(JSON.parse((await response.text()).slice(0, 20000)));
  } catch {
    return null;
  }
}

// One set of passes, shared by the owner's devices, asked for again an hour before it runs out.
let kept: { servers: IceServer[]; until: number; keyId: string } | null = null;
export function forgetPasses(): void {
  kept = null;
}

export async function iceAnswer(request: Request, deps: ScreensDeps = relayDeps()): Promise<Response> {
  if (!(await ownerIsAsking(request, deps))) return json(200, { iceServers: STUN_ONLY, relay: false });
  const key = await readKey(deps.env);
  if (key === null) return json(200, { iceServers: STUN_ONLY, relay: false });
  const now = deps.now();
  if (kept === null || kept.keyId !== key.keyId || kept.until < now) {
    const servers = await askCloudflare(deps, key, PASS_SECONDS);
    if (servers === null) return json(200, { iceServers: STUN_ONLY, relay: false, why: 'Cloudflare gave no relay passes' });
    kept = { servers, until: now + (PASS_SECONDS - 3600) * 1000, keyId: key.keyId };
  }
  return json(200, { iceServers: kept.servers, relay: true });
}

export async function relayAnswer(request: Request, deps: ScreensDeps = relayDeps()): Promise<Response> {
  if (!(await ownerIsAsking(request, deps))) return json(403, { error: 'Not available.' });
  const file = relayFile(deps.env);
  if (request.method !== 'POST') return json(200, { set: (await readKey(deps.env)) !== null, ready: file !== null });
  if (file === null) return json(409, { error: 'The PC that serves the site has no place set for the relay key yet.' });
  let asked: unknown = null;
  try {
    asked = JSON.parse((await bodyText(request, 2048)) ?? '');
  } catch {
    /* refused below */
  }
  const key = typeof asked === 'object' && asked !== null ? plainKey((asked as { keyId?: unknown }).keyId, (asked as { token?: unknown }).token) : null;
  if (key === null) return json(400, { error: 'That is not a relay key: the key id is 32 letters and digits (0-9, a-f), the token one long word.' });
  // Tried before it is kept, so a mistyped key never replaces a working one.
  if ((await askCloudflare(deps, key, 60)) === null) return json(400, { error: 'Cloudflare did not accept that key id and token.' });
  await fs.writeFile(file, `# The relay key for SCREENS (Cloudflare TURN), typed by Luke into the site's RELAY KEY form.\nRELAY_KEY_ID=${key.keyId}\nRELAY_TOKEN=${key.token}\n`, { mode: 0o600 });
  forgetPasses();
  return json(200, { set: true });
}
