'use client';

import { useEffect, useRef, useState } from 'react';
import { getMusicRepository } from '../lib/audio/repository';
import { QUEUE_HEARTBEAT_MS, publishablePosition, shouldPublish } from '../lib/audio/heartbeat';
import { QUEUE_CHANGED } from '../lib/audio/queue-window';
import { useAuth } from './AuthProvider';
import { useMusicPlayer } from './MusicPlayerProvider';

/**
 * Keeps this account's broadcast alive while they listen.
 *
 * **Why this is not part of the switch.** The switch is the reader's *decision* - on or off - and it is a
 * component that mounts when the tab does and unmounts when they leave it. A broadcast has to go on
 * writing whether or not anybody is looking at the window that started it, so the two are separate
 * things: the switch says "publish me", and this says "and here is where I am".
 *
 * **The row has to move or it reads as dead.** `queueState` marks a queue `silent` after
 * `QUEUE_STALE_SECONDS`, so a host who goes public and then reads a thread would fall off the list's
 * lamps - not because they stopped listening, but because nobody was writing. A heartbeat is what makes
 * `SILENT` mean "they stopped" rather than "nobody has typed a number in a while".
 *
 * It runs only while this account is public *and* signed in, and it stops on sign-out - so the one write
 * this whole module can make is the reader's own row, which the policy would refuse anyway. Nothing here
 * publishes a paused listener's silence: `shouldPublish` decides, and it is a separate module so the
 * arithmetic can be checked without a browser.
 */
export default function BroadcastHeartbeat() {
  const { user, status } = useAuth();
  const player = useMusicPlayer();
  const repository = getMusicRepository();

  const trackId = player.track?.src ?? null;
  const index = player.index;
  const total = player.queue.length;

  /**
   * The moving values, in a ref rather than in the effect's dependencies.
   *
   * `elapsed` changes on every `timeupdate` - several times a second - so an effect that depended on it
   * would tear down and rebuild its interval continuously and never fire. The interval is set up from the
   * facts that decide *whether* to broadcast (who, which track, may they) and reads the clock out of this
   * ref when it fires. That is the whole reason it is written this way, and it is the sort of thing that
   * looks like a style choice until the row never moves.
   *
   * Written in an effect, not during render: a ref touched while rendering is a value React cannot see
   * change, which is the fault the lint rule is there to catch.
   */
  const clock = useRef({ position: 0, playing: false, rate: 1 });

  useEffect(() => {
    clock.current = {
      position: player.elapsed,
      playing: player.playing,
      rate: player.playbackRate,
    };
  }, [player.elapsed, player.playing, player.playbackRate]);

  /**
   * Whether this account is broadcasting, re-read when they sign in or the switch is pressed.
   *
   * Reading it on mount is not enough: the switch writes the row *after* this has mounted, so a reader
   * who presses `[ GO PUBLIC ]` would be on the list and not heartbeating until they reloaded. The event
   * the switch sends is what closes that gap.
   *
   * The signed-out case is *derived* rather than written back into this state. Setting it to false in an
   * effect would be a second render for a fact that is already known, and it is the shape the lint rule
   * warns about - so `broadcasting` below is the only thing the rest of this file reads.
   */
  const [published, setPublished] = useState(false);
  const [revision, setRevision] = useState(0);

  const userId = user?.id ?? null;

  /** The one reading: signed in *and* public. Everything else here uses this. */
  const broadcasting = status === 'signed-in' && userId !== null && published;

  useEffect(() => {
    if (status !== 'signed-in' || userId === null) return;

    let cancelled = false;

    void repository
      .readOwnQueue(userId)
      .then((own) => {
        if (!cancelled) setPublished(own?.isPublic ?? false);
      })
      .catch(() => {
        // Unreadable: treated as not broadcasting. A heartbeat that guessed the other way would write a
        // public row for somebody who had turned it off.
        if (!cancelled) setPublished(false);
      });

    return () => {
      cancelled = true;
    };
  }, [repository, revision, status, user, userId]);

  // A press on the switch is a change of state this component cannot see on its own, and it cannot see
  // the *switch* either - they are siblings in different subtrees. The event is the seam between them.
  useEffect(() => {
    const onChange = () => setRevision((current) => current + 1);

    window.addEventListener(QUEUE_CHANGED, onChange);
    return () => window.removeEventListener(QUEUE_CHANGED, onChange);
  }, []);

  useEffect(() => {
    if (!broadcasting || userId === null || trackId === null) return;

    let lastPublished = -1;

    const publish = () => {
      const { position, playing, rate } = clock.current;
      const at = publishablePosition(position, playing, rate);

      // Nothing to say: a paused listener whose position has not moved. The row keeps its last write and
      // ages into `SILENT` on its own, which is the honest answer - they are not playing anything.
      if (!shouldPublish(at, lastPublished, playing)) return;

      lastPublished = at;

      void repository
        .publishQueue({
          userId,
          trackId,
          trackIndex: index,
          trackTotal: total,
          positionSeconds: at,
          isPublic: true,
        })
        .catch(() => {
          // A dropped heartbeat is not worth a banner: the next one is seconds away, and a screen that
          // flashed a fault every time a phone changed network would be unreadable. The row going quiet
          // is the visible symptom, and the list says SILENT for it.
        });
    };

    publish();

    const timer = window.setInterval(publish, QUEUE_HEARTBEAT_MS);

    return () => window.clearInterval(timer);
  }, [broadcasting, index, repository, total, trackId, userId]);

  return null;
}
