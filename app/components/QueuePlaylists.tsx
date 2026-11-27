'use client';

import Link from 'next/link';
import { useMemo, useState, useSyncExternalStore } from 'react';
import type { Playlist, PlaylistItem } from '../lib/audio/library';
import { webTrackNow } from '../lib/web/web-track-lookup';
import { useCatalogue } from '../lib/media/catalogue';
import { PLATE, PLATE_LINK, PLATE_PRESSED } from '../lib/ui/controls';
import { FILE_ITEM, listThings } from '../lib/watch/music-rooms';
import { NO_ROOM_YET, addToMyQueue } from '../lib/watch/my-queue';
import { ownRoomState, subscribeToOwnRoom } from '../lib/watch/own-room-client';
import { soloRefusal } from '../lib/watch/own-screen';
import { isTrustedPicture } from '../lib/watch/pictures';
import { upcoming } from '../lib/watch/rules';
import { useWatchRoom } from '../lib/watch/use-watch-room';
import { useAuth } from './AuthProvider';
import { useMusicLibrary } from './MusicLibraryProvider';
import { useMusicPlayer } from './MusicPlayerProvider';
import { NOTE, explain } from '../lib/ui/explain';

/**
 * PLAYLISTS, the queue window's middle tab (SPEC-rooms-queues.md, phase 4; Luke's answers 3A and 9A): your saved
 * queues. A playlist holds songs, videos and the site's own files in order, each kept whole as a link, never a copy.
 *
 * - `[ ▶ PLAY ]` makes the playlist your queue and starts its first thing (a second press when something is already
 *   waiting, because it replaces it). Not offered inside a live room, where the queue is not only yours.
 * - `[ + QUEUE ]` adds it to the end of the queue you are on: your own, or the live room's by the crown rule.
 * - A name opens the list: every item, each with `[ × ]` to take it out.
 *
 * Making one is SAVE AS PLAYLIST under any queue (UP NEXT), or the PLAYLIST key on a song or a MEDIA row. Naming,
 * and deleting a whole playlist, are in MY MUSIC.
 */
