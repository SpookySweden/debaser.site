/**
 * Keeps a tab's presence updates under Realtime's own limit, so the server never shuts the channel on it.
 *
 * Supabase Realtime allows each connection **5 presence calls (track or untrack) per channel in 30 seconds**; the sixth
 * closes that channel (`ClientPresenceRateLimitReached`, supabase/realtime `presence_handler.ex`, defaults
 * `CLIENT_PRESENCE_MAX_CALLS` 5 and `CLIENT_PRESENCE_WINDOW_MS` 30000). A room's channel is how everybody knows who is
 * watching, so a shut channel drops that person off the list of watchers, and their companion with them, until the
 * room joins again a few seconds later (Luke, 2026-11-16: "the characters ... popping in and out of existence ... it
 * seems to correspond with the user also dissapearing from the list of watchers"). A companion re-says its presence
 * whenever it picks a new spot, mood or reaction, which is easily more than five times in half a minute: the live logs
 * showed the channel shut that way 171 times in one day.
 *
 * So every call goes through here: at most `calls` in any `windowMs` (4 in 32 s: one under the limit, with two seconds
 * for the network to bunch them up). A call that would go over waits, and only the latest waiting one is sent, so the
 * room always ends up hearing the newest state, a few seconds late at worst. Pure apart from the clock it is handed.
 */

/** Calls sent in any one window: the server's 5, less one. */
export const PRESENCE_CALLS = 4;
/** The window: the server's 30 seconds, plus two for the network. */
export const PRESENCE_WINDOW_MS = 32_000;

export type PaceClock = {
  now: () => number;
  later: (run: () => void, ms: number) => unknown;
  cancel: (handle: unknown) => void;
};

const REAL_CLOCK: PaceClock = {
  now: () => Date.now(),
  later: (run, ms) => setTimeout(run, ms),
  cancel: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export type PresencePace = {
  /** Sends this call now if the window allows, otherwise once it does, unless a newer call has taken its place. */
  say: (call: () => void) => void;
  /** Forgets anything waiting and sends nothing more (the channel is being left or replaced). */
  stop: () => void;
};

/** One per joined channel: the server counts each channel of a connection on its own, from its first call. */
export function presencePace(clock: PaceClock = REAL_CLOCK, calls: number = PRESENCE_CALLS, windowMs: number = PRESENCE_WINDOW_MS): PresencePace {
  const sent: number[] = [];
  let waiting: (() => void) | null = null;
  let timer: unknown = null;
  let stopped = false;

  const flush = () => {
    timer = null;
    if (stopped || waiting === null) return;
    const now = clock.now();
    while (sent.length > 0 && now - sent[0] >= windowMs) sent.shift();
    if (sent.length < calls) {
      const call = waiting;
      waiting = null;
      sent.push(now);
      call();
      return;
    }
    // Looked at again the moment the oldest call leaves the window.
    timer = clock.later(flush, sent[0] + windowMs - now + 1);
  };

  return {
    say: (call) => {
      if (stopped) return;
      waiting = call;
      if (timer === null) flush();
    },
    stop: () => {
      stopped = true;
      waiting = null;
      if (timer !== null) clock.cancel(timer);
      timer = null;
    },
  };
}
