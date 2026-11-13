import type { WatchMember } from './types';

/**
 * Who is in a room, as one string: the same people give the same string whatever order presence lists them in.
 *
 * A room's presence syncs whenever anybody re-says theirs, and since SPEC-companion.md a companion re-says where it is
 * walking every few seconds. The room window only needs telling when who is here changes, so the repositories compare
 * this before calling it, and the room is not re-drawn for a companion's step.
 */
export function membersSignature(members: readonly WatchMember[]): string {
  return members
    .map((member) => [member.key, member.userId ?? '', member.guestId ?? '', member.name, member.joinedAt].join('\u0001'))
    .sort()
    .join('\u0002');
}
