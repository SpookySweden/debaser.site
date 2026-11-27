import type { PlaybackPatch } from './repository';
import type { WatchRoom } from './types';

/**
 * One account on several devices in one room (Luke, 2026-11-27: "issues with my streams being synced on multiple devices
 * logged into the same account"; his answers 1A, 2A, 3A). A room's host is an account, so the PC and the laptop were both
 * the host: each played its own player and wrote its own place over the other's, and neither ever followed.
 *
 * Now the device you last touched leads (1A): whichever of your devices made the room's last play, pause, seek or skip
 * plays the room's clock, and your others follow it as a viewer follows a host. The room's own record says which, with no
 * new column: each tab remembers the playback it wrote (`noteOwnPlayback`, called by the stores' writes), and a change to
 * the room's playback that is not one of those came from somewhere else (`isOwnPlayback`).
 *
 * No React and no browser here, so a check can drive it.
 */

/** A write this tab sent: what it said, and when (this machine's clock). Null fields: a write whose row it can't know yet. */
type SentPlayback = { roomId: string; entryId: string | null; seconds: number; playing: boolean; at: number; unknown: boolean };

/** How long a write is remembered: its echo comes back in well under a second, a slow one in a few. */
const REMEMBER_MS = 60_000;
/** A write whose row this tab can't know before the answer (a server function): it claims the room's next change for this long. */
const UNKNOWN_MS = 3_000;
/** The stores keep the place to the millisecond (`writePlayback` rounds it): a hair more covers the rounding. */
const SAME_SECONDS = 0.002;
/** A place this far from where the room's last write walks to is a seek, not the clock running on. */
export const SEEK_SECONDS = 1.5;

let sent: SentPlayback[] = [];

function prune(now: number): void {
  sent = sent.filter((write) => now - write.at < REMEMBER_MS);
}

/** Said by a store as it sends a playback write for this tab; `null` for a write whose result it can't know (a server function). */
export function noteOwnPlayback(roomId: string, patch: PlaybackPatch | null, now: number = Date.now()): void {
  prune(now);
  if (patch === null) {
    sent.push({ roomId, entryId: null, seconds: 0, playing: false, at: now, unknown: true });
    return;
  }
  sent.push({
    roomId,
    entryId: patch.currentEntryId,
    seconds: Math.max(0, Math.round(patch.positionSeconds * 1000) / 1000),
    playing: patch.isPlaying,
    at: now,
    unknown: false,
  });
}

/** Whether the room's playback as it now stands is a write this tab sent. */
export function isOwnPlayback(room: Pick<WatchRoom, 'id' | 'currentEntryId' | 'positionSeconds' | 'isPlaying'>, now: number = Date.now()): boolean {
  prune(now);
  return sent.some(
    (write) =>
      write.roomId === room.id &&
      (write.unknown
        ? now - write.at < UNKNOWN_MS
        : write.entryId === room.currentEntryId && write.playing === room.isPlaying && Math.abs(write.seconds - room.positionSeconds) <= SAME_SECONDS),
  );
}

/** For a check: forget every write. */
export function forgetOwnPlayback(): void {
  sent = [];
}

type Playback = Pick<WatchRoom, 'currentEntryId' | 'positionSeconds' | 'isPlaying' | 'updatedAt'>;

/**
 * Whether the room's playback really changed between two of its rows: what is on, playing or paused, or a jump. A beat that
 * only says the clock ran on, and a write about something else (a setting, a crown, a new host), is not a change.
 */
export function playbackChanged(before: Playback, after: Playback): boolean {
  if (before.currentEntryId !== after.currentEntryId || before.isPlaying !== after.isPlaying) return true;
  // Both stamps are the database's clock, so the walk between them needs no correction for this machine's.
  const gap = Math.max(0, (Date.parse(after.updatedAt) - Date.parse(before.updatedAt)) / 1000);
  const walked = before.isPlaying ? before.positionSeconds + (Number.isFinite(gap) ? gap : 0) : before.positionSeconds;
  return Math.abs(walked - after.positionSeconds) > SEEK_SECONDS;
}

/**
 * What a playback change in your own room says about this device (1A): your own write, it leads; somebody else's, it
 * follows. Null when the change says nothing about who leads: a crown's NEXT taking a picture off is the room's own rule
 * at work, not another of your devices.
 */
export function leadFromChange(change: { own: boolean; pictureTakenOff: boolean }): 'lead' | 'follow' | null {
  if (change.own) return 'lead';
  if (change.pictureTakenOff) return null;
  return 'follow';
}
