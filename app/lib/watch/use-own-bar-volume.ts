'use client';

import { useEffect, useEffectEvent, useRef } from 'react';
import { getWatchRepository, type OwnDeviceLine } from './repository';
import { OWN_ASK_AFTER_MS, OWN_VOLUME_SAY_MS } from './own-devices';
import { takesSoundFrom } from './own-device-modes';
import { deviceBook, thisDevice } from './own-device-book';

/** The sender, for a word said on the line (none before this tab knows its device). */
function fromDevice(id: string | null): { from?: string } {
  return id === null ? {} : { from: id };
}

/**
 * The music bar's volume, followed between your own devices while their bars play your room (Luke, 2026-11-27, asked whether the
 * bar's volume should follow too: "Yes, it follows"). A tab that opens takes the volume your other devices have (his answer,
 * "Take current volume on join"): it asks, and a tab of yours that was open before it answers. Signed in only, on the account's
 * own line (`WatchRepository.joinOwnDevices`); a visitor's bar is its own. [ DEVICES ] (SPEC-room-devices.md): the volume is taken
 * only from a device this one follows, or from any while nothing is chosen.
 */
export function useOwnBarVolume(accountId: string | null, roomId: string | null, volume: number, setVolume: (volume: number) => void, onYourRoom: boolean): void {
  const line = useRef<OwnDeviceLine | null>(null);
  /** When this tab's line opened: a tab asking with a later time is answered by this one. */
  const openedAt = useRef(0);
  /** This tab has the account's volume: from an answer, a word from another device, or a turn of its own. */
  const settled = useRef(false);
  /** The volume the line set last, so the change it makes is not said back. */
  const heard = useRef<number | null>(null);
  /** The volume as last seen here, so only a change is said. */
  const seen = useRef(volume);
  const sayTimer = useRef<number | null>(null);
  const saidAt = useRef(0);
  /** This tab's device id, once known: said with each word, and the key to its book of ways. */
  const device = useRef<string | null>(null);
  useEffect(() => {
    if (accountId === null) return;
    void thisDevice().then((id) => {
      device.current = id;
    });
  }, [accountId]);

  const answer = useEffectEvent((since: number) => {
    if (onYourRoom && roomId !== null && openedAt.current < since) line.current?.send({ kind: 'bar', roomId, volume, ...fromDevice(device.current) });
  });
  const hear = useEffectEvent((next: number, sender: string | undefined) => {
    if (!onYourRoom) return;
    if (accountId !== null && device.current !== null && !takesSoundFrom(deviceBook(accountId, device.current), sender ?? null)) return;
    settled.current = true;
    if (Math.abs(next - volume) < 0.001) return;
    heard.current = next;
    setVolume(next);
  });

  useEffect(() => {
    if (accountId === null || roomId === null) return;
    const opened = Date.now();
    openedAt.current = opened;
    settled.current = false;
    const held = getWatchRepository().joinOwnDevices(accountId, (message) => {
      if (message.roomId !== roomId) return;
      if (message.kind === 'ask-bar') answer(message.since);
      if (message.kind === 'bar') hear(message.volume, message.from);
    });
    line.current = held;
    const asks = OWN_ASK_AFTER_MS.map((after) =>
      window.setTimeout(() => {
        if (!settled.current) held.send({ kind: 'ask-bar', roomId, since: opened, ...fromDevice(device.current) });
      }, after),
    );
    return () => {
      for (const ask of asks) window.clearTimeout(ask);
      if (sayTimer.current !== null) window.clearTimeout(sayTimer.current);
      sayTimer.current = null;
      line.current = null;
      held.leave();
    };
  }, [accountId, roomId]);

  // A change of the bar's volume here is said to your other devices, at most every OWN_VOLUME_SAY_MS while it is dragged.
  useEffect(() => {
    if (Math.abs(volume - seen.current) < 0.001) return;
    seen.current = volume;
    if (heard.current !== null && Math.abs(heard.current - volume) < 0.001) {
      heard.current = null;
      return;
    }
    if (line.current === null || roomId === null || !onYourRoom) return;
    settled.current = true;
    if (sayTimer.current !== null) window.clearTimeout(sayTimer.current);
    sayTimer.current = window.setTimeout(
      () => {
        sayTimer.current = null;
        saidAt.current = Date.now();
        line.current?.send({ kind: 'bar', roomId, volume, ...fromDevice(device.current) });
      },
      Math.max(0, OWN_VOLUME_SAY_MS - (Date.now() - saidAt.current)),
    );
  }, [volume, roomId, onYourRoom]);
}
