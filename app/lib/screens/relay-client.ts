'use client';

import { sessionHeaders } from './host-client';

/**
 * The browser's side of the relay for anywhere (rules in `relay-server.ts`): the connection helpers every SCREENS
 * connection uses. Cloudflare's STUN always; for the owner, once the relay key is set, short-lived passes for
 * Cloudflare's TURN relay too, so a device on mobile data still gets the picture. Kept for an hour, then asked again.
 */

export const STUN_ONLY: RTCIceServer[] = [{ urls: 'stun:stun.cloudflare.com:3478' }];
const KEEP_MS = 60 * 60 * 1000;

let kept: { servers: RTCIceServer[]; relay: boolean; until: number } | null = null;
let asking: Promise<RTCIceServer[]> | null = null;

/** The helpers to use now (the last ones fetched, or STUN alone before any were): for code that cannot wait. */
export function iceServersKept(): RTCIceServer[] {
  return kept?.servers ?? STUN_ONLY;
}

/** Whether the last helpers fetched include Cloudflare's relay. */
export function relayKept(): boolean {
  return kept?.relay === true;
}

/** The helpers, fetched when there are none or they are an hour old. Never throws: STUN alone when it cannot ask. */
export function iceServersNow(): Promise<RTCIceServer[]> {
  if (kept !== null && kept.until > Date.now()) return Promise.resolve(kept.servers);
  if (asking !== null) return asking;
  asking = (async () => {
    try {
      const headers = await sessionHeaders();
      if (headers === null) return STUN_ONLY;
      const response = await fetch('/api/screens/ice', { headers, cache: 'no-store' });
      const body: unknown = await response.json();
      const list = typeof body === 'object' && body !== null ? (body as { iceServers?: unknown }).iceServers : null;
      const servers = Array.isArray(list) && list.length > 0 ? (list as RTCIceServer[]) : STUN_ONLY;
      kept = { servers, relay: (body as { relay?: unknown }).relay === true, until: Date.now() + KEEP_MS };
      return servers;
    } catch {
      return STUN_ONLY;
    } finally {
      asking = null;
    }
  })();
  return asking;
}

/** Whether the relay key is set on the PC that serves the site (owner only; null for anyone else or on trouble). */
export async function relayStatus(): Promise<{ set: boolean; ready: boolean } | null> {
  try {
    const headers = await sessionHeaders();
    if (headers === null) return null;
    const response = await fetch('/api/screens/relay', { headers, cache: 'no-store' });
    if (!response.ok) return null;
    const body = (await response.json()) as { set?: unknown; ready?: unknown };
    return { set: body.set === true, ready: body.ready === true };
  } catch {
    return null;
  }
}

/** Saves the relay key typed into the RELAY KEY form (tried with Cloudflare first). The plain reason when not. */
export async function saveRelayKey(keyId: string, token: string): Promise<string | null> {
  try {
    const headers = await sessionHeaders();
    if (headers === null) return 'SIGN IN FIRST';
    const response = await fetch('/api/screens/relay', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ keyId, token }),
      cache: 'no-store',
    });
    const body = (await response.json().catch(() => ({}))) as { error?: unknown };
    if (!response.ok) return typeof body.error === 'string' ? body.error.toUpperCase() : 'IT WAS NOT SAVED';
    kept = null;  // fetched afresh, with the relay, next time
    return null;
  } catch {
    return 'THE SITE COULD NOT BE ASKED';
  }
}
