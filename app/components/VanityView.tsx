'use client';

import Link from 'next/link';
import { createContext, useContext, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { hostState, type BroadcastQueue } from '../lib/audio/broadcast';
import { RADIO_CONTEXT, radioState, startRadio, stopRadio, subscribeToRadio } from '../lib/audio/radio';
import { forYou, isEmpty, liveFor, radioRound, type CloseRow, type Face, type Pick } from '../lib/audio/for-you';
import { hasMirror, mirror, type MirrorRow } from '../lib/audio/mirror';
import { formatClock } from '../lib/audio/format';
import { MAX_PLAYLIST_NAME } from '../lib/audio/library';
import { collectFiledTracks } from '../lib/audio/forum-tracks';
import { VANITY_HREF } from '../lib/audio/music-window';
import { getMusicRepository } from '../lib/audio/repository';
import { uploaderIdFromSrc } from '../lib/audio/track-context';
import type { AudioTrack } from '../lib/audio/tracks';
import {
  albumPlaylistName,
  byAlbum,
  byArtist,
  bySongPlays,
  playsLabel,
  vanitySongs,
  type VanityAlbum,
  type VanityArtist,
  type VanitySong,
} from '../lib/audio/vanity';
import { DEFAULT_AVATAR_SRC } from '../lib/profile/avatar-catalogue';
import { displayCrop } from '../lib/profile/avatar-crop';
import { usePublicProfile } from '../lib/profile/use-public-profile';
import { currentAvatarVersion } from '../lib/profile/visibility';
import { PLATE, PLATE_PRESSED, TITLE_BAR } from '../lib/ui/controls';
import { useAuth } from './AuthProvider';
import { useForum } from './ForumProvider';
import LibraryRow from './LibraryRow';
import { useMusicLibrary } from './MusicLibraryProvider';
import { useMusicPlayer } from './MusicPlayerProvider';
import ProfileAvatar from './ProfileAvatar';
import QueueProfilePopout from './QueueProfilePopout';

type Tab = 'foryou' | 'artist' | 'album' | 'song' | 'mirror';

const TABS: { key: Tab; label: string }[] = [
  { key: 'foryou', label: 'FOR YOU' },
  { key: 'artist', label: 'BY ARTIST' },
  { key: 'album', label: 'BY ALBUM' },
  { key: 'song', label: 'BY SONG' },
];

/** Only for someone who filed at least one song, and only they see it. */
const MIRROR_TAB: { key: Tab; label: string } = { key: 'mirror', label: 'MIRROR' };

/** Live faces (step 7): the broadcasts live right now, and opening one's card to follow along. */
const LiveContext = createContext<{ live: BroadcastQueue[]; open: (queue: BroadcastQueue) => void }>({ live: [], open: () => {} });

/**
 * VANITY (SPEC-vanity.md step 4): the site's MP3s laid out by artist, by album and by song, inside the
 * music window beside MY MUSIC.
 *
 * Artist and album come from the folder path (`lib/audio/vanity.ts`); an MP3 attached to a post is a
 * single by whoever posted it. A tile wears the picture of the person who filed most of its songs - no
 * drawn covers. Play counts are public totals (`music_play_counts`: capped, numbers only, no names).
 * FOR YOU (step 5, `lib/audio/for-you.ts`) is made from what the reader's closest people play; until
 * anybody has listened it says so in one line.
 */
export default function VanityView() {
  const player = useMusicPlayer();
  const library = useMusicLibrary();
  const forum = useForum();
  const userId = useAuth().user?.id ?? null;
  const repository = useMemo(() => getMusicRepository(), []);

  const [shelf, setShelf] = useState<AudioTrack[]>([]);
  const [counts, setCounts] = useState<ReadonlyMap<string, number>>(new Map());
  const [ready, setReady] = useState(false);
  const [tab, setTab] = useState<Tab>('artist');
  /** What is open: an artist, or an album (and the artist page it was opened from, for BACK). */
  const [open, setOpen] = useState<{ kind: 'artist' | 'album'; key: string; from?: string } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;

    void (async () => {
      const [tracks, plays] = await Promise.all([repository.listTracks(), repository.playCounts()]);
      if (!alive) return;

      setShelf(tracks);
      setCounts(plays);
      setReady(true);
    })();

    return () => {
      alive = false;
    };
  }, [repository]);

  /** FOR YOU's raw rows and the reader's own plays; a guest has neither and gets the all-site picks. */
  const [mirrorRows, setMirrorRows] = useState<MirrorRow[]>([]);
  const radio = useSyncExternalStore(subscribeToRadio, radioState, radioState);
  /** Broadcasts live right now, for the live markers; and the one whose card is open. */
  const [live, setLive] = useState<BroadcastQueue[]>([]);
  const [card, setCard] = useState<{ queue: BroadcastQueue; at: number } | null>(null);

  useEffect(() => {
    let alive = true;
    const read = () =>
      void repository
        .listQueues()
        .then((queues) => {
          const now = Date.now();
          if (alive) setLive(queues.filter((queue) => hostState(queue, now) === 'live'));
        })
        .catch(() => {
          // The markers stay as they were until the next read.
        });

    read();
    const unsubscribe = repository.subscribeToQueues(read);
    // A host who goes quiet writes nothing, so a slow poll is what lets their marker go.
    const poll = window.setInterval(read, 30000);
    return () => {
      alive = false;
      unsubscribe();
      window.clearInterval(poll);
    };
  }, [repository]);
  const [close, setClose] = useState<{ rows: CloseRow[]; mine: ReadonlyMap<string, number> }>({ rows: [], mine: new Map() });

  useEffect(() => {
    let alive = true;

    void (async () => {
      const [rows, mine] = userId === null ? [[], new Map<string, number>()] : await Promise.all([repository.forYou(userId), repository.myPlays(userId)]);
      if (alive) setClose({ rows, mine });
      const mirrored = userId === null ? [] : await repository.mirror(userId);
      if (alive) setMirrorRows(mirrored);
    })();

    return () => {
      alive = false;
    };
  }, [repository, userId]);

  const filed = useMemo(
    () => collectFiledTracks(forum.threads).map(({ track, poster }) => ({ track, poster })),
    [forum.threads],
  );
  const songs = useMemo(() => vanitySongs(shelf, filed, counts, uploaderIdFromSrc), [shelf, filed, counts]);
  const artists = useMemo(() => byArtist(songs), [songs]);
  const albums = useMemo(() => byAlbum(songs), [songs]);
  const ranked = useMemo(() => [...songs].sort(bySongPlays), [songs]);
  const showMirror = hasMirror(songs, userId);
  const mirrored = useMemo(() => mirror(songs, mirrorRows, userId), [songs, mirrorRows, userId]);
  const picks = useMemo(
    () => forYou({ songs, rows: close.rows, mine: close.mine, barred: library.barredSrcs, selfId: userId }),
    [songs, close, library.barredSrcs, userId],
  );

  function toggleRadio() {
    if (radio.on) {
      stopRadio();
      return;
    }
    const pool = picks.pool.map((pick) => ({ key: pick.key, score: pick.score, track: pick.songs[0].track }));
    const [first] = radioRound(pool, new Set(), Math.random, 1);
    if (first === undefined) return;
    player.play(first.track, { origin: 'shelf', href: VANITY_HREF, where: 'VANITY', context: RADIO_CONTEXT });
    startRadio(pool, first.key, player.upNext.map((track) => track.src));
  }

  const openArtist = open?.kind === 'artist' ? artists.find((artist) => artist.key === open.key) : undefined;
  const openAlbum = open?.kind === 'album' ? albums.find((album) => album.key === open.key) : undefined;

  const playSong = (song: VanitySong<AudioTrack>, context: string) =>
    player.track?.src === song.track.src
      ? player.toggle()
      : player.play(song.track, { origin: 'shelf', href: VANITY_HREF, where: 'VANITY', context });

  async function saveSongs(name: string, list: VanitySong<AudioTrack>[]) {
    setNotice(null);
    try {
      const now = new Date().toISOString();
      const made = await library.savePlaylist(
        name.length <= MAX_PLAYLIST_NAME ? name : name.slice(0, MAX_PLAYLIST_NAME).trimEnd(),
        list.map((song) => ({ trackId: song.track.id, addedAt: now })),
      );
      setNotice(`SAVED TO MY MUSIC :: ${made.name}`);
    } catch (caught) {
      setNotice(caught instanceof Error ? caught.message : 'THE LIBRARY DID NOT ANSWER.');
    }
  }

  const songList = (list: VanitySong<AudioTrack>[], context: string, extra?: (song: VanitySong<AudioTrack>) => React.ReactNode) =>
    list.length === 0 ? (
      <p className="p-2 text-label text-ink">EMPTY.</p>
    ) : (
      <ul>
        {list.map((song, index) => {
          const current = player.track?.src === song.track.src;
          return (
            <LibraryRow
              key={song.track.src}
              track={song.track}
              index={index}
              playing={current && player.playing}
              current={current}
              duration={current && Number.isFinite(player.duration) ? formatClock(player.duration) : song.track.length}
              onPlay={() => playSong(song, context)}
              // The artist only where the credit line does not already say it.
              note={[
                song.album === null && song.artist.toUpperCase() !== song.track.credit.trim().toUpperCase() ? song.artist : '',
                playsLabel(song.plays),
              ]
                .filter((part) => part.length > 0)
                .join(' :: ')}
              extra={extra?.(song)}
            />
          );
        })}
      </ul>
    );

  return (
    <LiveContext.Provider value={{ live, open: (queue) => setCard({ queue, at: Date.now() }) }}>
    <section>
      {card === null ? null : <QueueProfilePopout queue={card.queue} now={card.at} mine={card.queue.userId === userId} onClose={() => setCard(null)} />}
      <div className="mb-2 flex flex-wrap items-center gap-1" role="tablist" aria-label="Vanity views">
        {(showMirror ? [...TABS, MIRROR_TAB] : TABS).map((entry) => (
          <button
            key={entry.key}
            type="button"
            role="tab"
            aria-selected={tab === entry.key}
            onClick={() => {
              setTab(entry.key);
              setOpen(null);
              setNotice(null);
            }}
            className={tab === entry.key ? `${PLATE_PRESSED} cursor-pointer` : PLATE}
          >
            [ {entry.label} ]
          </button>
        ))}
      </div>

      {notice === null ? null : (
        <p role="status" className="mb-2 text-label font-bold text-ink">
          {notice}
        </p>
      )}

      {!ready ? (
        <p className="p-2 text-label text-ink">READING THE SHELF...</p>
      ) : openAlbum !== undefined ? (
        <AlbumPage
          album={openAlbum}
          onBack={() => {
            setOpen(open?.from === undefined ? null : { kind: 'artist', key: open.from });
            setNotice(null);
          }}
          onSave={() => void saveSongs(albumPlaylistName(openAlbum.artist, openAlbum.name), openAlbum.songs)}
          canSave={library.canWrite}
        >
          {songList(openAlbum.songs, `${openAlbum.artist} / ${openAlbum.name}`)}
        </AlbumPage>
      ) : openArtist !== undefined ? (
        <ArtistPage
          artist={openArtist}
          onBack={() => setOpen(null)}
          onAlbum={(key) => setOpen({ kind: 'album', key, from: openArtist.key })}
          singles={songList(openArtist.singles, openArtist.name)}
        />
      ) : tab === 'foryou' ? (
        isEmpty(picks) && !radio.on ? (
          <p className="p-2 text-label text-ink">NOTHING YET :: PICKS APPEAR AS PEOPLE LISTEN</p>
        ) : (
          <div className="flex flex-col gap-3">
            {/* While it runs the key stays, even if every pick was barred since: it is the only way to stop it. */}
            {picks.pool.length === 0 && !radio.on ? null : (
              <button
                type="button"
                onClick={toggleRadio}
                aria-pressed={radio.on}
                className={radio.on ? `${PLATE_PRESSED} cursor-pointer self-start` : `${PLATE} self-start`}
                title={radio.on ? 'Stop the endless queue of picks' : 'Play an endless queue of your picks'}
              >
                {radio.on ? '[ ■ PLAYING FOR YOU ]' : '[ ▶ PLAY FOR YOU ]'}
              </button>
            )}

            {picks.songs.length === 0 ? null : (
              <PickRow title="SONGS" onSave={library.canWrite ? () => void saveSongs('FOR YOU - SONGS', picks.songs.flatMap((pick) => pick.songs)) : undefined}>
                {songList(
                  picks.songs.flatMap((pick) => pick.songs),
                  'FOR YOU',
                  (song) => {
                    const pick = picks.songs.find((entry) => entry.key === song.track.src);
                    return pick === undefined ? null : <PickWhy pick={pick} />;
                  },
                )}
              </PickRow>
            )}

            {picks.artists.length === 0 ? null : (
              <PickRow title="ARTISTS">
                <PickList items={picks.artists} onOpen={(key) => setOpen({ kind: 'artist', key })} />
              </PickRow>
            )}

            {picks.albums.length === 0 ? null : (
              <PickRow title="ALBUMS">
                <PickList items={picks.albums} onOpen={(key) => setOpen({ kind: 'album', key })} />
              </PickRow>
            )}

            {picks.onRepeat.length === 0 ? null : (
              <PickRow title="ON REPEAT" onSave={library.canWrite ? () => void saveSongs('ON REPEAT', picks.onRepeat) : undefined}>
                {songList(picks.onRepeat, 'ON REPEAT')}
              </PickRow>
            )}

            {picks.orbits.map((orbit) => (
              <OrbitRow
                key={orbit.personId}
                personId={orbit.personId}
                onSave={library.canWrite ? (name) => void saveSongs(`${name}'S ORBIT`, orbit.songs) : undefined}
              >
                {songList(orbit.songs, 'FOR YOU')}
              </OrbitRow>
            ))}
          </div>
        )
      ) : tab === 'mirror' && showMirror ? (
        <div className="flex flex-col gap-3">
          <PickRow title="TOP LISTENERS">
            <div className="px-2 py-1">
              {mirrored.total === 0 ? (
                <p className="text-label text-ink">NO PLAYS YET</p>
              ) : (
                <>
                  <Faces faces={mirrored.top} more={mirrored.more} srcs={new Set(mirrored.songs.map((entry) => entry.song.track.src))} />
                  <p className="text-label text-ink">{playsLabel(mirrored.total)} ON YOUR SONGS</p>
                </>
              )}
            </div>
          </PickRow>
          <PickRow title="YOUR SONGS">
            {songList(
              mirrored.songs.map((entry) => entry.song),
              'MIRROR',
              (song) => {
                const entry = mirrored.songs.find((item) => item.song.track.src === song.track.src);
                return entry === undefined || entry.faces.length === 0 ? null : <Faces faces={entry.faces} more={entry.more} srcs={new Set([song.track.src])} />;
              },
            )}
          </PickRow>
        </div>
      ) : tab === 'artist' ? (
        <Tiles
          items={artists.map((artist) => ({
            key: artist.key,
            name: artist.name,
            sub: playsLabel(artist.plays) || `${artist.songCount} SONG${artist.songCount === 1 ? '' : 'S'}`,
            uploaderId: artist.uploaderId,
          }))}
          onOpen={(key) => setOpen({ kind: 'artist', key })}
        />
      ) : tab === 'album' ? (
        <Tiles
          items={albums.map((album) => ({ key: album.key, name: album.name, sub: [album.artist, playsLabel(album.plays)].filter(Boolean).join(' :: '), uploaderId: album.uploaderId }))}
          onOpen={(key) => setOpen({ kind: 'album', key })}
        />
      ) : (
        songList(ranked, 'VANITY')
      )}
    </section>
    </LiveContext.Provider>
  );
}

