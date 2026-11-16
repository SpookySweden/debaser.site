'use client';

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { DANCES, type MotionId } from '../lib/character/motion';
import { useShownCharacter } from '../lib/character/use-shown-character';
import { fallStep, spanFor, startBrain, think, throwOf, type BrainScene, type BrainState, type Fall, type Span } from '../lib/companion/brain';
import { companionOut } from '../lib/companion/choices';
import {
  companionChoicesState,
  serverCompanionChoices,
  setCompanionAccount,
  subscribeToCompanionChoices,
} from '../lib/companion/companion-slot';
import { onCompanionCatch, onCompanionHolds, onCompanionPoke, onCompanionSpoke, type HeldPicture } from '../lib/companion/events';
import { addedHere, outsideAnswer, outsidePicturesServerState, outsidePicturesState, subscribeToOutsidePictures } from '../lib/watch/outside-pictures';
import { dimensionsRefusal, loadPicture, outsideAddressRefusal, pictureHost } from '../lib/watch/pictures';
import { watchWindowState } from '../lib/watch/watch-window';
import { measureWindows, type Floor, type FloorBox } from '../lib/companion/floor';
import { shoveStep, shoveThrow } from '../lib/companion/shove';
import { holdLedgeHeight } from '../lib/companion/ledge';
import { companionScene } from '../lib/companion/scene';
import {
  isThrow,
  releaseVelocity,
  SAMPLE_WINDOW_MS,
  settleFrames,
  dragLook,
  glideAt,
  squashLook,
  startThrow,
  throwLook,
  throwStep,
  type Sample,
  type ThrowBox,
  type Thrown,
} from '../lib/companion/throw';
import { floatingState } from '../lib/ui/floating-player';
import { usePhone, useReducedMotion } from '../lib/companion/use-phone';
import {
  boxOf,
  clipOf,
  climbToward,
  noteRoomSpot,
  PORTAL_AFTER_MS,
  PORTAL_OPEN_MS,
  PORTAL_SIZE,
  PORTAL_STEP_OUT_MS,
  roomFloor,
  roomSpot,
  setCompanionInRoom,
  setCompanionOut,
  visitRoomState,
  whenRoomGoes,
  type VisitLook,
  type VisitPhase,
  type VisitRoom,
} from '../lib/companion/visit';
import {
  COMPANION_POSES,
  companionsToDraw,
  loopMotion,
  reactionIsLocal,
  reactionMark,
  reactionMotion,
  roomCompanionsState,
  sayCompanion,
  serverRoomCompanions,
  subscribeToRoomCompanions,
  type CompanionMood,
  type CompanionWire,
  type RoomCompanion,
} from '../lib/companion/wire';
import { SPRITE_SLOT } from '../lib/ui/controls';
import { draw, floorNow, measureInsets, NO_INSETS, SCALE, sizeOf, type Insets, type Look, type Size } from '../lib/companion/draw';
import { useAuth } from './AuthProvider';
import CompanionReactions from './CompanionReactions';
import { useMusicPlayer } from './MusicPlayerProvider';
import NoteTrail from './NoteTrail';
import SpeechBubble from './SpeechBubble';
import { blip } from '../lib/speech/blip';
import { SPEECH_PACE } from '../lib/speech/script';
import { voiceFor } from '../lib/speech/voice';
import SpriteSlot from './SpriteSlot';

/**
 * Your companion: your character, living along the bottom of the site on every page (SPEC-companion.md).
 *
 * It walks the top edge of the music bar (or the window's foot when the bar is folded), steps around the folded
 * player, the floating video and the stream's TV box, wanders, sits, falls asleep when nothing has happened for a
 * minute, dances while the music bar plays, chases the pointer when it comes down to the strip, and hops (with a `!`
 * over its head for a reply, a message or someone coming online). In a stream or music room everyone's companions
 * share the strip, each with its owner's name on hover; outside rooms only you see yours.
 *
 * A life of its own (Luke, 2026-11-14): press and drag it and it dangles from the pointer, then drops back to its strip
 * and lands; a press without a drag gets a hop, a wave or a spin in turn. Asleep, little `z`s drift up from it, and left
 * alone for five minutes it curls right up; it stretches when you come back (and waves, after a long sleep). Bored, it
 * stretches, spins or runs back and forth. It runs after the pointer, and changes its dance with the track.
 *
 * Thrown (Luke, 2026-11-14: "retain momentum and splat against the edge of the screen and obey the principles of
 * animation such as squash and stretch and wind up and smearing"): let go on the move it keeps the pointer's speed. A
 * beat of wind-up, then it flies, drawn out along its path with copies of itself trailing; hard into a side or the top
 * of the screen it splats flat, sticks, peels off and drops; it bounces on its floor, squashed, and settles, dizzy after
 * a splat. The rules are `../lib/companion/throw.ts`; the squash, stretch and smear are its own baked frame scaled and
 * copied, never anything drawn. A room is told only where it ended up.
 *
 * It wears its owner's SHOWN character (Luke, 2026-11-13: "Only the shown one"): the picture strip the owner's browser
 * baked from their own hand-built character (SPEC-profile-characters.md, `bake.ts`), played a cell at a time from the
 * strip's own motions (walk, idle, sit, sleep, the dances, hop). With no SHOWN character it is a placeholder field.
 * The code never draws a character.
 *
 * On a profile it climbs up into the room at the foot of the page once the room is on screen, and the room draws it there
 * (`ProfileRoom.tsx`, `../lib/companion/visit.ts`; Luke, 2026-11-13). Leaving the page, it climbs back down from where it
 * stood; if the page changes again before it is down, or it was still climbing up, it vanishes and pops out of a portal on
 * its strip a moment later. Under reduced motion it appears in the room, or back on its strip, standing still.
 *
 * It takes part (2026-11-14, `docs/companion.md`): types along, watches a game or a video, reads along with a book; in a
 * stream room whose window covers its strip it stands on that window's top edge; it waves at newcomers, hops when its
 * owner speaks in a room's chat, and wears a different text mark for each kind of news.
 *
 * Every frame is a write to the figure's style through a ref, ten a second in whole steps (the site's no-easing rule),
 * so nothing re-renders as it walks. Clicks pass straight through everything but the figure itself. Under reduced
 * motion it stands still in one frame.
 */

/** One frame: ten a second, as the strips are baked (`sheet.fps`). */
const TICK_MS = 100;
/** Pixels a frame, walking and chasing. */
const WALK_STEP = 3;
const CHASE_STEP = 6;
/** How far above the strip the pointer counts as near. */
const NEAR_PX = 120;
/** A chase re-says where it is headed at most this often. */
const CHASE_SAY_MS = 2_000;
/** How long the `!` stays up. */
const MARK_MS = 1_600;
/** The placeholder's hop: how high it is on each frame, then back down. A character plays its own one-off motions. */
const HOP = [-4, -8, -10, -8, -4, 0];
/** Two presses on it within this long are a double press: it is picked up, and follows the pointer with no key held. */
const DOUBLE_MS = 400;
/** It waves at a newcomer to the room at most this often. */
const GREET_QUIET_MS = 5_000;
/** A pointer that has not moved for this long is no longer chased. */
const CHASE_FRESH_MS = 8_000;
/** How far a press must move before it is a pick-up, not a poke. */
const GRAB_SLOP = 5;
/** A dance lasts this long before it changes to another (a new track changes it at once). */
const DANCE_MS: readonly [number, number] = [20_000, 40_000];
/** How far somebody else's companion drops a frame when its floor drops away under it (a room's window closing). */
const FALL_STEP = 24;
/** The book's box on its lap while it reads, in CSS pixels (its art slot, `sprite-companion-book`). */
const BOOK_SIZE = 24;
/** How long after the page settles a strip missing the newer motions is baked again. */
const REBAKE_AFTER_MS = 6_000;
/** What a press without a drag gets, in turn. */
const POKES: readonly NonNullable<CompanionWire['k']>[] = ['poke', 'wave', 'spin'];
/** The stars going round its head while it is dizzy, a frame each: text, not art. */
const DIZZY_MARKS: readonly string[] = ['✶··', '·✶·', '··✶', '·✶·'];

/** A dance at random, never the one it is doing now. */
function pickDance(not?: MotionId): MotionId {
  const others = DANCES.filter((dance) => dance !== not);
  return others[Math.floor(Math.random() * others.length)] ?? 'dance1';
}

/** Whether the music bar is playing, and which track, without re-rendering the strip on every tick of the track's clock. */
function MusicWatch({ onChange }: { onChange: (playing: boolean, track: string | null) => void }) {
  const { playing, track } = useMusicPlayer();
  const id = track?.id ?? null;
  useEffect(() => onChange(playing, id), [playing, id, onChange]);
  return null;
}


/** Where on the floor a share of it is, and back: the whole screen on the strip, between a room window's two corners on top of one. */
const floorRoom = (floor: Floor, size: Size): number => Math.max(1, floor.right - floor.left - size.w);

/**
 * The middle of what it is watching, across the screen, so it sits facing it: a room's picture, a floating video, the
 * arcade. Null when there is nothing on screen to face. Read once a second at most.
 */
const FOCUS_SELECTOR = '[data-room-picture], [data-floating-player], [data-dock-window="arcade"]';
let focusHeld: { at: number; x: number | null } = { at: 0, x: null };
function focusNow(): number | null {
  const now = Date.now();
  if (now - focusHeld.at <= 1_000) return focusHeld.x;
  let x: number | null = null;
  for (const element of document.querySelectorAll(FOCUS_SELECTOR)) {
    const box = element.getBoundingClientRect();
    if (box.width === 0 || box.height === 0) continue;
    x = box.left + box.width / 2;
    break;
  }
  focusHeld = { at: now, x };
  return x;
}

/**
 * On top of a stream room's window the video is under its feet, not up in front of it: watching from there is a plain
 * sit on the edge, not the looking-up it does from the floor.
 */
const onLedge = (loop: MotionId, floor: Floor): MotionId => (floor.ledge && loop === 'watch' ? 'sit' : loop);

