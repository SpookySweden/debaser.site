/**
 * The room window's [ DEVICES ] key (Luke, 2026-11-27: "allow another option in the top right called devices"; his answer, "Room
 * window, top right"). The key sits on the window's own title line (WatchWindow.tsx), the window it opens belongs to the room
 * (WatchRoom.tsx): the room offers how to open it while another device of yours is in the room, and takes the offer back after.
 */

let offer: (() => void) | null = null;
const listeners = new Set<() => void>();

/** Said by the room: how to open DEVICES, or null when the key should go. */
export function offerRoomDevices(open: (() => void) | null): void {
  if (offer === open) return;
  offer = open;
  for (const listener of listeners) listener();
}

export function roomDevicesOffer(): (() => void) | null {
  return offer;
}

export function noRoomDevicesOffer(): null {
  return null;
}

export function subscribeToRoomDevices(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
