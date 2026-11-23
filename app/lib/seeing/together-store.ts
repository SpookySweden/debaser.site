'use client';

/**
 * The room's own channel for SEEN TOGETHER, held once for BROWSER and the Room's window. Nothing is stored: words passed as they happen, on a private
 * channel only people in a live room may hear or say (`20261123130300_seen_together.sql`). On a local dev server, between this browser's own tabs.
 */
import type { RealtimeChannel } from '@supabase/supabase-js';
import { roomClient } from '../watch/room-client';
import { readTogether, type Placed, type TogetherMessage } from './together';

export type Together = { roomId: string | null; shown: Placed | null; leading: boolean; following: boolean };
const NONE: Together = { roomId: null, shown: null, leading: false, following: false };
let held: Together = NONE;
const listeners = new Set<() => void>();
const set = (next: Partial<Together>): void => {
  held = { ...held, ...next };
  for (const listener of listeners) listener();
};
export const together = (): Together => held;
export const togetherOnServer = (): Together => NONE;
export function subscribeToTogether(listener: () => void): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

type Line = { send: (message: TogetherMessage) => void; leave: () => void };

function openLine(roomId: string, hear: (value: unknown) => void, ready: () => void): Line {
  const topic = `seeing:${roomId}`;
  const client = process.env.NEXT_PUBLIC_WATCH_DATA_SOURCE === 'supabase' ? roomClient() : null;
  if (client === null) {
    if (typeof BroadcastChannel === 'undefined') return { send: () => undefined, leave: () => undefined };
    const line = new BroadcastChannel(topic);
    let closed = false;
    line.onmessage = (event) => hear(event.data);
    window.setTimeout(() => closed || ready(), 0);
    return {
      // Left at once (an effect run twice), it is told nothing more.
      send: (message) => closed || line.postMessage(message),
      leave: () => {
        closed = true;
        line.close();
      },
    };
  }
  let channel: RealtimeChannel | null = null;
  let left = false;
  const stale = client.getChannels().filter((each) => each.topic === `realtime:${topic}`);
  void Promise.all(stale.map((each) => client.removeChannel(each))).then(() => {
    if (left) return;
    channel = client.channel(topic, { config: { broadcast: { self: false }, private: true } });
    channel.on('broadcast', { event: 'see' }, ({ payload }) => hear(payload));
    channel.subscribe((status) => {
      if (status === 'SUBSCRIBED') ready();
    });
  });
  return {
    send: (message) => {
      if (channel !== null) void channel.send({ type: 'broadcast', event: 'see', payload: message });
    },
    leave: () => {
      left = true;
      if (channel !== null) void client.removeChannel(channel);
    },
  };
}

/** Nothing said for this long is nothing shown: somebody whose tab went without a word. */
const SILENT_MS = 60_000;
const AGAIN_MS = 20_000;
let line: Line | null = null;
let users = 0;
let mine: Placed | null = null;
let heardAt = 0;
let ticking: ReturnType<typeof setInterval> | null = null;

function hear(value: unknown): void {
  const message = readTogether(value);
  if (message === null) return;
  if (message.see === 'who') {
    if (held.leading && mine !== null) line?.send({ see: 'at', ...mine });
  } else if (message.see === 'over') set({ shown: null, following: false });
  else {
    heardAt = Date.now();
    // Somebody else is showing one: theirs is what the room sees now.
    set({ shown: { address: message.address, y: message.y, whole: message.whole }, leading: false });
  }
}

function tick(): void {
  if (held.leading && mine !== null) line?.send({ see: 'at', ...mine });
  else if (held.shown !== null && Date.now() - heardAt > SILENT_MS) set({ shown: null, following: false });
}

/** Joined while anything that draws it is there; left when the last of them goes. One room at a time. */
export function joinTogether(roomId: string): () => void {
  if (held.roomId !== roomId) {
    line?.leave();
    if (ticking !== null) clearInterval(ticking);
    users = 0;
    mine = null;
    set({ ...NONE, roomId });
    const opened = openLine(roomId, hear, () => opened.send({ see: 'who' }));
    line = opened;
    ticking = setInterval(tick, AGAIN_MS);
  }
  users += 1;
  let gone = false;
  return () => {
    if (gone || held.roomId !== roomId) return;
    gone = true;
    users -= 1;
    if (users > 0) return;
    if (held.leading) line?.send({ see: 'over' });
    line?.leave();
    line = null;
    if (ticking !== null) clearInterval(ticking);
    ticking = null;
    mine = null;
    set(NONE);
  };
}

/** The page in front, shown to the room; and no longer. */
export function lead(at: Placed): void {
  mine = at;
  set({ leading: true, following: false, shown: null });
  line?.send({ see: 'at', ...at });
}
export function stopLeading(): void {
  if (!held.leading) return;
  mine = null;
  line?.send({ see: 'over' });
  set({ leading: false });
}

/** Where the one showing it is, a few times a second at most. */
const EVERY_MS = 180;
let sentAt = 0;
let later: ReturnType<typeof setTimeout> | null = null;
export function leadTo(at: Placed): void {
  if (!held.leading) return;
  mine = at;
  const send = () => {
    later = null;
    sentAt = Date.now();
    if (held.leading && mine !== null) line?.send({ see: 'at', ...mine });
  };
  if (Date.now() - sentAt >= EVERY_MS) send();
  else later ??= setTimeout(send, EVERY_MS);
}

export const follow = (on: boolean): void => set({ following: on });
