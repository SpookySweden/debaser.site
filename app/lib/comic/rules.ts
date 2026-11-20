import { SYNCED_KEYS } from '../settings/settings-bus';
import type { ComicChapter, ComicContents, ComicPage, ComicVolume } from './types';

/**
 * COMIC's plain rules, kept apart from the browser and the database so `Temp/check-comic.cjs` asks them the same questions the
 * site does: reading order, page numbers, addresses, the alert's words.
 */

export const COMIC_HOME = '/comic';
export const COMIC_STUDIO = '/comic/studio';
export const TITLE_MAX = 120;
export const WORDS_MAX = 4000;

/** The reading copy's width and the zoom copy's long side, in pixels (SPEC-comic.md, "Page files"). */
export const READING_WIDTH = 2000;
export const ZOOM_LONG_SIDE = 4000;

/** Page files Luke may upload. */
export const PAGE_TYPES: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/tiff': 'tif',
};

/** The most one page may weigh (the bucket's own cap). */
export const PAGE_MAX_BYTES = 500 * 1024 * 1024;

/** One piece of an upload: small enough for Cloudflare's 100 MB request cap with room to spare. */
export const UPLOAD_CHUNK_BYTES = 4 * 1024 * 1024;

export function byPosition(a: Pick<ComicPage, 'position' | 'id'>, b: Pick<ComicPage, 'position' | 'id'>): number {
  return a.position - b.position || a.id.localeCompare(b.id);
}

/** A chapter's pages in reading order. */
export function chapterPages(contents: Pick<ComicContents, 'pages'>, chapterId: string): ComicPage[] {
  return contents.pages.filter((page) => page.chapterId === chapterId).sort(byPosition);
}

/** Chapters in reading order (their numbers run straight through the comic). */
export function chaptersInOrder(contents: Pick<ComicContents, 'chapters'>): ComicChapter[] {
  return [...contents.chapters].sort((a, b) => a.number - b.number);
}

export function volumesInOrder(contents: Pick<ComicContents, 'volumes'>): ComicVolume[] {
  return [...contents.volumes].sort((a, b) => a.number - b.number);
}

export function chaptersOfVolume(contents: Pick<ComicContents, 'chapters'>, volumeId: string): ComicChapter[] {
  return chaptersInOrder(contents).filter((chapter) => chapter.volumeId === volumeId);
}

/** A page's number inside its chapter, counted from 1 in reading order (as the database's release counts it). */
export function pageNumber(contents: Pick<ComicContents, 'pages'>, page: Pick<ComicPage, 'id' | 'chapterId'>): number {
  return chapterPages(contents, page.chapterId).findIndex((each) => each.id === page.id) + 1;
}

export function chapterPath(chapterNumber: number): string {
  return `${COMIC_HOME}/${chapterNumber}`;
}

export function pagePath(chapterNumber: number, pageNum: number, panelId?: string): string {
  const base = `${COMIC_HOME}/${chapterNumber}/${pageNum}`;
  return panelId === undefined ? base : `${base}?panel=${encodeURIComponent(panelId)}`;
}

/** The anchor a page carries in the chapter's column, so `/comic/3/12` can scroll to it. */
export function pageAnchor(pageNum: number): string {
  return `p${pageNum}`;
}

/** The file route's address for a page's reading or zoom copy. The version keeps a cached copy honest after a replace. */
export function pageFileUrl(page: Pick<ComicPage, 'id' | 'version'>, size: 'reading' | 'zoom'): string {
  return `/api/comic/page/${page.id}/${size}?v=${page.version}`;
}

/** Storage paths for a page's three files. */
export function storagePaths(pageId: string, version: number, originalExtension: string): { original: string; reading: string; zoom: string } {
  return {
    original: `original/${pageId}/v${version}.${originalExtension}`,
    reading: `reading/${pageId}/v${version}.jpg`,
    zoom: `zoom/${pageId}/v${version}.jpg`,
  };
}

/** The alert's words for one release: `3 NEW PAGES IN CHAPTER 2` (the database writes the same; this is for the studio's line). */
export function releaseTitle(count: number, chapterNumbers: readonly number[]): string {
  const distinct = [...new Set(chapterNumbers)];
  if (distinct.length === 1) return count === 1 ? `NEW PAGE IN CHAPTER ${distinct[0]}` : `${count} NEW PAGES IN CHAPTER ${distinct[0]}`;
  return count === 1 ? 'NEW PAGE' : `${count} NEW PAGES`;
}

/** The chapter after this one that has something to read, or null. */
export function nextChapter(contents: Pick<ComicContents, 'chapters' | 'pages'>, chapterNumber: number): ComicChapter | null {
  return (
    chaptersInOrder(contents).find(
      (chapter) => chapter.number > chapterNumber && contents.pages.some((page) => page.chapterId === chapter.id),
    ) ?? null
  );
}

/** A chapter's cover: its chosen page, else its first. */
export function coverOf(contents: Pick<ComicContents, 'pages'>, chapter: ComicChapter): ComicPage | null {
  const pages = chapterPages(contents, chapter.id);
  return pages.find((page) => page.id === chapter.coverPageId) ?? pages[0] ?? null;
}

/** Where a returning reader stopped: `<chapter>/<page>`, kept in the browser and synced to the account. */
export const PLACE_KEY = SYNCED_KEYS.comicPlace;

export function parsePlace(raw: string | null): { chapter: number; page: number } | null {
  if (raw === null) return null;
  const match = /^(\d{1,4})\/(\d{1,4})$/.exec(raw.trim());
  if (match === null) return null;
  return { chapter: Number(match[1]), page: Number(match[2]) };
}

export function formatPlace(chapter: number, page: number): string {
  return `${chapter}/${page}`;
}

/** The next number free for a new volume or chapter. */
export function nextNumber(items: readonly { number: number }[]): number {
  return items.reduce((highest, item) => Math.max(highest, item.number), 0) + 1;
}

export function cleanTitle(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim().slice(0, TITLE_MAX);
}
