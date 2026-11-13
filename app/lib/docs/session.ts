import * as Y from 'yjs';
import { Awareness, applyAwarenessUpdate, encodeAwarenessUpdate, removeAwarenessStates } from 'y-protocols/awareness';
import { DYES } from '../ui/themes';
import { pointerInterval } from './rules';
import type { DocChannelMessage, DocRoom } from './types';

/**
 * The part of live editing that does not care where the messages come from (it began as the lore
 * pages' provider, and the lore pages are documents now).
 *
 * Above this line is a `Y.Doc` and an `Awareness`; below it is a room that sends JSON and hands back
 * what arrives. The handshake, in three steps:
 *
 *   1. a joiner broadcasts `sync-request` and puts its own presence on the wire;
 *   2. whoever is already there answers that joiner alone with the whole document as one update;
 *   3. every change after that is one `update` per change, applied on arrival.
 *
 * Two more things ride the same channel, so a document never needs a second one:
 *
 *   - `pointer`: where someone's mouse is, as a Yjs relative position in the text plus a small pixel
 *     offset, so two window sizes agree on where it is. Sent about 8 times a second while it moves
 *     (2 a second above six people), never while it is still.
 *   - `saved`: said after a save, so a reader who cannot send (and so cannot ask for the document)
 *     reads the saved copy again when a change has reached it out of order.
 *
 * A reader (CAN READ, or a visitor on a PUBLIC document) joins with `canSend: false`: the database
 * lets only editors send on a document's channel, so a reader listens and sends nothing.
 */

export type DocPeer = {
  clientId: number;
  name: string;
  colour: string;
  /** The account, so a caret or pointer can wear its profile picture. Null for a visitor. */
  userId: string | null;
  self: boolean;
};

export type DocStatus = 'SYNCING' | 'LIVE' | 'ALONE';

export type DocIdentity = { name: string; colour: string; userId: string | null };

/** A pointer as it arrives: relative to the text, not the screen. */
export type DocPointer = { at: string; dx: number; dy: number };

/**
 * That identity as the awareness state everyone reads. The colour is written under both spellings:
 * this site says `colour`, the caret extension reads `color`.
 */
export function docPresence(identity: DocIdentity): Record<string, string> {
  return {
    name: identity.name,
    colour: identity.colour,
    color: identity.colour,
    userId: identity.userId ?? '',
  };
}

export type DocSession = {
  peers: () => DocPeer[];
  onPeers: (handler: (peers: DocPeer[]) => void) => () => void;
  status: () => DocStatus;
  onStatus: (handler: (status: DocStatus) => void) => () => void;
  /** Where this tab's pointer is, or null when it left the document. Throttled here. */
  sendPointer: (pointer: DocPointer | null) => void;
  onPointer: (handler: (from: number, pointer: DocPointer | null) => void) => () => void;
  /** Tells the others a save has landed. */
  announceSaved: () => void;
  onSaved: (handler: () => void) => () => void;
  /** Messages sent and heard since joining: the realtime cost, counted. */
  stats: () => { sent: number; heard: number; pointersSent: number };
  destroy: () => void;
};

type DocSessionOptions = {
  room: DocRoom;
  doc: Y.Doc;
  awareness: Awareness;
  user: DocIdentity;
  /** False for a reader: listens only. */
  canSend: boolean;
};

const SYNC_WINDOW_MS = 1500;
const HEARTBEAT_MS = 10_000;

const BASE64_CHUNK = 0x2000;

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';

  for (let index = 0; index < bytes.length; index += BASE64_CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(index, index + BASE64_CHUNK));
  }

  return btoa(binary);
}

export function base64ToBytes(value: string): Uint8Array {
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
}

