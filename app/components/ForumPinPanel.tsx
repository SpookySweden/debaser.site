'use client';

import Link from 'next/link';
import { useState } from 'react';
import { threadDomId } from '../lib/forum/anchors';
import { PIN_DURATIONS, livePins, pinLabel, pinSummary } from '../lib/forum/pins';
import type { ForumThread, PinDurationKey } from '../lib/forum/types';
import { PLATE } from '../lib/ui/controls';
import { useForum } from './ForumProvider';
import { useAdmin } from './ForumModerationControls';

function failure(caught: unknown, fallback: string): string {
  return caught instanceof Error ? caught.message : fallback;
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
  const [choosing, setChoosing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pin = forum.pinForThread(thread.id);
  if (!admin) return null;

  async function pinFor(duration: PinDurationKey) {
    setBusy(true);
    setError(null);

    try {
      await forum.pinThread(thread.id, duration);
      setChoosing(false);
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
      setChoosing(false);
    } catch (caught) {
      setError(failure(caught, 'THAT PIN COULD NOT BE TAKEN OFF.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-1 flex flex-wrap items-center gap-1 text-[10px] font-bold text-black">
      <span className="border border-black bg-[#000080] px-1 text-white">[ MOD ]</span>

      {pin === undefined ? null : (
        <span className="border border-black bg-[#800000] px-1 text-white" title={pinSummary(pin)}>
          {pinLabel(pin)}
        </span>
      )}

      <button type="button" onClick={() => setChoosing(!choosing)} disabled={busy} className={PLATE}>
        {choosing ? '[ CANCEL ]' : pin === undefined ? '[ PIN POST ]' : '[ CHANGE PIN ]'}
      </button>

      {pin === undefined ? null : (
        <button type="button" onClick={() => void unpin()} disabled={busy} className={PLATE}>
          {busy ? '[ WORKING... ]' : '[ UNPIN ]'}
        </button>
      )}

      {!choosing ? null : (
        <span className="flex w-full flex-wrap items-center gap-1 border border-gray-500 bg-[#f0f0f0] p-1">
          <span>PIN FOR:</span>
          {PIN_DURATIONS.map((duration) => (
            <button
              key={duration.key}
              type="button"
              onClick={() => void pinFor(duration.key)}
              disabled={busy}
              className={PLATE}
            >
              {duration.label}
            </button>
          ))}
          <span className="font-normal text-gray-700">
            IT SITS AT THE TOP OF THE BOARD AND LEADS THE WIRE.
          </span>
        </span>
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
    <section className="rounded-none border-2 border-t-white border-l-white border-r-gray-800 border-b-gray-800 bg-[#c0c0c0]">
      <div className="flex items-center justify-between bg-[#000080] px-2 py-1 text-[10px] font-bold text-white">
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
                    <Link href={`/forum#${threadDomId(thread.id)}`} className="underline hover:bg-gray-300">
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
