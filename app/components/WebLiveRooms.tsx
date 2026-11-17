'use client';

import { useEffect, useRef, useState } from 'react';
import { artSlot } from '../lib/ui/art/slots';
import { PLATE } from '../lib/ui/controls';
import { twitchOf, youtubeIdOf } from '../lib/watch/links';
import { enterRoom } from '../lib/watch/use-music-room';
import type { WatchLink } from '../lib/watch/types';
import { searchWords } from '../lib/web/search';
import { useLiveStreams, type LiveStreamRow } from './CytubeLiveStreams';
import SpriteSlot from './SpriteSlot';

/**
 * This site's live rooms in MEDIA, first (SPEC-live-streams.md; Luke, 2026-11-17: "also shows and prioritises user rooms, same
 * formatting as other media results"). Under a search, the rooms whose name, host or what is on has every word; under the
 * `[ ● LIVE ]` key with no words, every live room. The list is the ROOM list's own (`useLiveStreams`, CytubeLiveStreams.tsx), so
 * only rooms that list already shows that reader appear: never a private one. No count of who is in a room.
 *
 * Each row is drawn like an archive row (WebStream.tsx `WebRow`, WebSiteFiles.tsx): the picture of what is on (hotlinked from
 * YouTube's or Twitch's own picture server, built from the queued link's checked id, never an address from the data), what is on
 * as the title, `<HOST>'S ROOM` where a maker goes, the LIVE mark where a date goes, ROOM where a source goes, and JOIN.
 */

const MISSING_THUMB_SRC = `/${artSlot('web-thumb-missing')?.path ?? 'assets/web/thumb-missing.png'}`;
/** How many rooms show before `[ ALL n ROOMS ]`. */
const ROOMS_SHOWN = 3;

/** The picture of what is on: a YouTube video's or a live Twitch channel's, from the link's checked id; else none. */
export function roomPicture(link: WatchLink | null): string | null {
  if (link === null) return null;
  const youtube = youtubeIdOf(link);
  if (youtube !== null && /^[A-Za-z0-9][A-Za-z0-9_-]{10}$/.test(youtube)) return `https://i.ytimg.com/vi/${youtube}/hqdefault.jpg`;
  const twitch = twitchOf(link);
  if (twitch?.channel !== undefined && /^[a-z0-9][a-z0-9_]{1,24}$/.test(twitch.channel)) return `https://static-cdn.jtvnw.net/previews-ttv/live_user_${twitch.channel}-640x360.jpg`;
  return null;
}

/** The rooms a search finds: every word in the room's name, host or what is on. No words: every room. */
export function roomsMatching(rows: readonly LiveStreamRow[], query: string): LiveStreamRow[] {
  const wanted = searchWords(query) ?? [];
  if (wanted.length === 0) return [...rows];
  return rows.filter((row) => {
    const have = new Set(searchWords([row.name ?? '', row.hostName, row.title].join(' ')) ?? []);
    return wanted.every((word) => have.has(word));
  });
}

export default function WebLiveRooms({ query }: { query: string }) {
  const rooms = useLiveStreams();
  const [all, setAll] = useState(false);
  const matches = rooms === null ? [] : roomsMatching(rooms, query);
  if (matches.length === 0) return null;
  const shown = all ? matches : matches.slice(0, ROOMS_SHOWN);

  return (
    <section aria-label="Live rooms on this site" className="mb-2" data-live-rooms={matches.length}>
      <p className="text-label font-bold text-ink-quiet">{`LIVE ROOMS :: ${matches.length} ROOM${matches.length === 1 ? '' : 'S'}`}</p>
      <ul aria-label="Live rooms">
        {shown.map((room, index) => (
          <RoomRow key={room.roomId} room={room} focusFirst={all && index === ROOMS_SHOWN} />
        ))}
      </ul>
      {matches.length > shown.length ? (
        <button type="button" onClick={() => setAll(true)} className={`${PLATE} mt-1`}>
          {`[ ALL ${matches.length} ROOMS ]`}
        </button>
      ) : null}
    </section>
  );
}

function RoomRow({ room, focusFirst }: { room: LiveStreamRow; focusFirst: boolean }) {
  const [thumbFailed, setThumbFailed] = useState(false);
  const picture = thumbFailed ? null : roomPicture(room.link);
  const title = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (focusFirst) title.current?.focus();
  }, [focusFirst]);
  const host = room.hostName.toUpperCase();
  const on = room.title.length > 0 ? room.title : 'NOTHING ON YET';

  return (
    <li className="rule-pixel py-2" data-live-room={room.roomId}>
      <div className="flex items-start gap-2">
        <span className="block h-18 w-24 shrink-0 overflow-hidden border border-ink-plate bg-paper">
          {picture !== null ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={picture} alt="" width={96} height={72} loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setThumbFailed(true)} className="block h-full w-full object-cover" />
          ) : (
            <SpriteSlot
              src={MISSING_THUMB_SRC}
              alt=""
              width={96}
              height={72}
              title="No picture"
              fallback={<span aria-hidden="true" className="flex h-full w-full items-center justify-center text-label font-bold text-ink">NO IMAGE</span>}
            />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <p ref={title} tabIndex={-1} className="text-sm font-bold text-ink wrap-anywhere">
            {on}
          </p>
          <p className="text-label text-ink-quiet wrap-anywhere">{`${host}'S ROOM${room.name ? ` :: ${room.name.toUpperCase()}` : ''}`}</p>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-label">
            <span className="font-bold text-ink-quiet">{room.kind === 'music' ? 'MUSIC' : 'VIDEO'}</span>
            <span className="bg-acid px-1 font-bold text-ink-plate" data-live-mark>
              ● LIVE
            </span>
            <span className="bg-ice-pale px-1 font-bold text-ink">ROOM</span>
            {/* As the ROOM list joins (CytubePage.tsx): a music room folded with the bar playing it, a video room opened. */}
            <button type="button" onClick={() => enterRoom(room.roomId, room.kind)} className={PLATE} aria-label={`Join ${room.hostName}'s room, playing "${on}"`} data-live-room-join>
              [ ▶ JOIN ]
            </button>
          </div>
        </div>
      </div>
    </li>
  );
}
