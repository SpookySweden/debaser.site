import type { CharacterSheet, Mood } from '../character/sheet';
import { createWindowSlot } from '../ui/window-slot';

/**
 * Your companion visiting a profile's room (Luke, 2026-11-13): "the profile version of the character is at the bottom of
 * the profile in an ena style window where your own one then climbs up and hangs out with it ... basically never two of
 * the same character on the same screen".
 *
 * Two small stores between the companion (`Companion.tsx`, in the layout) and the room (`ProfileRoom.tsx`, at the foot
 * of a profile), so neither re-renders the page:
 *   - the room on the page now, which the companion may climb into (`openRoom`);
 *   - your companion as the room needs to know it: whether it is out on this device, what it wears, and whether it has
 *     arrived (the room draws it from then on, walking alongside the owner's character).
 *
 * The climb itself is the companion's: it walks along its strip to under the room, climbs up into it a step at a time
 * with its own climbing frames (2026-11-14; its walk frames before then), and hands over. Leaving the page, it climbs back down from where it stood; if the page
 * changes again before it is down (or it was still climbing), it vanishes and pops out of a portal on its strip a moment
 * later. Under reduced motion nothing climbs: it simply appears in the room, or back on its strip.
 *
 * The pure parts (where it can climb to, what leaving does) are tested in `Temp/check-profile-room.cjs`.
 */

/** What a figure wears: a SHOWN character's baked strip and its mood, or null (the placeholder field). */
export type VisitLook = { stripUrl: string; sheet: CharacterSheet; mood: Mood } | null;

/** A room on the page your companion may climb into: whose it is, and the stage it stands on. */
export type VisitRoom = { owner: string; stage: HTMLElement };

export type CompanionVisit = {
  /** False until the companion has read the device, the motion setting and your SHOWN character. */
  known: boolean;
  /** Your companion is out on this device. */
  out: boolean;
  look: VisitLook;
  /** Reduced motion: nothing climbs, and it stands still. */
  still: boolean;
  /** It has arrived in the room, and the room draws it now. */
  inRoom: boolean;
  /** Where it arrived: its left edge, from the stage's left, in CSS pixels. */
  arriveX: number;
};

const START: CompanionVisit = { known: false, out: false, look: null, still: false, inRoom: false, arriveX: 0 };

const roomSlot = createWindowSlot<VisitRoom | null>(null);
const visitSlot = createWindowSlot<CompanionVisit>(START);

export const visitRoomState = roomSlot.state;

/** Puts a room on the page; the function it hands back takes it away again (only if it is still that room). */
export function openRoom(room: VisitRoom): () => void {
  roomSlot.set(room);
  return () => {
    if (roomSlot.state() === room) roomSlot.set(null);
  };
}

export const companionVisitState = visitSlot.state;
export const subscribeToCompanionVisit = visitSlot.subscribe;
export const serverCompanionVisit = (): CompanionVisit => START;

/** What the companion says about itself (out, wearing what), leaving where it is alone. */
export function setCompanionOut(next: { known: boolean; out: boolean; look: VisitLook; still: boolean }): void {
  const now = visitSlot.state();
  if (now.known === next.known && now.out === next.out && now.look === next.look && now.still === next.still) return;
  visitSlot.set({ ...now, ...next, ...(next.out ? {} : { inRoom: false }) });
}

/** The companion arrived in the room (at `arriveX`), or left it. */
export function setCompanionInRoom(inRoom: boolean, arriveX = 0): void {
  const now = visitSlot.state();
  if (now.inRoom === inRoom && (!inRoom || now.arriveX === arriveX)) return;
  visitSlot.set({ ...now, inRoom, arriveX: Math.round(arriveX) });
}

/**
 * Where the visiting figure stands in the room now, on screen (its left edge and its feet), written by the room as it walks
 * and read by the companion when the room goes: that is where it climbs down from. Not a store: nothing draws from it.
 */
export type RoomSpot = { left: number; bottom: number; onScreen: boolean };
let spot: RoomSpot | null = null;
export function noteRoomSpot(next: RoomSpot | null): void {
  spot = next;
}
export const roomSpot = (): RoomSpot | null => spot;

/* --- other people's companions climbing into their own room -------------------------------------------------------- */

/*
 * Luke, 2026-11-22: "when viewing someones profile while in a stream with them, there is one version of their character in
 * the profile box and one above the bottom player bar ... i need it so there is just one of each character on the screen at
 * a time and ideally have them be the same one for real as in the same little dude that carries some memory and
 * consistency".
 *
 * Somebody else's companion on this screen (in a stream room you share, `RoomFigure` in `Companion.tsx`) is the same
 * character their profile's room, or a room they visit as a commenter, would draw. So the room draws no copy of them: it
 * calls them (`callIntoRoom`), their companion walks to under it and climbs up the way yours does, and the room carries on
 * with it from where it stepped in and the way it faced. When the room goes, or no longer wants them, it climbs back down
 * from where it stood (`roomSpotOf`), still the same figure on the strip, with what it had seen. Until it has climbed in
 * (the room scrolled away, or it stands on a stream room's window, where there is no way down) the room leaves them out.
 * A person not on this screen's strip is drawn by the room itself, as before.
 */

