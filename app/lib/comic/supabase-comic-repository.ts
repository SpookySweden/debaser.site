import type { SupabaseClient } from '@supabase/supabase-js';
import { chapterPages } from './rules';
import type { Appearance, ComicChapter, ComicContents, ComicPage, ComicPanel, ComicRepository, ComicVolume, LoreLink } from './types';

/**
 * COMIC in the database (supabase/migrations/20261120015329_comic.sql). Row Level Security decides what comes back: a visitor
 * gets released pages only, the house account everything; only the house account may write, and a page is released only
 * through `comic_release`. Nothing here filters for safety.
 */

type VolumeRow = { id: string; number: number; title: string };
type ChapterRow = { id: string; volume_id: string; number: number; title: string; cover_page_id: string | null };
type PageRow = {
  id: string;
  chapter_id: string;
  position: number;
  is_spread: boolean;
  width: number | null;
  height: number | null;
  reading_width: number | null;
  reading_height: number | null;
  version: number;
  reading_path: string | null;
  zoom_path: string | null;
  words: string;
  released_at: string | null;
};
type PanelRow = { id: string; page_id: string; position: number; x: number; y: number; w: number; h: number; guessed: boolean };
type TagRow = { panel_id: string; doc_id: string; docs: { slug: string | null; title: string } | null };

const LIMIT = 2000;
const PAGE_COLUMNS = 'id, chapter_id, position, is_spread, width, height, reading_width, reading_height, version, reading_path, zoom_path, words, released_at';

/** The database's own refusals that are worded for a reader; anything else gets the site's words. */
const READABLE = ['only the house account releases pages', 'pick the pages to release', 'nothing to release'];

function failure(error: { message?: string; code?: string } | null, fallback: string): Error {
  const message = error?.message ?? '';
  if (error?.code === '23505') return new Error('THAT NUMBER IS TAKEN.');
  if (error?.code === '23503') return new Error('MOVE OR DELETE WHAT IS INSIDE IT FIRST.');
  const readable = READABLE.find((each) => message.includes(each));
  return new Error(readable ? readable.toUpperCase() + '.' : fallback);
}

function pageFrom(row: PageRow): ComicPage {
  return {
    id: row.id,
    chapterId: row.chapter_id,
    position: row.position,
    isSpread: row.is_spread,
    width: row.width,
    height: row.height,
    readingWidth: row.reading_width,
    readingHeight: row.reading_height,
    version: row.version,
    hasCopies: row.reading_path !== null && row.zoom_path !== null,
    words: row.words,
    releasedAt: row.released_at,
  };
}

function panelFrom(row: PanelRow): ComicPanel {
  return { id: row.id, pageId: row.page_id, position: row.position, x: row.x, y: row.y, w: row.w, h: row.h, guessed: row.guessed };
}

function newId(): string {
  return crypto.randomUUID();
}