export default function QueuePlaylists() {
  const { user } = useAuth();
  const library = useMusicLibrary();
  const player = useMusicPlayer();
  const catalogue = useCatalogue();
  const own = useSyncExternalStore(subscribeToOwnRoom, ownRoomState, ownRoomState);
  const ownRead = useWatchRoom(own.roomId, { follow: false }).read;
  const [open, setOpen] = useState<string | null>(null);
  const [armed, setArmed] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<{ list: string; words: string } | null>(null);

  const shelf = player.queue;
  const byId = useMemo(() => new Map(shelf.map((track) => [track.id, track])), [shelf]);
  const fileTitles = useMemo(() => new Map(catalogue.items.map((item) => [item.id, item.title])), [catalogue.items]);
  const trackById = (id: string) => byId.get(id) ?? webTrackNow(id) ?? undefined;
  const inLiveRoom = player.room !== null;
  const waitingAtHome = ownRead === undefined || ownRead === null ? 0 : upcoming(ownRead.queue).length;

  if (user === null || !library.canWrite) {
    return (
      <p className="p-3 text-label font-bold text-ink" data-queue-playlists="signed-out">
        <Link href="/account" className={PLATE_LINK} {...explain('Goes to the account page to log in or make an account.', 'Playlists are kept on your account.')}>
          [ LOG IN ]
        </Link>{' '}
        TO KEEP PLAYLISTS
      </p>
    );
  }
  const userId = user.id;

  /** A song is marked with a note, as the queue marks it; a file by its title in FILES. */
  const titleOf = (item: PlaylistItem): string => {
    if (item.link !== undefined) return item.link.kind === 'audio' ? `♪ ${item.link.title}` : item.link.kind === 'picture' ? `▣ ${isTrustedPicture(item.link.url) ? '' : 'OUTSIDE :: '}${item.link.title}` : item.link.title;
    if (item.trackId.startsWith(FILE_ITEM)) return fileTitles.get(item.trackId.slice(FILE_ITEM.length)) ?? 'A FILE NO LONGER HELD';
    const track = trackById(item.trackId);
    return track === undefined ? 'A SONG NO LONGER HELD' : `♪ ${track.title}`;
  };

  async function queue(list: Playlist, replace: boolean) {
    setArmed(null);
    setBusy(true);
    setSaid(null);
    const say = (words: string) => setSaid({ list: list.id, words });
    try {
      const things = listThings(list.items, trackById);
      if (things.length === 0) {
        say('NOTHING IN THAT PLAYLIST PLAYS HERE.');
        return;
      }
      if (inLiveRoom) {
        // The live room's queue, by its own rule: with a crown straight in, otherwise onto your list there.
        let queued = 0;
        let listed = 0;
        for (const thing of things) {
          const result = await addToMyQueue(thing.link !== undefined ? { title: thing.link.title, link: thing.link } : { title: fileTitles.get(thing.mediaItemId) ?? '', mediaItemId: thing.mediaItemId }, userId);
          if (result.as === 'queued') queued += 1;
          else listed += 1;
        }
        say(listed === 0 ? `${queued} ADDED TO THE LIVE ROOM'S QUEUE.` : `${listed} PUT ON YOUR LIST IN THE LIVE ROOM${queued > 0 ? `, ${queued} QUEUED` : ''}.`);
        return;
      }
      const session = ownRoomState().session;
      if (session === null) throw new Error(NO_ROOM_YET);
      const plays = things.filter((thing) => thing.link === undefined || soloRefusal(thing.link) === null);
      const liveOnly = things.length - plays.length;
      const liveOnlyWords = liveOnly > 0 ? ` ${liveOnly} PLAY IN A LIVE ROOM ONLY.` : '';
      if (replace) {
        const held = session.replaceWaiting(plays);
        if (held > 0) player.next();
        say(`${list.name} IS YOUR QUEUE NOW: ${held} ${held === 1 ? 'THING' : 'THINGS'}.${liveOnlyWords}`);
        return;
      }
      const added = session.enqueueThings(plays);
      say(`${added} ADDED TO YOUR QUEUE.${added < plays.length ? ' THE REST WERE ALREADY WAITING, OR THE QUEUE IS FULL.' : ''}${liveOnlyWords}`);
    } catch (failure) {
      say(failure instanceof Error ? failure.message : 'THE PLAYLIST COULD NOT BE QUEUED.');
    } finally {
      setBusy(false);
    }
  }

  async function takeOut(list: Playlist, item: PlaylistItem) {
    setBusy(true);
    try {
      await library.togglePlaylistTrack(list.id, item.trackId);
    } catch (failure) {
      setSaid({ list: list.id, words: failure instanceof Error ? failure.message : 'IT COULD NOT BE TAKEN OUT.' });
    } finally {
      setBusy(false);
    }
  }

  if (library.playlists.length === 0) {
    return (
      <p className="p-3 text-label font-bold text-ink" data-queue-playlists="none">
        NO PLAYLISTS YET. [ SAVE AS PLAYLIST ] IS UNDER YOUR QUEUE, ON UP NEXT.
      </p>
    );
  }

  return (
    <section aria-label="Playlists" className="text-label text-ink" data-queue-playlists="some">
      <ul className="divide-y divide-dotted divide-ink">
        {library.playlists.map((list) => {
          const shown = open === list.id;
          const replaces = armed === list.id;
          return (
            <li key={list.id} className="px-2 py-1" data-playlist={list.name}>
              <div className="flex flex-wrap items-center gap-2">
                <button type="button" className="min-w-0 flex-1 cursor-pointer truncate text-left font-bold hover:underline max-sm:min-h-tap" aria-expanded={shown} {...explain(shown ? 'Folds this playlist shut.' : 'Opens this playlist to show what is in it.', 'To see, play or take out its things one by one.')} onClick={() => setOpen(shown ? null : list.id)} data-playlist-open>
                  {shown ? '▾' : '▸'} {list.name} ({list.items.length})
                </button>
                {inLiveRoom ? null : (
                  <button
                    type="button"
                    className={replaces ? PLATE_PRESSED : PLATE}
                    disabled={busy || list.items.length === 0}
                    onClick={() => (waitingAtHome > 0 && !replaces ? setArmed(list.id) : void queue(list, true))}
                    onBlur={() => setArmed((was) => (was === list.id ? null : was))}
                    title="Your queue becomes this playlist, and its first thing starts"
                    aria-label={replaces ? `Replace your queue with ${list.name}` : `Play ${list.name}`}
                    data-playlist-play
                    {...explain(replaces ? 'Replaces your queue with this playlist now, and its first thing starts.' : 'Your queue becomes this playlist, and its first thing starts.', 'If things are already waiting in your queue, it asks first; clicking elsewhere cancels.', NOTE.asks)}
                  >
                    {replaces ? '[ REPLACE YOUR QUEUE? ]' : '[ ▶ PLAY ]'}
                  </button>
                )}
                <button
                  type="button"
                  className={PLATE}
                  disabled={busy || list.items.length === 0}
                  onClick={() => void queue(list, false)}
                  title={inLiveRoom ? "Add it to the end of the live room's queue" : 'Add it to the end of your queue'}
                  aria-label={`Add ${list.name} to the queue`}
                  data-playlist-queue
                  {...explain(inLiveRoom ? 'Adds the whole playlist to the end of the live room\'s queue.' : 'Adds the whole playlist to the end of your queue.', 'What is already queued stays ahead of it.')}
                >
                  [ + QUEUE ]
                </button>
              </div>
              {said !== null && said.list === list.id ? (
                <p className="font-bold" role="status" data-playlist-said>
                  {said.words}
                </p>
              ) : null}
              {shown ? (
                list.items.length === 0 ? (
                  <p className="text-ink-quiet">EMPTY.</p>
                ) : (
                  <ol className="mt-1 flex flex-col gap-0.5" aria-label={`In ${list.name}`}>
                    {list.items.map((item) => (
                      <li key={item.trackId} className="flex items-center gap-2" data-playlist-item>
                        <span className="min-w-0 flex-1 truncate" title={titleOf(item)}>
                          {titleOf(item)}
                        </span>
                        <button type="button" className={PLATE} disabled={busy} aria-label={`Take ${titleOf(item)} out of ${list.name}`} {...explain('Takes this out of the playlist.', 'Only the playlist changes; anything already queued stays.')} onClick={() => void takeOut(list, item)}>
                          [ × ]
                        </button>
                      </li>
                    ))}
                  </ol>
                )
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
