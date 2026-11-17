'use client';

import { readPaused as readAccountPaused, setPaused as setAccountPaused, subscribeHistory } from '../recommender/history';
import { getSupabaseBrowserClient } from '../supabase/client';
import { HISTORY_DATA_SOURCE, keptInBrowser, playsRepository } from './repository';
import type { Play, PlayHow, PlayNote } from './types';

/**
 * The browser's half of HISTORY (SPEC-history.md): note a play, say where it stopped, read and trim the log, PAUSE.
 *
 * Who is asking decides where the log is: a signed-in account (not a stream room's guest) on the real site writes to
 * `user_plays`; anybody else keeps it in this browser. Writing is fire-and-forget: a refused or failed write never stops
 * what is playing. PAUSE is one switch with FOR YOU's history on an account (Luke's answer 4: one PAUSE for both); a
 * visitor's is kept in their browser.
 */

const VISITOR_PAUSED_KEY = 'debaser.plays.browser-paused.v1';
const listeners = new Set<() => void>();

function changed(): void {
  listeners.forEach((listener) => listener());
}

/** The window redraws after a new line, a removal, ERASE or PAUSE. */
export function subscribePlays(listener: () => void): () => void {
  listeners.add(listener);
  // FOR YOU's PAUSE and ERASE are the same switch on an account: its changes redraw HISTORY too.
  const off = subscribeHistory(listener);
  return () => {
    listeners.delete(listener);
    off();
  };
}

/* --- who is asking -------------------------------------------------------------------------------- */

let account: { at: number; signedIn: Promise<boolean> } | null = null;
const ACCOUNT_FOR_MS = 15_000;

/** True for a signed-in account that is not a guest. Read from the session itself, at most every 15 seconds. */
export function signedInForHistory(): Promise<boolean> {
  if (account !== null && Date.now() - account.at < ACCOUNT_FOR_MS) return account.signedIn;
  const db = getSupabaseBrowserClient();
  const signedIn =
    HISTORY_DATA_SOURCE === 'mock' || db === null
      ? Promise.resolve(true)
      : db.auth
          .getSession()
          .then(({ data }) => Boolean(data.session && !data.session.user.is_anonymous))
          .catch(() => false);
  account = { at: Date.now(), signedIn };
  return signedIn;
}

/** Forget who was asking: a sign-in or sign-out just happened. */
export function historyAccountChanged(): void {
  account = null;
  changed();
}

export async function historyKeptInBrowser(): Promise<boolean> {
  return keptInBrowser(await signedInForHistory());
}

/* --- PAUSE ---------------------------------------------------------------------------------------- */

function visitorPaused(): boolean {
  try {
    return window.localStorage.getItem(VISITOR_PAUSED_KEY) === '1';
  } catch {
    return false;
  }
}

export async function readPlaysPaused(): Promise<boolean> {
  if (await historyKeptInBrowser()) return visitorPaused();
  return readAccountPaused();
}

export async function setPlaysPaused(paused: boolean): Promise<boolean> {
  if (await historyKeptInBrowser()) {
    try {
      window.localStorage.setItem(VISITOR_PAUSED_KEY, paused ? '1' : '0');
    } catch {
      return false;
    }
    changed();
    return true;
  }
  const done = await setAccountPaused(paused);
  changed();
  return done;
}

/* --- where a play came from, handed over by the place that pressed it ------------------------------ */

/**
 * A letter, a post or a comment says "the next thing that starts came from me" at the moment its PLAY is pressed; the
 * keeper takes it with the play that follows. It goes stale after 15 seconds, so a later play is never filed under it.
 */
export type PlayContext = { how: Extract<PlayHow, 'letter' | 'comment' | 'post' | 'profile' | 'playlist'>; whereLabel?: string; whereHref?: string | null; addedBy?: string | null; addedByName?: string; letterId?: string | null; sourceRef?: string | null };

const CONTEXT_FOR_MS = 15_000;
let armed: { at: number; context: PlayContext } | null = null;

export function armPlayContext(context: PlayContext): void {
  armed = { at: Date.now(), context };
}

export function takePlayContext(): PlayContext | null {
  const held = armed;
  armed = null;
  return held !== null && Date.now() - held.at < CONTEXT_FOR_MS ? held.context : null;
}

/* --- writing -------------------------------------------------------------------------------------- */

/** One play under way: `stop` says where it got to, once. */
export type PlayHandle = { stop: (leftAtSeconds: number | null, lengthSeconds: number | null) => void };

const NOTHING: PlayHandle = { stop: () => undefined };

/** Something started playing. Fire-and-forget; a paused history writes nothing. */
export function notePlay(note: PlayNote): PlayHandle {
  if (typeof window === 'undefined' || note.ref.trim() === '') return NOTHING;
  const id = (async () => {
    const signedIn = await signedInForHistory();
    if (keptInBrowser(signedIn) ? visitorPaused() : await readAccountPaused()) return null;
    const kept = await playsRepository(signedIn).note(note);
    changed();
    return kept === null ? null : { kept, signedIn };
  })().catch(() => null);
  let stopped = false;
  return {
    stop(leftAtSeconds, lengthSeconds) {
      if (stopped) return;
      stopped = true;
      void id
        .then((line) => (line === null ? undefined : playsRepository(line.signedIn).stop(line.kept, leftAtSeconds, lengthSeconds)))
        .catch(() => undefined);
    },
  };
}

/* --- reading and trimming ------------------------------------------------------------------------- */

export async function readPlays(limit: number, before?: string): Promise<Play[]> {
  return playsRepository(await signedInForHistory()).list(limit, before);
}

export async function removePlay(id: string): Promise<boolean> {
  const done = await playsRepository(await signedInForHistory()).remove(id);
  changed();
  return done;
}

/** ERASE in the window: every HISTORY line (FOR YOU's history is left alone). */
export async function erasePlays(): Promise<boolean> {
  const done = await playsRepository(await signedInForHistory()).erase();
  changed();
  return done;
}
