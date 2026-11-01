import { isSupabaseConfigured } from '../supabase/client';
import type { SavedLayouts } from '../ui/window-layout';
import { getMockWindowLayoutRepository } from './mock-window-layout-repository';
import { getSupabaseWindowLayoutRepository } from './supabase-window-layout-repository';

/**
 * Where one account's window layouts are kept.
 *
 * A layout is a setting on an account, so it follows the profiles unless it is told otherwise: a project
 * with `NEXT_PUBLIC_PROFILE_DATA_SOURCE=supabase` keeps layouts in `window_layouts` with no new deployment
 * setting. To point them somewhere else:
 *
 *   NEXT_PUBLIC_WINDOWS_DATA_SOURCE=supabase   (or `mock`)
 *
 * A guest has no account, so a guest's layout never comes here: `guest-window-layouts.ts` keeps it in
 * the browser.
 */
export type WindowLayoutRepository = {
  /** The account's layouts, `null` when it has none. Throws when the store could not be read. */
  load: (userId: string) => Promise<SavedLayouts | null>;
  /** Replaces the account's layouts. Last save wins. */
  save: (userId: string, layouts: SavedLayouts) => Promise<void>;
};

export type WindowLayoutDataSource = 'mock' | 'supabase';

function readSource(value: string | undefined): string | undefined {
  return value === undefined || value.trim().length === 0 ? undefined : value.trim();
}

const REQUESTED =
  readSource(process.env.NEXT_PUBLIC_WINDOWS_DATA_SOURCE) ?? readSource(process.env.NEXT_PUBLIC_PROFILE_DATA_SOURCE);

export const WINDOW_LAYOUT_DATA_SOURCE: WindowLayoutDataSource =
  REQUESTED === 'supabase' && isSupabaseConfigured ? 'supabase' : 'mock';

export function getWindowLayoutRepository(): WindowLayoutRepository {
  return WINDOW_LAYOUT_DATA_SOURCE === 'supabase' ? getSupabaseWindowLayoutRepository() : getMockWindowLayoutRepository();
}
