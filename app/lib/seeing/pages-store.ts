'use client';

/** The kept pages this browser may show, held once for everything that draws them (BROWSER, Ctrl+K). */
import { getSupabaseBrowserClient, isSupabaseConfigured } from '../supabase/client';
import type { MadeCopy, SeenPage } from './pages';
import { localPages, type PagesRepository } from './pages-repository';
import { createSupabasePages } from './supabase-pages-repository';

let repository: PagesRepository | null = null;
export function pagesRepository(): PagesRepository {
  const client = PAGES_ARE_SHARED && isSupabaseConfigured ? getSupabaseBrowserClient() : null;
  repository ??= client === null ? localPages : createSupabasePages(client);
  return repository;
}

export const PAGES_ARE_SHARED = process.env.NEXT_PUBLIC_SEEING_DATA_SOURCE === 'supabase';

const NONE: readonly SeenPage[] = [];
let held: { owner: string | null; pages: readonly SeenPage[]; read: boolean } = { owner: null, pages: NONE, read: false };
const listeners = new Set<() => void>();
const set = (next: typeof held): void => {
  held = next;
  for (const listener of listeners) listener();
};

export const keptPages = (): readonly SeenPage[] => held.pages;
export const keptPagesOnServer = (): readonly SeenPage[] => NONE;
export function subscribeToKeptPages(listener: () => void): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

/** Read once for whoever is signed in; again only when that changes. */
export async function openKeptPagesOf(owner: string | null): Promise<void> {
  if (held.read && held.owner === owner) return;
  set({ owner, pages: NONE, read: true });
  const pages = await pagesRepository().list(owner).catch(() => NONE);
  if (held.owner === owner) set({ ...held, pages });
}

export async function keepPage(page: SeenPage, copy: MadeCopy | null): Promise<void> {
  await pagesRepository().keep(page, copy);
  if (held.owner === page.ownerId) set({ ...held, pages: [page, ...held.pages.filter((each) => each.id !== page.id)] });
}

export async function removePage(page: SeenPage): Promise<void> {
  await pagesRepository().remove(page);
  set({ ...held, pages: held.pages.filter((each) => each.id !== page.id) });
}

export const copyOfPage = (id: string): Promise<MadeCopy | null> => pagesRepository().copyOf(id, held.owner);
export const keptPage = (id: string): SeenPage | null => held.pages.find((each) => each.id === id) ?? null;