/**
 * Where somebody else's companion stepped into the room: its left edge from the stage's left, and the way it faced. One
 * dragged and dropped into a room it does not belong to (Luke, 2026-11-23: "allow to drag into the profile room", "Also
 * others' in stream") also says who it is and what it wears, so that room can draw it as a visitor until the room goes.
 */
export type OtherArrival = { x: number; facing: 1 | -1; dropped?: { name: string; look: VisitLook } };

/** Whose companions are on this screen's strip just now, and who of them has climbed into the room on the page. */
export type OthersHere = { onStrip: readonly string[]; inRoom: Readonly<Record<string, OtherArrival>> };

const NO_OTHERS: OthersHere = { onStrip: [], inRoom: {} };
let othersHere: OthersHere = NO_OTHERS;
const othersListeners = new Set<() => void>();
/** How many figures each person has on the strip (one per tab of theirs in the room). */
const stripCounts = new Map<string, number>();

function setOthersHere(next: OthersHere): void {
  othersHere = next;
  for (const listener of othersListeners) listener();
}

export const othersHereState = (): OthersHere => othersHere;
export const serverOthersHere = (): OthersHere => NO_OTHERS;
export function subscribeToOthersHere(listener: () => void): () => void {
  othersListeners.add(listener);
  return () => {
    othersListeners.delete(listener);
  };
}

/** Without `person`'s arrival in the room. */
function withoutArrival(inRoom: OthersHere['inRoom'], person: string): OthersHere['inRoom'] {
  if (inRoom[person] === undefined) return inRoom;
  const next = { ...inRoom };
  delete next[person];
  return next;
}

/**
 * Somebody's companion is on the strip (`already`: it is the one the room is drawing just now, so it starts in the room
 * and the room's figure of them carries on). The function it hands back takes it off again, and out of the room.
 */
export function joinStrip(person: string, already: OtherArrival | null = null): () => void {
  otherSpots.delete(person);
  stripCounts.set(person, (stripCounts.get(person) ?? 0) + 1);
  const onStrip = othersHere.onStrip.includes(person) ? othersHere.onStrip : [...othersHere.onStrip, person];
  const inRoom = already === null || othersHere.inRoom[person] !== undefined ? othersHere.inRoom : { ...othersHere.inRoom, [person]: already };
  if (onStrip !== othersHere.onStrip || inRoom !== othersHere.inRoom) setOthersHere({ onStrip, inRoom });
  let left = false;
  return () => {
    if (left) return;
    left = true;
    const count = (stripCounts.get(person) ?? 1) - 1;
    if (count > 0) {
      stripCounts.set(person, count);
      return;
    }
    stripCounts.delete(person);
    otherSpots.delete(person);
    setOthersHere({ onStrip: othersHere.onStrip.filter((one) => one !== person), inRoom: withoutArrival(othersHere.inRoom, person) });
  };
}

/** Somebody's companion climbed into the room (where, facing which way), or left it (null). */
export function setOtherInRoom(person: string, arrival: OtherArrival | null): void {
  // A spot is only ever this visit's: forgotten as it climbs in (the room writes it anew) and once it has left.
  otherSpots.delete(person);
  const now = othersHere.inRoom[person];
  if (arrival === null) {
    if (now !== undefined) setOthersHere({ ...othersHere, inRoom: withoutArrival(othersHere.inRoom, person) });
    return;
  }
  const next: OtherArrival = { x: Math.round(arrival.x), facing: arrival.facing, ...(arrival.dropped === undefined ? {} : { dropped: arrival.dropped }) };
  if (now !== undefined && now.x === next.x && now.facing === next.facing && now.dropped === next.dropped) return;
  setOthersHere({ ...othersHere, inRoom: { ...othersHere.inRoom, [person]: next } });
}

/** Whether the room draws `person` itself: they are not on this screen's strip, or their companion has climbed in. Pure. */
export function roomDraws(person: string, here: OthersHere): boolean {
  return !here.onStrip.includes(person) || here.inRoom[person] !== undefined;
}

/**
 * The people somebody dropped into this room who are not already in it as its owner or a visiting commenter: drawn by the
 * room as visitors, with the look and name they arrived with, until the room goes. Pure.
 */
export function droppedVisitors(here: OthersHere, already: readonly string[]): { id: string; name: string; look: VisitLook; x: number; facing: 1 | -1 }[] {
  const found: { id: string; name: string; look: VisitLook; x: number; facing: 1 | -1 }[] = [];
  for (const [id, arrival] of Object.entries(here.inRoom)) {
    if (arrival.dropped === undefined || already.includes(id)) continue;
    found.push({ id, name: arrival.dropped.name, look: arrival.dropped.look, x: arrival.x, facing: arrival.facing });
  }
  return found;
}

/** A room calling the companions of the people it would draw (its owner, its visiting commenters) up into it. */
export type RoomCall = { stage: HTMLElement; wants: readonly string[] };
let call: RoomCall | null = null;