/** One FOR YOU row: a heading, SAVE AS PLAYLIST where it saves songs, and what it holds. */
function PickRow({ title, onSave, children }: { title: React.ReactNode; onSave?: () => void; children: React.ReactNode }) {
  return (
    <div>
      <div className={`${TITLE_BAR} flex items-center justify-between gap-2`}>
        <span className="min-w-0 truncate">{title}</span>
        {onSave === undefined ? null : (
          <button type="button" onClick={onSave} className={PLATE}>
            [ SAVE AS PLAYLIST ]
          </button>
        )}
      </div>
      {children}
    </div>
  );
}

/** `FROM <NAME>'S ORBIT`: what one of the reader's closest people plays most, their face as the heading. */
function OrbitRow({ personId, onSave, children }: { personId: string; onSave?: (name: string) => void; children: React.ReactNode }) {
  const { profile, ready } = usePublicProfile(personId);
  const name = ready ? profile.displayName.toUpperCase() : '...';

  return (
    <PickRow
      title={
        <span className="flex items-center gap-2">
          <PersonFace personId={personId} tip={`OPEN ${name}'S PROFILE`} srcs={null} />
          <span className="truncate">FROM {name}&apos;S ORBIT</span>
        </span>
      }
      onSave={onSave === undefined || !ready ? undefined : () => onSave(name)}
    >
      {children}
    </PickRow>
  );
}

