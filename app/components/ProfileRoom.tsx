'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
import { useShownCharacter } from '../lib/character/use-shown-character';
import {
  boxOf,
  clipOf,
  companionVisitState,
  noteRoomSpot,
  openRoom,
  serverCompanionVisit,
  subscribeToCompanionVisit,
  wholeIn,
} from '../lib/companion/visit';
import { useAuth } from './AuthProvider';
import { useMusicPlayer } from './MusicPlayerProvider';
import { roomFigureSize, RoomWalker, type RoomLook } from './ProfileCharacter';

/** Room over the tallest figure for the music notes trailing up from a dance. */
const HEADROOM = 40;

/** Where the visiting figure stands on screen, for the companion to climb down from when the page changes. */
function noteSpot(figure: HTMLElement): void {
  const box = boxOf(figure);
  noteRoomSpot({ left: box.left, bottom: box.bottom, onScreen: wholeIn(box, clipOf(figure)) });
}

/**
 * The last thing on a profile: a small window in the site's ENA colours, `[NAME]'S ROOM`, where the person's shown
 * character lives (Luke, 2026-11-13). It walks, idles and dances along the floor, dances while the profile's track plays
 * (with colourful notes trailing up from it), and waves, hops or turns when pressed.
 *
 * Your own companion (`Companion.tsx`) climbs up into it from its strip above the music bar once the room is on screen,
 * and hangs out here alongside the owner's character until you leave the page (`../lib/companion/visit.ts`). On your own
 * profile the room draws no copy of your character while your companion is out: your companion climbs up and is the one
 * living here, so the same character is never on screen twice. With your companion switched off, the room draws the
 * owner's character itself, yours included.
 *
 * An owner with no shown character has no figure here (their hand-drawn sprite slot stays in the status bar); the room is
 * still drawn when your companion is coming to visit, and left out when nobody would be in it.
 */
export default function ProfileRoom({ userId, displayName, music }: { userId: string; displayName: string; music: boolean }) {
  const { user } = useAuth();
  const player = useMusicPlayer();
  const shown = useShownCharacter(userId);
  const visit = useSyncExternalStore(subscribeToCompanionVisit, companionVisitState, serverCompanionVisit);
  const [stage, setStage] = useState<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(0);

  const own = user !== null && user.id === userId;
  const ready = shown !== undefined && visit.known;
  // Never two of the same character: on your own profile, with your companion out, your companion is the one in the room.
  const drawOwner = ready && shown !== null && !(own && visit.out);
  const drawn = ready && (drawOwner || visit.out);

  useEffect(() => {
    if (stage === null) return;
    const sizes = new ResizeObserver((entries) => setWidth(Math.floor(entries[0]?.contentRect.width ?? 0)));
    sizes.observe(stage);
    return () => sizes.disconnect();
  }, [stage]);

  // The room is somewhere your companion can climb into while it is out.
  useEffect(() => {
    if (stage === null || !visit.out) return;
    return openRoom({ owner: userId, stage });
  }, [stage, visit.out, userId]);

  if (!drawn) return null;

  const ownerLook: RoomLook = shown === null || shown === undefined ? null : { stripUrl: shown.stripUrl, sheet: shown.sheet };
  const visitorLook: RoomLook = visit.look === null ? null : { stripUrl: visit.look.stripUrl, sheet: visit.look.sheet };
  const tallest = Math.max(drawOwner ? roomFigureSize(ownerLook).h : 0, visit.out ? roomFigureSize(visitorLook).h : 0);
  const name = displayName.toUpperCase();

  return (
    <section aria-label={`${name}'S ROOM`} className="frame bg-ena-deep" data-profile-room>
      <div className="truncate bg-ena px-2 py-0.5 text-label font-bold text-ink-bar">{name}&apos;S ROOM</div>
      <div ref={setStage} className="relative overflow-hidden" style={{ height: tallest + HEADROOM }} data-profile-room-stage>
        {drawOwner && shown ? (
          <RoomWalker
            key={`${shown.person}:${shown.bakedAt}`}
            look={ownerLook}
            mood={shown.mood}
            music={music}
            width={width}
            who="owner"
            label={`${name}'S CHARACTER`}
          />
        ) : null}
        {visit.out && visit.inRoom ? (
          <RoomWalker
            key={`visit:${visit.look?.stripUrl ?? 'placeholder'}`}
            look={visitorLook}
            mood={visit.look?.mood ?? 'busy'}
            music={player.playing}
            width={width}
            startX={visit.arriveX}
            who="visitor"
            label="YOUR COMPANION"
            onSpot={noteSpot}
          />
        ) : null}
      </div>
      {/* The floor it all stands on: a stripe in the window's own blue. */}
      <div aria-hidden="true" className="h-1 bg-ena" />
    </section>
  );
}
