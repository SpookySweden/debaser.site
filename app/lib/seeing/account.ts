'use client';

/**
 * What BROWSER keeps on the account (SPEC-seeing-machine.md, Phase 5): history, tabs and notes. Only when the site's data source is the
 * database's; Row Level Security decides who reads what, and nothing here filters for safety. Each is also in this browser, so a line that is
 * down loses nothing that was seen here.
 */
import { getSupabaseBrowserClient, isSupabaseConfigured } from '../supabase/client';
import { HISTORY_MOST, rowsFrom, type Seen } from './history';
import { marginsFrom, type Margin } from './margins';
import { storedTabs, tabsFromStored, type Tabs } from './tabs';

export const ON_THE_ACCOUNT = process.env.NEXT_PUBLIC_SEEING_DATA_SOURCE === 'supabase';

const client = () => (ON_THE_ACCOUNT && isSupabaseConfigured ? getSupabaseBrowserClient() : null);

type HistoryRow = { address: string; title: string; came_from: string | null; at: string };
const ONCE = 500;

/** Null when it could not be read: nothing is taken for an empty history. */
export async function accountHistory(): Promise<Seen[] | null> {
  const asked = client();
  if (asked === null) return null;
  const rows: HistoryRow[] = [];
  // The database answers so many rows at a time.
  for (let from = 0; from < HISTORY_MOST; from += ONCE) {
    const { data, error } = await asked.from('browse_history').select('address, title, came_from, at').order('at', { ascending: false }).range(from, from + ONCE - 1);
    if (error) return null;
    rows.push(...((data ?? []) as HistoryRow[]));
    if ((data ?? []).length < ONCE) break;
  }
  return rowsFrom(rows.map((row) => ({ address: row.address, title: row.title, from: row.came_from, at: Date.parse(row.at) })), Date.now());
}

export async function addToAccountHistory(rows: readonly Seen[]): Promise<void> {
  const asked = client();
  if (asked === null || rows.length === 0) return;
  for (let from = 0; from < rows.length; from += ONCE) {
    await asked.from('browse_history').insert(rows.slice(from, from + ONCE).map((row) => ({ address: row.address, title: row.title.slice(0, 300), came_from: row.from, at: new Date(row.at).toISOString() })));
  }
}

export async function forgetInAccountHistory(row: Seen): Promise<void> {
  await client()?.from('browse_history').delete().eq('address', row.address).eq('at', new Date(row.at).toISOString());
}

/** One key clears it: on the account too, and it says so when it could not. */
export async function clearAccountHistory(): Promise<boolean> {
  const asked = client();
  if (asked === null) return !ON_THE_ACCOUNT;
  const { error } = await asked.from('browse_history').delete().gte('id', 0);
  return !error;
}

export async function accountTabs(): Promise<Tabs | null> {
  const asked = client();
  if (asked === null) return null;
  const { data } = await asked.from('browse_tabs').select('state').maybeSingle();
  const state = (data as { state?: unknown } | null)?.state;
  return state === undefined ? null : tabsFromStored(JSON.stringify(state));
}

export async function saveAccountTabs(owner: string, tabs: Tabs): Promise<void> {
  await client()?.from('browse_tabs').upsert({ person: owner, state: JSON.parse(storedTabs(tabs)) as unknown, updated_at: new Date().toISOString() });
}

/** A note as the site has it: whose it is, and that it is not ours to delete when it isn't. */
export type SharedNote = Margin & { ownerId: string; ownerLabel: string };

type NoteRow = { id: string; owner: string; owner_label: string; page: string; quote: string; note: string; created_at: string };

export async function notesOnPage(page: string): Promise<SharedNote[]> {
  const asked = client();
  if (asked === null) return [];
  const { data } = await asked.from('seen_notes').select('id, owner, owner_label, page, quote, note, created_at').eq('page', page).order('created_at', { ascending: false }).limit(100);
  const rows = (data ?? []) as NoteRow[];
  const read = marginsFrom({ notes: rows.map((row) => ({ id: row.id, page: row.page, quote: row.quote, note: row.note, at: Date.parse(row.created_at) })) }).notes;
  return read.flatMap((note) => {
    const row = rows.find((each) => each.id === note.id);
    return row === undefined ? [] : [{ ...note, ownerId: row.owner, ownerLabel: row.owner_label.slice(0, 80) }];
  });
}

export async function addSharedNote(note: Margin): Promise<boolean> {
  const asked = client();
  if (asked === null) return false;
  const { error } = await asked.from('seen_notes').insert({ id: note.id, page: note.page, quote: note.quote, note: note.note });
  return !error;
}

export async function deleteSharedNote(id: string): Promise<boolean> {
  const asked = client();
  if (asked === null) return false;
  const { error } = await asked.from('seen_notes').delete().eq('id', id);
  return !error;
}

/** A moderator's: hidden from everybody but its maker and the moderators, and said in their log. */
export async function hideSeen(kind: 'page' | 'note', id: string): Promise<boolean> {
  const asked = client();
  if (asked === null) return false;
  const { error } = await asked.rpc('seen_hide', { kind, target: id, hide: true, why: '' });
  return !error;
}
