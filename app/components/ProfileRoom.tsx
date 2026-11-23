'use client';

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { ShownCharacter } from '../lib/character/profile-character-repository';
import { useShownCharacter } from '../lib/character/use-shown-character';
import {
  boxOf,
  callIntoRoom,
  clipOf,
  companionVisitState,
  droppedVisitors,
  noteRoomSpot,
  noteRoomSpotOf,
  openRoom,
  othersHereState,
  roomDraws,
  serverCompanionVisit,
  serverOthersHere,
  subscribeToCompanionVisit,
  subscribeToOthersHere,
  wholeIn,
} from '../lib/companion/visit';
import { onCompanionSpoke } from '../lib/companion/events';
import {
  FRIEND_REPLY_MS,
  friendAnswer,
  friendIn,
  friendLines,
  KISS_MS,
  kissDue,
  nearForKiss,
  pairKeyOf,
  togetherSince,
  wantsAnswer,
} from '../lib/character/friends';
import type { ForumThread } from '../lib/forum/types';
import type { ProfileComment } from '../lib/profile/types';
import { blip } from '../lib/speech/blip';
import { guestCandidates, linesFor, nextLine, SPEECH_PACE, waitWithin, type SpeechLine, type SpeechPerson } from '../lib/speech/script';
import { voiceFor } from '../lib/speech/voice';
import { useAuth } from './AuthProvider';
import { useMusicPlayer } from './MusicPlayerProvider';
import { roomFigureSize, RoomWalker, useReducedMotion, type RoomLook } from './ProfileCharacter';
import SpeechAudioKey from './SpeechAudioKey';
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

