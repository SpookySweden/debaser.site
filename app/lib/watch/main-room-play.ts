'use client';

import { closeWatch, expandWatch, openWatch, watchWindowState } from './watch-window';
import { ownRoomState } from './own-room-client';
import { createWindowSlot } from '../ui/window-slot';
import type { WatchLink } from './types';

/**
 * PLAY on a video in MEDIA or FILES opens your main room's window with it on screen (SPEC-rooms-perpetual.md, Luke
 * 2026-11-16: "when you open a video from media, it opens in your room not pip"). Accounts only: a signed-out visitor's
 * room lives in their browser and keeps its own window (`OwnRoomWindow.tsx`).
 *
 * Module state, like the windows: nothing here draws the page again. This file never imports the floating player
 * (the room's players must not, a9b6af9); `MusicRoomKeeper` hands it what a row asked the floating player for.
 */

export type MainRoomSource = { link: WatchLink; mediaItemId?: undefined } | { mediaItemId: string; link?: undefined };

/** The room window's own way to put something on, while it is drawn and you host it (`WatchRoom.tsx`). */
type HostPlay = { roomId: string; play: (source: MainRoomSource) => void };
let hostPlay: HostPlay | null = null;

/** Set by your main room's window while it is drawn; returns the way to take it back. */
export function registerMainRoomPlay(roomId: string, play: (source: MainRoomSource) => void): () => void {
  const mine: HostPlay = { roomId, play };
  hostPlay = mine;
  return () => {
    if (hostPlay === mine) hostPlay = null;
  };
}

/** You are in somebody else's room and pressed PLAY (Luke, Q2 A): the small ask, until it is answered. */
export type PlayAsk = { source: MainRoomSource; title: string; theirRoomId: string };
const askSlot = createWindowSlot<PlayAsk | null>(null);
export const playAskState = askSlot.state;
export const subscribeToPlayAsk = askSlot.subscribe;
export function answerPlayAsk(): void {
  askSlot.set(null);
}

/**
 * Puts `source` on in your main room and opens its window. 'room' when it did; 'ask' when you are in somebody else's
 * room and were asked first; 'none' when you have no main room here (a visitor, or before it is found): the caller
 * leaves the video where it was.
 */
export function playInMainRoom(source: MainRoomSource, title: string): 'room' | 'ask' | 'none' {
  const own = ownRoomState();
  const session = own.session;
  if (session === null || own.visitor || own.roomId === null) return 'none';
  const roomId = own.roomId;

  const shown = watchWindowState();
  if (shown.open && shown.focus?.kind === 'room' && shown.focus.roomId !== roomId) {
    askSlot.set({ source, title, theirRoomId: shown.focus.roomId });
    return 'ask';
  }
  return putOn(source);
}

/** PLAY IN YOUR ROOM from the ask: you leave theirs first. */
export function playInMainRoomLeaving(source: MainRoomSource): void {
  askSlot.set(null);
  closeWatch();
  putOn(source);
}

function putOn(source: MainRoomSource): 'room' | 'none' {
  const own = ownRoomState();
  const session = own.session;
  if (session === null || own.roomId === null) return 'none';
  const roomId = own.roomId;

  // The window is drawn and runs the room: it files the play itself, so its player and the room agree.
  if (hostPlay !== null && hostPlay.roomId === roomId) {
    hostPlay.play(source);
    openOrUnfold(roomId);
    return 'room';
  }

  const wasMade = session.isMade();
  if (source.link !== undefined) session.started(source.link);
  else session.startedFile(source.mediaItemId);
  // A room the database does not hold yet is written first, so the window finds it there.
  if (wasMade) openOrUnfold(roomId);
  else void session.saved().then(() => openOrUnfold(session.id() ?? roomId));
  return 'room';
}

/** The room whose window should open on WHO CAN JOIN: GO LIVE was pressed outside it. Taken once. */
let goLiveAsked: string | null = null;
export function takeGoLiveAsk(roomId: string): boolean {
  if (goLiveAsked !== roomId) return false;
  goLiveAsked = null;
  return true;
}

/**
 * `[ GO LIVE ]` on the music bar or the CYTUBE page (SPEC-rooms-perpetual.md): it announces the room you are already in,
 * so it opens your main room's window on WHO CAN JOIN. False when you have no main room here (a visitor): the caller
 * keeps its old way.
 */
export function goLiveInMainRoom(): boolean {
  const own = ownRoomState();
  const session = own.session;
  if (session === null || own.visitor || own.roomId === null) return false;
  void session.ensureMade().then((held) => {
    const roomId = session.id();
    if (!held || roomId === null) return;
    goLiveAsked = roomId;
    openOrUnfold(roomId);
  });
  return true;
}

function openOrUnfold(roomId: string): void {
  const now = watchWindowState();
  if (now.open && now.focus?.kind === 'room' && now.focus.roomId === roomId) expandWatch();
  else openWatch({ kind: 'room', roomId });
}