/** Which way to face to look at what it watches; as it was when there is nothing on screen to face. */
function facingFocus(x: number, size: Size, facing: 1 | -1): 1 | -1 {
  const focus = focusNow();
  if (focus === null) return facing;
  return focus >= x + size.w / 2 ? 1 : -1;
}

/** Where a key press was typed into: a text box, or a page being written (DOCS, the board, comms). */
const WRITING = 'input:not([type]), input[type="text"], input[type="search"], input[type="email"], input[type="url"], textarea, [contenteditable="true"]';
/** It types along for this long after the last key. */
const TYPING_MS = 1_500;


function hide(place: HTMLDivElement | null) {
  if (place !== null) place.style.visibility = 'hidden';
}

/** What a press is meant for when it lands on one: a key, a link, a field, a slider. */
const KEYS = 'button, a[href], input, select, textarea, label, summary, [role="button"], [role="slider"], [role="link"], [contenteditable="true"]';

/**
 * A figure standing over a key lets presses through to it (Luke's first rule for it: it never blocks a click). Where its
 * strip runs over a page's own keys (the reader's page keys and seek bar sit right along the foot of the screen), a press
 * on the figure goes to the key under it instead of to the figure, for as long as it stands there; it can be picked up
 * again once it has moved off. Looked at twice a second, at six spots across its box.
 */
function yieldToKeys(place: HTMLDivElement | null): void {
  if (place === null || place.style.visibility !== 'visible') return;
  const box = place.getBoundingClientRect();
  let over = false;
  for (const fx of [0.2, 0.5, 0.8]) {
    for (const fy of [0.45, 0.85]) {
      const under = document.elementsFromPoint(box.left + box.width * fx, box.top + box.height * fy).find((element) => element.closest('[data-companion-strip]') === null);
      if (under !== undefined && under.closest(KEYS) !== null) over = true;
    }
  }
  const want = over ? 'none' : '';
  if (place.style.pointerEvents !== want) place.style.pointerEvents = want;
}

/** Opens the portal (an art slot, `sprite-portal`) with its foot on the strip, centred on `middle`. */
function openPortal(portal: HTMLDivElement | null, middle: number, floorY: number) {
  if (portal === null) return;
  portal.style.transform = `translate3d(${Math.round(middle - PORTAL_SIZE / 2)}px, ${Math.round(floorY - PORTAL_SIZE)}px, 0)`;
  portal.style.visibility = 'visible';
  portal.dataset.open = 'true';
}
function closePortal(portal: HTMLDivElement | null) {
  if (portal === null) return;
  portal.style.visibility = 'hidden';
  portal.dataset.open = 'false';
}

/**
 * Where it is: on its strip, climbing up into a profile's room, in it, climbing down, gone, stepping out of the portal,
 * held up by the reader's pointer, falling back to its strip, or thrown (in the air, or flat against an edge of the screen).
 */
type Phase = VisitPhase | 'portal' | 'held' | 'fall' | 'thrown' | 'mount';

/**
 * A press on the figure: a poke until it moves, then a pick-up. `off` is where on the figure it was taken hold of, and
 * `trail` the pointer's last few moves, which a let-go reads its speed from (`releaseVelocity`).
 */
type Grab = { id: number; startX: number; startY: number; offX: number; offY: number; moved: boolean; px: number; py: number; trail: Sample[]; carried: boolean };

/** Puts a text mark (`!`, `VS`, a heart, `...`) up over its head for a moment. */
function showMark(mark: HTMLSpanElement | null, timer: ReturnType<typeof setTimeout> | null, text: string): ReturnType<typeof setTimeout> | null {
  if (mark === null) return timer;
  if (mark.textContent !== text) mark.textContent = text;
  mark.style.visibility = 'visible';
  if (timer !== null) clearTimeout(timer);
  return setTimeout(() => {
    mark.style.visibility = '';
  }, MARK_MS);
}

type FigureProps = {
  placeRef: React.RefObject<HTMLDivElement | null>;
  bodyRef: React.RefObject<HTMLSpanElement | null>;
  markRef: React.RefObject<HTMLSpanElement | null>;
  label: string;
  own: boolean;
  /** Whose it is, written on the figure (`data-companion-of`) so a thing dropped on it can find its owner. */
  ownerId: string | null;
  look: Look;
};

/**
 * What a companion says: its owner's own line of a stream room's chat, in a bubble over its head that moves with it
 * (SPEC-character-speech.md; Luke, 2026-11-14: "Both at once", and of stream rooms: "A: Yes, that"). The words come
 * with `companionSpoke`, from the chat line this browser already has, so nothing is sent to anybody. A newer line from
 * the same person takes the older one's place. With the audio key on, each letter blips in that character's own voice.
 * Hidden from a screen reader: the chat itself is where the line is read.
 */
function CompanionSpeech({ ownerId, name, look }: { ownerId: string; name: string; look: Look }) {
  const reduced = useReducedMotion();
  const [said, setSaid] = useState<{ turn: number; text: string } | null>(null);
  const turns = useRef(0);
  useEffect(
    () =>
      onCompanionSpoke((who, words) => {
        if (who !== ownerId || words === undefined || words.trim().length === 0) return;
        turns.current += 1;
        setSaid({ turn: turns.current, text: words });
      }),
    [ownerId],
  );
  // Nothing is drawn until the browser has said whether it may move: a bubble shown whole for a moment and then typed
  // would sound a stray blip.
  if (said === null || reduced === null) return null;
  const size = sizeOf(look);
  return (
    <SpeechBubble
      key={said.turn}
      line={{ id: `chat:${ownerId}:${said.turn}`, speakerId: ownerId, text: said.text, target: { kind: 'none' } }}
      name={name}
      at={{ x: 0, w: size.w, h: size.h }}
      within={0}
      free
      whole={reduced}
      wholeForMs={SPEECH_PACE.pageMs + said.text.length * SPEECH_PACE.letterMs}
      onDone={() => setSaid(null)}
      onOpenHere={() => undefined}
      onLetter={(letter) => blip(voiceFor(ownerId, look === null ? null : look.sheet.floor), letter)}
    />
  );
}

/** How long a companion holds up a picture its owner sent. */
const HELD_MS = 8000;
/**
 * The held picture's frame, on the top layer: a companion in a room stands on the room window's top edge, with only a sliver
 * of screen above it, and its own layer is under every window, so the picture is drawn over them, following its companion.
 */
const HELD_FRAME = 'pointer-events-none fixed left-0 top-0 z-popout border border-ink bg-paper p-0.5';
const HELD_PICTURE = 'block max-h-24 max-w-32 object-contain';
/** Kept this far inside the screen's edges. */
const HELD_MARGIN = 4;

/**
 * A picture its owner just sent in a stream room's chat, held up over its head for a few seconds instead of the address
 * being said in a bubble (ROOMSYNC, Luke 2026-11-16: "when a user sends a gif or image, have the companion raise it rather
 * than sending the text of the url"). The words come with `companionHolds`, from the chat line this browser already has.
 *
 * A GIPHY, Commons or site picture is drawn at once, hotlinked with no referrer. An outside picture follows this viewer's
 * OUTSIDE PICTURES choice, as it does in the chat and the queue (`outside-pictures.ts`): ASK holds up only a card naming
 * its host (nothing is loaded; the chat line has SHOW), NEVER holds up nothing, and one this viewer may see is loaded once
 * here, measured, and the very element that was measured is the one held up. Nothing is stored or sent. Hidden from a
 * screen reader: the chat is where the line is read. It only goes where its companion goes, so reduced motion changes
 * nothing here.
 */
function CompanionHeldPicture({ ownerId, figure, head }: { ownerId: string; figure: RefObject<HTMLDivElement | null>; /** Its head's height from the box's foot, when known. */ head: number | undefined }) {
  const viewerId = useAuth().user?.id ?? null;
  const choice = useSyncExternalStore(subscribeToOutsidePictures, outsidePicturesState, outsidePicturesServerState);
  const [held, setHeld] = useState<{ turn: number; picture: HeldPicture; roomId: string | null } | null>(null);
  const turns = useRef(0);
  useEffect(
    () =>
      onCompanionHolds((who, picture) => {
        if (who !== ownerId) return;
        turns.current += 1;
        const shown = watchWindowState();
        setHeld({ turn: turns.current, picture, roomId: shown.focus?.kind === 'room' ? shown.focus.roomId : null });
      }),
    [ownerId],
  );
  // A line of words from the same person takes the picture's place.
  useEffect(
    () =>
      onCompanionSpoke((who, words) => {
        if (who === ownerId && words !== undefined && words.trim().length > 0) setHeld(null);
      }),
    [ownerId],
  );
  useEffect(() => {
    if (held === null) return;
    const timer = setTimeout(() => setHeld(null), HELD_MS);
    return () => clearTimeout(timer);
  }, [held]);

  if (held === null) return null;
  const { url, outside } = held.picture;
  if (!outside) {
    return (
      <HeldBox figure={figure} head={head} ownerId={ownerId} state="shown">
        {/* eslint-disable-next-line @next/next/no-img-element -- hotlinked from where it lives, never through the site's server */}
        <img key={held.turn} src={url} alt="" referrerPolicy="no-referrer" decoding="async" onError={() => setHeld(null)} className={HELD_PICTURE} />
      </HeldBox>
    );
  }
  if (outsideAddressRefusal(url) !== null) return null;
  const answer = outsideAnswer(choice, { mine: ownerId === viewerId || addedHere(choice, url), roomId: held.roomId, guest: viewerId === null });
  if (answer === 'never') return null;
  if (answer === 'ask') {
    return (
      <HeldBox figure={figure} head={head} ownerId={ownerId} state="covered">
        <span className="block whitespace-nowrap px-1 font-mono text-label text-ink">{`PICTURE · ${pictureHost(url).toUpperCase()}`}</span>
      </HeldBox>
    );
  }
  return <HeldOutsidePicture key={held.turn} url={url} figure={figure} head={head} ownerId={ownerId} />;
}

