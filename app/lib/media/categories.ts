import type { CatalogueEntry, MediaKind } from './types';

/**
 * The archive's categories: what the `/media` page opens on (Luke, 2026-10-31: "the first thing you see
 * should be a set of categories", not a list of files).
 *
 * Nobody files anything into these by hand. A file's categories are read off what it is and where it is
 * used: a picture somebody wears as their profile picture is a PROFILE PICTURE, a track in an archive
 * folder sits in that folder's category. A file can sit in more than one (a profile song also filed in a
 * folder shows in both, as the music shelf already did), so a search lists each match once, under its
 * first category.
 *
 * Kept free of React so a check can run it on its own.
 */

export type CategoryId = string;

export type Category = {
  id: CategoryId;
  kind: MediaKind;
  label: string;
  entries: CatalogueEntry[];
  /** A music folder's own path (its top level), so the page can file into it; undefined otherwise. */
  folderPath?: string;
};

/** The order the kinds are shown in, and what their section is called. */
export const SECTIONS: { kind: MediaKind; label: string }[] = [
  { kind: 'image', label: 'PICTURES' },
  { kind: 'audio', label: 'MUSIC' },
  { kind: 'video', label: 'VIDEO' },
];

const FOLDER_PREFIX = 'music-folder:';

/** The fixed categories, in the order they are shown within their section. */
const FIXED: { id: CategoryId; kind: MediaKind; label: string }[] = [
  { id: 'pictures-profile', kind: 'image', label: 'PROFILE PICTURES' },
  { id: 'pictures-sheets', kind: 'image', label: 'CONCEPT SHEETS' },
  { id: 'pictures-posts', kind: 'image', label: 'POST PICTURES' },
  { id: 'pictures-other', kind: 'image', label: 'OTHER PICTURES' },
  { id: 'music-profile', kind: 'audio', label: 'PROFILE MUSIC' },
  { id: 'music-unfiled', kind: 'audio', label: 'UNFILED MUSIC' },
  { id: 'videos', kind: 'video', label: 'VIDEOS' },
];

/** The top level of a folder path: `HEXHAM/GRIDLOCK` is in `HEXHAM`. */
export function topFolder(path: string): string {
  return path.split('/').filter((part) => part.length > 0)[0] ?? '';
}

export function folderCategoryId(top: string): CategoryId {
  return `${FOLDER_PREFIX}${top}`;
}

/** Every category a file belongs to, in the order the page shows them. */
export function categoriesOf({ item, uses }: CatalogueEntry): CategoryId[] {
  const usedAs = (...kinds: string[]) => uses.some((use) => kinds.includes(use.useKind));

  if (item.kind === 'image') {
    const ids: CategoryId[] = [];
    if (usedAs('profile_picture')) ids.push('pictures-profile');
    if (item.source === 'sheet' || usedAs('sheet')) ids.push('pictures-sheets');
    if (usedAs('post', 'reply')) ids.push('pictures-posts');
    return ids.length === 0 ? ['pictures-other'] : ids;
  }

  if (item.kind === 'audio') {
    const ids: CategoryId[] = [];
    const top = topFolder(item.folderPath ?? '');
    if (top.length > 0) ids.push(folderCategoryId(top));
    if (usedAs('profile_song')) ids.push('music-profile');
    return ids.length === 0 ? ['music-unfiled'] : ids;
  }

  return ['videos'];
}

/**
 * The categories as the front page draws them: pictures, music, video. A fixed category with nothing in
 * it is left out. A music folder somebody made but has not filed anything into still shows, so they can
 * find it and file into it.
 */
export function categorise(entries: CatalogueEntry[], folderPaths: string[]): Category[] {
  const byId = new Map<CategoryId, CatalogueEntry[]>();
  for (const entry of entries) {
    for (const id of categoriesOf(entry)) byId.set(id, [...(byId.get(id) ?? []), entry]);
  }

  const tops = new Set<string>();
  for (const path of folderPaths) if (topFolder(path).length > 0) tops.add(topFolder(path));
  for (const id of byId.keys()) if (id.startsWith(FOLDER_PREFIX)) tops.add(id.slice(FOLDER_PREFIX.length));

  const folders: Category[] = [...tops]
    .sort((a, b) => a.localeCompare(b))
    .map((top) => ({ id: folderCategoryId(top), kind: 'audio', label: top, entries: byId.get(folderCategoryId(top)) ?? [], folderPath: top }));

  const fixed = (kind: MediaKind): Category[] =>
    FIXED.filter((category) => category.kind === kind)
      .map((category) => ({ ...category, entries: byId.get(category.id) ?? [] }))
      .filter((category) => category.entries.length > 0);

  return [...fixed('image'), ...folders, ...fixed('audio'), ...fixed('video')];
}

/** The words a search can find a file by that are not on the file itself: its categories' names. */
export function categoryWords(entry: CatalogueEntry): string {
  return categoriesOf(entry)
    .map((id) => (id.startsWith(FOLDER_PREFIX) ? id.slice(FOLDER_PREFIX.length) : FIXED.find((category) => category.id === id)?.label ?? ''))
    .join(' ')
    .toLowerCase();
}

/**
 * A list of matches grouped by category, each file once under its first category, in the front page's
 * order. Used for a search and for a tag, where the reader asked for the matches and the category is
 * where each one lives.
 */
export function groupMatches(matches: CatalogueEntry[], categories: Category[]): Category[] {
  const firstOf = new Map<string, CategoryId>();
  for (const entry of matches) firstOf.set(entry.item.id, categoriesOf(entry)[0]);

  return categories
    .map((category) => ({ ...category, entries: matches.filter((entry) => firstOf.get(entry.item.id) === category.id) }))
    .filter((category) => category.entries.length > 0);
}

/** Every tag in use, with how many files wear it, most worn first. `keyOf` folds spellings together. */
export function tagCounts(entries: CatalogueEntry[], keyOf: (tag: string) => string): { tag: string; key: string; count: number }[] {
  const byKey = new Map<string, { tag: string; key: string; count: number }>();
  for (const { item } of entries) {
    const seen = new Set<string>();
    for (const tag of item.tags) {
      const key = keyOf(tag);
      if (key.length === 0 || seen.has(key)) continue;
      seen.add(key);
      const current = byKey.get(key) ?? { tag, key, count: 0 };
      byKey.set(key, { ...current, count: current.count + 1 });
    }
  }

  return [...byKey.values()].sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
}
