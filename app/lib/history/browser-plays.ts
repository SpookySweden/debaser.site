import { samePlay } from './sessions';
import type { PlaysRepository } from './repository';
import { MAX_HREF, MAX_MAKER, MAX_REF, MAX_TITLE, MAX_WHERE, type Play, type PlayNote } from './types';

/**
 * HISTORY kept in this browser (SPEC-history.md, answer 5A): a signed-out visitor's log, a stream room guest's, and the
 * whole log on the mock site. Its own storage, never sent anywhere; up to `max` lines, the oldest going first. A storage
 * that refuses (a private window) keeps the log for this visit only.
 */

const clip = (value: string | null | undefined, max: number) => (value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

export function playFromNote(note: PlayNote, id: string, playedAt: string): Play {
  return {
    id,
    kind: note.kind,
    ref: clip(note.ref, MAX_REF),
    title: clip(note.title, MAX_TITLE),
    maker: clip(note.maker, MAX_MAKER),
    picture: note.picture ? clip(note.picture, MAX_REF) : null,
    how: note.how,
    whereLabel: clip(note.whereLabel, MAX_WHERE),
    whereHref: note.whereHref ? clip(note.whereHref, MAX_HREF) : null,
    addedBy: note.addedBy ?? null,
    addedByName: clip(note.addedByName, MAX_MAKER),
    roomId: note.roomId ?? null,
    queueEntryId: note.queueEntryId ?? null,
    letterId: note.letterId ?? null,
    sourceRef: note.sourceRef ? clip(note.sourceRef, MAX_HREF) : null,
    playedAt,
    stoppedAt: null,
    leftAtSeconds: null,
    lengthSeconds: note.lengthSeconds !== undefined && note.lengthSeconds !== null && note.lengthSeconds >= 0 ? Math.round(note.lengthSeconds) : null,
  };
}

export function createBrowserPlays(storageKey: string, max: number): PlaysRepository {
  let memory: Play[] | null = null;

  function read(): Play[] {
    if (memory !== null) return memory;
    try {
      const raw = JSON.parse(window.localStorage.getItem(storageKey) ?? '[]') as unknown;
      memory = Array.isArray(raw) ? (raw as Play[]).filter((play) => typeof play?.id === 'string' && typeof play.playedAt === 'string') : [];
    } catch {
      memory = [];
    }
    return memory;
  }

  function keep(plays: Play[]): void {
    memory = plays.slice(0, max);
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(memory));
    } catch {
      // Kept for this visit only.
    }
  }

  return {
    async note(note) {
      const now = Date.now();
      const plays = read();
      const ref = clip(note.ref, MAX_REF);
      const last = plays.find((play) => (note.queueEntryId ? play.queueEntryId === note.queueEntryId : false) || (play.kind === note.kind && play.ref === ref));
      if (last !== undefined && samePlay(last, { ...note, ref }, now)) return last.id;
      const play = playFromNote(note, `b:${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`, new Date(now).toISOString());
      keep([play, ...plays]);
      return play.id;
    },
    async stop(id, leftAtSeconds, lengthSeconds) {
      const plays = read();
      const at = plays.findIndex((play) => play.id === id);
      if (at === -1) return;
      const next = [...plays];
      next[at] = {
        ...plays[at],
        stoppedAt: new Date().toISOString(),
        leftAtSeconds: leftAtSeconds === null ? plays[at].leftAtSeconds : Math.max(0, Math.round(leftAtSeconds)),
        lengthSeconds: lengthSeconds === null ? plays[at].lengthSeconds : Math.max(0, Math.round(lengthSeconds)),
      };
      keep(next);
    },
    async list(limit, before) {
      const plays = [...read()].sort((a, b) => Date.parse(b.playedAt) - Date.parse(a.playedAt));
      const older = before === undefined ? plays : plays.filter((play) => Date.parse(play.playedAt) < Date.parse(before));
      return older.slice(0, limit);
    },
    async remove(id) {
      keep(read().filter((play) => play.id !== id));
      return true;
    },
    async erase() {
      keep([]);
      return true;
    },
  };
}
