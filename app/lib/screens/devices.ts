'use client';

import { useSyncExternalStore } from 'react';
import { sessionHeaders, type EngineId } from './host-client';
import { STUN_ONLY, iceServersKept, iceServersNow } from './relay-client';

/**
 * REMOTE from another of the owner's own devices, with nothing installed (SPEC-screens.md; the server side is
 * app/lib/screens/device-mail.ts). This tab says "here I am" every few seconds while the site is open, learns the
 * owner's other devices on the site now, and collects its messages. Only the owner's tabs keep it up: for anyone else
 * the first answer is a refusal and it stops for good on this page.
 */

export type OtherDevice = { id: string; name: string };
export type DeviceMessage = { from: string; kind: 'ask' | 'offer' | 'answer' | 'no' | 'stop'; body: string };

const ID_STORE = 'debaser.screens.device.v1';
/** How often "here I am" is said: often enough that a request arrives within a few seconds. */
const EVERY_MS = 3000;
/** While a picture is being started or shown between two devices, faster, so the handshake does not drag. */
const BUSY_EVERY_MS = 800;

/** This browser's own name for itself, kept in its own storage; a new one is made the first time. */
export function deviceId(): string {
  try {
    const kept = window.localStorage.getItem(ID_STORE);
    if (kept && /^[a-z0-9]{8,32}$/.test(kept)) return kept;
    const made = Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => (b % 36).toString(36)).join('');
    window.localStorage.setItem(ID_STORE, made);
    return made;
  } catch {
    // A browser that refuses to remember gets a name for this page's life.
    return (sessionId ??= Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => (b % 36).toString(36)).join(''));
  }
}
let sessionId: string | null = null;

/** How a device is shown to the owner's others: its system, its browser and its screen, e.g. "WINDOWS · CHROME · 1920x1080". */
export function deviceName(): string {
  const ua = navigator.userAgent;
  const system = /Windows/.test(ua) ? 'WINDOWS' : /Android/.test(ua) ? 'ANDROID' : /iPhone|iPad/.test(ua) ? 'IPHONE OR IPAD' : /Mac OS X/.test(ua) ? 'MAC' : /Linux/.test(ua) ? 'LINUX' : 'A DEVICE';
  const browser = /Edg\//.test(ua) ? 'EDGE' : /OPR\//.test(ua) ? 'OPERA' : /Firefox\//.test(ua) ? 'FIREFOX' : /Chrome\//.test(ua) ? 'CHROME' : /Safari\//.test(ua) ? 'SAFARI' : 'A BROWSER';
  const ratio = window.devicePixelRatio || 1;
  return `${system} · ${browser} · ${Math.round(screen.width * ratio)}x${Math.round(screen.height * ratio)}`;
}

type State = { on: boolean; others: OtherDevice[] };
let state: State = { on: false, others: [] };
const listeners = new Set<() => void>();
const takers = new Set<(message: DeviceMessage) => void>();
let started = false;
let stopped = false;
let busy = 0;
let timer = 0;

function set(next: State): void {
  state = next;
  for (const listener of listeners) listener();
}

async function hereIAm(): Promise<void> {
  if (stopped) return;
  const headers = await sessionHeaders();
  if (headers === null) {
    // Signed out: nothing is sent; looked at again now and then, in case somebody signs in on this page.
    window.clearTimeout(timer);
    timer = window.setTimeout(() => void hereIAm(), 15_000);
    return;
  }
  try {
    const response = await fetch('/api/screens/devices', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: deviceId(), name: deviceName() }),
      cache: 'no-store',
    });
    if (response.status === 403) {
      // Not the owner (or the feature is off): nothing more is asked on this page.
      stopped = true;
      set({ on: false, others: [] });
      return;
    }
    if (response.ok) {
      const body = (await response.json()) as { devices?: OtherDevice[]; mail?: DeviceMessage[] };
      const others = Array.isArray(body.devices) ? body.devices : [];
      const same = others.length === state.others.length && others.every((d, i) => d.id === state.others[i]?.id && d.name === state.others[i]?.name);
      if (!state.on || !same) set({ on: true, others });
      for (const message of Array.isArray(body.mail) ? body.mail : []) for (const take of takers) take(message);
    }
  } catch {
    /* the site is restarting, or offline: tried again shortly */
  }
  schedule();
}

function schedule(): void {
  if (stopped) return;
  window.clearTimeout(timer);
  timer = window.setTimeout(() => void hereIAm(), busy > 0 ? BUSY_EVERY_MS : EVERY_MS);
}

