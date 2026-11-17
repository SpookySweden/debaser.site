import type { SupabaseClient } from '@supabase/supabase-js';
import type { PlaysRepository } from './repository';
import { MAX_HREF, MAX_MAKER, MAX_REF, MAX_TITLE, MAX_WHERE, PLAY_HOWS, type Play, type PlayHow, type PlayKind } from './types';

/**
 * HISTORY on the account (`user_plays`, `20261117022630_user_plays.sql`; SPEC-history.md). Owner only, by Row Level
 * Security: the database refuses a guest, a visitor, a paused history and anyone else's lines, so nothing here filters
 * for safety. A line is written through `play_note`, which keeps one line for the same play pressed again within 60 s.
 */

const COLUMNS =
  'id, kind, ref, title, maker, picture, how, where_label, where_href, added_by, added_by_name, room_id, queue_entry_id, letter_id, source_ref, played_at, stopped_at, left_at_seconds, length_seconds';

const clip = (value: string | null | undefined, max: number) => (value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const orNull = (value: unknown) => (value === null || value === undefined || value === '' ? null : String(value));
const numberOrNull = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : null);

type Row = Record<string, unknown>;

function toPlay(row: Row): Play {
  const how = String(row.how) as PlayHow;
  return {
    id: String(row.id),
    kind: String(row.kind) as PlayKind,
    ref: String(row.ref ?? ''),
    title: String(row.title ?? ''),
    maker: String(row.maker ?? ''),
    picture: orNull(row.picture),
    how: PLAY_HOWS.includes(how) ? how : 'not_recorded',
    whereLabel: String(row.where_label ?? ''),
    whereHref: orNull(row.where_href),
    addedBy: orNull(row.added_by),
    addedByName: String(row.added_by_name ?? ''),
    roomId: orNull(row.room_id),
    queueEntryId: orNull(row.queue_entry_id),
    letterId: orNull(row.letter_id),
    sourceRef: orNull(row.source_ref),
    playedAt: String(row.played_at),
    stoppedAt: orNull(row.stopped_at),
    leftAtSeconds: numberOrNull(row.left_at_seconds),
    lengthSeconds: numberOrNull(row.length_seconds),
  };
}

async function me(client: SupabaseClient): Promise<string | null> {
  const { data } = await client.auth.getSession();
  const user = data.session?.user;
  return user && !user.is_anonymous ? user.id : null;
}

export function createSupabasePlays(client: SupabaseClient): PlaysRepository {
  return {
    async note(note) {
      const { data, error } = await client.rpc('play_note', {
        p_kind: note.kind,
        p_ref: clip(note.ref, MAX_REF),
        p_title: clip(note.title, MAX_TITLE),
        p_maker: clip(note.maker, MAX_MAKER),
        p_picture: note.picture ? clip(note.picture, MAX_REF) : null,
        p_how: note.how,
        p_where_label: clip(note.whereLabel, MAX_WHERE),
        p_where_href: note.whereHref ? clip(note.whereHref, MAX_HREF) : null,
        p_added_by: note.addedBy ?? null,
        p_added_by_name: clip(note.addedByName, MAX_MAKER),
        p_room: note.roomId ?? null,
        p_queue_entry: note.queueEntryId ?? null,
        p_letter: note.letterId ?? null,
        p_source_ref: note.sourceRef ? clip(note.sourceRef, MAX_HREF) : null,
        p_length: note.lengthSeconds === undefined || note.lengthSeconds === null ? null : Math.max(0, Math.round(note.lengthSeconds)),
      });
      if (error !== null || data === null || data === undefined) return null;
      return String(data);
    },
    async stop(id, leftAtSeconds, lengthSeconds) {
      const change: Row = { stopped_at: new Date().toISOString() };
      if (leftAtSeconds !== null) change.left_at_seconds = Math.max(0, Math.round(leftAtSeconds));
      if (lengthSeconds !== null) change.length_seconds = Math.max(0, Math.round(lengthSeconds));
      await client.from('user_plays').update(change).eq('id', id);
    },
    async list(limit, before) {
      if ((await me(client)) === null) return [];
      let query = client.from('user_plays').select(COLUMNS).order('played_at', { ascending: false }).limit(limit);
      if (before !== undefined) query = query.lt('played_at', before);
      const { data, error } = await query;
      if (error !== null || !data) return [];
      return (data as Row[]).map(toPlay);
    },
    async remove(id) {
      const { error } = await client.from('user_plays').delete().eq('id', id);
      return error === null;
    },
    async erase() {
      const person = await me(client);
      if (person === null) return false;
      const { error } = await client.from('user_plays').delete().eq('person', person);
      return error === null;
    },
  };
}
