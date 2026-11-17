'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { threadDomId } from '../lib/forum/anchors';
import { closeHistory, HISTORY_HREF, historyRequested, historyWindowServerState, historyWindowState, openHistory, subscribeToHistoryWindow } from '../lib/history/history-window';
import { accountName, loadAccountNames } from '../lib/history/names';
import { erasePlays, historyKeptInBrowser, readPlays, readPlaysPaused, removePlay, setPlaysPaused, subscribePlays } from '../lib/history/plays';
import { clockOf, foldLog, howLine, howMark, LOG_FILTERS, passes, placeOf, sessionHow, type LogFilter, type PlaySession } from '../lib/history/sessions';
import type { Play } from '../lib/history/types';
import { openLetter } from '../lib/letters/letter-window';
import { getLettersRepository } from '../lib/letters/repository';
import type { Letter, LetterItem } from '../lib/letters/types';
import { ICON_LIVE, ICON_MEDIA, ICON_MUSIC } from '../lib/ui/icons';
import { PLATE, PLATE_LINK, PLATE_PRESSED, TITLE_BAR_INACTIVE } from '../lib/ui/controls';
import { recognizeLink } from '../lib/watch/links';
import { playInMainRoom } from '../lib/watch/main-room-play';
import { ownRoomState, subscribeToOwnRoom } from '../lib/watch/own-room-client';
import { repositoryFor } from '../lib/watch/repository';
import { isSongLink, trackForSong } from '../lib/watch/songs';
import type { WatchLink, WatchQueueEntry, WatchRoomRead } from '../lib/watch/types';
import { openWatch } from '../lib/watch/watch-window';
import { webTrackNow } from '../lib/web/web-track-lookup';
import { useAuth } from './AuthProvider';
import DockWindow from './DockWindow';
import { useMusicPlayer, type MusicPlayerValue } from './MusicPlayerProvider';

/**
 * HISTORY (SPEC-history.md, Luke 2026-11-17): what you played, how it reached you, and when, as a logbook.
 *
 * Drawn once in `layout.tsx`, like QUEUE: opening it re-renders this window and nothing behind it. Day headings are log
 * stamps (`LOG 17.11 · TODAY`); each line is a log entry, its time, a mark for how it reached you, what it was and the
 * how line; plays in a row in one room fold into one session line. Pressing a line folds it open underneath: the room's
 * queue as it played with your play marked, the letter's things, or where it came from. `[ ▶ ]` jumps back in where you
 * left off (RADI-OH's point, Luke's answer 9); `[ X ]` takes the one line out. Metadata only: the one number shown is
 * how many of your own lines a session holds.
 */

/** Lines read at first, and added by each `[ SHOW OLDER ]`. */
const STEP = 50;
/** A room's fold shows what it played this long either side of your plays: the rest of that listening session. */
const AROUND_MS = 30 * 60_000;

export default function HistoryWindow() {
  const state = useSyncExternalStore(subscribeToHistoryWindow, historyWindowState, historyWindowServerState);
  const search = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const asked = search.toString();
  const query = asked.length === 0 ? '' : `?${asked}`;

  useEffect(() => {
    if (historyRequested(query)) openHistory();
  }, [query]);

  const close = useCallback(() => {
    closeHistory();
    if (historyRequested(query)) router.replace(pathname);
  }, [pathname, query, router]);

  if (!state.open) return null;
  return (
    <DockWindow title="HISTORY" onClose={close} id="history" defaultSize={{ w: 736, h: 600 }} minSize={{ w: 420, h: 260 }} status="YOUR LOG">
      <HistoryLog />
    </DockWindow>
  );
}

/* --- jumping back in ----------------------------------------------------------------------------- */

const FROM_HISTORY = { origin: 'shelf', where: 'HISTORY', href: HISTORY_HREF } as const;