export function createDocSession({ room, doc, awareness, user, canSend }: DocSessionOptions): DocSession {
  const peerListeners = new Set<(peers: DocPeer[]) => void>();
  const statusListeners = new Set<(status: DocStatus) => void>();
  const pointerListeners = new Set<(from: number, pointer: DocPointer | null) => void>();
  const savedListeners = new Set<() => void>();
  let status: DocStatus = 'SYNCING';
  let destroyed = false;
  let sent = 0;
  let heard = 0;
  let pointersSent = 0;

  // Pointer throttle: the latest position waits for the next slot, so a burst of moves is one message.
  let pointerWaiting: DocPointer | null | undefined;
  let pointerTimer: ReturnType<typeof setTimeout> | null = null;
  let lastPointerAt = 0;

  const send = (message: DocChannelMessage): void => {
    if (!canSend || destroyed) return;
    sent += 1;
    room.send(message);
  };

  if (canSend) awareness.setLocalStateField('user', docPresence(user));
  else awareness.setLocalState(null);

  const readPeers = (): DocPeer[] => {
    const peers: DocPeer[] = [];

    awareness.getStates().forEach((state, clientId) => {
      const identity = state.user as { name?: string; colour?: string; userId?: string } | undefined;
      if (identity === undefined) return;

      peers.push({
        clientId,
        name: typeof identity.name === 'string' && identity.name.length > 0 ? identity.name.slice(0, 60) : 'SOMEONE',
        colour: typeof identity.colour === 'string' && /^#[0-9a-fA-F]{6}$/.test(identity.colour) ? identity.colour : DYES.royalBlue,
        userId: typeof identity.userId === 'string' && identity.userId.length > 0 ? identity.userId.slice(0, 80) : null,
        self: clientId === doc.clientID,
      });
    });

    return peers.sort((left, right) => {
      if (left.self) return -1;
      if (right.self) return 1;
      return left.name.localeCompare(right.name);
    });
  };

  const publish = (): void => {
    const peers = readPeers();
    for (const listener of peerListeners) listener(peers);
  };

  const setStatus = (next: DocStatus): void => {
    if (status === next) return;
    status = next;
    for (const listener of statusListeners) listener(next);
  };

  const announce = (): void => {
    send({ kind: 'awareness', from: doc.clientID, update: bytesToBase64(encodeAwarenessUpdate(awareness, [doc.clientID])) });
  };

  const onDocUpdate = (update: Uint8Array, origin: unknown): void => {
    if (destroyed || origin === 'remote' || origin === 'stored') return;
    send({ kind: 'update', from: doc.clientID, update: bytesToBase64(update) });
  };

  const onAwarenessUpdate = (changes: { added: number[]; updated: number[]; removed: number[] }, origin: unknown): void => {
    if (destroyed) return;

    publish();
    if (origin === 'remote') return;

    const changed = [...changes.added, ...changes.updated, ...changes.removed];
    if (changed.length === 0) return;

    send({ kind: 'awareness', from: doc.clientID, update: bytesToBase64(encodeAwarenessUpdate(awareness, changed)) });
  };

  const onMessage = (message: DocChannelMessage): void => {
    if (destroyed || message.from === doc.clientID) return;
    heard += 1;

    switch (message.kind) {
      case 'sync-request': {
        send({ kind: 'sync-response', from: doc.clientID, to: message.from, state: bytesToBase64(Y.encodeStateAsUpdate(doc)) });
        announce();
        return;
      }

      case 'sync-response': {
        if (message.to !== doc.clientID) return;
        Y.applyUpdate(doc, base64ToBytes(message.state), 'remote');
        setStatus('LIVE');
        announce();
        return;
      }

      case 'update': {
        Y.applyUpdate(doc, base64ToBytes(message.update), 'remote');
        setStatus('LIVE');
        return;
      }

      case 'awareness': {
        const before = awareness.getStates().size;
        applyAwarenessUpdate(awareness, base64ToBytes(message.update), 'remote');
        if (awareness.getStates().size > before) setStatus('LIVE');
        return;
      }

      case 'gone': {
        removeAwarenessStates(awareness, [message.from], 'remote');
        for (const listener of pointerListeners) listener(message.from, null);
        return;
      }

      case 'pointer': {
        const fine = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 4000;
        if (message.at !== null && (typeof message.at !== 'string' || message.at.length > 400 || !fine(message.dx) || !fine(message.dy))) return;
        const pointer = message.at === null ? null : { at: message.at, dx: message.dx, dy: message.dy };
        for (const listener of pointerListeners) listener(message.from, pointer);
        return;
      }

      case 'saved': {
        for (const listener of savedListeners) listener();
        return;
      }
    }
  };

  const flushPointer = (): void => {
    pointerTimer = null;
    if (pointerWaiting === undefined) return;

    const pointer = pointerWaiting;
    pointerWaiting = undefined;
    lastPointerAt = Date.now();
    pointersSent += 1;
    send({ kind: 'pointer', from: doc.clientID, at: pointer?.at ?? null, dx: pointer?.dx ?? 0, dy: pointer?.dy ?? 0 });
  };

  doc.on('update', onDocUpdate);
  awareness.on('update', onAwarenessUpdate);
  const stopListening = room.listen(onMessage);
  // Back after a dropped connection: what was said meanwhile is gone, so ask for the document again.
  const stopRejoin = room.onRejoin?.(() => {
    send({ kind: 'sync-request', from: doc.clientID });
    announce();
  });

  send({ kind: 'sync-request', from: doc.clientID });
  announce();

  const syncWindow: ReturnType<typeof setTimeout> = setTimeout(() => {
    if (status === 'SYNCING') setStatus('ALONE');
  }, SYNC_WINDOW_MS);

  const heartbeat: ReturnType<typeof setInterval> = setInterval(() => {
    announce();
    publish();
  }, HEARTBEAT_MS);

  publish();

  return {
    peers: readPeers,
    onPeers: (handler) => {
      peerListeners.add(handler);
      handler(readPeers());
      return () => void peerListeners.delete(handler);
    },
    status: () => status,
    onStatus: (handler) => {
      statusListeners.add(handler);
      handler(status);
      return () => void statusListeners.delete(handler);
    },
    sendPointer: (pointer) => {
      if (!canSend || destroyed) return;

      pointerWaiting = pointer;
      if (pointerTimer !== null) return;

      const wait = Math.max(0, lastPointerAt + pointerInterval(awareness.getStates().size) - Date.now());
      pointerTimer = setTimeout(flushPointer, wait);
    },
    onPointer: (handler) => {
      pointerListeners.add(handler);
      return () => void pointerListeners.delete(handler);
    },
    announceSaved: () => send({ kind: 'saved', from: doc.clientID }),
    onSaved: (handler) => {
      savedListeners.add(handler);
      return () => void savedListeners.delete(handler);
    },
    stats: () => ({ sent, heard, pointersSent }),
    destroy: () => {
      if (destroyed) return;

      // Said before going: the presence removal and the goodbye.
      if (canSend) {
        const removal = encodeAwarenessUpdate(awareness, [doc.clientID]);
        awareness.setLocalState(null);
        send({ kind: 'awareness', from: doc.clientID, update: bytesToBase64(removal) });
        send({ kind: 'gone', from: doc.clientID });
      }

      destroyed = true;
      clearTimeout(syncWindow);
      clearInterval(heartbeat);
      if (pointerTimer !== null) clearTimeout(pointerTimer);
      doc.off('update', onDocUpdate);
      awareness.off('update', onAwarenessUpdate);
      stopListening();
      stopRejoin?.();
      room.close();
    },
  };
}
