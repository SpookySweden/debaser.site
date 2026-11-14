'use client';

import { getSupabaseBrowserClient } from '../supabase/client';
import { asSummary, MAX_FILE_BYTES, readTakeout, type TakeoutResult } from './takeout';
import type { WatchSummary } from './youtube-picks';

/**
 * The summary of an imported YouTube history on the person's account (`user_watch_summary`, Luke's OK 2026-11-14:
 * "A: Yes, new table"), so MEDIA leans the same way on their phone and their computer.
 *
 * The Takeout file is read here, in the person's browser, and never uploaded: only the summary (`takeout.ts`: channel
 * names with a strength and a month, and topic words) is saved. Owner only by Row Level Security; guests and visitors
 * are shut out; it goes by itself 12 months after the import (the hourly MEDIA fetch), with the account, at
 * [ REMOVE IMPORT ], and with ERASE MY HISTORY. With no Supabase (the mock site) it is kept in this browser.
 */
const MOCK_KEY = 'debaser.watch-summary.mock.v1';
const KEEP_MS = 365 * 86_400_000;
const listeners = new Set<() => void>();

/** Lets the page redraw after an import or a removal. */
export function subscribeSummary(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const changed = () => listeners.forEach((listener) => listener());

async function owner(): Promise<string | null> {
  const db = getSupabaseBrowserClient();
  if (db === null) return null;
  const { data } = await db.auth.getSession();
  return data.session && !data.session.user.is_anonymous ? data.session.user.id : null;
}

/** The person's own summary, or null: none imported, signed out, or older than 12 months. */
export async function readSummary(): Promise<WatchSummary | null> {
  const db = getSupabaseBrowserClient();
  try {
    if (db === null) {
      const kept = asSummary(JSON.parse(window.localStorage.getItem(MOCK_KEY) ?? 'null'));
      return kept !== null && Date.now() - Date.parse(kept.importedAt) < KEEP_MS ? kept : null;
    }
    const person = await owner();
    if (person === null) return null;
    const { data, error } = await db.from('user_watch_summary').select('channels, words, imported_at').eq('person', person).maybeSingle();
    if (error || !data || Date.now() - Date.parse(String(data.imported_at)) > KEEP_MS) return null;
    return asSummary({ channels: data.channels, words: data.words, importedAt: String(data.imported_at) });
  } catch {
    return null;
  }
}

/** Saves a new summary over the last one. False when it could not be kept (signed out, or the database refused). */
export async function saveSummary(summary: WatchSummary): Promise<boolean> {
  const db = getSupabaseBrowserClient();
  try {
    if (db === null) {
      window.localStorage.setItem(MOCK_KEY, JSON.stringify(summary));
    } else {
      const person = await owner();
      if (person === null) return false;
      const { error } = await db.from('user_watch_summary').upsert({ person, channels: summary.channels, words: summary.words, imported_at: summary.importedAt });
      if (error) return false;
    }
    changed();
    return true;
  } catch {
    return false;
  }
}

/** [ REMOVE IMPORT ], and ERASE MY HISTORY: the summary goes at once. */
export async function removeSummary(): Promise<boolean> {
  const db = getSupabaseBrowserClient();
  try {
    if (db === null) {
      window.localStorage.removeItem(MOCK_KEY);
    } else {
      const person = await owner();
      if (person === null) return false;
      const { error } = await db.from('user_watch_summary').delete().eq('person', person);
      if (error) return false;
    }
    changed();
    return true;
  } catch {
    return false;
  }
}

/**
 * A chosen or dropped Takeout file, read in this browser and kept as its summary. The file's own bytes go nowhere: no
 * request carries them, and nothing but the summary is stored.
 */
export async function importTakeoutFile(file: File): Promise<TakeoutResult> {
  if (!/\.(json|html?)$/i.test(file.name)) return { ok: false, problem: 'CHOOSE THE FILE NAMED WATCH-HISTORY, ENDING IN .JSON OR .HTML.' };
  if (file.size > MAX_FILE_BYTES) return { ok: false, problem: 'THAT FILE IS TOO BIG TO READ HERE.' };
  let text: string;
  try {
    text = await file.text();
  } catch {
    return { ok: false, problem: 'THAT FILE COULD NOT BE READ.' };
  }
  const result = readTakeout(text, Date.now());
  if (!result.ok) return result;
  return (await saveSummary(result.summary)) ? result : { ok: false, problem: 'IT WAS READ, BUT COULD NOT BE SAVED. LOG IN AND TRY AGAIN.' };
}