/** Artists or albums picked FOR YOU: a name that opens its page, then the faces and why. */
function PickList({ items, onOpen }: { items: Pick<AudioTrack>[]; onOpen: (key: string) => void }) {
  return (
    <ul>
      {items.map((pick) => (
        <li key={pick.key} className="border-b border-dotted border-ink bg-paper px-2 py-1 hover:bg-pointed">
          <button type="button" onClick={() => onOpen(pick.key)} className="block w-full min-w-0 cursor-pointer text-left" title={`Open ${pick.name}`}>
            <span className="block truncate text-key font-bold text-ink">{pick.name}</span>
            <span className="block truncate text-label text-ink">
              {[pick.sub, `${pick.songs.length} SONG${pick.songs.length === 1 ? '' : 'S'}`, playsLabel(pick.songs.reduce((total, song) => total + song.plays, 0))]
                .filter(Boolean)
                .join(' :: ')}
            </span>
          </button>
          <PickWhy pick={pick} />
        </li>
      ))}
    </ul>
  );
}

/** Up to three faces of the people a pick came through, `+n` for the rest, and the "why this?" line. */
function PickWhy({ pick }: { pick: Pick<AudioTrack> }) {
  return (
    <Faces faces={pick.faces} more={pick.more} srcs={new Set(pick.songs.map((song) => song.track.src))}>
      <span className="min-w-0 text-label text-ink">{pick.why}</span>
    </Faces>
  );
}

