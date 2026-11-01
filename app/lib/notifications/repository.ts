import { isSupabaseConfigured } from '../supabase/client';
import { getMockNotificationsRepository } from './mock-notifications-repository';
import { getSupabaseNotificationsRepository } from './supabase-notifications-repository';
import type { NotificationsDataSource, NotificationsRepository } from './types';

/**
 * The single switch that decides where the notification feed lives.
 *
 * Tags and replies are board events, so the feed follows the board unless it is told
 * otherwise: a project with `NEXT_PUBLIC_FORUM_DATA_SOURCE=supabase` gets a live feed without
 * another deployment setting, and a project on the mock board keeps its tags in this browser.
 * To point the two at different stores:
 *
 *   NEXT_PUBLIC_NOTIFICATIONS_DATA_SOURCE=supabase   (or `mock`)
 *
 * Nothing in the UI changes either way: the bell, the menu and the provider all talk to the
 * NotificationsRepository interface, which is what makes one pop-up serve both.
 */

/** An env var that was set but left blank counts as unset. */
function readSource(value: string | undefined): string | undefined {
  return value === undefined || value.trim().length === 0 ? undefined : value.trim();
}

const REQUESTED =
  readSource(process.env.NEXT_PUBLIC_NOTIFICATIONS_DATA_SOURCE) ??
  readSource(process.env.NEXT_PUBLIC_FORUM_DATA_SOURCE);

export const NOTIFICATIONS_DATA_SOURCE: NotificationsDataSource =
  REQUESTED === 'supabase' && isSupabaseConfigured ? 'supabase' : 'mock';

export function getNotificationsRepository(): NotificationsRepository {
  return NOTIFICATIONS_DATA_SOURCE === 'supabase'
    ? getSupabaseNotificationsRepository()
    : getMockNotificationsRepository();
}
