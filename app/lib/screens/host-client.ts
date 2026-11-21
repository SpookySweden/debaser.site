'use client';

import { useSyncExternalStore } from 'react';
import { USING_MOCK_AUTH } from '../auth/auth-repository';
import { getSupabaseBrowserClient } from '../supabase/client';
import { hostSettingsFrom, type HostSettings, type SettingsRequest } from './wishes';

/**
 * SCREENS, the browser's side of the site's three small routes (`app/api/screens/*`, rules in `host-server.ts`): is
 * the PC's screen there for me, the "hello", and the settings. The browser never talks to the engine's own web
 * address; the site's server checks who is asking and passes these on to the engine on the PC. The picture and
 * CONTROL then travel by WebRTC straight between this browser and the engine.
 */

/**
 * The session to show the routes: an account's token, `{}` on the mock accounts (the server then says no, unless it
 * is a local server opened for a drive), null when signed out or a stream-room guest: nothing is asked at all.
 */
async function sessionHeaders(): Promise<Record<string, string> | null> {
  if (USING_MOCK_AUTH) return {};
  const client = getSupabaseBrowserClient();
  if (client === null) return null;
  const { data } = await client.auth.getSession();
  const session = data.session;
  if (session === null || session.user.is_anonymous === true) return null;
  return { Authorization: `Bearer ${session.access_token}` };
}

/** The route's plain words for why not, or a stand-in when it sent none. */
async function wordsOf(response: Response, fallback: string): Promise<string> {
  try {
    const body: unknown = await response.json();
    const said = typeof body === 'object' && body !== null ? (body as { error?: unknown }).error : null;
    return typeof said === 'string' && said.length > 0 ? said : fallback;
  } catch {
    return fallback;
  }
}

/* --- is the PC's screen there? ------------------------------------------------------------------- */

export type ScreenHost = { available: boolean; settings: HostSettings | null };

const NOT_THERE: ScreenHost = { available: false, settings: null };
/** A room opening asks again, but never more often than this. */
const ASK_AGAIN_AFTER_MS = 10_000;

let host: ScreenHost = NOT_THERE;
let askedAt = 0;
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function setHost(next: ScreenHost): void {
  if (next.available === host.available && next.settings === host.settings) return;
  host = next;
  for (const listener of listeners) listener();
}

async function readHost(): Promise<ScreenHost> {
  try {
    const headers = await sessionHeaders();
    if (headers === null) return NOT_THERE;
    const response = await fetch('/api/screens/host', { headers, cache: 'no-store' });
    if (!response.ok) return NOT_THERE;
    const body: unknown = await response.json();
    if (typeof body !== 'object' || body === null || (body as { available?: unknown }).available !== true) return NOT_THERE;
    return { available: true, settings: hostSettingsFrom((body as { settings?: unknown }).settings) };
  } catch {
    return NOT_THERE;
  }
}

/** Asks the site whether the PC's screen is there for this reader (a room opening does). The answer reaches `useScreenHost`. */
export function askScreenHost(): void {
  const now = Date.now();
  if (askedAt !== 0 && now - askedAt < ASK_AGAIN_AFTER_MS) return;
  askedAt = now;
  void readHost().then(setHost);
}

/** Whether the PC's screen is there for this reader: only ever true for its owner, while the engine answers. */
export function useScreenHost(): ScreenHost {
  return useSyncExternalStore(
    subscribe,
    () => host,
    () => NOT_THERE,
  );
}

/** What the site last said, for code that is not a component. */
export const screenHostNow = (): ScreenHost => host;

/* --- the hello ----------------------------------------------------------------------------------- */

/**
 * Sends this browser's WebRTC offer and brings the engine's answer back, with the number the PC gave this viewer
 * (saying it back lets the PC tell this device whether control is "yours"). Throws the reason in plain words.
 */
export async function sendOffer(sdp: string): Promise<{ sdp: string; viewer: string | null }> {
  const headers = await sessionHeaders();
  if (headers === null) {
    setHost(NOT_THERE);
    throw new Error('sign in first');
  }
  const response = await fetch('/api/screens/offer', { method: 'POST', headers: { ...headers, 'Content-Type': 'application/sdp' }, body: sdp, cache: 'no-store' });
  // No longer this reader's to open (signed out, or signed in as somebody else, since the key was offered): the key goes.
  if (response.status === 403) setHost(NOT_THERE);
  if (!response.ok) throw new Error(await wordsOf(response, `the site answered ${response.status}`));
  return { sdp: await response.text(), viewer: response.headers.get('Debaser-Viewer') };
}

/* --- the settings -------------------------------------------------------------------------------- */

export type SettingsAnswer = { ok: true; settings: HostSettings } | { ok: false; why: string };

/** Reads what the PC is sending (`change` null) or asks it for a change. Throws only when it could not be asked at all. */
export async function talkToSettings(viewer: string | null, change: SettingsRequest | null): Promise<SettingsAnswer> {
  const headers = await sessionHeaders();
  if (headers === null) throw new Error('signed out');
  const address = `/api/screens/settings${viewer === null ? '' : `?viewer=${encodeURIComponent(viewer)}`}`;
  const response = await fetch(address, change === null ? { headers, cache: 'no-store' } : { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(change), cache: 'no-store' });
  if (!response.ok) return { ok: false, why: await wordsOf(response, String(response.status)) };
  const settings = hostSettingsFrom(await response.json());
  return settings === null ? { ok: false, why: 'its answer could not be read' } : { ok: true, settings };
}
