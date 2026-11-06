'use client';

import { useRoomGuest } from '../lib/watch/use-room-guest';
import { useAuth } from './AuthProvider';

/** Who somebody is in a stream room: an account, a guest, or nobody yet. An account always wins (SPEC-guests.md). */
export type RoomIdentity = { kind: 'account'; id: string; label: string; named: true } | { kind: 'guest'; id: string; label: string; named: boolean } | null;

export function useRoomIdentity(): RoomIdentity {
  const { user } = useAuth();
  const guest = useRoomGuest();
  if (user !== null) return { kind: 'account', id: user.id, label: user.displayName, named: true };
  return guest === null ? null : { kind: 'guest', ...guest };
}
