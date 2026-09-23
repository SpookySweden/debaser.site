'use client';

import Link from 'next/link';
import { useState } from 'react';
import { threadDomId } from '../lib/forum/anchors';
import { DEFAULT_PIN_DURATION, PIN_DURATIONS, livePins, pinLabel, pinSummary } from '../lib/forum/pins';
import type { ForumThread, PinDurationKey } from '../lib/forum/types';
import { PLATE } from '../lib/ui/controls';
import { useForum } from './ForumProvider';
import { useAdmin } from './ForumModerationControls';

function failure(caught: unknown, fallback: string): string {
  return caught instanceof Error ? caught.message : fallback;
}

/** One shared audio context for the selector's beep, made lazily on the first click. */
let beepContext: AudioContext | null = null;

/**
 * A short, low-volume, high-pitched beep for the duration selector.
 *
 * Sound is optional: if the browser has no audio (or refuses it) the number still cycles, so
 * this swallows every failure and never blocks the click.
 */
function playPinTick(): void {
  try {
    const Ctx = typeof AudioContext !== 'undefined' ? AudioContext : undefined;
    if (Ctx === undefined) return;

    beepContext ??= new Ctx();
    const context = beepContext;
    const now = context.currentTime;

    const oscillator = context.createOscillator();
    const gain = context.createGain();

    oscillator.type = 'square';
    oscillator.frequency.setValueAtTime(1400, now);
    gain.gain.setValueAtTime(0.03, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.07);

    oscillator.connect(gain);
    gain.connect(context.destination);

    oscillator.start(now);
    oscillator.stop(now + 0.07);
  } catch {
    // No audio available: the selector still cycles.
  }
}

/**
 * Pin this post, for as long as the moderator says.
 *
 * Only the house account draws this at all (`useAdmin`, the same test the edit and remove
 * controls use), and only it can make the write stick: both stores refuse anybody else, and the
 * database's `is_admin()` policies refuse again. The durations are the whole choice - an hour for
 * something happening now, a day by default, up to forever for a standing notice - and a post
 * that is already pinned can be re-pinned (to extend it) or unpinned from the same strip.
 */
export function ThreadPinControl({ thread }: { thread: ForumThread }) {
  const forum = useForum();
  const admin = useAdmin();
  const [duration, setDuration] = useState<PinDurationKey>(DEFAULT_PIN_DURATION);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pin = forum.pinForThread(thread.id);
  const durationChoice = PIN_DURATIONS.find((entry) => entry.key === duration);
  if (!admin) return null;

  async function pinFor() {
    setBusy(true);
    setError(null);

    try {
      await forum.pinThread(thread.id, duration);
    } catch (caught) {
      setError(failure(caught, 'THAT POST COULD NOT BE PINNED.'));
    } finally {
      setBusy(false);
    }
  }

  async function unpin() {
    setBusy(true);
    setError(null);

    try {
      await forum.unpinThread(thread.id);
    } catch (caught) {
      setError(failure(caught, 'THAT PIN COULD NOT BE TAKEN OFF.'));
    } finally {
      setBusy(false);
    }
  }

  function cycleDuration() {
    playPinTick();
    setDuration((current) => {
      const index = PIN_DURATIONS.findIndex((entry) => entry.key === current);
      const next = PIN_DURATIONS[(index + 1) % PIN_DURATIONS.length];
      return next.key;
    });
  }

  return (
    <div className="mt-1 flex flex-wrap items-center gap-1 text-[10px] font-bold text-black">
      <span className="border border-black bg-ena px-1 text-white">[ MOD ]</span>

      {pin === undefined ? null : (
        <span className="border border-black bg-[#800000] px-1 text-white" title={pinSummary(pin)}>
          {pinLabel(pin)}
        </span>
      )}

      <button type="button" onClick={() => void pinFor()} disabled={busy} className={PLATE}>
        {busy ? '[ WORKING... ]' : pin === undefined ? '[ PIN POST ]' : '[ CHANGE PIN ]'}
      </button>

      <button
        key={duration}
        type="button"
        onClick={cycleDuration}
        disabled={busy}
        title={`Pin for ${durationChoice?.label.toLowerCase() ?? ''} - click to cycle`}
        className={`${PLATE} pin-tick`}
      >
        [ {durationChoice?.short ?? duration} ]
      </button>

      {pin === undefined ? null : (
        <button type="button" onClick={() => void unpin()} disabled={busy} className={PLATE}>
          {busy ? '[ WORKING... ]' : '[ UNPIN ]'}
        </button>
      )}

      {error === null ? null : <span className="text-[#800000]">{error}</span>}
    </div>
  );
}

/**
 * The moderators' panel: what is pinned right now.
 *
 * A pinned post is easy to forget - it is doing its job precisely when nobody is looking at it -
 * so this says what is held where, and until when, in one place: the post, who pinned it, how
 * long is left, and `[ UNPIN ]`. It is drawn for the house account only, because it is a control
 * panel rather than a status: everybody else sees the pins themselves, at the top of the board
 * and leading the wire.
 */
export default function ForumPinPanel() {
  const forum = useForum();
  const admin = useAdmin();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const pins = livePins(forum.pins);
  if (!admin) return null;

  async function unpin(threadId: string) {
    setBusyId(threadId);
    setError(null);

    try {
      await forum.unpinThread(threadId);
    } catch (caught) {
      setError(failure(caught, 'THAT PIN COULD NOT BE TAKEN OFF.'));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section className="rounded-none border-2 border-t-white border-l-white border-r-gray-800 border-b-gray-800 bg-sun-pale">
      <div className="flex items-center justify-between bg-ena px-2 py-1 text-[10px] font-bold text-white">
        <span>PINNED POSTS :: MODERATORS</span>
        <span>[ {pins.length === 0 ? 'NOTHING PINNED' : `${pins.length} PINNED`} ]</span>
      </div>

      <div className="p-2 text-black">
        <p className="text-[10px] font-bold">
          A PIN HOLDS A POST AT THE TOP OF THE BOARD AND LEADS THE WIRE UNTIL IT RUNS OUT - OR
          FOREVER, IF THAT IS WHAT WAS PICKED. `[ PIN POST ]` ON ANY POST BELOW TAKES ONE.
        </p>

        {pins.length === 0 ? (
          <p className="mt-1 text-[10px] text-gray-700">NO POST IS PINNED AT THE MOMENT.</p>
        ) : (
          <ul className="mt-1 space-y-1">
            {pins.map((pin) => {
              const thread = forum.threads.find((item) => item.id === pin.threadId);

              return (
                <li
                  key={pin.threadId}
                  className="flex flex-wrap items-center gap-x-2 gap-y-1 border border-gray-500 bg-white p-1 text-[10px] font-bold"
                >
                  <span className="border border-black bg-[#800000] px-1 text-white">{pinLabel(pin)}</span>

                  {thread === undefined ? (
                    <span className="text-gray-700">A POST THAT IS NO LONGER ON THE BOARD</span>
                  ) : (
                    <Link href={`/forum#${threadDomId(thread.id)}`} className="underline hover:bg-ice">
                      {thread.title}
                    </Link>
                  )}

                  <span className="font-normal text-gray-700">{pinSummary(pin)}</span>

                  <button
                    type="button"
                    onClick={() => void unpin(pin.threadId)}
                    disabled={busyId !== null}
                    className={PLATE}
                  >
                    {busyId === pin.threadId ? '[ WORKING... ]' : '[ UNPIN ]'}
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        {error === null ? null : <p className="mt-1 text-[10px] font-bold text-[#800000]">{error}</p>}
      </div>
    </section>
  );
}