/** Puts a room's call on the page; the function it hands back takes it away (only if it is still that call). */
export function callIntoRoom(next: RoomCall): () => void {
  call = next;
  return () => {
    if (call === next) call = null;
  };
}
export const roomCallState = (): RoomCall | null => call;

/** Whether the room on the page wants `person`'s companion up in it. Pure. */
export function roomWants(person: string, room: RoomCall | null): boolean {
  return room !== null && room.wants.includes(person);
}

/** Where each person's figure stands in the room on screen, written by the room as it walks; read when it climbs down. */
const otherSpots = new Map<string, RoomSpot>();
export function noteRoomSpotOf(person: string, next: RoomSpot): void {
  otherSpots.set(person, next);
}
export const roomSpotOf = (person: string): RoomSpot | null => otherSpots.get(person) ?? null;

/**
 * What the room going (or no longer wanting it) does to somebody else's companion that was in it: down from where it stood
 * when that spot shows whole above its floor, else back over the edge of its floor from behind, as when it first came. Pure.
 */
export function otherLeaves(spot: RoomSpot | null, floorY: number): 'down' | 'over' {
  return spot !== null && spot.onScreen && spot.bottom <= floorY ? 'down' : 'over';
}

/** Whether a figure's box shows whole inside `clip`. */
export function wholeIn(box: Box, clip: Box): boolean {
  return box.left >= clip.left - 0.5 && box.right <= clip.right + 0.5 && box.top >= clip.top - 0.5 && box.bottom <= clip.bottom + 0.5;
}

/* --- the pure parts ------------------------------------------------------------------------------------------------ */

export type Box = { left: number; top: number; right: number; bottom: number };

/** Pixels a frame, climbing: ten frames a second, so a climb up a screen takes a few seconds. */
export const CLIMB_STEP = 8;
/** How long it is gone before it pops out of the portal, and how long the portal stays open. */
export const PORTAL_AFTER_MS = 2_000;
export const PORTAL_OPEN_MS = 1_200;
/** How long after the portal opens it steps out. */
export const PORTAL_STEP_OUT_MS = 400;
/** The portal's box, in CSS pixels (its art slot, `sprite-portal`). */
export const PORTAL_SIZE = 48;

/**
 * Where a figure of `size` could stand in the room: the stage's floor and the stretch of it showing, or null when the floor
 * isn't on screen with room to stand (scrolled away, or under the music bar's strip). `clip` is what of the page shows (the
 * page's scrolling pane, cut by the screen); `strip` is the y of the companion's own floor, which the room must be above.
 */
export function roomFloor(stage: Box, clip: Box, size: { w: number; h: number }, strip: number): { left: number; right: number; floor: number } | null {
  const floor = stage.bottom;
  if (floor > clip.bottom + 0.5 || floor - size.h < clip.top - 0.5) return null;
  if (floor > strip - 4) return null;
  const left = Math.max(stage.left, clip.left);
  const right = Math.min(stage.right, clip.right) - size.w;
  if (right < left) return null;
  return { left, right, floor };
}

/** One climbing frame: `y` (its feet) a step nearer `to`, never past it. */
export function climbToward(y: number, to: number, step: number = CLIMB_STEP): number {
  if (Math.abs(to - y) <= step) return to;
  return y + Math.sign(to - y) * step;
}

export type VisitPhase = 'strip' | 'up' | 'room' | 'down' | 'gone';

/**
 * What the room going away (the page changed) does to a companion in `phase`: settled in the room with its spot on screen,
 * it climbs back down from there; still climbing up, or with its spot off screen, it vanishes (and the portal brings it
 * back); on its strip, nothing.
 */
export function whenRoomGoes(phase: VisitPhase, spotOnScreen: boolean): VisitPhase {
  if (phase === 'room') return spotOnScreen ? 'down' : 'gone';
  if (phase === 'up') return 'gone';
  return phase;
}

/** What the page changing again does: climbing down (or up), too fast for it, it vanishes. */
export function whenPageChanges(phase: VisitPhase): VisitPhase {
  return phase === 'down' || phase === 'up' ? 'gone' : phase;
}

/* --- the browser part ---------------------------------------------------------------------------------------------- */

/** What of the page shows around `element`: the screen, cut by every ancestor that clips (the page's scrolling pane). */
export function clipOf(element: HTMLElement): Box {
  let box: Box = { left: 0, top: 0, right: document.documentElement.clientWidth, bottom: window.innerHeight };
  for (let parent = element.parentElement; parent !== null; parent = parent.parentElement) {
    const style = window.getComputedStyle(parent);
    if (style.overflowX === 'visible' && style.overflowY === 'visible') continue;
    const r = parent.getBoundingClientRect();
    box = { left: Math.max(box.left, r.left), top: Math.max(box.top, r.top), right: Math.min(box.right, r.right), bottom: Math.min(box.bottom, r.bottom) };
  }
  return box;
}

/** A box as plain numbers. */
export function boxOf(element: Element): Box {
  const r = element.getBoundingClientRect();
  return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
}
