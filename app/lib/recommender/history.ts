'use client';

import { getSupabaseBrowserClient } from '../supabase/client';
import { HISTORY_KINDS, MAX_MAKER, MAX_REF, MAX_TITLE, MAX_WORDS, type HistoryAction, type HistoryKind, type HistoryNote, type HistoryRow } from './types';

/**
 * The browser's half of FOR YOU's private history (`user_history`, `user_history_settings`; Luke's OK 2026-11-13).
 *
 * Owner only, by Row Level Security: a page writes through `history_note` as the signed-in person, and the database
 * itself refuses a guest or a paused history. A visitor writes nothing. Writing is fire-and-forget: a failure never
 * stops what the reader was doing. With no Supabase (the mock site) the same calls keep a copy in this browser.
 *
 * Metadata only: an address, a title and maker as the site shows them, and words. Never counts, never DM text.
 */

const MOCK_KEY = 'debaser.history.mock.v1';
const MOCK_PAUSED_KEY = 'debaser.history.mock-paused.v1';
/** The same thing noted again within this long is not sent again. */
const QUIET_MS = 10 * 60_000;
const recent = new Map<string, number>();
const listeners = new Set<() => void>();

const clip = (value: string | null | undefined, max: number) => (value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const cleanWords = (words: readonly string[] | undefined) =>
  [...new Set((words ?? []).map((word) => clip(word, 60).toLowerCase()).filter(Boolean))].slice(0, MAX_WORDS);

function changed(): void {
  listeners.forEach((listener) => listener());
}

/** Lets FOR YOU redraw after ERASE, PAUSE or NOT FOR ME. */
export function subscribeHistory(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

async function signedIn(): Promise<boolean> {
  const db = getSupabaseBrowserClient();
  if (db === null) return true;
  const { data } = await db.auth.getSession();
  return Boolean(data.session && !data.session.user.is_anonymous);
}

/* --- the mock site's copy ---------------------------------------------------------------------- */

function mockRows(): HistoryRow[] {
  try {
    const rows = JSON.parse(window.localStorage.getItem(MOCK_KEY) ?? '[]') as unknown;
    return Array.isArray(rows) ? (rows as HistoryRow[]) : [];
  } catch {
    return [];
  }
}

function keepMock(rows: HistoryRow[]): void {
  try {
    window.localStorage.setItem(MOCK_KEY, JSON.stringify(rows.slice(0, 3000)));
  } catch {
    // Kept for this visit only.
  }
}

const RANK: Record<HistoryAction, number> = { opened: 1, played: 2, read: 2, finished: 3, not_for_me: 9 };

function mockNote(kind: HistoryKind, ref: string, fields: Omit<HistoryRow, 'kind' | 'ref' | 'firstAt' | 'lastAt'>): void {
  if (mockPaused()) return;
  const now = new Date().toISOString();
  const rows = mockRows();
  const at = rows.findIndex((row) => row.kind === kind && row.ref === ref);
  const before = at === -1 ? null : rows[at];
  const row: HistoryRow = {
    kind,
    ref,
    ...fields,
    words: fields.words.length > 0 ? fields.words : (before?.words ?? []),
    action: before !== null && RANK[before.action] >= RANK[fields.action] ? before.action : fields.action,
    firstAt: before?.firstAt ?? now,
    lastAt: now,
  };
  keepMock([row, ...rows.filter((_, index) => index !== at)]);
}

function mockPaused(): boolean {
  try {
    return window.localStorage.getItem(MOCK_PAUSED_KEY) === '1';
  } catch {
    return false;
  }
}

/* --- writing ----------------------------------------------------------------------------------- */

async function send(kind: HistoryKind, ref: string, fields: Omit<HistoryRow, 'kind' | 'ref' | 'firstAt' | 'lastAt'>): Promise<void> {
  const db = getSupabaseBrowserClient();
  if (db === null) {
    mockNote(kind, ref, fields);
    return;
  }
  if (!(await signedIn())) return;
  // A paused history or a guest is refused by the database itself; nothing to do here about it.
  await db.rpc('history_note', { p_kind: kind, p_ref: ref, p_title: fields.title, p_maker: fields.maker, p_words: fields.words, p_action: fields.action });
}

/** Something opened, played or read. Fire-and-forget; the same thing again within ten minutes is not sent again. */
export function noteHistory(note: HistoryNote): void {
  if (typeof window === 'undefined' || !HISTORY_KINDS.includes(note.kind)) return;
  const ref = clip(note.ref, MAX_REF);
  if (ref === '') return;
  const key = `${note.kind}:${ref}:${note.action}`;
  const last = recent.get(key);
  if (last !== undefined && Date.now() - last < QUIET_MS) return;
  recent.set(key, Date.now());
  void send(note.kind, ref, { title: clip(note.title, MAX_TITLE), maker: clip(note.maker, MAX_MAKER), words: cleanWords(note.words), action: note.action }).catch(() => {
    // History is a convenience: a failed write changes nothing the reader sees.
  });
}

/** `[ NOT FOR ME ]`: this thing is hidden from FOR YOU, and its words and maker count less. */
export async function notForMe(note: Omit<HistoryNote, 'action'>): Promise<void> {
  const ref = clip(note.ref, MAX_REF);
  if (ref === '') return;
  await send(note.kind, ref, { title: clip(note.title, MAX_TITLE), maker: clip(note.maker, MAX_MAKER), words: cleanWords(note.words), action: 'not_for_me' }).catch(() => undefined);
  changed();
}

/* --- reading and the controls ------------------------------------------------------------------- */

/** The person's own history, newest first (at most `limit` rows). Signed out: nothing. */
export async function readHistory(limit = 1000): Promise<HistoryRow[]> {
  const db = getSupabaseBrowserClient();
  if (db === null) return mockRows().slice(0, limit);
  if (!(await signedIn())) return [];
  const { data, error } = await db
    .from('user_history')
    .select('kind, ref, title, maker, words, action, first_at, last_at')
    .order('last_at', { ascending: false })
    .limit(limit);
  if (error || !data) return [];
  return data.map((row) => ({
    kind: row.kind as HistoryKind,
    ref: String(row.ref),
    title: String(row.title ?? ''),
    maker: String(row.maker ?? ''),
    words: Array.isArray(row.words) ? row.words.map(String) : [],
    action: row.action as HistoryAction,
    firstAt: String(row.first_at),
    lastAt: String(row.last_at),
  }));
}

export async function readPaused(): Promise<boolean> {
  const db = getSupabaseBrowserClient();
  if (db === null) return mockPaused();
  if (!(await signedIn())) return false;
  const { data } = await db.from('user_history_settings').select('paused').maybeSingle();
  return data?.paused === true;
}

/** PAUSE HISTORY / RESUME HISTORY. The database refuses new rows while it is paused. */
export async function setPaused(paused: boolean): Promise<boolean> {
  const db = getSupabaseBrowserClient();
  if (db === null) {
    try {
      window.localStorage.setItem(MOCK_PAUSED_KEY, paused ? '1' : '0');
    } catch {
      return false;
    }
    changed();
    return true;
  }
  const { data } = await db.auth.getSession();
  const person = data.session?.user.id;
  if (!person) return false;
  const { error } = await db.from('user_history_settings').upsert({ person, paused, changed_at: new Date().toISOString() });
  changed();
  return error === null;
}

/** ERASE MY HISTORY: every row of the person's, at once. */
export async function eraseHistory(): Promise<boolean> {
  recent.clear();
  const db = getSupabaseBrowserClient();
  if (db === null) {
    keepMock([]);
    changed();
    return true;
  }
  const { data } = await db.auth.getSession();
  const person = data.session?.user.id;
  if (!person) return false;
  const { error } = await db.from('user_history').delete().eq('person', person);
  changed();
  return error === null;
}

/** Undo a NOT FOR ME, or take one thing out of the history: its row is deleted. */
export async function forgetOne(kind: HistoryKind, ref: string): Promise<void> {
  const db = getSupabaseBrowserClient();
  if (db === null) {
    keepMock(mockRows().filter((row) => !(row.kind === kind && row.ref === ref)));
  } else {
    const { data } = await db.auth.getSession();
    const person = data.session?.user.id;
    if (person) await db.from('user_history').delete().eq('person', person).eq('kind', kind).eq('ref', ref);
  }
  recent.clear();
  changed();
}