/** An outside picture this viewer may see, loaded once, measured, and held up as that same element (never fetched twice). */
function HeldOutsidePicture({ url, figure, head, ownerId }: { url: string; figure: RefObject<HTMLDivElement | null>; head: number | undefined; ownerId: string }) {
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  useEffect(() => {
    let current = true;
    void loadPicture(url).then((drawn) => {
      if (!current || drawn === null || dimensionsRefusal(drawn.width, drawn.height) !== null) return;
      drawn.image.alt = '';
      drawn.image.className = HELD_PICTURE;
      setImage(drawn.image);
    });
    return () => {
      current = false;
    };
  }, [url]);
  const mount = useCallback(
    (box: HTMLSpanElement | null) => {
      if (box !== null && image !== null) box.replaceChildren(image);
    },
    [image],
  );
  if (image === null) return null;
  return (
    <HeldBox figure={figure} head={head} ownerId={ownerId} state="outside">
      <span ref={mount} className="block" />
    </HeldBox>
  );
}

/**
 * The frame a held picture is in: on the top layer, kept over its companion's head (inside the screen). It follows on the
 * companion's own ten-a-second clock, the steps its companion walks in.
 */
function HeldBox({ figure, head, ownerId, state, children }: { figure: RefObject<HTMLDivElement | null>; head: number | undefined; ownerId: string; state: string; children: ReactNode }) {
  const box = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const follow = () => {
      const held = box.current;
      const body = figure.current;
      if (held !== null && body !== null) {
        const at = body.getBoundingClientRect();
        held.style.visibility = at.width > 0 && getComputedStyle(body).visibility !== 'hidden' ? 'visible' : 'hidden';
        const headTop = at.bottom - (head ?? at.height);
        const w = held.offsetWidth;
        const h = held.offsetHeight;
        const keepIn = (x: number) => Math.min(window.innerWidth - w - HELD_MARGIN, Math.max(HELD_MARGIN, x));
        let x = keepIn(at.left + at.width / 2 - w / 2);
        let y = headTop - h - HELD_MARGIN;
        // No room over its head (a room window's top edge is near the top of the screen): held out at its side instead,
        // on whichever side has the room, so it never covers its own companion.
        if (y < HELD_MARGIN) {
          y = HELD_MARGIN;
          x = at.right + HELD_MARGIN + w <= window.innerWidth - HELD_MARGIN ? at.right + HELD_MARGIN : keepIn(at.left - HELD_MARGIN - w);
        }
        held.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
      }
    };
    follow();
    const steps = setInterval(follow, TICK_MS);
    return () => clearInterval(steps);
  }, [figure, head]);
  return createPortal(
    <span ref={box} aria-hidden="true" className={`${HELD_FRAME} invisible`} data-companion-held={state} data-companion-held-of={ownerId}>
      {children}
    </span>,
    document.body,
  );
}

/** One figure on the strip: the character (or the placeholder field), its name on hover, and the `!` over its head. */
function Figure({ placeRef, bodyRef, markRef, label, own, ownerId, look }: FigureProps) {
  const size = sizeOf(look);
  const rows = look === null ? 0 : Math.ceil(look.sheet.cells / look.sheet.columns);
  // The `!` sits just over the head (`sheet.head`), not over the box's empty top.
  const markBottom = look === null ? undefined : size.h - look.sheet.head * SCALE + 2;
  // A stream room's window leaves this much room above itself for the companions being drawn (`../lib/companion/ledge.ts`).
  useEffect(() => holdLedgeHeight(size.h), [size.h]);
  return (
    <div
      ref={placeRef}
      role="img"
      aria-label={own ? 'Your companion' : `${label}'s companion`}
      // Yours can be picked up: a grabbing hand over it, and a touch drags it rather than scrolling the page.
      className={`group pointer-events-auto invisible absolute left-0 top-0 overflow-visible ${own ? 'cursor-grab touch-none select-none' : ''}`}
      style={{ width: size.w, height: size.h }}
      data-companion={own ? 'own' : 'room'}
      data-companion-of={ownerId ?? undefined}
      data-mood="stand"
      data-facing="right"
      data-held="false"
    >
      {/* Its owner's name, over its head on hover (not while it is being carried): absolutely placed, so it moves nothing. */}
      <span
        className="invisible absolute bottom-full left-0 mb-1 whitespace-nowrap border border-ink bg-ink px-1 font-mono text-label text-paper group-hover:group-data-[held=false]:visible group-data-[tag=under]:bottom-auto group-data-[tag=under]:top-full group-data-[tag=under]:mt-1 group-data-[tag=under]:mb-0"
        data-companion-name
      >
        {label}
      </span>
      {/* Colourful music notes while it dances (Luke, 2026-11-13) and little `z`s while it sleeps (2026-11-14), from
          about where its sunk head is: text, not art, and none under reduced motion. */}
      <NoteTrail watch={placeRef} sleepAt={look === null ? size.h : Math.round((size.h - look.sheet.head * SCALE) * 0.6)} />
      {/* What its owner has just said in a stream room's chat, when the chat hands the words over. */}
      {ownerId === null ? null : <CompanionSpeech ownerId={ownerId} name={label} look={look} />}
      {/* A picture its owner has just sent in a stream room's chat, held up over its head (ROOMSYNC). */}
      {ownerId === null ? null : <CompanionHeldPicture ownerId={ownerId} figure={placeRef} head={look === null ? undefined : look.sheet.head * SCALE} />}
      {/* The `!`: text, not art (SPEC-companion.md, decision 3). */}
      <span
        ref={markRef}
        className={`invisible absolute right-0 border border-ink bg-sun-pale px-1 font-mono text-label leading-none text-ink ${look === null ? 'bottom-full mb-1' : ''}`}
        style={markBottom === undefined ? undefined : { bottom: markBottom }}
        data-companion-mark
      >
        !
      </span>
      {/* Typing along (Luke, 2026-11-14): `...` over its head for as long as it plays `type`. Text, not art. */}
      <span
        className={`invisible absolute right-0 border border-ink bg-sun-pale px-1 font-mono text-label leading-none text-ink group-data-[motion=type]:visible ${look === null ? 'bottom-full mb-1' : ''}`}
        style={markBottom === undefined ? undefined : { bottom: markBottom }}
        data-companion-typing
      >
        ...
      </span>
      {/* The book it reads along from: Luke's to draw (an art slot), an empty dithered field on its lap until it is filed.
          There only while it plays `read` or turns a page, on the side it faces. */}
      <span
        aria-hidden="true"
        className="absolute bottom-1 hidden group-data-[motion=flick]:block group-data-[motion=read]:block group-data-[facing=left]:left-1 group-data-[facing=left]:-scale-x-100 group-data-[facing=right]:right-1"
        data-companion-book
      >
        <SpriteSlot src="/assets/sprites/companion-book.gif" alt="" width={BOOK_SIZE} height={BOOK_SIZE} title="Its book appears here once assets/sprites/companion-book.gif is drawn" />
      </span>
      {look === null ? (
        // No SHOWN character: the placeholder field.
        <span ref={bodyRef} className={`${SPRITE_SLOT} block h-full w-full`} data-companion-figure="placeholder" />
      ) : (
        <>
          {/* The smear behind it when it is thrown fast (Luke, 2026-11-14: "smearing"): two fainter copies of the very
              frame it is showing, placed back along its path by the loop. Its own baked frame again, nothing drawn; hidden
              the rest of the time. Yours only: a room sees where a throw ended, not the throw. */}
          {own
            ? (['opacity-50', 'opacity-25'] as const).map((faint) => (
                <span
                  key={faint}
                  aria-hidden="true"
                  className={`pointer-events-none invisible absolute inset-0 -z-10 block ${faint}`}
                  style={{
                    backgroundImage: `url("${look.stripUrl}")`,
                    backgroundRepeat: 'no-repeat',
                    backgroundSize: `${look.sheet.columns * look.sheet.cell.w * SCALE}px ${rows * look.sheet.cell.h * SCALE}px`,
                    imageRendering: 'pixelated',
                  }}
                  data-companion-smear
                />
              ))
            : null}
          {/* A cell of the owner's baked strip, whole pixels, no smoothing; the loop moves the window onto each cell. */}
          <span
            ref={bodyRef}
            className="block h-full w-full overflow-hidden"
            style={{
              backgroundImage: `url("${look.stripUrl}")`,
              backgroundRepeat: 'no-repeat',
              backgroundSize: `${look.sheet.columns * look.sheet.cell.w * SCALE}px ${rows * look.sheet.cell.h * SCALE}px`,
              imageRendering: 'pixelated',
            }}
            data-companion-figure="character"
          />
        </>
      )}
    </div>
  );
}

/** A share of the strip's width, rounded so a pixel's wobble is not a new message. */
function share(x: number, floor: Floor, size: Size): number {
  return Math.round(Math.min(1, Math.max(0, (x - floor.left) / floorRoom(floor, size))) * 1000) / 1000;
}

/**
 * How many reactions this tab's companion has had, kept outside the figure's loop: a viewer hops when it sees a bigger
 * number than last time, so the count must never go back down when the loop restarts (the switch, reduced motion).
 */
let reactions = 0;
let reactionKind: CompanionWire['k'] = null;

/** How long a one-off motion plays, in ticks: the strip's own, or the placeholder's hop. */
const actLength = (look: Look, motion: MotionId): number => (look === null ? HOP.length : look.sheet.motions[motion].ticks.length);

/** A one-off motion being played through once: which, and how far in. */
type Act = { motion: MotionId; tick: number };

type OwnProps = {
  label: string;
  /** Whose it is: it hops when this account speaks in a room's chat. */
  userId: string | null;
  /** The other companions in the room just now, as their keys joined up: it waves at a new one. */
  roomKeys: string;
  musicPlaying: boolean;
  track: string | null;
  still: boolean;
  look: Look;
  lookRef: string | null;
};

