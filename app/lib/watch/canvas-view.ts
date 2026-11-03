'use client';

import { useSyncExternalStore } from 'react';
import { screenShown, type ScreenView } from './canvas';

/**
 * Which screen each viewer has picked in each room: the picture or the canvas (SPEC-stream-art.md). This tab's
 * own choice, never synced; kept for the tab's life, so the room window closing and opening again remembers it.
 * The default (no choice) is the canvas while audio plays and the picture with a video (`screenShown`).
 */

const choices = new Map<string, { view: ScreenView; audio: boolean }>();
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** What this viewer's screen shows in the room now. */
export function useScreenView(roomId: string, audio: boolean): ScreenView {
  return useSyncExternalStore(
    subscribe,
    () => screenShown(choices.get(roomId) ?? null, audio),
    () => screenShown(null, audio),
  );
}

/** The toggle: this viewer's choice, for the kind of thing playing now. */
export function chooseScreen(roomId: string, view: ScreenView, audio: boolean): void {
  choices.set(roomId, { view, audio });
  for (const listener of listeners) listener();
}
