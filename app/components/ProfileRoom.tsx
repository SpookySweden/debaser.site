'use client';

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { ShownCharacter } from '../lib/character/profile-character-repository';
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
import type { ForumThread } from '../lib/forum/types';
import type { ProfileComment } from '../lib/profile/types';
import { guestCandidates, linesFor, nextLine, SPEECH_PACE, waitWithin, type SpeechLine, type SpeechPerson } from '../lib/speech/script';
import { useAuth } from './AuthProvider';
import { useMusicPlayer } from './MusicPlayerProvider';
import { roomFigureSize, RoomWalker, useReducedMotion, type RoomLook } from './ProfileCharacter';
import SpeechBubble, { SPEECH_HEADROOM } from './SpeechBubble';

/** Room over the tallest figure for the music notes trailing up from a dance. */
const HEADROOM = 40;

/** How many commenters' characters come to visit at most (Luke, 2026-11-14: "Commenters visit"). */
const GUESTS = 3;
/** How many of the newest commenters are looked up to find them: some will have no character to show. */
const GUEST_LOOKUPS = 6;

/** Where the visiting figure stands on screen, for the companion to climb down from when the page changes. */
function noteSpot(figure: HTMLElement): void {
  const box = boxOf(figure);
  noteRoomSpot({ left: box.left, bottom: box.bottom, onScreen: wholeIn(box, clipOf(figure)) });
}

/** Looks up whether somebody has a character to show, and says so: it draws nothing itself. */
function GuestLook({ whose, onLook }: { whose: string; onLook: (person: string, shown: ShownCharacter | null) => void }) {
  const shown = useShownCharacter(whose);
  useEffect(() => {
    if (shown !== undefined) onLook(whose, shown);
  }, [whose, shown, onLook]);
  return null;
}

type ProfileRoomProps = {
  userId: string;
  displayName: string;
  music: boolean;
  /** Every comment the page carries, as this reader may see them: what the characters here may say. */
  comments?: ProfileComment[];
  /** The board as this reader's browser holds it: replies to the owner are read out of it. */
  threads?: ForumThread[];
  /** A bubble was pressed and what it said is a comment on this profile itself: open the comments at it. */
  onOpenComment?: (commentId: string) => void;
};

const NO_COMMENTS: ProfileComment[] = [];
const NO_THREADS: ForumThread[] = [];

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
 * **The people who commented on the profile come to visit, and everybody here talks** (SPEC-character-speech.md; Luke,
 * 2026-11-14). Up to three of the newest commenters' shown characters walk in. Every so often one character stops,
 * faces the reader, and says something its own person wrote, in a bubble over its head (`./SpeechBubble.tsx`): a comment
 * on this profile, or a reply to the owner from anywhere on the board (`../lib/speech/script.ts` decides what counts,
 * and nobody ever says a word they did not write). One speaker at a time, at random, a few seconds apart, and only while
 * the room is on screen. Under reduced motion nothing speaks by itself: pressing a character shows its next line whole,
 * and pressing it again puts it away.
 *
 * An owner with no shown character has no figure here (their hand-drawn sprite slot stays in the status bar); the room is
 * still drawn when your companion is coming to visit or a commenter's character is, and left out when nobody would be
 * in it.
 */
