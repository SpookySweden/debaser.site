'use client';

import { useSyncExternalStore } from 'react';
import { sessionHeaders } from './host-client';

/**
 * The browser's side of `/api/screens/rdp` (rules in `rdp-server.ts`): is the server reachable by Windows Remote
 * Desktop for this reader (only ever its owner), is that remote switched on, which way it goes, its extra lock, and a
 * pass to open the websocket with.
 */

export type RdpRoute = 'tunnel' | 'direct';
export type RdpWay = { available: boolean; serverSet: boolean; on: boolean; locked: boolean; route: RdpRoute; door: string | null };
const NOT_THERE: RdpWay = { available: false, serverSet: false, on: false, locked: false, route: 'tunnel', door: null };
const ASK_AGAIN_AFTER_MS = 10_000;

let way: RdpWay = NOT_THERE;
let askedAt = 0;
const listeners = new Set<() => void>();

function wayFrom(body: unknown): RdpWay {
  if (typeof body !== 'object' || body === null || (body as { available?: unknown }).available !== true) return NOT_THERE;
  const b = body as Record<string, unknown>;
  return {
    available: true,
    serverSet: b.serverSet === true,
    on: b.on === true,
    locked: b.locked === true,
    route: b.route === 'direct' ? 'direct' : 'tunnel',
    door: typeof b.door === 'string' ? b.door : null,
  };
}

function setWay(next: RdpWay): void {
  if (JSON.stringify(next) === JSON.stringify(way)) return;
  way = next;
  for (const listener of listeners) listener();
}

async function readWay(): Promise<RdpWay> {
  try {
    const headers = await sessionHeaders();
    if (headers === null) return NOT_THERE;
    const response = await fetch('/api/screens/rdp', { headers, cache: 'no-store' });
    return response.ok ? wayFrom(await response.json()) : NOT_THERE;
  } catch {
    return NOT_THERE;
  }
}

/** Asks now, and waits for the answer (the Remote Desktop view does, each time it starts). */
export async function readRdpWayNow(): Promise<RdpWay> {
  const next = await readWay();
  setWay(next);
  return next;
}

/** Asks whether the Remote Desktop way in is there (a room opening does), at most every ten seconds. */
export function askRdpWay(): void {
  const now = Date.now();
  if (askedAt !== 0 && now - askedAt < ASK_AGAIN_AFTER_MS) return;
  askedAt = now;
  void readWay().then(setWay);
}

export function useRdpWay(): RdpWay {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    () => way,
    () => NOT_THERE,
  );
}

async function post(body: unknown): Promise<{ ok: boolean; body: Record<string, unknown> }> {
  const headers = await sessionHeaders();
  if (headers === null) return { ok: false, body: { error: 'Sign in first.' } };
  const response = await fetch('/api/screens/rdp', {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    cache: 'no-store',
  });
  const said: unknown = await response.json().catch(() => null);
  return { ok: response.ok, body: (typeof said === 'object' && said !== null ? said : {}) as Record<string, unknown> };
}

/** The server remote's own switch: on or off on the PC itself. The plain reason when it would not switch. */
export async function switchRdp(on: boolean): Promise<string | null> {
  try {
    const got = await post({ switch: on });
    if (!got.ok) return typeof got.body.error === 'string' ? got.body.error.toUpperCase() : 'IT WOULD NOT SWITCH';
    setWay(wayFrom(got.body));
    return null;
  } catch {
    return 'THE SITE COULD NOT BE ASKED';
  }
}

/**
 * Whether the extra lock (Cloudflare Access) lets this browser through: its unlocking page is asked without following
 * any redirect. Unlocked, the gateway answers; locked, Cloudflare sends the browser off to its sign-in instead.
 */
export async function doorIsOpen(door: string): Promise<boolean> {
  try {
    const response = await fetch(`${door}?check=1`, { cache: 'no-store', redirect: 'manual', credentials: 'same-origin' });
    if (response.type === 'opaqueredirect' || !response.ok) return false;
    const body: unknown = await response.json().catch(() => null);
    return typeof body === 'object' && body !== null && (body as { unlocked?: unknown }).unlocked === true;
  } catch {
    return false;
  }
}

/** A pass for the websocket and where to open it; or the plain reason why not. */
export async function askRdpPass(size: { width: number; height: number; dpi: number }): Promise<{ pass: string; socket: string } | { why: string }> {
  try {
    const got = await post(size);
    if (got.ok && typeof got.body.pass === 'string' && typeof got.body.socket === 'string') return { pass: got.body.pass, socket: got.body.socket };
    return { why: typeof got.body.error === 'string' ? got.body.error.toUpperCase() : 'THE REMOTE DESKTOP WAY IN IS NOT THERE' };
  } catch {
    return { why: 'THE SITE COULD NOT BE ASKED' };
  }
}