/** A line of faces, each naming its plays (`PLAYED 14× BY <NAME>`), then `+n` for the rest. */
function Faces({ faces, more, srcs, children }: { faces: Face[]; more: number; srcs: ReadonlySet<string>; children?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-x-1">
      {faces.map((face) => (
        <PlayedByFace key={face.personId} face={face} srcs={srcs} />
      ))}
      {more > 0 ? <span className="text-label font-bold text-ink">+{more}</span> : null}
      {children}
    </div>
  );
}

function PlayedByFace({ face, srcs }: { face: Face; srcs: ReadonlySet<string> }) {
  const { profile, ready } = usePublicProfile(face.personId);
  return <PersonFace personId={face.personId} tip={ready ? `PLAYED ${face.plays}× BY ${profile.displayName.toUpperCase()}` : '...'} srcs={srcs} />;
}

/**
 * A small round face that opens the person's profile; the tip names them. When they are playing one of
 * `srcs` right now (null: anything), a LIVE key beside it opens their broadcast's card to follow along.
 */
function PersonFace({ personId, tip, srcs }: { personId: string; tip: string; srcs: ReadonlySet<string> | null }) {
  const { profile, ready } = usePublicProfile(personId);
  const name = ready ? profile.displayName : '...';
  const { live, open } = useContext(LiveContext);
  const broadcast = liveFor(live, personId, srcs);

  return (
    <>
    <Link
      href={`/profile/${encodeURIComponent(personId)}`}
      title={tip}
      aria-label={tip}
      className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center hover:bg-ice-pale"
    >
      <span className="inline-flex overflow-hidden rounded-full">
        <ProfileAvatar version={currentAvatarVersion(profile)} displayName={name} size={28} variant="plain" hideVersionLabel crop={displayCrop(profile)} />
      </span>
    </Link>
    {broadcast === null ? null : (
      <button type="button" onClick={() => open(broadcast)} className={PLATE} title={`${name} is playing this now: listen along`}>
        [ ● LIVE ]
      </button>
    )}
    </>
  );
}