function OwnCompanion({ label, userId, roomKeys, musicPlaying, track, still, look, lookRef }: OwnProps) {
  const placeRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLSpanElement>(null);
  const markRef = useRef<HTMLSpanElement>(null);
  const portalRef = useRef<HTMLDivElement>(null);
  const music = useRef({ playing: musicPlaying, track });
  const wearing = useRef<{ look: Look; ref: string | null }>({ look, ref: lookRef });
  useEffect(() => {
    music.current = { playing: musicPlaying, track };
  }, [musicPlaying, track]);
  const company = useRef({ userId, keys: roomKeys });
  useEffect(() => {
    company.current = { userId, keys: roomKeys };
  }, [userId, roomKeys]);
  useEffect(() => {
    wearing.current = { look, ref: lookRef };
  }, [look, lookRef]);

  useEffect(() => {
    const place = placeRef.current;
    const mark = markRef.current;
    const portal = portalRef.current;
    const now = Date.now();
    let brain: BrainState = startBrain(now);
    let lastActivity = now;
    let pointer: { x: number; y: number; at: number } | null = null;
    let x: number | null = null;
    let facing: 1 | -1 = 1;
    let frame = 0;
    /** The one-off it is playing through (a hop, a stretch, a cheer), and any waiting their turn after it. */
    let act: Act | null = null;
    const queue: MotionId[] = [];
    let dance = pickDance();
    let danceUntil = 0;
    /** The track its dance was picked for; undefined before its first dance. */
    let dancedTrack: string | null | undefined;
    let motion: MotionId = 'idle';
    let motionTick = 0;
    /** The loop it is in, and that loop as the room hears it (`CompanionWire.p`: not every pose is the room's business). */
    let looping: MotionId = 'idle';
    let posing: MotionId | null = null;
    let pokes = 0;
    /** How far into its start at being lifted it is; -1 once it hangs. */
    let lifting = -1;
    /** When it was last pressed without a drag: a second press soon after picks it up. */
    let lastTap = 0;
    let wasOnLedge = false;
    /** The room's companions it has waved at, and when it last waved (a busy door is not a flapping arm). */
    const greeted = new Set<string>();
    let greetedKeys = '';
    let lastGreet = 0;
    /** It types along until then: a moment after the last key typed into a text box. */
    let typingUntil = 0;
    /** A press on it, and the fall after it is let go. */
    let grab: Grab | null = null;
    let fall: Fall | null = null;
    /** Thrown: where it is in the throw, and after it the last of its settling (how tall it is drawn, a frame each). */
    let thrown: Thrown | null = null;
    let settle: number[] = [];
    /** The empty margin round its picture, looked at the first time it is picked up (a splat needs it). */
    let insets: Insets = NO_INSETS;
    let measured = false;
    let markTimer: ReturnType<typeof setTimeout> | null = null;
    /** The windows as they were last frame, and those that have just hit it (`../lib/companion/shove.ts`). Null until first seen. */
    let windowsSeen: Map<string, FloorBox> | null = null;
    let windowsCooling = new Map<string, number>();
    let lastSaid: { mood: CompanionMood; target: number | null; ref: string | null; pose: MotionId | null; share: number; at: number } | null = null;
    // Visiting a profile's room.
    let phase: Phase = 'strip';
    /** Its feet while it climbs, from the top of the screen. */
    let y = 0;
    /** The room it is climbing into, or is in. */
    let visiting: VisitRoom | null = null;
    let path = window.location.pathname;
    /** The page it started climbing down on: another page before it is down, and it vanishes. */
    let downFrom = path;
    let goneUntil = 0;
    let stepOutAt = 0;
    let portalUntil = 0;
    /**
     * Its floor last frame. Climbing in, never floating (Luke, 2026-11-16): a floor that rises under it (a stream room's
     * window opening, the music bar unfolding) is climbed up to from behind its edge; one that drops away is fallen from.
     */
    let lastFloorY: number | null = null;
    /**
     * In the air it is drawn between its frames too (Luke, 2026-11-16: "better framerate and visual tracking"): from this
     * frame's place toward the next frame's, worked out by the same rules a frame early (`glideAt`), every display frame.
     * Its picture (which cell, the squash, the stretch) still changes ten times a second; only where it is glides.
     */
    let glide: { from: { x: number; y: number }; to: { x: number; y: number }; at: number; h: number } | null = null;
    let glideFrame = 0;
    const glideLoop = () => {
      glideFrame = 0;
      if (place === null || glide === null || (phase !== 'thrown' && phase !== 'fall')) {
        glide = null;
        return;
      }
      const at = glideAt(glide.from, glide.to, (performance.now() - glide.at) / TICK_MS);
      place.style.transform = `translate3d(${at.x}px, ${at.y - glide.h}px, 0)`;
      glideFrame = requestAnimationFrame(glideLoop);
    };
    const glideToward = (from: { x: number; y: number }, to: { x: number; y: number }, h: number) => {
      glide = { from, to, at: performance.now(), h };
      if (glideFrame === 0) glideFrame = requestAnimationFrame(glideLoop);
    };
    /** One frame of its fall after a let-go: down onto the nearest stretch it can stand on, sliding off what it steps around. */
    const fallNext = (from: Fall, floor: Floor, size: Size): Fall => {
      const next = fallStep(from, floor.y, floor.screen - size.w);
      const under = spanFor(floor.spans, next.x);
      // Over something it steps around (the folded player, a floating video): it slides off to the side as it falls.
      const slid = under === null ? next.x : Math.min(under.right, Math.max(under.left, next.x));
      return { ...next, x: next.landed ? slid : next.x + Math.sign(slid - next.x) * Math.min(16, Math.abs(slid - next.x)) };
    };

    const leaveRoom = () => {
      visiting = null;
      setCompanionInRoom(false);
    };
    const vanish = () => {
      phase = 'gone';
      goneUntil = Date.now() + PORTAL_AFTER_MS;
      leaveRoom();
      hide(place);
    };

    const say = (floor: Floor, size: Size, force: boolean) => {
      const target = brain.target ?? x ?? 0;
      const ref = wearing.current.ref;
      // Where along its floor, as the room hears it. Standing or sitting it has no target, and this only changes when it
      // is put somewhere else (carried, or its floor changed under it: up onto a room's window), which the room is told once.
      const at = share(target, floor, size);
      const changed =
        lastSaid === null || lastSaid.mood !== brain.mood || lastSaid.target !== brain.target || lastSaid.ref !== ref || lastSaid.pose !== posing || lastSaid.share !== at;
      if (!changed && !force) return;
      if (!force && brain.mood === 'chase' && lastSaid?.mood === 'chase' && lastSaid.ref === ref && Date.now() - lastSaid.at < CHASE_SAY_MS) return;
      lastSaid = { mood: brain.mood, target: brain.target, ref, pose: posing, share: at, at: Date.now() };
      sayCompanion({ x: at, m: brain.mood, r: reactions, k: reactionKind, c: ref, p: posing });
    };

    /** The next frame of a loop: on from where it was, or from its start when it is a new one. */
    const play = (next: MotionId) => {
      motionTick = next === motion ? motionTick + 1 : 0;
      motion = next;
    };

    const tick = () => {
      const look = wearing.current.look;
      const size = sizeOf(look);
      const floor = floorNow(size);
      const floorWas = lastFloorY;
      lastFloorY = floor.y;
      const now = Date.now();
      const room = visitRoomState();
      const pathNow = window.location.pathname;
      const pageChanged = pathNow !== path;
      path = pathNow;
      if (portalUntil !== 0 && now >= portalUntil) {
        portalUntil = 0;
        closePortal(portal);
      }

      // Shoved by a window (Luke, 2026-11-16): one that pops up on it, is dragged into it, or is brought down onto its head
      // throws it (../lib/companion/shove.ts). On its strip, falling, or already in the air; not in the hand, nor on its way
      // to or from a profile's room. The windows are looked at every frame, so the first frame after one moves is the hit;
      // the first look of all only learns where they are (a window open as the page loads has not just popped up on it).
      {
        const windows = still ? [] : measureWindows(floor.ledge);
        if (windowsSeen === null) windowsSeen = new Map(windows.map((seen) => [seen.id, seen.box]));
        else {
          const feet = phase === 'strip' ? floor.y : y;
          const left = x ?? 0;
          const body = { left, right: left + size.w, top: feet - size.h, bottom: feet };
          const looked = shoveStep(windows, windowsSeen, windowsCooling, body, [Math.random(), Math.random()]);
          windowsSeen = looked.seen;
          windowsCooling = looked.cooling;
          if (looked.shove !== null && x !== null && (phase === 'strip' || phase === 'fall' || phase === 'thrown')) {
            thrown = shoveThrow(x, feet, looked.shove, phase === 'thrown' ? thrown : null);
            phase = 'thrown';
            fall = null;
            act = null;
            queue.length = 0;
            settle = [];
            if (Math.abs(thrown.vx) >= 2) facing = thrown.vx > 0 ? 1 : -1;
            const worn = wearing.current.look;
            if (!measured && worn !== null) {
              measured = true;
              void measureInsets(worn, 'splat').then((found) => {
                insets = found;
              });
            }
            markTimer = showMark(mark, markTimer, '!');
          }
        }
      }

      // In the reader's hand: it hangs where the pointer has it, swinging, never off the screen or under its own floor.
      if (phase === 'held' && grab !== null) {
        const at = hangAt(floor, size, grab);
        x = at.x;
        y = at.y;
        // Just lifted: a start and a wriggle (`lifted`), once, and then it hangs.
        if (lifting >= 0 && lifting < actLength(look, 'lifted')) {
          motion = 'lifted';
          motionTick = lifting;
          lifting += 1;
        } else {
          lifting = -1;
          play('dangle');
        }
        // Leaning back against the drag while the pointer moves (`dragLook`); itself again once the pointer rests.
        const pull = releaseVelocity(grab.trail, performance.now());
        draw(place, bodyRef.current, look, { x, floorY: y, facing, mood: 'stand', motion, tick: motionTick, lift: 0, held: true, fx: dragLook(pull.vx, pull.vy) });
        return;
      }
      // Thrown: it keeps the speed it was let go at (`../lib/companion/throw.ts`). A beat of wind-up, then through the air
      // drawn out along its path; flat against an edge of the screen it hits hard; bouncing, squashed, on its floor.
      if (phase === 'thrown' && thrown !== null) {
        const box: ThrowBox = { ...size, ...insets };
        // Its picture, not the empty edge of its box, is what meets the sides and the top of the screen.
        const arena = { left: -insets.left, right: floor.screen - size.w + insets.right, ceiling: size.h - insets.top, floor: floor.y, spans: floor.spans };
        thrown = throwStep(thrown, arena);
        x = thrown.x;
        y = thrown.y;
        if (Math.abs(thrown.vx) >= 2) facing = thrown.vx > 0 ? 1 : -1;
        if (thrown.stage !== 'landed') {
          // Between this frame and the next it glides toward where the rules will have it then.
          const ahead = throwStep(thrown, arena);
          glideToward({ x: thrown.x, y: thrown.y }, { x: ahead.x, y: ahead.y }, size.h);
          // Winding up it still hangs as it did in the hand; in the air it is flung; on the glass it is a splat.
          play(thrown.stage === 'wind' ? 'dangle' : thrown.stage === 'stuck' || thrown.stage === 'peel' ? 'splat' : 'flung');
          draw(place, bodyRef.current, look, { x, floorY: y, facing, mood: 'stand', motion, tick: motionTick, lift: 0, held: true, fx: throwLook(thrown, box), thrown: thrown.stage });
          return;
        }
        // Down: squashed by the landing, springing back over the next frames (`settle`), and after a splat seeing stars,
        // shaking it off, and a hop to get going again. The room is told now, once, where it ended up.
        const dizzy = thrown.splatted;
        settle = settleFrames(thrown.impact);
        thrown = null;
        phase = 'strip';
        if (place !== null) place.style.cursor = '';
        brain = startBrain(now);
        lastActivity = now;
        react(dizzy ? 'dizzy' : 'land');
        if (dizzy) queue.push('hop');
      }
      // Let go: down it comes, onto the nearest stretch of its strip it can stand on, and lands.
      // Let go below its floor (carried down the front of a stream room's window it stands on top of): it climbs back up
      // to it from where it is, never floats (Luke, 2026-11-16).
      if ((phase === 'held' || phase === 'fall') && !still && (fall?.y ?? y) > floor.y + 1) {
        y = fall?.y ?? y;
        x = fall?.x ?? x;
        fall = null;
        phase = 'mount';
      }
      if (phase === 'held' || phase === 'fall') {
        const from: Fall = fall ?? { x: x ?? 0, y, vx: 0, vy: 0, landed: false };
        const next = fallNext(from, floor, size);
        x = next.x;
        y = next.y;
        fall = next;
        if (!next.landed) {
          phase = 'fall';
          play('dangle');
          const ahead = fallNext(next, floor, size);
          glideToward({ x, y }, { x: ahead.x, y: ahead.y }, size.h);
          draw(place, bodyRef.current, look, { x, floorY: y, facing, mood: 'stand', motion, tick: motionTick, lift: 0, held: true });
          return;
        }
        fall = null;
        phase = 'strip';
        if (place !== null) place.style.cursor = '';
        brain = startBrain(now);
        lastActivity = now;
        react('land');
      }

      if (still) {
        // Reduced motion: nothing climbs. It is in a profile's room while there is one, and back on its strip when it goes.
        if (room !== null) {
          if (visiting !== room) {
            visiting = room;
            phase = 'room';
            noteRoomSpot(null);
            setCompanionInRoom(true, Math.max(0, room.stage.clientWidth - size.w - 16));
          }
          hide(place);
          return;
        }
        if (phase === 'room') {
          phase = 'strip';
          leaveRoom();
        }
      } else {
        // In a profile's room, the room draws it. When the room goes (the page changed) it climbs down from where it stood,
        // or vanishes when that spot was off screen.
        if (phase === 'room') {
          if (room !== null && room === visiting) {
            hide(place);
            return;
          }
          const spot = roomSpot();
          phase = whenRoomGoes('room', spot !== null && spot.onScreen && spot.bottom <= floor.y);
          leaveRoom();
          if (phase === 'down' && spot !== null) {
            x = spot.left;
            y = spot.bottom;
            downFrom = pathNow;
          } else {
            vanish();
            return;
          }
        }
        // The room went (or the page changed) while it was still climbing up; another page while it climbs down.
        if (phase === 'up' && (room === null || room !== visiting || pageChanged)) {
          vanish();
          return;
        }
        if (phase === 'down' && pathNow !== downFrom) {
          vanish();
          return;
        }
        if (phase === 'gone') {
          if (now < goneUntil) {
            hide(place);
            return;
          }
          // Back on its strip, out of a portal.
          const back = spanFor(floor.spans, x ?? floor.screen - size.w - 48);
          if (back === null) {
            hide(place);
            return;
          }
          x = Math.min(back.right, Math.max(back.left, x ?? back.right));
          openPortal(portal, x + size.w / 2, floor.y);
          portalUntil = now + PORTAL_OPEN_MS;
          stepOutAt = now + PORTAL_STEP_OUT_MS;
          phase = 'portal';
        }
        if (phase === 'portal') {
          if (now < stepOutAt) {
            hide(place);
            return;
          }
          phase = 'strip';
          brain = startBrain(now);
          act = { motion: 'hop', tick: 0 };
        }
        // Climbing, a step a frame with its own climbing frames: up into the room (walking along its strip to under it
        // first), or back down to its strip.
        if (phase === 'up' && visiting !== null) {
          const into = roomFloor(boxOf(visiting.stage), clipOf(visiting.stage), size, floor.y);
          if (into === null) {
            // Scrolled away above it: back down.
            visiting = null;
            phase = 'down';
            downFrom = pathNow;
          } else {
            const from = x ?? into.left;
            const column = Math.min(into.right, Math.max(into.left, from));
            const strip = spanFor(floor.spans, column);
            const below = strip === null ? column : Math.min(strip.right, Math.max(strip.left, column));
            if (y >= floor.y && Math.abs(below - from) >= 1) {
              facing = below > from ? 1 : -1;
              x = from + Math.sign(below - from) * Math.min(WALK_STEP, Math.abs(below - from));
            } else {
              if (Math.abs(column - from) >= 1) {
                facing = column > from ? 1 : -1;
                x = from + Math.sign(column - from) * Math.min(WALK_STEP, Math.abs(column - from));
              } else x = from;
              y = climbToward(y, into.floor);
            }
            if (y === into.floor && Math.abs(column - (x ?? column)) < 1) {
              phase = 'room';
              noteRoomSpot(null);
              setCompanionInRoom(true, (x ?? column) - boxOf(visiting.stage).left);
              hide(place);
              return;
            }
          }
        }
        if (phase === 'down') y = climbToward(y, floor.y);
        if (phase === 'up' || phase === 'down') {
          // Off its strip it climbs, its back to you, reaching up (Luke, 2026-11-14); along the strip to under the room it walks.
          play(y < floor.y ? 'climb' : 'walk');
          draw(place, bodyRef.current, look, { x: x ?? 0, floorY: y, facing, mood: 'walk', motion, tick: motionTick, lift: 0 });
          if (phase === 'down' && y >= floor.y) phase = 'strip';
          return;
        }
      }

      const span: Span | null = spanFor(floor.spans, x ?? floor.screen - size.w - 48);
      if (span === null) {
        hide(place);
        return;
      }
      const first = x === null;
      if (x === null) x = span.right;
      // Up onto a room's window: somewhere along its edge, so a room's companions do not all land on one corner.
      if (floor.ledge && !wasOnLedge) x = Math.round(span.left + Math.random() * (span.right - span.left));
      wasOnLedge = floor.ledge;
      if (x < span.left || x > span.right) x = Math.min(span.right, Math.max(span.left, x));

      // Climbing in, never floating (Luke, 2026-11-16). Its first frame on a page, it climbs up over the edge of its floor
      // from behind it (the music bar, or the foot of the window). A floor that rises under it (a stream room's window
      // opening over the strip, the bar unfolding) is climbed up to from just behind its edge, and one that drops away (the
      // window folded or closed) is fallen from. Under reduced motion it is simply there.
      if (!still && (phase === 'strip' || phase === 'mount')) {
        if (first) {
          y = floor.y + size.h;
          phase = 'mount';
        } else if (phase === 'strip' && floorWas !== null && floor.y < floorWas - 4) {
          y = Math.min(floorWas, floor.y + size.h);
          phase = 'mount';
        } else if (phase === 'strip' && floorWas !== null && floor.y > floorWas + 4) {
          fall = { x, y: floorWas, vx: 0, vy: 0, landed: false };
          y = floorWas;
          phase = 'fall';
          play('dangle');
          draw(place, bodyRef.current, look, { x, floorY: y, facing, mood: 'stand', motion, tick: motionTick, lift: 0, held: true });
          return;
        }
        if (phase === 'mount') {
          // Its back to you, reaching up a step a frame on its climbing frames, as into a profile's room.
          y = climbToward(y, floor.y);
          play('climb');
          draw(place, bodyRef.current, look, { x, floorY: y, facing, mood: 'walk', motion, tick: motionTick, lift: 0 });
          if (y === floor.y) {
            phase = 'strip';
            brain = startBrain(now);
          }
          return;
        }
      }

      // A profile's room on screen: up it goes.
      // (Not from on top of a stream room's window: there is no way down from there but the window going.)
      if (!still && phase === 'strip' && !floor.ledge && room !== null && roomFloor(boxOf(room.stage), clipOf(room.stage), size, floor.y) !== null) {
        phase = 'up';
        visiting = room;
        y = floor.y;
      }

      if (still) {
        brain = { mood: 'stand', target: null, until: Infinity, chaseUntil: 0, pose: null, act: null, laps: 0, home: 0 };
        posing = null;
        draw(place, bodyRef.current, look, { x, floorY: floor.y, facing, mood: 'stand', motion: 'idle', tick: 0, lift: 0 });
        if (Math.floor(now / TICK_MS) % 5 === 0) yieldToKeys(place);
        say(floor, size, false);
        return;
      }

      // The pointer near its strip is chased while it is moving about there. Left resting (or gone into a book's or a
      // video's own frame, whose moves are not heard out here), it is let be after a while: it wanders off, or sits to read.
      // (On top of a room's window "near" is a band about that edge: the whole window is below it, and is not near.)
      const close = pointer !== null && pointer.y >= floor.y - NEAR_PX && (!floor.ledge || pointer.y <= floor.y + NEAR_PX / 2);
      const near = pointer !== null && close && now - pointer.at < CHASE_FRESH_MS ? pointer.x - size.w / 2 : null;
      const was = brain;
      // What you are doing that it can join in with: typing (it hears the keys itself), a game, a book, a video
      // (`../lib/companion/scene.ts`; a video in the floating player counts as one being watched).
      const scene: BrainScene | null = now < typingUntil ? 'type' : (companionScene() ?? (floatingState().entry !== null ? 'watch' : null));
      brain = think(brain, {
        now,
        lastActivity,
        musicPlaying: music.current.playing,
        pointerX: near,
        x,
        span,
        random: Math.random,
        hour: new Date(now).getHours(),
        scene,
      });
      if (was.mood === 'sleep' && brain.mood !== 'sleep') {
        // Awake: a stretch, and after a long sleep a wave for whoever came back.
        react('wake');
        if (was.pose === 'curl') queue.push('wave');
      }
      // Bored: the brain asks for a stretch or a spin, once.
      if (brain.act !== null && act === null) act = { motion: brain.act, tick: 0 };
      // Somebody's companion new to the room (or you new to theirs): a wave, which they see, and theirs waves too.
      const keys = company.current.keys;
      if (keys !== greetedKeys) {
        const present = new Set(keys.split(',').filter((key) => key.length > 0));
        // One that has gone is forgotten, so it gets a wave when it comes back.
        for (const key of greeted) if (!present.has(key)) greeted.delete(key);
        const fresh = [...present].filter((key) => !greeted.has(key));
        if (fresh.length === 0) greetedKeys = keys;
        else if (now - lastGreet >= GREET_QUIET_MS) {
          for (const key of fresh) greeted.add(key);
          greetedKeys = keys;
          lastGreet = now;
          react('wave');
        }
        // (Too soon after its last wave: looked at again next frame, so nobody arriving in that quiet goes unwaved at.)
      }
      // A dance changes with the track, and after a while of the same one: always to a different dance, even when the
      // music stopped for a moment between two tracks. The same track paused and played again keeps its dance.
      const trackNow = music.current.track;
      if (brain.mood === 'dance' && (trackNow !== dancedTrack || now >= danceUntil)) {
        dance = pickDance(dance);
        dancedTrack = trackNow;
        danceUntil = now + DANCE_MS[0] + Math.random() * (DANCE_MS[1] - DANCE_MS[0]);
      }

      if (act === null && queue.length > 0) act = { motion: queue.shift() ?? 'hop', tick: 0 };
      // A hop goes on walking; anything longer (a stretch, a cheer) is done standing where it is.
      const held = act !== null && act.motion !== 'hop';
      if (!held && brain.target !== null && (brain.mood === 'walk' || brain.mood === 'chase')) {
        const step = brain.mood === 'chase' || brain.pose === 'run' ? CHASE_STEP : WALK_STEP;
        const gap = brain.target - x;
        if (Math.abs(gap) >= 1) {
          facing = gap > 0 ? 1 : -1;
          x += Math.sign(gap) * Math.min(step, Math.abs(gap));
        }
      }
      const walking = brain.target !== null && Math.abs(brain.target - x) >= 1;

      frame += 1;
      let lift = 0;
      const loop = onLedge(loopMotion(brain.mood === 'walk' && !walking ? 'stand' : brain.mood, brain.pose, dance), floor);
      looping = loop;
      posing = COMPANION_POSES.includes(loop) ? loop : null;
      // Watching, it sits facing what it watches.
      if (loop === 'watch') facing = facingFocus(x, size, facing);
      if (act !== null) {
        motion = act.motion;
        motionTick = act.tick;
        if (look === null) lift = HOP[act.tick] ?? 0;
        // Dizzy: the star over its head goes round, for as long as its mark is up.
        if (act.motion === 'dizzy' && mark !== null && mark.style.visibility === 'visible') mark.textContent = DIZZY_MARKS[act.tick % DIZZY_MARKS.length];
        act = act.tick + 1 < actLength(look, act.motion) ? { motion: act.motion, tick: act.tick + 1 } : null;
      } else {
        play(loop);
        // The placeholder has no dance of its own: a stepped bob, turning every half second.
        if (look === null && brain.mood === 'dance') {
          lift = frame % 4 < 2 ? -2 : 0;
          if (frame % 5 === 0) facing = facing === 1 ? -1 : 1;
        }
      }
      // Just landed from a throw: the squash, the spring back and the dip after it, feet on the floor.
      const tall = settle.shift();
      draw(place, bodyRef.current, look, { x, floorY: floor.y, facing, mood: brain.mood, motion, tick: motionTick, lift, fx: tall === undefined ? null : squashLook('floor', tall, size) });
      if (frame % 5 === 0 && grab === null) yieldToKeys(place);
      say(floor, size, false);
    };

    const react = (kind: NonNullable<CompanionWire['k']>) => {
      // A page turned is its head flicking across the book, while it reads along. Yours to see only: the room is never
      // told when you turn a page.
      if (kind === 'flick') {
        // A page turned is you being here: a book's keys and taps are heard inside its own frame, not out on the page.
        lastActivity = Date.now();
        if (looping === 'read' && !still) act = { motion: 'flick', tick: 0 };
        return;
      }
      const text = reactionMark(kind);
      if (!still) act = { motion: reactionMotion(kind), tick: 0 };
      if (text !== null) markTimer = showMark(mark, markTimer, text);
      // A look round at a new theme, a hop as you speak in a room's chat: played here, and the room is told nothing (it
      // has the chat line itself, and works the hop out from that).
      if (reactionIsLocal(kind)) return;
      reactions += 1;
      reactionKind = kind;
      const size = sizeOf(wearing.current.look);
      say(floorNow(size), size, true);
    };

    const active = () => {
      lastActivity = Date.now();
    };
    // A key typed into a text box or a page being written: it types along for a moment after each.
    const onKey = (event: KeyboardEvent) => {
      active();
      const into = event.target instanceof Element ? event.target.closest(WRITING) : null;
      if (into !== null && (event.key.length === 1 || event.key === 'Backspace' || event.key === 'Enter') && !event.ctrlKey && !event.metaKey) typingUntil = Date.now() + TYPING_MS;
      // Carried after a double press: Escape puts it down where it hangs.
      if (event.key === 'Escape' && grab !== null && grab.carried) letGo(0);
    };
    const onMove = (event: PointerEvent) => {
      active();
      if (event.pointerType === 'touch') return;
      pointer = { x: event.clientX, y: event.clientY, at: Date.now() };
    };
    const onOut = (event: PointerEvent) => {
      // Off the page, or into a frame (a book's pages, a video): its moves in there are not heard out here, so it is
      // gone as far as the companion can tell, rather than left where it was last seen for it to chase for good.
      if (event.relatedTarget === null || event.relatedTarget instanceof HTMLIFrameElement) pointer = null;
    };
    /** Where it hangs for the pointer that has it: under it, never off the screen or under its own floor. */
    const hangAt = (floor: Floor, size: Size, held: Grab): { x: number; y: number } => ({
      x: Math.round(Math.min(Math.max(0, floor.screen - size.w), Math.max(0, held.px - held.offX))),
      // (From on top of a room's window it can be carried anywhere down the screen; let go, it is back up on the window.)
      y: Math.round(Math.min(floor.ledge ? window.innerHeight : floor.y, Math.max(size.h, held.py + held.offY))),
    });
    /** Let go of, from where it hangs: down it comes (the frame loop does the falling), with whatever throw it was given. */
    const letGo = (throwX: number) => {
      grab = null;
      fall = { x: x ?? 0, y, vx: throwX, vy: 0, landed: false };
      phase = 'fall';
    };
    /**
     * Let go on the move (Luke, 2026-11-14: "retain momentum"): thrown, at the speed the pointer had. Slower than a throw,
     * under reduced motion, or let go under its own floor, it is only put down, and drops as it always did.
     */
    const fling = (toss: { vx: number; vy: number }) => {
      const look = wearing.current.look;
      const size = sizeOf(look);
      const floor = floorNow(size);
      if (!still && y > floor.y) {
        // Let go below its floor (down the front of a stream room's window): it climbs back up to it (the frame loop).
        grab = null;
        fall = null;
        phase = 'mount';
        return;
      }
      if (still || !isThrow(toss.vx, toss.vy)) {
        letGo(throwOf(toss.vx));
        return;
      }
      grab = null;
      fall = null;
      thrown = startThrow(x ?? 0, y, toss.vx, toss.vy);
      phase = 'thrown';
      if (Math.abs(toss.vx) >= 2) facing = toss.vx > 0 ? 1 : -1;
      // The wind-up is drawn at once, not at the next frame: the pull back against the throw is what makes the let-go felt.
      // (Still hanging as it did in the hand: the frame it was showing, pressed and pulled back.)
      if (motion !== 'dangle') {
        motion = 'dangle';
        motionTick = 0;
      }
      draw(place, bodyRef.current, look, { x: thrown.x, floorY: thrown.y, facing, mood: 'stand', motion, tick: motionTick, lift: 0, held: true, fx: throwLook(thrown, { ...size, ...insets }), thrown: thrown.stage });
    };
    /** The pointer's moves while it has the figure, kept a moment: what a let-go reads its speed from. */
    const trace = (held: Grab, event: PointerEvent) => {
      const at = performance.now();
      held.trail.push({ x: event.clientX, y: event.clientY, t: at });
      while (held.trail.length > 32 || (held.trail.length > 0 && at - held.trail[0].t > SAMPLE_WINDOW_MS * 2)) held.trail.shift();
    };
    /** Lifted off its strip: whatever it was doing (a hop, a climb up to a room) is dropped, and it starts at being picked up. */
    const liftOff = () => {
      phase = 'held';
      leaveRoom();
      act = null;
      queue.length = 0;
      // Caught out of the air, or peeled off the glass by hand: the throw is over.
      thrown = null;
      fall = null;
      settle = [];
      const worn = wearing.current.look;
      if (!measured && worn !== null) {
        measured = true;
        void measureInsets(worn, 'splat').then((found) => {
          insets = found;
        });
      }
      lifting = still ? -1 : 0;
      // A `!` as it is lifted: text, not art.
      markTimer = showMark(mark, markTimer, '!');
      if (place !== null) {
        // Its own to take presses again (it may have been letting them through to a key under it), and held in the hand.
        place.style.pointerEvents = '';
        place.style.cursor = 'grabbing';
      }
    };
    const onBlur = () => {
      pointer = null;
      // The window lost the pointer mid-carry: it is let go where it hangs.
      if (grab !== null && grab.moved) letGo(0);
      grab = null;
    };
    /** A press without a drag: a hop, a wave, a spin, in turn. */
    const poke = () => {
      react(POKES[pokes % POKES.length]);
      pokes += 1;
    };
    // A press on the figure: a poke if it is let go where it was pressed, a pick-up once it is dragged. Under reduced
    // motion nothing is carried about: a press is a poke (its mark, with no hop).
    /**
     * It can be taken hold of on its strip, on its way up to or down from a room, or thrown (caught out of the air, or
     * peeled off the glass): not in a room, gone, or already held.
     */
    const canGrab = () => phase === 'strip' || phase === 'up' || phase === 'down' || phase === 'thrown' || phase === 'mount';
    /**
     * In the hand it is placed on every move of the pointer, not at the next frame (Luke, 2026-11-16: "the character stays
     * under the pointer with no visible lag"), leaning back against the drag (`dragLook`).
     */
    const followHand = () => {
      if (phase !== 'held' || grab === null || place === null) return;
      const look = wearing.current.look;
      const size = sizeOf(look);
      const at = hangAt(floorNow(size), size, grab);
      x = at.x;
      y = at.y;
      const pull = releaseVelocity(grab.trail, performance.now());
      draw(place, bodyRef.current, look, { x, floorY: y, facing, mood: 'stand', motion, tick: motionTick, lift: 0, held: true, fx: dragLook(pull.vx, pull.vy) });
    };
    const onFigure = (event: PointerEvent) => {
      if (event.button !== 0 || place === null || grab !== null) return;
      if (still || !canGrab()) {
        if (phase === 'strip') poke();
        return;
      }
      const box = place.getBoundingClientRect();
      grab = {
        id: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        offX: event.clientX - box.left,
        offY: box.bottom - event.clientY,
        moved: false,
        px: event.clientX,
        py: event.clientY,
        trail: [],
        carried: false,
      };
      // The figure keeps hearing the pointer wherever it goes, and the drag selects no text on the page.
      event.preventDefault();
      try {
        place.setPointerCapture(event.pointerId);
      } catch {
        // No capture (the pointer went away already): the moves still reach the window's own listener.
      }
    };
    const onDrag = (event: PointerEvent) => {
      if (grab === null) return;
      // Carried after a double press: it follows the pointer, whichever pointer, with nothing held down.
      if (grab.carried) {
        grab.px = event.clientX;
        grab.py = event.clientY;
        trace(grab, event);
        followHand();
        return;
      }
      if (event.pointerId !== grab.id) return;
      grab.px = event.clientX;
      grab.py = event.clientY;
      trace(grab, event);
      if (grab.moved) {
        followHand();
        return;
      }
      if (Math.hypot(event.clientX - grab.startX, event.clientY - grab.startY) < GRAB_SLOP) return;
      // Pressed while it climbed, and it has since gone into the room (or vanished): there is nothing here to pick up.
      if (!canGrab()) {
        grab = null;
        return;
      }
      // Picked up.
      grab.moved = true;
      liftOff();
      followHand();
    };
    // Carried after a double press, the next press anywhere puts it down there (Luke, 2026-11-14: "double click to pick
    // up and drag the companion around"). It is under the pointer, so the press lands on it and on nothing behind it.
    const onPutDown = (event: PointerEvent) => {
      if (grab === null || !grab.carried || event.button !== 0) return;
      grab.px = event.clientX;
      grab.py = event.clientY;
      // A finger has no hover: it is put down where the finger next touches, from there.
      if (place !== null) {
        const box = place.getBoundingClientRect();
        x = Math.round(Math.min(Math.max(0, window.innerWidth - box.width), Math.max(0, grab.px - grab.offX)));
        y = Math.round(Math.max(box.height, grab.py + grab.offY));
      }
      // Put down with the pointer still on the move, it is thrown from there; at rest, it only drops.
      fling(releaseVelocity(grab.trail, performance.now()));
    };
    const onDrop = (event: PointerEvent) => {
      // Carried after a double press, nothing is held down: letting a key go is not letting it go.
      if (grab === null || grab.carried || event.pointerId !== grab.id) return;
      const released = grab;
      grab = null;
      if (!released.moved) {
        // A press let go where it was made is a poke, on its strip only: a climb has no frames to play one in.
        if (event.type !== 'pointerup' || phase !== 'strip') return;
        const at = Date.now();
        if (at - lastTap <= DOUBLE_MS && place !== null) {
          // The second press of two: picked up, to follow the pointer until the next press puts it down. The first
          // press's poke is given back, so the turn of hop, wave, spin is not used up by a pick-up.
          lastTap = 0;
          pokes = Math.max(0, pokes - 1);
          const box = place.getBoundingClientRect();
          grab = { id: -1, startX: event.clientX, startY: event.clientY, offX: box.width / 2, offY: box.height / 2, moved: true, px: event.clientX, py: event.clientY, trail: [], carried: true };
          liftOff();
          return;
        }
        lastTap = at;
        poke();
        return;
      }
      // Let go by something other than a lifted finger or key (the pointer was taken away): it only drops.
      if (event.type !== 'pointerup') {
        letGo(0);
        return;
      }
      // From where the pointer is now, not where the last frame drew it: a fast hand is well ahead of a frame.
      const size = sizeOf(wearing.current.look);
      const at = hangAt(floorNow(size), size, released);
      x = at.x;
      y = at.y;
      fling(releaseVelocity(released.trail, performance.now()));
    };

    const offPoke = onCompanionPoke(react);
    // You speaking in a stream room's chat: it hops with `...` (`../lib/companion/events.ts`).
    const offSpoke = onCompanionSpoke((who) => {
      if (who === company.current.userId) react('spoke');
    });
    place?.addEventListener('pointerdown', onFigure);
    // On the window, not the figure: a let-go is heard wherever it happens, so it can never be left hanging.
    window.addEventListener('pointermove', onDrag, { passive: true });
    window.addEventListener('pointerup', onDrop, { passive: true });
    window.addEventListener('pointercancel', onDrop, { passive: true });
    window.addEventListener('pointerdown', onPutDown, { passive: true });
    // Something handed to you (a letter dropped on your character): it catches it (`../lib/companion/events.ts`).
    const offCatch = onCompanionCatch((who) => {
      if (who === company.current.userId && phase === 'strip') react('catch');
    });
    // A picture you sent in a room's chat: it raises it, arms up (ROOMSYNC). Played here only: every browser in the room
    // has the line, and raises your companion's arms for itself.
    const offHold = onCompanionHolds((who) => {
      if (who === company.current.userId && phase === 'strip' && !still) act = { motion: 'cheer', tick: 0 };
    });
    window.addEventListener('pointermove', onMove, { passive: true });
    window.addEventListener('pointerdown', active, { passive: true });
    window.addEventListener('keydown', onKey, { passive: true });
    window.addEventListener('scroll', active, { passive: true, capture: true });
    window.addEventListener('wheel', active, { passive: true });
    document.addEventListener('pointerout', onOut, { passive: true });
    window.addEventListener('blur', onBlur);
    tick();
    const timer = setInterval(tick, TICK_MS);

    return () => {
      clearInterval(timer);
      if (glideFrame !== 0) cancelAnimationFrame(glideFrame);
      if (markTimer !== null) clearTimeout(markTimer);
      offPoke();
      offSpoke();
      offCatch();
      offHold();
      window.removeEventListener('pointerdown', onPutDown);
      // Gone while it was in the hand (the motion setting changed): nothing of the carry is left on the figure.
      if (place !== null) {
        place.style.cursor = '';
        place.style.pointerEvents = '';
      }
      place?.removeEventListener('pointerdown', onFigure);
      window.removeEventListener('pointermove', onDrag);
      window.removeEventListener('pointerup', onDrop);
      window.removeEventListener('pointercancel', onDrop);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerdown', active);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', active, { capture: true });
      window.removeEventListener('wheel', active);
      document.removeEventListener('pointerout', onOut);
      window.removeEventListener('blur', onBlur);
      sayCompanion(null);
      setCompanionInRoom(false);
      closePortal(portal);
    };
  }, [still]);

  return (
    <>
      {/* The portal it pops back out of: Luke's drawing (an art slot), an empty dithered field until it is filed. Drawn
          first, so the figure stepping out is in front of it. */}
      <div
        ref={portalRef}
        aria-hidden="true"
        className="invisible absolute left-0 top-0"
        style={{ width: PORTAL_SIZE, height: PORTAL_SIZE }}
        data-companion-portal
        data-open="false"
      >
        <SpriteSlot
          src="/assets/sprites/portal.gif"
          alt=""
          width={PORTAL_SIZE}
          height={PORTAL_SIZE}
          title="A portal opens here once assets/sprites/portal.gif is drawn"
        />
      </div>
      <Figure placeRef={placeRef} bodyRef={bodyRef} markRef={markRef} label={label} own ownerId={userId} look={look} />
    </>
  );
}