export default function ProfileRoom({
  userId,
  displayName,
  music,
  comments = NO_COMMENTS,
  threads = NO_THREADS,
  onOpenComment,
}: ProfileRoomProps) {
  const { user } = useAuth();
  const player = useMusicPlayer();
  const shown = useShownCharacter(userId);
  const visit = useSyncExternalStore(subscribeToCompanionVisit, companionVisitState, serverCompanionVisit);
  const reduced = useReducedMotion();
  const [stage, setStage] = useState<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(0);
  const [inView, setInView] = useState(false);

  const viewerId = user?.id ?? null;
  const own = viewerId !== null && viewerId === userId;
  const ready = shown !== undefined && visit.known;
  // Never two of the same character: on your own profile, with your companion out, your companion is the one in the room.
  const drawOwner = ready && shown !== null && !(own && visit.out);

  // Who might come to visit, and which of them turned out to have a character to show.
  const candidates = useMemo(() => guestCandidates(comments, userId, viewerId, GUEST_LOOKUPS), [comments, userId, viewerId]);
  const [looks, setLooks] = useState<Record<string, ShownCharacter | null>>({});
  const noteLook = useCallback((person: string, found: ShownCharacter | null) => {
    setLooks((current) => (current[person] === found ? current : { ...current, [person]: found }));
  }, []);
  const guests = useMemo(
    () =>
      candidates
        .map((person) => ({ person, shown: looks[person.id] ?? null }))
        .filter((guest): guest is { person: SpeechPerson; shown: ShownCharacter } => guest.shown !== null)
        .slice(0, GUESTS),
    [candidates, looks],
  );

  const drawn = ready && (drawOwner || visit.out || guests.length > 0);
  const visitorHere = visit.out && visit.inRoom && viewerId !== null;

  // Everybody whose character is in the room, by whose it is. Your companion on your own profile speaks as the owner.
  const people = useMemo(() => {
    const here: SpeechPerson[] = [];
    if (drawOwner) here.push({ id: userId, name: displayName });
    if (visitorHere && viewerId !== null && !here.some((person) => person.id === viewerId)) {
      here.push({ id: viewerId, name: own ? displayName : (user?.displayName ?? 'YOU') });
    }
    for (const guest of guests) here.push(guest.person);
    return here;
  }, [drawOwner, visitorHere, viewerId, own, userId, displayName, user?.displayName, guests]);

  // What each of them may say: only their own words, out of what this reader's page already holds.
  const lines = useMemo(() => {
    const owner = { id: userId, name: displayName };
    const all: Record<string, SpeechLine[]> = {};
    for (const person of people) all[person.id] = linesFor({ owner, speakerId: person.id, present: people, comments, threads });
    return all;
  }, [people, userId, displayName, comments, threads]);
  const talkers = people.filter((person) => (lines[person.id]?.length ?? 0) > 0);
  // A change in who can talk, or in how much they have to say, starts the wait again; a redraw of the board does not.
  const talkersKey = talkers.map((person) => `${person.id}:${lines[person.id].length}`).join('|');

  /** The one line being said, and by whom. */
  const [saying, setSaying] = useState<{ speakerId: string; line: SpeechLine } | null>(null);
  // Somebody who has left the room is no longer saying anything.
  const said = saying !== null && people.some((person) => person.id === saying.speakerId) ? saying : null;
  /** What each character has said since its bag was last emptied, and whether anybody has spoken yet this visit. */
  const bags = useRef<Record<string, string[]>>({});
  const spokeOnce = useRef(false);
  const material = useRef({ talkers, lines });
  useEffect(() => {
    material.current = { talkers, lines };
  });

  const sayNext = useCallback((speakerId: string): boolean => {
    const picked = nextLine(material.current.lines[speakerId] ?? [], bags.current[speakerId] ?? [], Math.random);
    if (picked === null) return false;
    bags.current[speakerId] = picked.said;
    setSaying({ speakerId, line: picked.line });
    return true;
  }, []);

  // The talk: one speaker at a time, at random, a few seconds apart (Luke: "randomly semi frequently"), only while the
  // room is on screen and the tab is in front. Nothing here runs under reduced motion.
  const [again, setAgain] = useState(0);
  useEffect(() => {
    if (reduced || !inView || said !== null || talkersKey.length === 0) return;
    const wait = waitWithin(spokeOnce.current ? SPEECH_PACE.gapMs : SPEECH_PACE.firstMs, Math.random);
    const timer = window.setTimeout(() => {
      const able = material.current.talkers;
      if (document.hidden || able.length === 0) {
        // Not now: wait again from the top.
        setAgain((count) => count + 1);
        return;
      }
      const speaker = able[Math.min(able.length - 1, Math.floor(Math.random() * able.length))];
      if (sayNext(speaker.id)) spokeOnce.current = true;
    }, wait);
    return () => window.clearTimeout(timer);
  }, [reduced, inView, said, talkersKey, again, sayNext]);

  /** Reduced motion: a press on a character shows its next line, whole; a second press puts it away. */
  const pressed = useCallback(
    (speakerId: string) => {
      if (!reduced) return;
      if (saying !== null && saying.speakerId === speakerId) setSaying(null);
      else sayNext(speakerId);
    },
    [reduced, saying, sayNext],
  );

  useEffect(() => {
    if (stage === null) return;
    const sizes = new ResizeObserver((entries) => setWidth(Math.floor(entries[0]?.contentRect.width ?? 0)));
    sizes.observe(stage);
    const seen = new IntersectionObserver((entries) => setInView(entries[entries.length - 1]?.isIntersecting ?? false), { threshold: 0.5 });
    seen.observe(stage);
    return () => {
      sizes.disconnect();
      seen.disconnect();
    };
  }, [stage]);

  // The room is somewhere your companion can climb into while it is out.
  useEffect(() => {
    if (stage === null || !visit.out) return;
    return openRoom({ owner: userId, stage });
  }, [stage, visit.out, userId]);

  // The lookups are drawn whether or not the room is: they are how the room learns there is somebody to draw it for.
  const lookups = candidates.map((person) => <GuestLook key={person.id} whose={person.id} onLook={noteLook} />);

  if (!drawn) return <>{lookups}</>;

  const ownerLook: RoomLook = shown === null || shown === undefined ? null : { stripUrl: shown.stripUrl, sheet: shown.sheet };
  const visitorLook: RoomLook = visit.look === null ? null : { stripUrl: visit.look.stripUrl, sheet: visit.look.sheet };
  const tallest = Math.max(
    drawOwner ? roomFigureSize(ownerLook).h : 0,
    visit.out ? roomFigureSize(visitorLook).h : 0,
    ...guests.map((guest) => roomFigureSize({ stripUrl: guest.shown.stripUrl, sheet: guest.shown.sheet }).h),
  );
  const name = displayName.toUpperCase();
  const nameOf = (id: string) => people.find((person) => person.id === id)?.name ?? '';

  /** What a figure is saying just now, if it is the one speaking. */
  const speechOf = (id: string) =>
    said !== null && said.speakerId === id
      ? (at: { x: number; w: number; h: number }) => (
          <SpeechBubble
            key={said.line.id}
            line={said.line}
            name={nameOf(id)}
            at={at}
            within={width}
            whole={reduced}
            onDone={() => setSaying(null)}
            onOpenHere={(commentId) => onOpenComment?.(commentId)}
          />
        )
      : undefined;

  return (
    <section aria-label={`${name}'S ROOM`} className="frame bg-ena-deep" data-profile-room>
      {lookups}
      <div className="truncate bg-ena px-2 py-0.5 text-label font-bold text-ink-bar">{name}&apos;S ROOM</div>
      {/* A bubble's height is kept for good once anybody here has something to say, so nothing jumps when one opens. */}
      <div
        ref={setStage}
        // `isolate`: a bubble is lifted over the other figures here (so it can always be pressed), and no further.
        className="relative isolate overflow-hidden"
        style={{ height: tallest + (talkers.length > 0 ? SPEECH_HEADROOM : HEADROOM) }}
        data-profile-room-stage
        data-room-talkers={talkers.length}
      >
        {drawOwner && shown ? (
          <RoomWalker
            key={`${shown.person}:${shown.bakedAt}`}
            look={ownerLook}
            mood={shown.mood}
            music={music}
            width={width}
            who="owner"
            label={`${name}'S CHARACTER`}
            hello={visit.out && visit.inRoom}
            person={userId}
            speech={speechOf(userId)}
            onPress={() => pressed(userId)}
          />
        ) : null}
        {guests.map((guest) => (
          <RoomWalker
            key={`guest:${guest.person.id}:${guest.shown.bakedAt}`}
            look={{ stripUrl: guest.shown.stripUrl, sheet: guest.shown.sheet }}
            mood={guest.shown.mood}
            music={music}
            width={width}
            who="guest"
            label={`${guest.person.name.toUpperCase()}'S CHARACTER`}
            person={guest.person.id}
            speech={speechOf(guest.person.id)}
            onPress={() => pressed(guest.person.id)}
          />
        ))}
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
            person={user?.id}
            onSpot={noteSpot}
            {...(viewerId === null ? {} : { speech: speechOf(viewerId), onPress: () => pressed(viewerId) })}
          />
        ) : null}
      </div>
      {/* The floor it all stands on: a stripe in the window's own blue. */}
      <div aria-hidden="true" className="h-1 bg-ena" />
    </section>
  );
}
