'use client';

import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { OwnDeviceLine, OwnDeviceWay, WatchRepository } from './repository';
import { EMPTY_BOOK, chooseMode, cleanDeviceName, hearMode, hearName, nextStamp, type DeviceBook, type DeviceMode } from './own-device-modes';
import { OWN_ASK_AFTER_MS } from './own-devices';
import { changeDeviceBook, deviceBook, deviceName, subscribeDeviceBook, thisDevice } from './own-device-book';

/** One other device of yours in this room, as this device knows it from its hello. */
export type OwnDeviceHere = { deviceId: string; key: string; name: string; held: boolean };

export type OwnDevices = {
  /** This tab's device id, once it has one (a moment after the page opens). */
  deviceId: string | null;
  book: DeviceBook;
  /** What this device calls itself. */
  name: string;
  /** Your other devices in this room that have said who they are, in the order they came in. */
  here: OwnDeviceHere[];
  choose: (deviceId: string, mode: DeviceMode | null, keeper: string | null) => void;
  muteDevice: (deviceId: string, on: boolean) => void;
  rename: (typed: string) => void;
  /** Lifts a mute from DEVICES on this device (its own speaker key, or UNMUTE in its window). */
  unholdSelf: () => void;
  /** Asks the device that keeps the room where its player is (it answers through `places.current.heard`). */
  askPlace: () => void;
};

/** What the room gives for places: where this device's player is if it keeps the room, and what to do with another's. */
export type OwnPlaces = {
  mine: () => { entryId: string; seconds: number } | null;
  heard: (place: { entryId: string; seconds: number; at: number }) => void;
};

const noBook = () => EMPTY_BOOK;

/** The ways a book holds, as they go in a hello. */
function ways(from: DeviceBook): Record<string, OwnDeviceWay> {
  return Object.fromEntries(Object.entries(from.devices).map(([id, record]) => [id, { mode: record.mode, keeper: record.keeper, at: record.modeAt }]));
}

/**
 * [ DEVICES ] (Luke, 2026-11-27; own-device-modes.ts): your devices in one room say who they are to each other on the account's
 * own line, agree the way each pair goes, and pass MUTE from one to another. `open` while another device of yours is here.
 */