/** The video's link again, from its address: null for a line that cannot be played again (an old MEDIA id). */
function videoSource(play: Pick<Play, 'ref' | 'title'>): { link: WatchLink } | { mediaItemId: string } | null {
  if (play.ref.startsWith('file:')) return { mediaItemId: play.ref.slice(5) };
  const verdict = recognizeLink(play.ref);
  return verdict.ok ? { link: { ...verdict.link, title: play.title || verdict.link.title } } : null;
}

function canResume(play: Play): boolean {
  if (play.kind === 'book') return play.whereHref !== null || play.ref !== '';
  if (play.kind === 'song') return play.ref.startsWith('/') || /^https?:\/\//.test(play.ref);
  return videoSource(play) !== null;
}

function playSong(player: MusicPlayerValue, link: WatchLink, at: number | null): void {
  const track = trackForSong(link, player.queue, webTrackNow(link.url));
  player.play(track, FROM_HISTORY, at !== null && at > 0 ? { at } : undefined);
}

/** `[ ▶ ]`: the song from where you left it, the video in your room from there, the book at your place. */
function resume(play: Play, player: MusicPlayerValue, go: (href: string) => void): void {
  if (play.kind === 'book') {
    go(play.whereHref ?? `/read/${play.ref}`);
    return;
  }
  if (play.kind === 'song') {
    playSong(player, { url: play.ref, kind: 'audio', title: play.title }, play.leftAtSeconds);
    return;
  }
  const source = videoSource(play);
  if (source !== null) playInMainRoom(source, play.title, play.leftAtSeconds);
}

/** `[ ▶ PLAY FROM HERE ]`: the first now, the rest next in your own queue, in the order they played. */
function playFrom(links: readonly WatchLink[], player: MusicPlayerValue): void {
  const [first, ...rest] = links;
  if (first === undefined) return;
  const title = first.title;
  if (isSongLink(first)) playSong(player, first, null);
  else playInMainRoom({ link: first }, title);
  const session = ownRoomState().session;
  if (session === null) return;
  for (const link of [...rest].reverse()) {
    try {
      session.enqueue(link, 'next');
    } catch {
      // A full queue keeps what it has.
    }
  }
}

/* --- the log ------------------------------------------------------------------------------------- */