/** A grid of tiles: the face of whoever filed most of it, its name, and one line under it. */
function Tiles({
  items,
  onOpen,
}: {
  items: { key: string; name: string; sub: string; uploaderId: string | null }[];
  onOpen: (key: string) => void;
}) {
  if (items.length === 0) return <p className="p-2 text-label text-ink">NOTHING FILED YET.</p>;

  return (
    <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      {items.map((item) => (
        <li key={item.key}>
          <button
            type="button"
            onClick={() => onOpen(item.key)}
            className="flex w-full min-w-0 cursor-pointer flex-col items-start gap-1 p-1 text-left hover:bg-pointed"
            title={`Open ${item.name}`}
          >
            <UploaderFace uploaderId={item.uploaderId} size={72} />
            <span className="block w-full truncate text-key font-bold text-ink">{item.name}</span>
            {item.sub.length === 0 ? null : <span className="block w-full truncate text-label text-ink">{item.sub}</span>}
          </button>
        </li>
      ))}
    </ul>
  );
}

/** An artist: their albums as tiles, then their singles. */
function ArtistPage({
  artist,
  onBack,
  onAlbum,
  singles,
}: {
  artist: VanityArtist<AudioTrack>;
  onBack: () => void;
  onAlbum: (key: string) => void;
  singles: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <button type="button" onClick={onBack} className={PLATE}>
          [ ← BACK ]
        </button>
        <UploaderFace uploaderId={artist.uploaderId} size={40} />
        <span className="min-w-0 flex-1 truncate text-title text-ink">{artist.name}</span>
        {artist.plays > 0 ? <span className="text-label text-ink">{playsLabel(artist.plays)}</span> : null}
      </div>

      {artist.albums.length === 0 ? null : (
        <>
          <div className={TITLE_BAR}>
            <span>ALBUMS</span>
          </div>
          <Tiles
            items={artist.albums.map((album) => ({ key: album.key, name: album.name, sub: playsLabel(album.plays), uploaderId: album.uploaderId }))}
            onOpen={onAlbum}
          />
        </>
      )}

      {artist.singles.length === 0 ? null : (
        <>
          <div className={`${TITLE_BAR} mt-2`}>
            <span>SINGLES</span>
          </div>
          {singles}
        </>
      )}
    </div>
  );
}

