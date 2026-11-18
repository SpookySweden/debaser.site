'use client';

import { useSyncExternalStore } from 'react';
import { noteSettingChanged, subscribeToAccountSettings } from '../settings/settings-bus';

/**
 * MEDIA's VIEW setting (Luke, 2026-11-14: "settings for the media ui that show the current view and a few others such
 * as a more thumbnail view like youtube has"): how a list of results is laid out. Kept in this browser only; a browser
 * that won't keep it gets LIST, today's view. No database.
 */

export type MediaView = 'list' | 'grid' | 'large' | 'compact';

/** The choices, in order. `preview` is a tiny picture made of text characters (never drawn art), read as decoration. */
export const MEDIA_VIEWS: readonly { value: MediaView; label: string; line: string; preview: readonly string[] }[] = [
  { value: 'list', label: 'LIST', line: 'A PICTURE, THE TITLE AND THE DETAILS', preview: ['▣ ═════', '▣ ═════'] },
  { value: 'grid', label: 'GRID', line: 'BIG PICTURES IN ROWS, LIKE YOUTUBE', preview: ['▣ ▣ ▣ ▣', '═ ═ ═ ═'] },
  { value: 'large', label: 'LARGE', line: 'ONE BIG CARD AT A TIME, EASY TO READ', preview: ['█▣ ════', '██ ════'] },
  { value: 'compact', label: 'COMPACT', line: 'TITLES ONLY, FOR SCANNING FAST', preview: ['▪ ─────', '▪ ─────'] },
];

const KEY = 'debaser.media.view.v1';
const listeners = new Set<() => void>();

function read(): MediaView {
  try {
    const kept = window.localStorage.getItem(KEY);
    return MEDIA_VIEWS.some((view) => view.value === kept) ? (kept as MediaView) : 'list';
  } catch {
    return 'list';
  }
}

export function setMediaView(view: MediaView): void {
  try {
    window.localStorage.setItem(KEY, view);
  } catch {
    // Kept for this visit only: the listeners still hear it.
  }
  memo = view;
  listeners.forEach((listener) => listener());
  noteSettingChanged('mediaView');
}

let memo: MediaView | null = null;

// Signed in, the account's view is written into storage on sign-in (SPEC-forum-v3.md, F2A): read it again then.
if (typeof window !== 'undefined') {
  subscribeToAccountSettings(() => {
    memo = read();
    listeners.forEach((listener) => listener());
  });
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The view this browser chose; LIST on the server's draw and until the browser has been read. */
export function useMediaView(): MediaView {
  return useSyncExternalStore(
    subscribe,
    () => (memo ??= read()),
    () => 'list',
  );
}

export function viewLabel(view: MediaView): string {
  return MEDIA_VIEWS.find((one) => one.value === view)?.label ?? 'LIST';
}

/**
 * The list's own layout: GRID lays its rows out in columns, four across on a computer, fewer only where a card would be
 * too narrow for its keys (`.media-grid` in app/globals.css; MEDIACARD, 2026-11-17); the rest stack.
 */
export function viewListClass(view: MediaView): string {
  return view === 'grid' ? 'media-grid' : '';
}