export function useOwnDevices(repository: WatchRepository, accountId: string | null, roomId: string, myKey: string, otherKeys: readonly string[], open: boolean, places: { readonly current: OwnPlaces | null }): OwnDevices {
  const [deviceId, setDeviceId] = useState<string | null>(null);
  useEffect(() => {
    if (accountId === null) return;
    let current = true;
    void thisDevice().then((id) => {
      if (current) setDeviceId(id);
    });
    return () => {
      current = false;
    };
  }, [accountId]);

  const readBook = useCallback(() => (accountId === null || deviceId === null ? EMPTY_BOOK : deviceBook(accountId, deviceId)), [accountId, deviceId]);
  const book = useSyncExternalStore(subscribeDeviceBook, readBook, noBook);
  const name = deviceName(book);

  /** Who said hello, by presence key: a device's id, name and whether it is muted from DEVICES. */
  const [heard, setHeard] = useState<Record<string, OwnDeviceHere>>({});
  const line = useRef<OwnDeviceLine | null>(null);

  const change = useCallback(
    (next: (before: DeviceBook) => DeviceBook) => (accountId === null || deviceId === null ? EMPTY_BOOK : changeDeviceBook(accountId, deviceId, next)),
    [accountId, deviceId],
  );

  const sayHello = useCallback(
    (answer: boolean) => {
      if (deviceId === null) return;
      const now = readBook();
      line.current?.send({ kind: 'hello', roomId, from: deviceId, key: myKey, name: deviceName(now), modes: ways(now), held: now.heldMuted !== null, answer });
    },
    [deviceId, readBook, roomId, myKey],
  );

  const hear = useEffectEvent((message: Parameters<Parameters<WatchRepository['joinOwnDevices']>[1]>[0]) => {
    if (deviceId === null || message.roomId !== roomId || message.from === deviceId) return;
    if (message.kind === 'hello') {
      const from = message.from;
      setHeard((before) => {
        const kept = Object.fromEntries(Object.entries(before).filter(([key, device]) => key !== message.key && device.deviceId !== from));
        return { ...kept, [message.key]: { deviceId: from, key: message.key, name: message.name, held: message.held } };
      });
      change((before) => {
        let next = hearName(before, from, message.name);
        const theirs = message.modes[deviceId];
        if (theirs !== undefined) next = hearMode(next, from, theirs.mode, theirs.keeper, theirs.at);
        return next;
      });
      // A device that has just come in hears back from every one here; an answer is not answered.
      if (!message.answer) sayHello(true);
      return;
    }
    if (message.kind === 'pair' && message.to === deviceId) {
      change((before) => hearMode(before, message.from, message.mode, message.keeper, message.at));
      return;
    }
    if (message.kind === 'ask-place') {
      const mine = places.current?.mine() ?? null;
      if (mine !== null) line.current?.send({ kind: 'place', roomId, from: deviceId, to: message.from, asked: message.asked, ...mine });
      return;
    }
    if (message.kind === 'place' && message.to === deviceId) {
      // `asked` is this device's own clock, so no two clocks are compared: the answer is half the round trip old.
      const now = Date.now();
      places.current?.heard({ entryId: message.entryId, seconds: message.seconds + Math.max(0, now - message.asked) / 2000, at: now });
      return;
    }
    if (message.kind === 'mute-device' && message.to === deviceId) {
      const by = Object.values(heard).find((device) => device.deviceId === message.from)?.name ?? null;
      change((before) => ({ ...before, heldMuted: message.on ? { by, at: Date.now() } : null }));
      sayHello(true);
    }
  });

  useEffect(() => {
    if (!open || accountId === null || deviceId === null) return;
    const held = repository.joinOwnDevices(accountId, hear);
    line.current = held;
    // Said at once and again a few times after (the times the bar's volume asks at): a line takes a moment to join, and a word
    // said before it has is lost.
    sayHello(false);
    const again = OWN_ASK_AFTER_MS.map((after) => window.setTimeout(() => sayHello(false), after));
    return () => {
      for (const timer of again) window.clearTimeout(timer);
      line.current = null;
      held.leave();
    };
  }, [repository, open, accountId, deviceId, roomId, sayHello]);

  const here = useMemo(() => otherKeys.flatMap((key) => (heard[key] === undefined ? [] : [heard[key]])), [otherKeys, heard]);

  const choose = useCallback(
    (other: string, mode: DeviceMode | null, keeper: string | null) => {
      if (deviceId === null) return;
      const at = nextStamp(readBook(), other, Date.now());
      change((before) => chooseMode(before, other, mode, keeper, at));
      line.current?.send({ kind: 'pair', roomId, from: deviceId, to: other, mode, keeper: mode === 'apart' ? keeper : null, at });
    },
    [deviceId, readBook, change, roomId],
  );
  const muteDevice = useCallback(
    (other: string, on: boolean) => {
      if (deviceId === null) return;
      line.current?.send({ kind: 'mute-device', roomId, from: deviceId, to: other, on });
      // Shown at once here; the device's own hello says it took it.
      setHeard((before) => Object.fromEntries(Object.entries(before).map(([key, device]) => [key, device.deviceId === other ? { ...device, held: on } : device])));
    },
    [deviceId, roomId],
  );
  const rename = useCallback(
    (typed: string) => {
      change((before) => ({ ...before, name: cleanDeviceName(typed) }));
      sayHello(true);
    },
    [change, sayHello],
  );
  const unholdSelf = useCallback(() => {
    if (readBook().heldMuted === null) return;
    change((before) => ({ ...before, heldMuted: null }));
    sayHello(true);
  }, [readBook, change, sayHello]);

  const askPlace = useCallback(() => {
    if (deviceId === null) return;
    line.current?.send({ kind: 'ask-place', roomId, from: deviceId, asked: Date.now() });
  }, [deviceId, roomId]);

  return { deviceId, book, name, here, choose, muteDevice, rename, unholdSelf, askPlace };
}