/** Somebody else's companion in the room: wears their SHOWN character, walks where their browser says, plays the rest. */
function RoomFigure({ companion, still }: { companion: RoomCompanion; still: boolean }) {
  const placeRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLSpanElement>(null);
  const markRef = useRef<HTMLSpanElement>(null);
  // Anyone may read anyone's SHOWN character (SPEC-profile-characters.md); the figure is keyed by the strip the owner
  // says it wears, so a new one is read again.
  const shown = useShownCharacter(companion.wire.c === null ? null : companion.userId);
  const look = useMemo<Look>(() => (shown === null || shown === undefined ? null : { stripUrl: shown.stripUrl, sheet: shown.sheet }), [shown]);
  const wire = useRef(companion.wire);
  const wearing = useRef(look);
  const owner = useRef(companion.userId);
  useEffect(() => {
    wire.current = companion.wire;
    owner.current = companion.userId;
  }, [companion.wire, companion.userId]);
  useEffect(() => {
    wearing.current = look;
  }, [look]);

  useEffect(() => {
    const place = placeRef.current;
    const mark = markRef.current;
    let x: number | null = null;
    let facing: 1 | -1 = 1;
    let frame = 0;
    let act: Act | null = null;
    let dance = pickDance();
    let motion: MotionId = 'idle';
    let motionTick = 0;
    let seen: number | null = null;
    let markTimer: ReturnType<typeof setTimeout> | null = null;
    /** Its feet, from the top of the screen: on its floor, or on the way up to or down to it. */
    let feet: number | null = null;

    const tick = () => {
      const lookNow = wearing.current;
      const size = sizeOf(lookNow);
      const floor = floorNow(size);
      const now = wire.current;
      const target = floor.left + now.x * floorRoom(floor, size);
      const span = spanFor(floor.spans, x ?? target);
      if (span === null) {
        hide(place);
        return;
      }
      const goal = Math.min(span.right, Math.max(span.left, target));
      if (x === null || still) x = goal;

      // A bigger reaction count than last seen is a hop (and maybe a `!`); the first sight only notes it.
      if (seen === null) seen = now.r;
      else if (now.r > seen) {
        seen = now.r;
        if (!still) act = { motion: reactionMotion(now.k), tick: 0 };
        const text = reactionMark(now.k);
        if (text !== null) markTimer = showMark(mark, markTimer, text);
      }

      if (still) {
        feet = floor.y;
        draw(place, bodyRef.current, lookNow, { x, floorY: floor.y, facing, mood: 'stand', motion: 'idle', tick: 0, lift: 0 });
        return;
      }

      // Climbing in, never floating (Luke, 2026-11-16), as its owner's does: up to a floor that rose under it (a stream
      // room's window opening over the strip) from just behind its edge, and down off one that dropped away.
      // New to the room, it climbs up over the edge of its floor from behind it, as yours does on a page.
      if (feet === null) feet = floor.y + size.h;
      if (feet > floor.y + 1 || feet < floor.y - 1) {
        const up = feet > floor.y;
        feet = up ? climbToward(Math.min(feet, floor.y + size.h), floor.y) : Math.min(floor.y, feet + FALL_STEP);
        const next: MotionId = up ? 'climb' : 'dangle';
        motionTick = next === motion ? motionTick + 1 : 0;
        motion = next;
        draw(place, bodyRef.current, lookNow, { x, floorY: feet, facing, mood: up ? 'walk' : 'stand', motion, tick: motionTick, lift: 0, held: !up });
        return;
      }

      // As on its owner's screen: a hop goes on walking, anything longer is done standing where it is.
      const busy = act !== null && act.motion !== 'hop';
      const walking = !busy && Math.abs(goal - x) >= 1;
      if (walking) {
        const step = now.m === 'chase' || now.p === 'run' ? CHASE_STEP : WALK_STEP;
        facing = goal > x ? 1 : -1;
        x += Math.sign(goal - x) * Math.min(step, Math.abs(goal - x));
      }
      const mood: CompanionMood = walking ? (now.m === 'chase' ? 'chase' : 'walk') : now.m === 'walk' || now.m === 'chase' ? 'stand' : now.m;
      if (mood === 'dance' && motion !== dance && !DANCES.includes(motion)) dance = pickDance();

      frame += 1;
      let lift = 0;
      if (act !== null) {
        motion = act.motion;
        motionTick = act.tick;
        if (lookNow === null) lift = HOP[act.tick] ?? 0;
        act = act.tick + 1 < actLength(lookNow, act.motion) ? { motion: act.motion, tick: act.tick + 1 } : null;
      } else {
        // The loop its owner's browser says it is in (which dance, a run, a curled-up sleep), when that goes with its mood.
        const next = onLedge(loopMotion(mood, now.p, dance), floor);
        motionTick = next === motion ? motionTick + 1 : 0;
        motion = next;
        if (next === 'watch') facing = facingFocus(x, size, facing);
        if (lookNow === null && mood === 'dance') {
          lift = frame % 4 < 2 ? -2 : 0;
          if (frame % 5 === 0) facing = facing === 1 ? -1 : 1;
        }
      }
      draw(place, bodyRef.current, lookNow, { x, floorY: floor.y, facing, mood, motion, tick: motionTick, lift });
      if (frame % 5 === 0) yieldToKeys(place);
    };

    // Its owner speaking in the room's chat: a hop with `...`, worked out here from the chat line this browser already has.
    const offSpoke = onCompanionSpoke((who) => {
      if (who !== owner.current) return;
      if (!still) act = { motion: 'hop', tick: 0 };
      markTimer = showMark(mark, markTimer, '...');
    });
    // Something handed to its owner (a letter dropped on it here): it catches it, on this screen.
    const offCatch = onCompanionCatch((who) => {
      if (who === owner.current && !still) act = { motion: 'catch', tick: 0 };
    });
    // A picture its owner sent in the room's chat: it raises it, arms up (ROOMSYNC).
    const offHold = onCompanionHolds((who) => {
      if (who === owner.current && !still) act = { motion: 'cheer', tick: 0 };
    });
    tick();
    const timer = setInterval(tick, TICK_MS);
    return () => {
      clearInterval(timer);
      offSpoke();
      offCatch();
      offHold();
      if (markTimer !== null) clearTimeout(markTimer);
    };
  }, [still]);

  return <Figure placeRef={placeRef} bodyRef={bodyRef} markRef={markRef} label={companion.name || 'SOMEONE'} own={false} ownerId={companion.userId} look={look} />;
}