export function createSupabaseComicRepository(client: SupabaseClient): ComicRepository {
  async function characterIds(docIds: readonly string[]): Promise<Set<string>> {
    if (docIds.length === 0) return new Set();
    const { data } = await client.from('comic_characters').select('doc_id').in('doc_id', [...docIds]).limit(LIMIT);
    return new Set(((data ?? []) as { doc_id: string }[]).map((row) => row.doc_id));
  }

  const repository: ComicRepository = {
    async contents(): Promise<ComicContents> {
      const [volumes, chapters, pages] = await Promise.all([
        client.from('comic_volumes').select('id, number, title').order('number').limit(LIMIT),
        client.from('comic_chapters').select('id, volume_id, number, title, cover_page_id').order('number').limit(LIMIT),
        client.from('comic_pages').select(PAGE_COLUMNS).order('position').limit(LIMIT * 5),
      ]);
      if (volumes.error || chapters.error || pages.error) throw new Error('THE COMIC COULD NOT BE READ.');
      return {
        volumes: ((volumes.data ?? []) as VolumeRow[]).map((row): ComicVolume => ({ id: row.id, number: row.number, title: row.title })),
        chapters: ((chapters.data ?? []) as ChapterRow[]).map(
          (row): ComicChapter => ({ id: row.id, volumeId: row.volume_id, number: row.number, title: row.title, coverPageId: row.cover_page_id }),
        ),
        pages: ((pages.data ?? []) as PageRow[]).map(pageFrom),
      };
    },
    async panels(pageIds) {
      if (pageIds.length === 0) return [];
      const { data, error } = await client
        .from('comic_panels')
        .select('id, page_id, position, x, y, w, h, guessed')
        .in('page_id', [...pageIds])
        .order('position')
        .limit(LIMIT);
      if (error) throw new Error('THE PANELS COULD NOT BE READ.');
      return ((data ?? []) as PanelRow[]).map(panelFrom);
    },
    async findPanel(panelId) {
      const { data } = await client.from('comic_panels').select('id, page_id, position, x, y, w, h, guessed').eq('id', panelId).maybeSingle();
      return data ? panelFrom(data as PanelRow) : null;
    },
    async tags(panelIds) {
      const found: Record<string, LoreLink[]> = {};
      if (panelIds.length === 0) return found;
      const { data, error } = await client
        .from('comic_panel_tags')
        .select('panel_id, doc_id, docs(slug, title)')
        .in('panel_id', [...panelIds])
        .limit(LIMIT);
      if (error) return found;
      const rows = (data ?? []) as unknown as TagRow[];
      const characters = await characterIds([...new Set(rows.map((row) => row.doc_id))]);
      for (const row of rows) {
        if (row.docs === null || row.docs.slug === null) continue;
        (found[row.panel_id] ??= []).push({ docId: row.doc_id, slug: row.docs.slug, title: row.docs.title, isCharacter: characters.has(row.doc_id) });
      }
      for (const links of Object.values(found)) links.sort((a, b) => Number(b.isCharacter) - Number(a.isCharacter) || a.title.localeCompare(b.title));
      return found;
    },
    async appearances(docId) {
      const { data, error } = await client.from('comic_panel_tags').select('panel_id').eq('doc_id', docId).limit(LIMIT);
      if (error || !data || data.length === 0) return [];
      const panelIds = (data as { panel_id: string }[]).map((row) => row.panel_id);
      const [contents, panelRows] = await Promise.all([
        repository.contents(),
        client.from('comic_panels').select('id, page_id, position, x, y, w, h, guessed').in('id', panelIds).limit(LIMIT),
      ]);
      const found: Appearance[] = [];
      for (const panel of ((panelRows.data ?? []) as PanelRow[]).map(panelFrom)) {
        const page = contents.pages.find((each) => each.id === panel.pageId && each.releasedAt !== null);
        const chapter = page ? contents.chapters.find((each) => each.id === page.chapterId) : undefined;
        if (!page || !chapter) continue;
        found.push({
          panelId: panel.id,
          pageId: page.id,
          chapterNumber: chapter.number,
          pageNumber: chapterPages(contents, chapter.id).findIndex((each) => each.id === page.id) + 1,
          box: { x: panel.x, y: panel.y, w: panel.w, h: panel.h },
          page: { id: page.id, version: page.version, readingWidth: page.readingWidth, readingHeight: page.readingHeight },
        });
      }
      return found.sort((a, b) => a.chapterNumber - b.chapterNumber || a.pageNumber - b.pageNumber);
    },
    async isCharacter(docId) {
      return (await characterIds([docId])).has(docId);
    },

    async addVolume(input) {
      const { error } = await client.from('comic_volumes').insert({ number: input.number, title: input.title });
      if (error) throw failure(error, 'THE VOLUME COULD NOT BE ADDED.');
    },
    async updateVolume(id, input) {
      const { error } = await client.from('comic_volumes').update(input).eq('id', id);
      if (error) throw failure(error, 'THE VOLUME COULD NOT BE SAVED.');
    },
    async deleteVolume(id) {
      const { error } = await client.from('comic_volumes').delete().eq('id', id);
      if (error) throw failure(error, 'THE VOLUME COULD NOT BE DELETED.');
    },
    async addChapter(input) {
      const { error } = await client.from('comic_chapters').insert({ volume_id: input.volumeId, number: input.number, title: input.title });
      if (error) throw failure(error, 'THE CHAPTER COULD NOT BE ADDED.');
    },
    async updateChapter(id, input) {
      const row: Record<string, unknown> = {};
      if (input.number !== undefined) row.number = input.number;
      if (input.title !== undefined) row.title = input.title;
      if (input.coverPageId !== undefined) row.cover_page_id = input.coverPageId;
      if (input.volumeId !== undefined) row.volume_id = input.volumeId;
      const { error } = await client.from('comic_chapters').update(row).eq('id', id);
      if (error) throw failure(error, 'THE CHAPTER COULD NOT BE SAVED.');
    },
    async deleteChapter(id) {
      const { error } = await client.from('comic_chapters').delete().eq('id', id);
      if (error) throw failure(error, 'THE CHAPTER COULD NOT BE DELETED.');
    },
    async savePage({ id, chapterId, position, uploaded, replacing }) {
      const files = {
        width: uploaded.width,
        height: uploaded.height,
        reading_width: uploaded.readingWidth,
        reading_height: uploaded.readingHeight,
        version: uploaded.version,
        original_path: uploaded.originalPath,
        reading_path: uploaded.readingPath,
        zoom_path: uploaded.zoomPath,
      };
      if (replacing) {
        const { error } = await client.from('comic_pages').update(files).eq('id', id);
        if (error) throw failure(error, 'THE PAGE COULD NOT BE SAVED.');
        const { data } = await client.from('comic_panels').select('guessed').eq('page_id', id).limit(LIMIT);
        // Boxes Luke has fixed stay; a page whose boxes were only guesses takes the new guess.
        if (((data ?? []) as { guessed: boolean }[]).some((row) => !row.guessed)) return;
      } else {
        const { error } = await client
          .from('comic_pages')
          .insert({ id, chapter_id: chapterId, position, is_spread: uploaded.width > uploaded.height, ...files });
        if (error) throw failure(error, 'THE PAGE COULD NOT BE SAVED.');
      }
      await repository.savePanels(
        id,
        uploaded.panels.map((box) => ({ ...box, guessed: true })),
      );
    },
    async updatePage(id, patch) {
      const row: Record<string, unknown> = {};
      if (patch.chapterId !== undefined) row.chapter_id = patch.chapterId;
      if (patch.position !== undefined) row.position = patch.position;
      if (patch.isSpread !== undefined) row.is_spread = patch.isSpread;
      if (patch.words !== undefined) row.words = patch.words;
      const { error } = await client.from('comic_pages').update(row).eq('id', id);
      if (error) throw failure(error, 'THE PAGE COULD NOT BE SAVED.');
    },
    async reorderPages(chapterId, orderedIds) {
      if (orderedIds.length === 0) return;
      const { error } = await client
        .from('comic_pages')
        .upsert(orderedIds.map((id, position) => ({ id, chapter_id: chapterId, position })), { onConflict: 'id' });
      if (error) throw failure(error, 'THE ORDER COULD NOT BE SAVED.');
    },
    async deletePage(id) {
      const { error } = await client.from('comic_pages').delete().eq('id', id);
      if (error) throw failure(error, 'THE PAGE COULD NOT BE DELETED.');
    },
    async savePanels(pageId, boxes) {
      const { data, error } = await client.from('comic_panels').select('id, position').eq('page_id', pageId).order('position').limit(LIMIT);
      if (error) throw failure(error, 'THE PANELS COULD NOT BE SAVED.');
      const old = (data ?? []) as { id: string; position: number }[];
      // Boxes keep their ids (and so their tags and comment threads) where they stay in place in the order.
      const rows = boxes.map((box, index) => ({
        id: old[index]?.id ?? newId(),
        page_id: pageId,
        position: index,
        x: box.x,
        y: box.y,
        w: box.w,
        h: box.h,
        guessed: box.guessed,
      }));
      const gone = old.slice(rows.length).map((row) => row.id);
      if (gone.length > 0) {
        const removed = await client.from('comic_panels').delete().in('id', gone);
        if (removed.error) throw failure(removed.error, 'THE PANELS COULD NOT BE SAVED.');
      }
      if (rows.length > 0) {
        const saved = await client.from('comic_panels').upsert(rows, { onConflict: 'id' });
        if (saved.error) throw failure(saved.error, 'THE PANELS COULD NOT BE SAVED.');
      }
    },
    async setTags(panelId, docIds) {
      const removed = await client.from('comic_panel_tags').delete().eq('panel_id', panelId);
      if (removed.error) throw failure(removed.error, 'THE TAGS COULD NOT BE SAVED.');
      if (docIds.length === 0) return;
      const { error } = await client.from('comic_panel_tags').insert(docIds.map((docId) => ({ panel_id: panelId, doc_id: docId })));
      if (error) throw failure(error, 'THE TAGS COULD NOT BE SAVED.');
    },
    async setCharacter(docId, on) {
      const { error } = on
        ? await client.from('comic_characters').upsert({ doc_id: docId }, { onConflict: 'doc_id' })
        : await client.from('comic_characters').delete().eq('doc_id', docId);
      if (error) throw failure(error, 'THE CHARACTER MARK COULD NOT BE SAVED.');
    },
    async release(pageIds) {
      const { data, error } = await client.rpc('comic_release', { p_page_ids: [...pageIds] });
      if (error) throw failure(error, 'THE PAGES COULD NOT BE RELEASED.');
      const { data: row } = await client.from('comic_releases').select('page_count').eq('id', data as string).maybeSingle();
      return (row as { page_count: number } | null)?.page_count ?? pageIds.length;
    },
    async searchLore(query) {
      const wanted = query.trim().replace(/[%_,()]/g, ' ');
      let request = client.from('docs').select('id, slug, title').not('slug', 'is', null).order('title').limit(20);
      if (wanted.length > 0) request = request.ilike('title', `%${wanted}%`);
      const { data, error } = await request;
      if (error) return [];
      const rows = (data ?? []) as { id: string; slug: string; title: string }[];
      const characters = await characterIds(rows.map((row) => row.id));
      return rows.map((row) => ({ docId: row.id, slug: row.slug, title: row.title, isCharacter: characters.has(row.id) }));
    },
  };
  return repository;
}