function HistoryLog() {
  const { user } = useAuth();
  const own = useSyncExternalStore(subscribeToOwnRoom, ownRoomState, ownRoomState);
  const me = user?.id ?? (own.visitor ? own.hostId : null);
  const [plays, setPlays] = useState<Play[] | null>(null);
  const [older, setOlder] = useState(false);
  const [paused, setPaused] = useState(false);
  const [browserOnly, setBrowserOnly] = useState(false);
  const [filter, setFilter] = useState<LogFilter>('all');
  const [open, setOpen] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [fault, setFault] = useState<string | null>(null);
  const shown = useRef(STEP);

  const load = useCallback(async () => {
    const [read, isPaused, inBrowser] = await Promise.all([readPlays(shown.current), readPlaysPaused(), historyKeptInBrowser()]);
    setPlays(read);
    setOlder(read.length >= shown.current);
    setPaused(isPaused);
    setBrowserOnly(inBrowser);
  }, []);

  const signedInAs = user?.id ?? null;
  useEffect(() => {
    void loadAccountNames();
    const reload = () => void load().catch(() => setFault('COULD NOT READ YOUR LOG. TRY AGAIN.'));
    reload();
    return subscribePlays(reload);
  }, [load, signedInAs]);

  const days = useMemo(() => foldLog((plays ?? []).filter((play) => passes(play, filter)), new Date()), [plays, filter]);

  const flipPause = async () => {
    setFault(null);
    if (!(await setPlaysPaused(!paused))) setFault('COULD NOT CHANGE IT. TRY AGAIN.');
  };
  const erase = async () => {
    if (!confirming) {
      setConfirming(true);
      return;
    }
    setConfirming(false);
    setFault(null);
    if (!(await erasePlays())) setFault('COULD NOT ERASE IT. TRY AGAIN.');
  };
  const showOlder = () => {
    shown.current += STEP;
    void load();
  };
  const toggle = (key: string) => setOpen((was) => (was === key ? null : key));

  return (
    <section aria-label="Your history" data-history-log className="flex flex-col gap-2">
      {browserOnly ? (
        <p className="border-b border-ink px-2 py-1 text-label text-ink" data-history-note="visitor">
          KEPT IN THIS BROWSER ONLY.{' '}
          <Link href="/account" className={PLATE_LINK}>
            [ LOG IN ]
          </Link>{' '}
          TO KEEP IT ON YOUR ACCOUNT.
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-1" data-history-keys>
        <button type="button" onClick={() => void flipPause()} aria-pressed={paused} className={paused ? PLATE_PRESSED : PLATE} data-history-pause>
          {paused ? '[ RESUME ]' : '[ PAUSE ]'}
        </button>
        <span className="flex flex-wrap items-center gap-1" role="group" aria-label="Show">
          {LOG_FILTERS.map((one) => (
            <button key={one.key} type="button" onClick={() => setFilter(one.key)} aria-pressed={filter === one.key} className={filter === one.key ? PLATE_PRESSED : PLATE} data-history-filter={one.key}>
              [ {one.label} ]
            </button>
          ))}
        </span>
        <button type="button" onClick={() => void erase()} onBlur={() => setConfirming(false)} className={`${PLATE} ml-auto`} data-history-erase>
          {confirming ? '[ YES, ERASE ALL ]' : '[ ERASE ]'}
        </button>
      </div>

      {paused ? (
        <p className="text-label font-bold text-ink" data-history-paused>
          PAUSED: NOTHING IS BEING WRITTEN DOWN.
        </p>
      ) : null}
      {fault !== null ? (
        <p role="alert" className="w-fit bg-bubble-pale px-1 text-label text-ink-bar">
          {fault}
        </p>
      ) : null}

      {plays === null ? (
        <p className="p-2 text-label font-bold text-ink">READING YOUR LOG...</p>
      ) : days.length === 0 ? (
        <p className="p-2 text-label text-ink" data-history-empty>
          {filter === 'all' ? 'NOTHING IN THE LOG YET. PRESS PLAY ANYWHERE ON THE SITE AND IT IS WRITTEN DOWN HERE.' : 'NOTHING OF THAT KIND IN THE LOG.'}
        </p>
      ) : (
        days.map((day) => (
          <section key={day.key} aria-label={day.stamp} data-history-day={day.key}>
            <h3 className={TITLE_BAR_INACTIVE}>
              <span>{day.stamp}</span>
            </h3>
            <ul>
              {day.entries.map((entry) =>
                entry.kind === 'play' ? (
                  <PlayLine key={entry.play.id} play={entry.play} me={me} open={open === entry.play.id} onToggle={() => toggle(entry.play.id)} />
                ) : (
                  <SessionLine key={entry.key} session={entry} me={me} open={open === entry.key} onToggle={() => toggle(entry.key)} />
                ),
              )}
            </ul>
          </section>
        ))
      )}

      {older && plays !== null && plays.length > 0 ? (
        <button type="button" onClick={showOlder} className={`${PLATE} self-start`} data-history-older>
          [ SHOW OLDER ]
        </button>
      ) : null}
    </section>
  );
}

/* --- one line ------------------------------------------------------------------------------------ */

/** The picture box, a fixed size so a slow or missing picture never moves the line: the thumbnail, or the line's mark. */
function LineBox({ play }: { play: Play }) {
  const [failed, setFailed] = useState(false);
  return (
    <span className="flex h-9 w-16 shrink-0 items-center justify-center overflow-hidden border border-ink-plate bg-paper text-title text-ink" aria-hidden="true">
      {play.picture && !failed ? (
        // eslint-disable-next-line @next/next/no-img-element -- hotlinked from the platform, never proxied or copied (SPEC-web.md)
        <img src={play.picture} alt="" width={64} height={36} loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setFailed(true)} className="block h-full w-full object-cover" />
      ) : (
        howMark(play)
      )}
    </span>
  );
}

function PlayLine({ play, me, open, onToggle }: { play: Play; me: string | null; open?: boolean; onToggle?: () => void }) {
  const player = useMusicPlayer();
  const router = useRouter();
  const [fault, setFault] = useState<string | null>(null);
  const on = play.kind === 'song' && player.track?.src === play.ref && player.playing;
  const what = play.maker.trim() === '' ? play.title || 'UNTITLED' : `${play.title || 'UNTITLED'} — ${play.maker}`;
  const body = (
    <>
      <span className="w-12 shrink-0 font-mono text-label text-ink">{clockOf(play.playedAt)}</span>
      <LineBox play={play} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-label font-bold text-ink">
          {what}
          {on ? <span className="ml-2 text-accent-ink">{ICON_MUSIC} NOW</span> : null}
        </span>
        <span className="block truncate text-label text-ink">
          <span aria-hidden="true" className="text-accent-ink">
            {howMark(play)}
          </span>{' '}
          {howLine(play, me)}
        </span>
      </span>
    </>
  );
  const take = async () => {
    setFault(null);
    if (!(await removePlay(play.id))) setFault('COULD NOT TAKE IT OUT.');
  };

  return (
    <li className="rule-pixel py-1" data-history-line={play.id} data-history-how={play.how}>
      <div className="flex items-center gap-1">
        {onToggle === undefined ? (
          <div className="flex min-w-0 flex-1 items-center gap-2 px-1">{body}</div>
        ) : (
          <button type="button" onClick={onToggle} aria-expanded={open === true} className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 px-1 text-left hover:bg-chrome-dark">
            {body}
          </button>
        )}
        {canResume(play) ? (
          <button
            type="button"
            onClick={() => resume(play, player, (href) => router.push(href))}
            className={PLATE}
            aria-label={`Play ${play.title || 'it'} again${placeOf(play.leftAtSeconds) ? ` from ${placeOf(play.leftAtSeconds)}` : ''}`}
            title={placeOf(play.leftAtSeconds) ? `FROM ${placeOf(play.leftAtSeconds)}` : 'FROM THE START'}
            data-history-resume
          >
            [ ▶ ]
          </button>
        ) : null}
        <button type="button" onClick={() => void take()} className={PLATE} aria-label={`Take ${play.title || 'this line'} out of your history`} data-history-remove>
          [ X ]
        </button>
      </div>
      {fault !== null ? (
        <p role="alert" className="w-fit bg-bubble-pale px-1 text-label text-ink-bar">
          {fault}
        </p>
      ) : null}
      {open ? <LineFold play={play} me={me} /> : null}
    </li>
  );
}

/** A session: plays in a row in one room. Open, its plays, then the room's queue as it played around them. */
function SessionLine({ session, me, open, onToggle }: { session: PlaySession; me: string | null; open: boolean; onToggle: () => void }) {
  const newest = session.plays[0];
  const oldest = session.plays[session.plays.length - 1];
  const inRoom = session.plays.find((play) => play.how === 'room');
  const where = inRoom === undefined ? 'YOUR ROOM' : inRoom.whereLabel.toUpperCase() || 'A ROOM';
  return (
    <li className="rule-pixel py-1" data-history-session={session.roomId}>
      <button type="button" onClick={onToggle} aria-expanded={open} className="flex w-full cursor-pointer items-center gap-2 px-1 text-left hover:bg-chrome-dark">
        <span className="shrink-0 font-mono text-label text-ink">
          {clockOf(oldest.playedAt)}–{clockOf(newest.playedAt)}
        </span>
        <span aria-hidden="true" className="flex h-9 w-16 shrink-0 items-center justify-center border border-ink-plate bg-paper text-title text-accent-ink">
          {ICON_LIVE}
        </span>
        <span className="min-w-0 flex-1 truncate text-label font-bold text-ink">
          IN {where} · {session.plays.length} PLAYED
        </span>
        <span aria-hidden="true" className="shrink-0 text-label text-accent-ink">
          {open ? '[ − ]' : '[ + ]'}
        </span>
      </button>
      {open ? (
        <div className="ml-4 border-l border-ink pl-2">
          <ul>
            {session.plays.map((play) => (
              <PlayLine key={play.id} play={play} me={me} />
            ))}
          </ul>
          <RoomFold roomId={session.roomId} plays={session.plays} me={me} />
        </div>
      ) : null}
    </li>
  );
}

/* --- what a line folds open to ------------------------------------------------------------------- */

function LineFold({ play, me }: { play: Play; me: string | null }) {
  // Where it came from decides the fold: a letter's things, a room's queue (only for a play the room itself put on), or
  // the facts with [ OPEN ] (code review: every keeper line has a room, so the room must not be asked first).
  if (play.letterId !== null) return <LetterFold play={play} />;
  if (play.roomId !== null && sessionHow(play.how)) return <RoomFold roomId={play.roomId} plays={[play]} me={me} />;
  return <FactsFold play={play} />;
}

const FOLD = 'ml-4 mt-1 flex flex-col gap-1 border-l border-ink pl-2 pb-1';

function FactsFold({ play }: { play: Play }) {
  const left = placeOf(play.leftAtSeconds);
  const length = placeOf(play.lengthSeconds);
  const opens = play.whereHref !== null && play.whereHref.startsWith('/');
  return (
    <div className={FOLD} data-history-fold="facts">
      {play.how === 'not_recorded' ? <p className="text-label text-ink">FILLED IN FROM BEFORE HISTORY BEGAN: HOW IT REACHED YOU WAS NEVER WRITTEN DOWN.</p> : null}
      <p className="text-label text-ink">
        {play.kind === 'song' ? 'A SONG' : play.kind === 'video' ? 'A VIDEO' : 'A BOOK'}
        {play.whereLabel ? ` · ${play.whereLabel.toUpperCase()}` : ''}
        {left ? ` · YOU LEFT IT AT ${left}${length ? ` OF ${length}` : ''}` : ''}
      </p>
      {opens ? (
        <Link href={play.whereHref as string} className={`${PLATE} self-start`} data-history-open>
          [ OPEN ]
        </Link>
      ) : null}
    </div>
  );
}

function LetterFold({ play }: { play: Play }) {
  const [held, setHeld] = useState<{ letter: Letter; items: LetterItem[] } | null | undefined>(undefined);
  const letterId = play.letterId as string;
  useEffect(() => {
    let live = true;
    const repository = getLettersRepository();
    void Promise.all([repository.get(letterId), repository.items(letterId)])
      .then(([letter, items]) => live && setHeld(letter === null ? null : { letter, items }))
      .catch(() => live && setHeld(null));
    return () => {
      live = false;
    };
  }, [letterId]);

  if (held === undefined) return <p className={`${FOLD} text-label text-ink`}>READING THE LETTER...</p>;
  if (held === null) return <p className={`${FOLD} text-label text-ink`}>THIS LETTER IS GONE, OR PRIVATE NOW.</p>;
  const title = play.title.trim().toUpperCase();
  return (
    <div className={FOLD} data-history-fold="letter">
      <p className="text-label font-bold text-ink">{held.letter.name.toUpperCase() || 'A LETTER'}</p>
      <ul>
        {held.items.map((item) => {
          const yours = title !== '' && item.title.trim().toUpperCase() === title;
          return (
            <li key={item.id} className="truncate text-label text-ink">
              {yours ? <span className="font-bold text-accent-ink">► YOU PLAYED THIS · </span> : '· '}
              {item.title || 'UNTITLED'}
            </li>
          );
        })}
      </ul>
      <button type="button" onClick={() => openLetter(letterId)} className={`${PLATE} self-start`} data-history-open>
        [ OPEN LETTER ]
      </button>
    </div>
  );
}

/** The rows a room played around your plays, in the order they played. */
function rowsAround(read: WatchRoomRead, plays: readonly Play[]): WatchQueueEntry[] {
  const times = plays.map((play) => Date.parse(play.playedAt));
  const from = Math.min(...times) - AROUND_MS;
  const to = Math.max(...times) + AROUND_MS;
  return read.queue
    .filter((row) => row.playedAt !== null && Date.parse(row.playedAt) >= from && Date.parse(row.playedAt) <= to)
    .sort((a, b) => (a.playIndex ?? 0) - (b.playIndex ?? 0) || Date.parse(a.playedAt as string) - Date.parse(b.playedAt as string));
}

function RoomFold({ roomId, plays, me }: { roomId: string; plays: readonly Play[]; me: string | null }) {
  const player = useMusicPlayer();
  const [read, setRead] = useState<WatchRoomRead | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    void repositoryFor(roomId)
      .readRoom(roomId)
      .then((found) => live && setRead(found))
      .catch(() => live && setRead(null));
    return () => {
      live = false;
    };
  }, [roomId]);

  if (read === undefined) return <p className={`${FOLD} text-label text-ink`}>READING THE ROOM...</p>;
  const rows = read === null ? [] : rowsAround(read, plays);
  const yours = new Set(plays.flatMap((play) => (play.queueEntryId === null ? [] : [play.queueEntryId])));
  const ownRoom = roomId === ownRoomState().roomId;

  if (read === null || rows.length === 0) {
    return (
      <div className={FOLD} data-history-fold="room-gone">
        <p className="text-label text-ink">ONLY WHAT YOU HEARD IS KEPT: THE ROOM&apos;S OWN QUEUE CAN&apos;T BE READ ANY MORE.</p>
      </div>
    );
  }

  // From your first play in this stretch onward, for PLAY FROM HERE.
  const start = Math.max(0, rows.findIndex((row) => yours.has(row.id)));
  const links = rows.slice(start).flatMap((row) => (row.link !== null && row.link.kind !== 'picture' ? [row.link] : []));
  const ended = read.room.endedAt !== null;

  return (
    <div className={FOLD} data-history-fold="room">
      <p className="text-label font-bold text-ink">THE ROOM&apos;S QUEUE THEN</p>
      <ol>
        {rows.map((row) => {
          const mine = yours.has(row.id);
          const adder = row.addedBy === null ? 'SOMEONE' : row.addedBy === me ? 'YOU' : accountName(row.addedBy).toUpperCase() || 'SOMEONE';
          return (
            <li key={row.id} className={`flex items-center gap-2 text-label ${mine ? 'font-bold text-accent-ink' : 'text-ink'}`} data-history-room-row={mine ? 'yours' : 'theirs'}>
              <span className="w-12 shrink-0 font-mono">{clockOf(row.playedAt as string)}</span>
              <span aria-hidden="true" className="shrink-0">
                {isSongLink(row.link) ? ICON_MUSIC : ICON_MEDIA}
              </span>
              <span className="min-w-0 flex-1 truncate">
                {row.link?.title || 'A FILE FROM THE SITE'} · ADDED BY {adder}
              </span>
              {mine ? <span className="shrink-0">► YOU WERE HERE</span> : null}
            </li>
          );
        })}
      </ol>
      <div className="flex flex-wrap items-center gap-1">
        {links.length > 0 ? (
          <button type="button" onClick={() => playFrom(links, player)} className={PLATE} data-history-play-from>
            [ ▶ PLAY FROM HERE ]
          </button>
        ) : null}
        {!ended ? (
          <button type="button" onClick={() => openWatch({ kind: 'room', roomId })} className={PLATE} data-history-open>
            {ownRoom ? '[ OPEN YOUR ROOM ]' : `[ ${ICON_LIVE} JOIN ROOM ]`}
          </button>
        ) : read.room.forumThreadId !== null ? (
          <Link href={`/forum#${threadDomId(read.room.forumThreadId)}`} className={PLATE} data-history-open>
            [ OPEN ITS RECORD ]
          </Link>
        ) : (
          <span className="text-label text-ink">THIS ROOM HAS ENDED.</span>
        )}
      </div>
    </div>
  );
}
