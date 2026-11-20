'use client';

import { useEffect, useSyncExternalStore } from 'react';
import { getMockNotifySettingsRepository } from './mock-notify-settings-repository';
import { DEFAULT_NOTIFICATION_PREFS, type KindSwitch, type NotificationPrefs, type NotifySettingsRepository } from './prefs';
import { NOTIFICATIONS_DATA_SOURCE } from './repository';
import { getSupabaseNotifySettingsRepository } from './supabase-notify-settings-repository';

/**
 * One account's notification switches and TELL ME WHEN LIVE picks, read once per sign-in and shared by every screen
 * that shows them (PREFERENCES, a profile's key, the balloon). A change shows at once and is saved behind it; a save that
 * fails puts the old value back and says so.
 */

export function getNotifySettingsRepository(): NotifySettingsRepository {
  return NOTIFICATIONS_DATA_SOURCE === 'supabase' ? getSupabaseNotifySettingsRepository() : getMockNotifySettingsRepository();
}

export type NotifySettingsState = {
  person: string | null;
  ready: boolean;
  prefs: NotificationPrefs;
  watches: string[];
  error: string | null;
};

const EMPTY: NotifySettingsState = { person: null, ready: false, prefs: DEFAULT_NOTIFICATION_PREFS, watches: [], error: null };

let state: NotifySettingsState = EMPTY;
const listeners = new Set<() => void>();

function set(next: NotifySettingsState): void {
  state = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const snapshot = () => state;
const serverSnapshot = () => EMPTY;

let loading: string | null = null;

/** Reads the account's row (once per person); signed out, the defaults and no picks. */
export function loadNotifySettings(person: string | null): void {
  if (person === null) {
    loading = null;
    if (state.person !== null) set(EMPTY);
    return;
  }
  if (state.person === person || loading === person) return;
  loading = person;
  const repository = getNotifySettingsRepository();
  void Promise.all([repository.readPrefs(person), repository.listWatches(person)])
    .then(([prefs, watches]) => {
      if (loading !== person) return;
      set({ person, ready: true, prefs, watches, error: null });
    })
    .catch((caught: unknown) => {
      if (loading !== person) return;
      set({ ...EMPTY, person, ready: true, error: caught instanceof Error ? caught.message : 'YOUR NOTIFICATION SETTINGS DID NOT LOAD.' });
    })
    .finally(() => {
      if (loading === person) loading = null;
    });
}

/** Flips one switch (a kind, BALLOONS or WEEKLY EMAIL). */
export async function setNotifySwitch(key: KindSwitch | 'balloons' | 'weeklyEmail', on: boolean): Promise<void> {
  const { person, prefs } = state;
  if (person === null) return;
  const next = { ...prefs, [key]: on };
  set({ ...state, prefs: next, error: null });
  try {
    await getNotifySettingsRepository().savePrefs(person, next);
  } catch (caught: unknown) {
    if (state.person === person) set({ ...state, prefs, error: caught instanceof Error ? caught.message : 'THAT SWITCH DID NOT SAVE.' });
  }
}

/** TELL ME WHEN LIVE: picks or unpicks a person. */
export async function setLiveWatch(host: string, on: boolean): Promise<void> {
  const { person, watches } = state;
  if (person === null || host === person) return;
  const next = on ? [host, ...watches.filter((id) => id !== host)] : watches.filter((id) => id !== host);
  set({ ...state, watches: next, error: null });
  try {
    const repository = getNotifySettingsRepository();
    await (on ? repository.addWatch(person, host) : repository.removeWatch(person, host));
  } catch (caught: unknown) {
    if (state.person === person) set({ ...state, watches, error: caught instanceof Error ? caught.message : 'THAT DID NOT SAVE.' });
  }
}

/** The signed-in account's settings, loading them the first time any screen asks. */
export function useNotifySettings(person: string | null): NotifySettingsState {
  useEffect(() => {
    loadNotifySettings(person);
  }, [person]);
  const current = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
  return current.person === person ? current : { ...EMPTY, person };
}