export default function Companion() {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const choices = useSyncExternalStore(subscribeToCompanionChoices, companionChoicesState, serverCompanionChoices);
  const others = useSyncExternalStore(subscribeToRoomCompanions, roomCompanionsState, serverRoomCompanions);
  const phone = usePhone();
  const still = useReducedMotion();
  const [music, setMusic] = useState<{ playing: boolean; track: string | null }>({ playing: false, track: null });
  const onMusic = useCallback((playing: boolean, track: string | null) => {
    setMusic((now) => (now.playing === playing && now.track === track ? now : { playing, track }));
  }, []);
  // Your SHOWN character: what your companion wears, and whether it is out by default (undefined while it is read).
  const shown = useShownCharacter(userId);

  useEffect(() => {
    void setCompanionAccount(userId);
  }, [userId]);

  // A strip baked before the newer motions is baked again here, once, quietly (Luke's OK, 2026-11-14): on a computer,
  // a few seconds after the page has settled. The baking code is fetched only then.
  const stale = shown !== null && shown !== undefined && shown.stale ? shown : null;
  useEffect(() => {
    if (stale === null || userId === null || phone !== false) return;
    const timer = setTimeout(() => {
      void import('../lib/character/rebake').then(({ rebakeShown }) => rebakeShown(userId, stale));
    }, REBAKE_AFTER_MS);
    return () => clearTimeout(timer);
  }, [stale, userId, phone]);

  const ready = phone !== null && still !== null && shown !== undefined;
  const mine = ready && companionOut(choices, { signedIn: userId !== null, phone, hasShown: shown !== null });
  // What a profile's room needs to know of your companion (`../lib/companion/visit.ts`): whether it is out, and what it wears.
  const visitLook = useMemo<VisitLook>(() => (shown ? { stripUrl: shown.stripUrl, sheet: shown.sheet, mood: shown.mood } : null), [shown]);
  useEffect(() => {
    setCompanionOut({ known: ready, out: mine, look: visitLook, still: still === true });
  }, [ready, mine, visitLook, still]);

  // Nothing until the device, the motion setting and your SHOWN character can be read: never one frame on a guess.
  if (phone === null || still === null || shown === undefined) return null;
  const look: Look = shown === null ? null : { stripUrl: shown.stripUrl, sheet: shown.sheet };
  const drawn = companionsToDraw(others, mine);

  if (!mine && drawn.length === 0) return null;

  return (
    // Under the music bar (z-50) and every window, over the page. Only the figures take the pointer.
    <div className="pointer-events-none fixed inset-0 z-40 overflow-hidden" data-companion-strip>
      {mine ? (
        <>
          <MusicWatch onChange={onMusic} />
          <CompanionReactions />
          {/* Re-made when the strip changes: a new character is a new box. */}
          <OwnCompanion
            key={shown?.bakedAt ?? 'placeholder'}
            label={user?.displayName ?? 'YOU'}
            userId={userId}
            roomKeys={drawn.map((companion) => companion.key).join(',')}
            musicPlaying={music.playing}
            track={music.track}
            still={still}
            look={look}
            lookRef={shown?.bakedAt ?? null}
          />
        </>
      ) : null}
      {drawn.map((companion) => (
        <RoomFigure key={`${companion.key}:${companion.wire.c ?? ''}`} companion={companion} still={still} />
      ))}
    </div>
  );
}