/** Starts saying "here I am" on this page (once; any number of callers). */
export function startDeviceBeacon(): void {
  void iceServersNow();
  if (started || typeof window === 'undefined') return;
  started = true;
  void hereIAm();
}

/** Hears this device's messages. Returns the way to stop hearing them. */
export function takeDeviceMessages(take: (message: DeviceMessage) => void): () => void {
  takers.add(take);
  return () => void takers.delete(take);
}

/** While a picture is being started or shown, messages are collected faster. Returns the way to end that. */
export function beBusy(): () => void {
  busy += 1;
  schedule();
  let done = false;
  return () => {
    if (done) return;
    done = true;
    busy = Math.max(0, busy - 1);
  };
}

/** Sends one message of the handshake to another of the owner's devices. Its plain words when it could not. */
export async function sendDeviceMessage(to: string, kind: DeviceMessage['kind'], body = ''): Promise<string | null> {
  const headers = await sessionHeaders();
  if (headers === null) return 'Not signed in.';
  try {
    const response = await fetch('/api/screens/mail', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: deviceId(), to, kind, body }),
      cache: 'no-store',
    });
    if (response.ok) return null;
    const said: unknown = await response.json().catch(() => null);
    return typeof said === 'object' && said !== null && typeof (said as { error?: unknown }).error === 'string' ? (said as { error: string }).error : 'The site would not pass it on.';
  } catch {
    return 'The site could not be reached.';
  }
}

export function useOtherDevices(): State {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    () => state,
    () => state,
  );
}

/* --- which screen REMOTE shows: the PC's engine, or one of the owner's other devices ------------------------------ */

/** `rdp`: the server, by Windows Remote Desktop through the PC's gateway (RoomRdpScreen). */
/** `engine`: our own engine, on THE PC or THE SERVER (2026-11-22, both ways). */
export type RemoteSource = { kind: 'engine'; engine: EngineId } | { kind: 'rdp' } | { kind: 'device'; id: string; name: string };
let source: RemoteSource = { kind: 'engine', engine: 'pc' };
const sourceListeners = new Set<() => void>();

export function chooseRemoteSource(next: RemoteSource): void {
  source = next;
  for (const listener of sourceListeners) listener();
}

export function useRemoteSource(): RemoteSource {
  return useSyncExternalStore(
    (listener) => {
      sourceListeners.add(listener);
      return () => void sourceListeners.delete(listener);
    },
    () => source,
    () => source,
  );
}

/**
 * The WebRTC setup both sides use (2026-11-22, "relay for anywhere"): Cloudflare's public STUN server (free, no key)
 * tells each browser its address from outside, so two devices on different networks can reach each other directly
 * behind ordinary home routers. On the home network they still go straight across it. (A device behind a strict
 * network, such as a phone on mobile data, needs a relay too: not yet.)
 */
export const STUN_SERVERS: RTCIceServer[] = STUN_ONLY;
/** The device share's setup: the helpers fetched last, Cloudflare's relay among them once its key is set. */
export const deviceRtc = (): RTCConfiguration => ({ iceServers: iceServersKept() });

/** One picture's own number, carried by every message of its handshake. */
export function newCall(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => (b % 36).toString(36)).join('');
}

/** A handshake message's body: the picture's number, and the description or the plain words it carries. */
export type CallBody = { call: string; sdp?: string; why?: string };

export function callBody(text: string): CallBody | null {
  try {
    const value: unknown = JSON.parse(text);
    if (typeof value !== 'object' || value === null || typeof (value as { call?: unknown }).call !== 'string') return null;
    const v = value as { call: string; sdp?: unknown; why?: unknown };
    return { call: v.call, sdp: typeof v.sdp === 'string' ? v.sdp : undefined, why: typeof v.why === 'string' ? v.why : undefined };
  } catch {
    return null;
  }
}

/** Waits until the connection has gathered its addresses (so one message each way is enough), at most `ms`. */
export function gathered(connection: RTCPeerConnection, ms = 2500): Promise<void> {
  if (connection.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      connection.removeEventListener('icegatheringstatechange', check);
      window.clearTimeout(timeout);
      resolve();
    };
    const check = () => {
      if (connection.iceGatheringState === 'complete') done();
    };
    connection.addEventListener('icegatheringstatechange', check);
    const timeout = window.setTimeout(done, ms);
  });
}
