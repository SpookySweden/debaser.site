/**
 * [ DEVICES ]: how each of your own devices in a room follows this one (Luke, 2026-11-27: "for room syncing, when signed into the
 * same account, allow another option in the top right called devices, which lets you mute devices or disable influence over them
 * from the device you are currently acting on, to sync with them or to sync them to you"). SPEC-room-devices.md.
 *
 * Each open tab is a device with an id of its own (a browser keeps a short list of them, and an open tab holds one by a lock, so a
 * tab closed and opened again on the laptop is the laptop again). What it was told about your other devices is kept in its own
 * browser storage until you change it (his answer, "Until you change it"): nothing goes to the database. The words between your
 * devices ride the account's own line (`WatchRepository.joinOwnDevices`).
 *
 * The first half has no React and no browser, so a check can drive it; the second is this tab's own book, kept in storage.
 */

/** As this device sees another: it copies this one, this one copies it, or neither moves the other. */
export type DeviceMode = 'follows-me' | 'i-follow' | 'apart';

/** What this device knows of one other device of yours. */
export type DeviceRecord = {
  name: string | null;
  /** Null: nothing chosen, today's rules (the device touched last leads; the sound follows both ways). */
  mode: DeviceMode | null;
  /** When the mode was last chosen (either end's clock), so two ends that disagree settle on the later choice. */
  modeAt: number;
  /** APART in your own room: the device that keeps the room's clock; the other goes ON ITS OWN. */
  keeper: string | null;
};

/** One device's whole book: its own name, whether it was muted from another device, and its others. */
export type DeviceBook = {
  name: string | null;
  /** Muted from DEVICES on another device of yours (or this one): silent whatever the synced mute says, until lifted. */
  heldMuted: { by: string | null; at: number } | null;
  devices: Record<string, DeviceRecord>;
};

export const EMPTY_BOOK: DeviceBook = { name: null, heldMuted: null, devices: {} };

/** The same choice as the other end sees it. */
export function mirrorMode(mode: DeviceMode | null): DeviceMode | null {
  if (mode === 'follows-me') return 'i-follow';
  if (mode === 'i-follow') return 'follows-me';
  return mode;
}

/** Whether this device takes the sound (volume and mute) from that one: from one it follows, or from any while nothing is chosen. */
export function takesSoundFrom(book: DeviceBook, deviceId: string | null): boolean {
  if (deviceId === null) return true;
  const mode = book.devices[deviceId]?.mode ?? null;
  return mode === null || mode === 'i-follow';
}

/**
 * In a room your account hosts, what this device may do with the room's playback, given which of your devices are here now:
 * - `follow`: it follows another of yours that it was set to follow, and never takes the room (its keys give way);
 * - `own`: APART from the device that keeps the room, it plays on its own (it neither follows the room nor moves it);
 * - `lead`: another of yours here follows it, or is APART with this one keeping the room: it plays the room's clock;
 * - `free`: nothing chosen with those here, today's rule (the device touched last leads).
 */
export type PlaybackRole = { role: 'follow' | 'own' | 'lead' | 'free'; by: string | null };

export function playbackRole(book: DeviceBook, me: string, here: readonly string[]): PlaybackRole {
  let lead: string | null = null;
  let own: string | null = null;
  for (const id of here) {
    if (id === me) continue;
    const record = book.devices[id];
    if (record === undefined || record.mode === null) continue;
    if (record.mode === 'i-follow') return { role: 'follow', by: id };
    if (record.mode === 'follows-me') lead ??= id;
    if (record.mode === 'apart') {
      if (record.keeper === id) own ??= id;
      else if (record.keeper === me) lead ??= id;
    }
  }
  if (own !== null) return { role: 'own', by: own };
  if (lead !== null) return { role: 'lead', by: lead };
  return { role: 'free', by: null };
}

/** The stamp for a choice made here now: later than anything this pair has held, whatever the two clocks say. */
export function nextStamp(book: DeviceBook, deviceId: string, now: number): number {
  return Math.max(now, (book.devices[deviceId]?.modeAt ?? 0) + 1);
}