/** An album: its track list in running order, and SAVE AS PLAYLIST. */
function AlbumPage({
  album,
  onBack,
  onSave,
  canSave,
  children,
}: {
  album: VanityAlbum<AudioTrack>;
  onBack: () => void;
  onSave: () => void;
  canSave: boolean;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <button type="button" onClick={onBack} className={PLATE}>
          [ ← BACK ]
        </button>
        <UploaderFace uploaderId={album.uploaderId} size={40} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-title text-ink">{album.name}</span>
          <span className="block truncate text-label text-ink">
            {[album.artist, playsLabel(album.plays)].filter(Boolean).join(' :: ')}
          </span>
        </span>
        {canSave ? (
          <button type="button" onClick={onSave} className={PLATE}>
            [ SAVE AS PLAYLIST ]
          </button>
        ) : null}
      </div>
      {children}
    </div>
  );
}

/**
 * The picture of the person who filed it - the site's own default picture for files that came with the
 * site. Not a link: it sits inside a tile that is itself a key.
 */
function UploaderFace({ uploaderId, size }: { uploaderId: string | null; size: number }) {
  const { profile, ready } = usePublicProfile(uploaderId);
  const name = uploaderId === null ? 'DEBASER.SITE' : ready ? profile.displayName : '...';

  return (
    <span className="shrink-0" aria-hidden="true">
      {uploaderId === null ? (
        <ProfileAvatar src={DEFAULT_AVATAR_SRC} displayName={name} size={size} variant="plain" hideVersionLabel />
      ) : (
        <ProfileAvatar version={currentAvatarVersion(profile)} displayName={name} size={size} variant="plain" hideVersionLabel crop={displayCrop(profile)} />
      )}
    </span>
  );
}
