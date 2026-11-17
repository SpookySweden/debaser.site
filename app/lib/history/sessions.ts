import { ICON_COMMS, ICON_FORUM, ICON_LIVE, ICON_LOOP, ICON_MEDIA, ICON_MUSIC, ICON_READ, ICON_USERS } from '../ui/icons';
import { SAME_PLAY_MS, SAME_ROW_MS, SESSION_GAP_MS, type Play, type PlayHow, type PlayKind, type PlayNote } from './types';

/**
 * HISTORY's arithmetic (SPEC-history.md), kept pure so a check can hold it: the same play pressed again, the log folded
 * into day headings and room sessions, and the words and marks each line wears. No React, no storage.
 */

/**
 * True when `note` is the same play as `last`: the same thing, reached the same way, in the same room, within 60 s; or
 * the same room queue row within 6 hours (a reload, or coming back to a room, mid-play: the room says it is one play).
 */
export function samePlay(
  last: Pick<Play, 'kind' | 'ref' | 'how' | 'roomId' | 'playedAt'> & { queueEntryId?: string | null } | undefined,
  note: Pick<PlayNote, 'kind' | 'ref' | 'how' | 'roomId' | 'queueEntryId'>,
  now: number,
): boolean {
  if (last === undefined) return false;
  if (note.queueEntryId && last.queueEntryId === note.queueEntryId) return now - Date.parse(last.playedAt) < SAME_ROW_MS;
  return (
    last.kind === note.kind &&
    last.ref === note.ref &&
    last.how === note.how &&
    (last.roomId ?? null) === (note.roomId ?? null) &&
    now - Date.parse(last.playedAt) < SAME_PLAY_MS
  );
}

/** One session: plays in a row in the same room, newest first, with less than 30 minutes between each. */
export type PlaySession = { kind: 'session'; key: string; roomId: string; plays: Play[] };
export type LogEntry = { kind: 'play'; play: Play } | PlaySession;
export type LogDay = { key: string; stamp: string; entries: LogEntry[] };

const DAY_NAMES = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
const two = (value: number) => String(value).padStart(2, '0');
const dayKey = (at: Date) => `${at.getFullYear()}-${two(at.getMonth() + 1)}-${two(at.getDate())}`;

/** A day heading as a log stamp: `LOG 17.11 · TODAY`, `LOG 16.11 · YESTERDAY`, `LOG 14.11 · FRI`, `LOG 03.10.25` another year. */
export function logStamp(at: Date, now: Date): string {
  const sameYear = at.getFullYear() === now.getFullYear();
  const date = `${two(at.getDate())}.${two(at.getMonth() + 1)}${sameYear ? '' : `.${String(at.getFullYear()).slice(-2)}`}`;
  const today = dayKey(now);
  const yesterday = dayKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1));
  const key = dayKey(at);
  if (key === today) return `LOG ${date} · TODAY`;
  if (key === yesterday) return `LOG ${date} · YESTERDAY`;
  return sameYear ? `LOG ${date} · ${DAY_NAMES[at.getDay()]}` : `LOG ${date}`;
}

/** The time a line wears, on the reader's own clock: `14:02`. */
export function clockOf(at: string): string {
  const time = new Date(at);
  return Number.isNaN(time.getTime()) ? '--:--' : `${two(time.getHours())}:${two(time.getMinutes())}`;
}

/**
 * The log folded for the window: day headings, newest first, and inside each day the plays, with plays in a row in the
 * same room (less than 30 minutes apart) folded into one session. A lone room play stays a plain line. A session never
 * crosses midnight: each day is read on its own.
 */
export function foldLog(plays: readonly Play[], now: Date): LogDay[] {
  const sorted = [...plays].sort((a, b) => Date.parse(b.playedAt) - Date.parse(a.playedAt));
  const days: LogDay[] = [];
  for (const play of sorted) {
    const at = new Date(play.playedAt);
    const key = dayKey(at);
    let day = days[days.length - 1];
    if (day === undefined || day.key !== key) {
      day = { key, stamp: logStamp(at, now), entries: [] };
      days.push(day);
    }
    const last = day.entries[day.entries.length - 1];
    const lastPlay = last === undefined ? undefined : last.kind === 'play' ? last.play : last.plays[last.plays.length - 1];
    const joins =
      play.roomId !== null &&
      lastPlay !== undefined &&
      lastPlay.roomId === play.roomId &&
      Date.parse(lastPlay.playedAt) - Date.parse(play.playedAt) < SESSION_GAP_MS;
    if (joins && last !== undefined) {
      if (last.kind === 'session') last.plays.push(play);
      else day.entries[day.entries.length - 1] = { kind: 'session', key: `s:${last.play.id}`, roomId: play.roomId as string, plays: [last.play, play] };
    } else {
      day.entries.push({ kind: 'play', play });
    }
  }
  return days;
}