/** The same, for somebody else's companion that climbed in from the strip: where it climbs back down from. */
function noteSpotOf(person: string, figure: HTMLElement): void {
  const box = boxOf(figure);
  noteRoomSpotOf(person, { left: box.left, bottom: box.bottom, onScreen: wholeIn(box, clipOf(figure)) });
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
 * **The same goes for everybody else on this screen** (Luke, 2026-11-22: "just one of each character on the screen at a
 * time ... the same little dude"). When the owner, or a visiting commenter, has a companion on this screen's strip (a stream
 * room you share), the room draws no copy of them: it calls their companion up (`callIntoRoom`), which walks to under it
 * and climbs in, and the room carries on with it from where it stepped in; when the room goes it climbs back down from
 * where it stood (`../lib/companion/visit.ts`, `RoomFigure` in `./Companion.tsx`). What they type in the room's chat is
 * said up here meanwhile.
 *
 * **The people who commented on the profile come to visit, and everybody here talks** (SPEC-character-speech.md; Luke,
 * 2026-11-14). Up to three of the newest commenters' shown characters walk in. Every so often one character stops,
 * faces the reader, and says something its own person wrote, in a bubble over its head (`./SpeechBubble.tsx`): a comment
 * on this profile, or a reply to the owner from anywhere on the board (`../lib/speech/script.ts` decides what counts,
 * and nobody ever says a word they did not write). One speaker at a time, at random, a few seconds apart, and only while
 * the room is on screen. Under reduced motion nothing speaks by itself: pressing a character shows its next line whole,
 * and pressing it again puts it away.
 *
 * **And they can be heard** (the same spec: "an audio button on the top right which starts muted"): while anybody here
 * has something to say, the title bar carries the audio key (`./SpeechAudioKey.tsx`). Switched on, each letter of a
 * bubble makes a short blip in that character's own voice: deeper for a taller character, with a quirk from its
 * account (`../lib/speech/voice.ts`).
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
  // Other people's companions on this screen (a stream room you share): theirs is the one figure of them (Luke, 2026-11-22).
  const others = useSyncExternalStore(subscribeToOthersHere, othersHereState, serverOthersHere);
  const reduced = useReducedMotion();
  const [stage, setStage] = useState<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(0);
  const [inView, setInView] = useState(false);

  const viewerId = user?.id ?? null;
  const own = viewerId !== null && viewerId === userId;
  const ready = shown !== undefined && visit.known;
  // Never two of the same character: on your own profile, with your companion out, your companion is the one in the room.
  const ownerBelongs = ready && shown !== null && !(own && visit.out);
  // And with the owner's companion on this screen's strip, it climbs up and is the one here: no figure of them till then.
  const drawOwner = ownerBelongs && roomDraws(userId, others);

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
  // A visiting commenter whose companion is on this screen's strip is drawn once it has climbed in, the same way.
  const guestsHere = useMemo(() => guests.filter((guest) => roomDraws(guest.person.id, others)), [guests, others]);
  // Whose companions the room calls up into it: everybody it would draw itself.
  const wantsKey = [...(ownerBelongs ? [userId] : []), ...guests.map((guest) => guest.person.id)].join('\n');

  // Somebody's companion from a stream room dragged and dropped in here that is not already one of the above (Luke,
  // 2026-11-23: "allow to drag into the profile room", "Also others' in stream"): a visitor, until the room goes.
  const dropped = useMemo(
    () => droppedVisitors(others, [...(ownerBelongs ? [userId] : []), ...guests.map((guest) => guest.person.id), ...(viewerId === null ? [] : [viewerId])]),
    [others, ownerBelongs, userId, guests, viewerId],
  );

  const drawn = ready && (ownerBelongs || visit.out || guests.length > 0 || dropped.length > 0);
  const visitorHere = visit.out && visit.inRoom && viewerId !== null;

  // Everybody whose character is in the room, by whose it is. Your companion on your own profile speaks as the owner.
  const people = useMemo(() => {
    const here: SpeechPerson[] = [];
    if (drawOwner) here.push({ id: userId, name: displayName });
    if (visitorHere && viewerId !== null && !here.some((person) => person.id === viewerId)) {
      here.push({ id: viewerId, name: own ? displayName : (user?.displayName ?? 'YOU') });
    }
    for (const guest of guestsHere) here.push(guest.person);
    for (const one of dropped) here.push({ id: one.id, name: one.name });
    return here;
  }, [drawOwner, visitorHere, viewerId, own, userId, displayName, user?.displayName, guestsHere, dropped]);

  // Friends here together (`../lib/character/friends.ts`; Luke, 2026-11-21): whose friend is in the room, by whose it is.
  const friends = useMemo(() => {
    const ids = people.map((person) => person.id);
    const found: Record<string, string | null> = {};
    for (const id of ids) found[id] = friendIn(id, ids);
    return found;
  }, [people]);
  /** Where each figure stands, shared by the walkers so a friend can come and stand beside another. */
  const [spots] = useState(() => new Map<string, number>());

  // A kiss now and then between two friends standing together (Luke, 2026-11-22: "kiss sometimes with hearts and
  // cutely"; `../lib/character/friends.ts`). The room keeps the clock for each pair here and hands both walkers the
  // moment; they step in, lean in with hearts rising, and hop and cheer after. Under reduced motion nobody moves: two
  // friends both here get a still ♥ over their heads instead, at the same moments.
  const pairsKey = useMemo(
    () =>
      [...new Set(Object.entries(friends).flatMap(([id, friend]) => (friend === null ? [] : [pairKeyOf(id, friend)])))].join('\n'),
    [friends],
  );
  /** How wide each figure here is, for whether two of them stand together. */
  const widths = useMemo(() => {
    const all: Record<string, number> = {};
    if (shown) all[userId] = roomFigureSize({ stripUrl: shown.stripUrl, sheet: shown.sheet }).w;
    for (const guest of guests) all[guest.person.id] = roomFigureSize({ stripUrl: guest.shown.stripUrl, sheet: guest.shown.sheet }).w;
    if (viewerId !== null && visit.out) all[viewerId] = roomFigureSize(visit.look === null ? null : { stripUrl: visit.look.stripUrl, sheet: visit.look.sheet }).w;
    return all;
  }, [shown, userId, guests, viewerId, visit.out, visit.look]);
  /** The one line being said, and by whom. */
  const [saying, setSaying] = useState<{ speakerId: string; line: SpeechLine } | null>(null);
  // Somebody who has left the room is no longer saying anything.
  const said = saying !== null && people.some((person) => person.id === saying.speakerId) ? saying : null;

  /** The kiss each figure is in, by whose it is: its moment. */
  const [kisses, setKisses] = useState<Record<string, number>>({});
  /** A kiss under way: nobody starts saying anything till it is over. */
  const kissing = Object.keys(kisses).length > 0;
  const kissClock = useRef({ since: new Map<string, number | null>(), last: new Map<string, number | null>() });
  /** Read by the kiss clock without restarting it: how wide each is. */
  const kissRead = useRef(widths);
  useEffect(() => {
    kissRead.current = widths;
  });
  useEffect(() => {
    if (!inView || pairsKey.length === 0) return;
    const pairs = pairsKey.split('\n').map((key) => key.split(':') as [string, string]);
    const clears = new Set<number>();
    let from = Date.now();
    const timer = window.setInterval(() => {
      const now = Date.now();
      const { since, last } = kissClock.current;
      for (const [a, b] of pairs) {
        const key = pairKeyOf(a, b);
        const xa = spots.get(a);
        const xb = spots.get(b);
        const w = Math.max(kissRead.current[a] ?? 0, kissRead.current[b] ?? 0);
        // Under reduced motion nobody walks over, so being here together is enough.
        const near = xa !== undefined && xb !== undefined && (reduced || nearForKiss(xa, xb, w));
        const together = togetherSince(since.get(key) ?? null, near, now);
        since.set(key, together);
        const moment = kissDue(key, from, now, together, last.get(key) ?? null);
        if (moment === null) continue;
        last.set(key, moment);
        setKisses((current) => ({ ...current, [a]: moment, [b]: moment }));
        // The kiss wins: a bubble over either of the two is put away.
        setSaying((current) => (current !== null && (current.speakerId === a || current.speakerId === b) ? null : current));
        const clear = window.setTimeout(() => {
          clears.delete(clear);
          setKisses((current) => {
            const next = { ...current };
            for (const id of [a, b]) if (next[id] === moment) delete next[id];
            return next;
          });
        }, KISS_MS + 200);
        clears.add(clear);
      }
      from = now;
    }, 500);
    return () => {
      window.clearInterval(timer);
      for (const clear of clears) window.clearTimeout(clear);
      setKisses({});
    };
  }, [inView, pairsKey, reduced, spots]);

  // What each of them may say: only their own words, out of what this reader's page already holds; and, with a friend
  // here, a few cheerful noises of its own for them (never words: see `friends.ts`).
  const lines = useMemo(() => {
    const owner = { id: userId, name: displayName };
    const all: Record<string, SpeechLine[]> = {};
    for (const person of people) {
      const own = linesFor({ owner, speakerId: person.id, present: people, comments, threads });
      all[person.id] = friends[person.id] ? [...own, ...friendLines(person.id)] : own;
    }
    return all;
  }, [people, userId, displayName, comments, threads, friends]);
  const talkers = people.filter((person) => (lines[person.id]?.length ?? 0) > 0);
  // A change in who can talk, or in how much they have to say, starts the wait again; a redraw of the board does not.
  const talkersKey = talkers.map((person) => `${person.id}:${lines[person.id].length}`).join('|');

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
  /** A friend about to answer a cheerful noise: whose character answers. */
  const [answer, setAnswer] = useState<string | null>(null);
  useEffect(() => {
    if (reduced || !inView || said !== null || answer === null || kissing) return;
    const wait = waitWithin(FRIEND_REPLY_MS, Math.random);
    const timer = window.setTimeout(() => {
      setAnswer(null);
      if (!document.hidden && material.current.talkers.some((person) => person.id === answer)) {
        setSaying({ speakerId: answer, line: friendAnswer(answer, Math.random) });
      }
    }, wait);
    return () => window.clearTimeout(timer);
  }, [reduced, inView, said, answer, kissing]);
  useEffect(() => {
    if (reduced || !inView || said !== null || answer !== null || kissing || talkersKey.length === 0) return;
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
  }, [reduced, inView, said, answer, kissing, talkersKey, again, sayNext]);

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

  // And it calls up the companions of the people it would draw, when they are on this screen's strip (Luke, 2026-11-22).
  useEffect(() => {
    // Called even with nobody to call up: it is also where a carried character can be dropped (2026-11-23).
    if (stage === null) return;
    return callIntoRoom({ stage, wants: wantsKey.length === 0 ? [] : wantsKey.split('\n') });
  }, [stage, wantsKey]);

  // Up here, a companion from a stream room still says what its person types in the room's chat, as it did on the strip.
  const arrived = useRef(others.inRoom);
  useEffect(() => {
    arrived.current = others.inRoom;
  });
  const chatTurns = useRef(0);
  useEffect(
    () =>
      onCompanionSpoke((who, words) => {
        if (words === undefined || words.trim().length === 0 || arrived.current[who] === undefined) return;
        chatTurns.current += 1;
        setSaying({ speakerId: who, line: { id: `chat:${who}:${chatTurns.current}`, speakerId: who, text: words, target: { kind: 'none' } } });
      }),
    [],
  );

  // The lookups are drawn whether or not the room is: they are how the room learns there is somebody to draw it for.
  const lookups = candidates.map((person) => <GuestLook key={person.id} whose={person.id} onLook={noteLook} />);

  if (!drawn) return <>{lookups}</>;

  const ownerLook: RoomLook = shown === null || shown === undefined ? null : { stripUrl: shown.stripUrl, sheet: shown.sheet };
  const visitorLook: RoomLook = visit.look === null ? null : { stripUrl: visit.look.stripUrl, sheet: visit.look.sheet };
  const tallest = Math.max(
    // Room kept for those still on their way up, so nothing jumps when they step in.
    ownerBelongs ? roomFigureSize(ownerLook).h : 0,
    visit.out ? roomFigureSize(visitorLook).h : 0,
    ...guests.map((guest) => roomFigureSize({ stripUrl: guest.shown.stripUrl, sheet: guest.shown.sheet }).h),
    ...dropped.map((one) => roomFigureSize(one.look === null ? null : { stripUrl: one.look.stripUrl, sheet: one.look.sheet }).h),
  );
  const name = displayName.toUpperCase();
  const nameOf = (id: string) => people.find((person) => person.id === id)?.name ?? '';
  /** How tall a speaker's character is, in its strip's own blocks; null for the placeholder field. */
  const heightOf = (id: string): number | null => {
    const guest = guests.find((one) => one.person.id === id);
    if (guest !== undefined) return guest.shown.sheet.floor;
    const visiting = dropped.find((one) => one.id === id);
    if (visiting !== undefined) return visiting.look?.sheet.floor ?? null;
    if (id === userId && drawOwner && shown) return shown.sheet.floor;
    return visit.look?.sheet.floor ?? null;
  };

  /**
   * For somebody whose companion is on this screen's strip: it carries on from where it stepped in, the way it faced, and
   * says where it stands, so it can climb back down from there when the room goes.
   */
  const fromStrip = (id: string) => {
    const at = others.inRoom[id];
    return {
      ...(at === undefined ? {} : { startX: at.x, startFacing: at.facing }),
      ...(others.onStrip.includes(id) ? { onSpot: (figure: HTMLElement) => noteSpotOf(id, figure) } : {}),
    };
  };

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
            onDone={() => {
              setSaying(null);
              // A cheerful noise to a friend: the friend answers it a moment later (not under reduced motion).
              if (wantsAnswer(said.line) && !reduced) setAnswer(friends[id] ?? null);
            }}
            onLetter={(letter) => blip(voiceFor(id, heightOf(id)), letter)}
            onOpenHere={(commentId) => onOpenComment?.(commentId)}
          />
        )
      : undefined;

  return (
    <section aria-label={`${name}'S ROOM`} className="frame bg-ena-deep" data-profile-room>
      {lookups}
      <div className="flex items-center justify-between gap-2 bg-ena px-2 py-0.5 text-label font-bold text-ink-bar">
        <span className="min-w-0 truncate">{name}&apos;S ROOM</span>
        {/* A key that could never sound would be a lie: it is here only while somebody has something to say. */}
        {talkers.length > 0 ? <SpeechAudioKey /> : null}
      </div>
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
            friendId={friends[userId] ?? null}
            kiss={kisses[userId] ?? null}
            spots={spots}
            {...fromStrip(userId)}
          />
        ) : null}
        {guestsHere.map((guest) => (
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
            friendId={friends[guest.person.id] ?? null}
            kiss={kisses[guest.person.id] ?? null}
            spots={spots}
            {...fromStrip(guest.person.id)}
          />
        ))}
        {/* Dropped in here off a stream room's strip (2026-11-23): somebody's companion, visiting until the room goes. */}
        {dropped.map((one) => (
          <RoomWalker
            key={`dropped:${one.id}`}
            look={one.look === null ? null : { stripUrl: one.look.stripUrl, sheet: one.look.sheet }}
            mood={one.look?.mood ?? 'busy'}
            music={music}
            width={width}
            who="guest"
            label={`${one.name.toUpperCase()}'S CHARACTER`}
            person={one.id}
            speech={speechOf(one.id)}
            onPress={() => pressed(one.id)}
            friendId={friends[one.id] ?? null}
            kiss={kisses[one.id] ?? null}
            spots={spots}
            {...fromStrip(one.id)}
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
            friendId={viewerId === null ? null : (friends[viewerId] ?? null)}
            kiss={viewerId === null ? null : (kisses[viewerId] ?? null)}
            spots={spots}
            {...(viewerId === null ? {} : { speech: speechOf(viewerId), onPress: () => pressed(viewerId) })}
          />
        ) : null}
      </div>
      {/* The floor it all stands on: a stripe in the window's own blue. */}
      <div aria-hidden="true" className="h-1 bg-ena" />
    </section>
  );
}
