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
export async function sessionHeaders(): Promise<Record<string, string> | null> {
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

export type ScreenHost = {
  available: boolean;
  settings: HostSettings | null;
  /** TEST ONLY: the site's server was opened for the local drive (never a production one). See `pretendNotThisPc`. */
  drive: boolean;
};

const NOT_THERE: ScreenHost = { available: false, settings: null, drive: false };

/** Where the local drive leaves its mark (`scripts/drive-screens.cjs`). */
const DRIVE_NOT_THIS_PC = 'debaser.screens.drive.not-this-pc';

/**
 * TEST ONLY. The drive's browser runs on the PC, so it always reaches the engine on its own machine and is always
 * "the PC itself", where SOUND is never offered. To prove SOUND, the drive marks its own browser, and that mark is
 * honoured only when the site's server says it was opened for the drive (`drive: true`), which a production server
 * cannot say (`devOpen` in host-server.ts is compiled out of a production build).
 */
export function pretendNotThisPc(): boolean {
  if (!hosts.pc.drive && !hosts.server.drive) return false;
  try {
    return window.localStorage.getItem(DRIVE_NOT_THIS_PC) === '1';
  } catch {
    return false;
  }
}
/** A room opening asks again, but never more often than this. */
const ASK_AGAIN_AFTER_MS = 10_000;

/**
 * Which machine's engine (2026-11-22: "our engine working both ways"): THE PC's (the gaming PC, as before) or THE
 * SERVER's. The site's server is told with `?engine=server`; THE PC needs nothing added, so older pages still work.
 */
export type EngineId = 'pc' | 'server';
export const ENGINE_IDS: EngineId[] = ['pc', 'server'];
export const ENGINE_NAMES: Record<EngineId, string> = { pc: 'THE PC', server: 'THE SERVER' };
const engineParam = (engine: EngineId): string => (engine === 'server' ? 'engine=server' : '');
const withParams = (path: string, ...params: string[]): string => {
  const query = params.filter(Boolean).join('&');
  return query === '' ? path : `${path}?${query}`;
};

let hosts: Record<EngineId, ScreenHost> = { pc: NOT_THERE, server: NOT_THERE };
let askedAt = 0;
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function setHost(next: ScreenHost, engine: EngineId = 'pc'): void {
  const was = hosts[engine];
  if (next.available === was.available && next.settings === was.settings) return;
  hosts = { ...hosts, [engine]: next };
  for (const listener of listeners) listener();
}

async function readHost(engine: EngineId): Promise<ScreenHost> {
  try {
    const headers = await sessionHeaders();
    if (headers === null) return NOT_THERE;
    const response = await fetch(withParams('/api/screens/host', engineParam(engine)), { headers, cache: 'no-store' });
    if (!response.ok) return NOT_THERE;
    const body: unknown = await response.json();
    if (typeof body !== 'object' || body === null || (body as { available?: unknown }).available !== true) return NOT_THERE;
    return { available: true, settings: hostSettingsFrom((body as { settings?: unknown }).settings), drive: (body as { drive?: unknown }).drive === true };
  } catch {
    return NOT_THERE;
  }
}

/** Asks the site whether the PC's screen is there for this reader (a room opening does). The answer reaches `useScreenHost`. */
export function askScreenHost(): void {
  const now = Date.now();
  if (askedAt !== 0 && now - askedAt < ASK_AGAIN_AFTER_MS) return;
  askedAt = now;
  for (const engine of ENGINE_IDS) void readHost(engine).then((next) => setHost(next, engine));
}

/** Whether that machine's screen is there for this reader: only ever true for its owner, while its engine answers. */
export function useScreenHost(engine: EngineId = 'pc'): ScreenHost {
  return useSyncExternalStore(
    subscribe,
    () => hosts[engine],
    () => NOT_THERE,
  );
}

/** What the site last said, for code that is not a component. */
export const screenHostNow = (engine: EngineId = 'pc'): ScreenHost => hosts[engine];

/* --- the hello ----------------------------------------------------------------------------------- */

/**
 * Sends this browser's WebRTC offer and brings the engine's answer back, with the number the PC gave this viewer
 * (saying it back lets the PC tell this device whether control is "yours"). Throws the reason in plain words.
 */
export async function sendOffer(sdp: string, engine: EngineId = 'pc'): Promise<{ sdp: string; viewer: string | null }> {
  const headers = await sessionHeaders();
  if (headers === null) {
    setHost(NOT_THERE, engine);
    throw new Error('sign in first');
  }
  const response = await fetch(withParams('/api/screens/offer', engineParam(engine)), { method: 'POST', headers: { ...headers, 'Content-Type': 'application/sdp' }, body: sdp, cache: 'no-store' });
  // No longer this reader's to open (signed out, or signed in as somebody else, since the key was offered): the key goes.
  if (response.status === 403) setHost(NOT_THERE, engine);
  if (!response.ok) throw new Error(await wordsOf(response, `the site answered ${response.status}`));
  return { sdp: await response.text(), viewer: response.headers.get('Debaser-Viewer') };
}

/* --- the settings -------------------------------------------------------------------------------- */

export type SettingsAnswer = { ok: true; settings: HostSettings } | { ok: false; why: string };

/** Reads what the PC is sending (`change` null) or asks it for a change. Throws only when it could not be asked at all. */
export async function talkToSettings(viewer: string | null, change: SettingsRequest | null, engine: EngineId = 'pc'): Promise<SettingsAnswer> {
  const headers = await sessionHeaders();
  if (headers === null) throw new Error('signed out');
  const address = withParams('/api/screens/settings', viewer === null ? '' : `viewer=${encodeURIComponent(viewer)}`, engineParam(engine));
  const response = await fetch(address, change === null ? { headers, cache: 'no-store' } : { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(change), cache: 'no-store' });
  if (!response.ok) return { ok: false, why: await wordsOf(response, String(response.status)) };
  const settings = hostSettingsFrom(await response.json());
  return settings === null ? { ok: false, why: 'its answer could not be read' } : { ok: true, settings };
}