/** The text-character mark for how a play reached you (SPEC-history.md's table). No drawn icons. */
export function howMark(play: Pick<Play, 'how' | 'kind'>): string {
  switch (play.how) {
    case 'yourself':
      return play.kind === 'video' ? ICON_MEDIA : play.kind === 'book' ? ICON_READ : ICON_MUSIC;
    case 'own_queue':
    case 'playlist':
      return ICON_LOOP;
    case 'room':
      return ICON_LIVE;
    case 'letter':
      return ICON_COMMS;
    case 'comment':
      return '✎';
    case 'post':
      return ICON_FORUM;
    case 'profile':
      return ICON_USERS;
    case 'reader':
      return ICON_READ;
    default:
      return '?';
  }
}

const upper = (value: string) => value.trim().toUpperCase();

/** "ADDED BY JO", "ADDED BY YOU", or "ADDED BY SOMEONE" for an account that has gone. */
function addedByWords(play: Pick<Play, 'addedBy' | 'addedByName'>, me: string | null): string {
  if (play.addedBy !== null && play.addedBy === me) return 'ADDED BY YOU';
  const name = upper(play.addedByName);
  return name === '' ? 'ADDED BY SOMEONE' : `ADDED BY ${name}`;
}

/** The how line: `IN MIA'S ROOM · ADDED BY JO`, `FROM A LETTER BY MIA`, `YOU PLAYED IT · FROM MEDIA`. */
export function howLine(play: Pick<Play, 'how' | 'whereLabel' | 'addedBy' | 'addedByName'>, me: string | null): string {
  const where = upper(play.whereLabel);
  const name = upper(play.addedByName) || 'SOMEONE';
  switch (play.how) {
    case 'yourself':
      return where === '' ? 'YOU PLAYED IT' : `YOU PLAYED IT · FROM ${where}`;
    case 'own_queue':
      return 'YOUR QUEUE · ADDED BY YOU';
    case 'room':
      return `IN ${where || 'A ROOM'} · ${addedByWords(play, me)}`;
    case 'letter':
      return `FROM A LETTER BY ${name}`;
    case 'comment':
      return `FROM A COMMENT BY ${name}`;
    case 'post':
      return `FROM A POST BY ${name}`;
    case 'profile':
      return `ON ${name === 'SOMEONE' ? 'A' : `${name}'S`} PROFILE`;
    case 'playlist':
      return `FROM ${name === 'SOMEONE' ? 'A' : `${name}'S`} PLAYLIST`;
    case 'reader':
      return 'READ IN THE READER';
    default:
      return 'HOW: NOT RECORDED';
  }
}

/** The filter plates over the log. */
export type LogFilter = 'all' | 'music' | 'video' | 'books' | 'rooms' | 'letters';
export const LOG_FILTERS: readonly { key: LogFilter; label: string }[] = [
  { key: 'all', label: 'ALL' },
  { key: 'music', label: 'MUSIC' },
  { key: 'video', label: 'VIDEO' },
  { key: 'books', label: 'BOOKS' },
  { key: 'rooms', label: 'ROOMS' },
  { key: 'letters', label: 'LETTERS' },
];

const KIND_OF: Partial<Record<LogFilter, PlayKind>> = { music: 'song', video: 'video', books: 'book' };
const HOW_OF: Partial<Record<LogFilter, readonly PlayHow[]>> = { rooms: ['room', 'own_queue'], letters: ['letter'] };

export function passes(play: Pick<Play, 'kind' | 'how' | 'roomId'>, filter: LogFilter): boolean {
  if (filter === 'all') return true;
  const kind = KIND_OF[filter];
  if (kind !== undefined) return play.kind === kind;
  if (filter === 'rooms') return play.roomId !== null || (HOW_OF.rooms ?? []).includes(play.how);
  return (HOW_OF[filter] ?? []).includes(play.how);
}

/** `3:07` for a place in seconds, or null when there is none worth showing. */
export function placeOf(seconds: number | null): string | null {
  if (seconds === null || !Number.isFinite(seconds) || seconds < 1) return null;
  const whole = Math.floor(seconds);
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  return hours > 0 ? `${hours}:${two(minutes)}:${two(whole % 60)}` : `${minutes}:${two(whole % 60)}`;
}