/** Set (or cleared) on this device for another: kept, stamped so the other end can agree. */
export function chooseMode(book: DeviceBook, deviceId: string, mode: DeviceMode | null, keeper: string | null, at: number): DeviceBook {
  const before = book.devices[deviceId] ?? { name: null, mode: null, modeAt: 0, keeper: null };
  return { ...book, devices: { ...book.devices, [deviceId]: { ...before, mode, keeper: mode === 'apart' ? keeper : null, modeAt: at } } };
}

/** Another device's word about this pair, as that device sees it; taken only when it is newer than what this one holds. */
export function hearMode(book: DeviceBook, from: string, theirMode: DeviceMode | null, keeper: string | null, at: number): DeviceBook {
  const before = book.devices[from];
  if (before !== undefined && before.modeAt >= at) return book;
  return chooseMode(book, from, mirrorMode(theirMode), keeper, at);
}

/** A name another device gave itself. */
export function hearName(book: DeviceBook, from: string, name: string | null): DeviceBook {
  const before = book.devices[from] ?? { name: null, mode: null, modeAt: 0, keeper: null };
  if (before.name === name) return book;
  return { ...book, devices: { ...book.devices, [from]: { ...before, name } } };
}

/** A name for this device from what the browser says of itself: "WINDOWS · EDGE". */
export function guessDeviceName(userAgent: string): string {
  const system = /Windows/i.test(userAgent)
    ? 'WINDOWS'
    : /iPhone|iPad|iPod/i.test(userAgent)
      ? 'IOS'
      : /Android/i.test(userAgent)
        ? 'ANDROID'
        : /Mac OS X|Macintosh/i.test(userAgent)
          ? 'MAC'
          : /CrOS/i.test(userAgent)
            ? 'CHROMEBOOK'
            : /Linux/i.test(userAgent)
              ? 'LINUX'
              : 'DEVICE';
  const browser = /Edg\//.test(userAgent)
    ? 'EDGE'
    : /OPR\/|Opera/.test(userAgent)
      ? 'OPERA'
      : /Firefox\//.test(userAgent)
        ? 'FIREFOX'
        : /Chrome\//.test(userAgent)
          ? 'CHROME'
          : /Safari\//.test(userAgent)
            ? 'SAFARI'
            : 'BROWSER';
  return `${system} · ${browser}`;
}

/** A name typed for a device: capitals, short, plain. */
export function cleanDeviceName(typed: string): string | null {
  const name = typed.replace(/\s+/g, ' ').trim().toUpperCase().slice(0, 24);
  return name.length === 0 ? null : name;
}

const isMode = (value: unknown): value is DeviceMode => value === 'follows-me' || value === 'i-follow' || value === 'apart';

/** A book read back from storage, or the empty one for anything not well-formed. */
export function readBook(raw: string | null): DeviceBook {
  if (raw === null) return EMPTY_BOOK;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const devices: Record<string, DeviceRecord> = {};
    if (typeof parsed.devices === 'object' && parsed.devices !== null) {
      for (const [id, value] of Object.entries(parsed.devices as Record<string, unknown>)) {
        if (typeof value !== 'object' || value === null) continue;
        const record = value as Record<string, unknown>;
        devices[id] = {
          name: typeof record.name === 'string' ? record.name : null,
          mode: isMode(record.mode) ? record.mode : null,
          modeAt: typeof record.modeAt === 'number' ? record.modeAt : 0,
          keeper: typeof record.keeper === 'string' ? record.keeper : null,
        };
      }
    }
    const held = parsed.heldMuted as Record<string, unknown> | null | undefined;
    return {
      name: typeof parsed.name === 'string' ? parsed.name : null,
      heldMuted: typeof held === 'object' && held !== null && typeof held.at === 'number' ? { by: typeof held.by === 'string' ? held.by : null, at: held.at } : null,
      devices,
    };
  } catch {
    return EMPTY_BOOK;
  }
}
