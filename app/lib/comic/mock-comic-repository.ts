import { getDocsRepository } from '../docs/repository';
import { chapterPages } from './rules';
import type { Appearance, ComicChapter, ComicContents, ComicPage, ComicPanel, ComicRepository, ComicVolume, LoreLink } from './types';

/**
 * COMIC in this browser only (no database): for local work and checks. It keeps the database's rules itself: an unreleased
 * page is seen only by the house account (`setComicViewerAdmin`), and only the house account changes anything. Kept in this
 * browser's storage so the studio's work survives a reload; a storage that throws (a private window) just starts fresh.
 *
 * The seeded pages have no files: the reader shows each as a blank dithered sheet with its number (text and a tile pattern,
 * never drawn art). Pages uploaded in the studio are real files, kept by the mock upload route on this computer.
 *
 * The mock DOCS store gives its seeded lore pages new ids on every load until something is saved there, so this store
 * knows lore pages by their address (slug), which stays put: tags and CHARACTER marks are matched on it.
 */

type Tag = { panelId: string; docId: string; slug: string; title: string };
type Store = {
  volumes: ComicVolume[];
  chapters: ComicChapter[];
  pages: ComicPage[];
  panels: ComicPanel[];
  tags: Tag[];
  /** CHARACTER marks, by lore address. */
  characters: string[];
};

const STORAGE_KEY = 'debaser.site.comic.mock.v1';

let viewerIsAdmin = false;
export function setComicViewerAdmin(on: boolean): void {
  viewerIsAdmin = on;
}

function seed(): Store {
  const now = Date.now();
  const at = (minutesAgo: number) => new Date(now - minutesAgo * 60_000).toISOString();
  const page = (id: string, chapterId: string, position: number, releasedAt: string | null, isSpread = false): ComicPage => ({
    id,
    chapterId,
    position,
    isSpread,
    width: isSpread ? 6000 : 3000,
    height: 4500,
    readingWidth: 2000,
    readingHeight: isSpread ? 1500 : 3000,
    version: 1,
    hasCopies: true,
    words: '',
    releasedAt,
  });
  const panelsFor = (pageId: string): ComicPanel[] => [
    { id: `${pageId}-a`, pageId, position: 0, x: 0.05, y: 0.04, w: 0.9, h: 0.3, guessed: true },
    { id: `${pageId}-b`, pageId, position: 1, x: 0.05, y: 0.36, w: 0.43, h: 0.3, guessed: true },
    { id: `${pageId}-c`, pageId, position: 2, x: 0.52, y: 0.36, w: 0.43, h: 0.3, guessed: true },
    { id: `${pageId}-d`, pageId, position: 3, x: 0.05, y: 0.68, w: 0.9, h: 0.28, guessed: true },
  ];
  const pages = [
    page('mock-p-1-1', 'mock-c-1', 0, at(9000)),
    page('mock-p-1-2', 'mock-c-1', 1, at(9000)),
    page('mock-p-1-3', 'mock-c-1', 2, at(9000), true),
    page('mock-p-1-4', 'mock-c-1', 3, at(9000)),
    page('mock-p-2-1', 'mock-c-2', 0, at(60)),
    page('mock-p-2-2', 'mock-c-2', 1, at(60)),
    page('mock-p-2-3', 'mock-c-2', 2, null),
    page('mock-p-2-4', 'mock-c-2', 3, null),
  ];
  return {
    volumes: [{ id: 'mock-v-1', number: 1, title: 'THE FIRST VOLUME' }],
    chapters: [
      { id: 'mock-c-1', volumeId: 'mock-v-1', number: 1, title: 'A TEST CHAPTER', coverPageId: null },
      { id: 'mock-c-2', volumeId: 'mock-v-1', number: 2, title: 'ANOTHER TEST CHAPTER', coverPageId: null },
    ],
    pages,
    panels: pages.filter((each) => !each.isSpread).flatMap((each) => panelsFor(each.id)),
    tags: [],
    characters: [],
  };
}

let memory: Store | null = null;

function load(): Store {
  if (memory) return memory;
  try {
    const raw = typeof window === 'undefined' ? null : window.localStorage.getItem(STORAGE_KEY);
    memory = raw === null ? seed() : (JSON.parse(raw) as Store);
  } catch {
    memory = seed();
  }
  return memory;
}

function save(store: Store): void {
  memory = store;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    // A private window: the work lasts until the tab closes.
  }
}

function mustBeAdmin(): void {
  if (!viewerIsAdmin) throw new Error('ONLY THE HOUSE ACCOUNT CAN CHANGE THE COMIC.');
}

function visiblePages(store: Store): ComicPage[] {
  return viewerIsAdmin ? store.pages : store.pages.filter((page) => page.releasedAt !== null);
}

/** A lore page's address from its id, as the DOCS store has it now. */
async function slugOf(docId: string): Promise<string | null> {
  const docs = await getDocsRepository(null).listDocs();
  return docs.find((doc) => doc.id === docId)?.slug ?? null;
}

function uuid(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `mock-${Date.now()}-${Math.random()}`;
}

export function createMockComicRepository(): ComicRepository {
  return {
    async contents(): Promise<ComicContents> {
      const store = load();
      const pages = visiblePages(store);
      const chapters = store.chapters.filter((chapter) => viewerIsAdmin || pages.some((page) => page.chapterId === chapter.id));
      const volumes = store.volumes.filter((volume) => viewerIsAdmin || chapters.some((chapter) => chapter.volumeId === volume.id));
      return { volumes: [...volumes], chapters: [...chapters], pages: [...pages] };
    },
    async panels(pageIds) {
      const store = load();
      const visible = new Set(visiblePages(store).map((page) => page.id));
      return store.panels
        .filter((panel) => pageIds.includes(panel.pageId) && visible.has(panel.pageId))
        .sort((a, b) => a.position - b.position);
    },
    async findPanel(panelId) {
      const store = load();
      const visible = new Set(visiblePages(store).map((page) => page.id));
      return store.panels.find((panel) => panel.id === panelId && visible.has(panel.pageId)) ?? null;
    },
    async tags(panelIds) {
      const store = load();
      const found: Record<string, LoreLink[]> = {};
      for (const tag of store.tags) {
        if (!panelIds.includes(tag.panelId)) continue;
        (found[tag.panelId] ??= []).push({ docId: tag.docId, slug: tag.slug, title: tag.title, isCharacter: store.characters.includes(tag.slug) });
      }
      return found;
    },
    async appearances(docId) {
      const store = load();
      const slug = await slugOf(docId);
      const released = store.pages.filter((page) => page.releasedAt !== null);
      const found: Appearance[] = [];
      for (const tag of store.tags.filter((each) => each.docId === docId || each.slug === slug)) {
        const panel = store.panels.find((each) => each.id === tag.panelId);
        const page = panel ? released.find((each) => each.id === panel.pageId) : undefined;
        const chapter = page ? store.chapters.find((each) => each.id === page.chapterId) : undefined;
        if (!panel || !page || !chapter) continue;
        found.push({
          panelId: panel.id,
          pageId: page.id,
          chapterNumber: chapter.number,
          pageNumber: chapterPages({ pages: store.pages }, chapter.id).findIndex((each) => each.id === page.id) + 1,
          box: { x: panel.x, y: panel.y, w: panel.w, h: panel.h },
          page: { id: page.id, version: page.version, readingWidth: page.readingWidth, readingHeight: page.readingHeight },
        });
      }
      return found.sort((a, b) => a.chapterNumber - b.chapterNumber || a.pageNumber - b.pageNumber);
    },
    async isCharacter(docId) {
      const slug = await slugOf(docId);
      return slug !== null && load().characters.includes(slug);
    },

    async addVolume(input) {
      mustBeAdmin();
      const store = load();
      if (store.volumes.some((volume) => volume.number === input.number)) throw new Error('THAT VOLUME NUMBER IS TAKEN.');
      save({ ...store, volumes: [...store.volumes, { id: uuid(), number: input.number, title: input.title }] });
    },
    async updateVolume(id, input) {
      mustBeAdmin();
      const store = load();
      if (input.number !== undefined && store.volumes.some((volume) => volume.id !== id && volume.number === input.number)) {
        throw new Error('THAT VOLUME NUMBER IS TAKEN.');
      }
      save({ ...store, volumes: store.volumes.map((volume) => (volume.id === id ? { ...volume, ...input } : volume)) });
    },
    async deleteVolume(id) {
      mustBeAdmin();
      const store = load();
      if (store.chapters.some((chapter) => chapter.volumeId === id)) throw new Error('MOVE OR DELETE ITS CHAPTERS FIRST.');
      save({ ...store, volumes: store.volumes.filter((volume) => volume.id !== id) });
    },
    async addChapter(input) {
      mustBeAdmin();
      const store = load();
      if (store.chapters.some((chapter) => chapter.number === input.number)) throw new Error('THAT CHAPTER NUMBER IS TAKEN.');
      save({ ...store, chapters: [...store.chapters, { id: uuid(), volumeId: input.volumeId, number: input.number, title: input.title, coverPageId: null }] });
    },
    async updateChapter(id, input) {
      mustBeAdmin();
      const store = load();
      if (input.number !== undefined && store.chapters.some((chapter) => chapter.id !== id && chapter.number === input.number)) {
        throw new Error('THAT CHAPTER NUMBER IS TAKEN.');
      }
      save({ ...store, chapters: store.chapters.map((chapter) => (chapter.id === id ? { ...chapter, ...input } : chapter)) });
    },
    async deleteChapter(id) {
      mustBeAdmin();
      const store = load();
      const pageIds = new Set(store.pages.filter((page) => page.chapterId === id).map((page) => page.id));
      const panelIds = new Set(store.panels.filter((panel) => pageIds.has(panel.pageId)).map((panel) => panel.id));
      save({
        ...store,
        chapters: store.chapters.filter((chapter) => chapter.id !== id),
        pages: store.pages.filter((page) => !pageIds.has(page.id)),
        panels: store.panels.filter((panel) => !panelIds.has(panel.id)),
        tags: store.tags.filter((tag) => !panelIds.has(tag.panelId)),
      });
    },
    async savePage({ id, chapterId, position, uploaded, replacing }) {
      mustBeAdmin();
      const store = load();
      const existing = store.pages.find((page) => page.id === id);
      const page: ComicPage = {
        id,
        chapterId: existing?.chapterId ?? chapterId,
        position: existing?.position ?? position,
        isSpread: existing?.isSpread ?? uploaded.width > uploaded.height,
        width: uploaded.width,
        height: uploaded.height,
        readingWidth: uploaded.readingWidth,
        readingHeight: uploaded.readingHeight,
        version: uploaded.version,
        hasCopies: true,
        words: existing?.words ?? '',
        releasedAt: existing?.releasedAt ?? null,
      };
      const pages = existing ? store.pages.map((each) => (each.id === id ? page : each)) : [...store.pages, page];
      // A new page, or a replaced one whose boxes were only guesses, takes the new guess.
      const keepPanels = replacing && store.panels.some((panel) => panel.pageId === id && !panel.guessed);
      const panels = keepPanels
        ? store.panels
        : [
            ...store.panels.filter((panel) => panel.pageId !== id),
            ...uploaded.panels.map((box, index) => ({
              ...box,
              id: store.panels.filter((panel) => panel.pageId === id).sort((a, b) => a.position - b.position)[index]?.id ?? uuid(),
              pageId: id,
              position: index,
              guessed: true,
            })),
          ];
      const panelIds = new Set(panels.map((panel) => panel.id));
      save({ ...store, pages, panels, tags: store.tags.filter((tag) => panelIds.has(tag.panelId)) });
    },
    async updatePage(id, patch) {
      mustBeAdmin();
      const store = load();
      save({ ...store, pages: store.pages.map((page) => (page.id === id ? { ...page, ...patch } : page)) });
    },
    async reorderPages(chapterId, orderedIds) {
      mustBeAdmin();
      const store = load();
      save({
        ...store,
        pages: store.pages.map((page) =>
          orderedIds.includes(page.id) ? { ...page, chapterId, position: orderedIds.indexOf(page.id) } : page,
        ),
      });
    },
    async deletePage(id) {
      mustBeAdmin();
      const store = load();
      const panelIds = new Set(store.panels.filter((panel) => panel.pageId === id).map((panel) => panel.id));
      save({
        ...store,
        pages: store.pages.filter((page) => page.id !== id),
        panels: store.panels.filter((panel) => panel.pageId !== id),
        tags: store.tags.filter((tag) => !panelIds.has(tag.panelId)),
        chapters: store.chapters.map((chapter) => (chapter.coverPageId === id ? { ...chapter, coverPageId: null } : chapter)),
      });
    },
    async savePanels(pageId, boxes) {
      mustBeAdmin();
      const store = load();
      const old = store.panels.filter((panel) => panel.pageId === pageId).sort((a, b) => a.position - b.position);
      // Boxes keep their ids (and so their tags and comment threads) where they stay in place in the order.
      const next = boxes.map((box, index) => ({ ...box, id: old[index]?.id ?? uuid(), pageId, position: index }));
      const panelIds = new Set([...store.panels.filter((panel) => panel.pageId !== pageId), ...next].map((panel) => panel.id));
      save({
        ...store,
        panels: [...store.panels.filter((panel) => panel.pageId !== pageId), ...next],
        tags: store.tags.filter((tag) => panelIds.has(tag.panelId)),
      });
    },
    async setTags(panelId, docIds) {
      mustBeAdmin();
      const store = load();
      const lore = await this.searchLore('');
      const tags = docIds
        .map((docId) => lore.find((link) => link.docId === docId))
        .filter((link): link is LoreLink => link !== undefined)
        .map((link) => ({ panelId, docId: link.docId, slug: link.slug, title: link.title }));
      save({ ...store, tags: [...store.tags.filter((tag) => tag.panelId !== panelId), ...tags] });
    },
    async setCharacter(docId, on) {
      mustBeAdmin();
      const store = load();
      const slug = await slugOf(docId);
      if (slug === null) throw new Error('THAT LORE PAGE IS GONE.');
      const characters = store.characters.filter((each) => each !== slug);
      save({ ...store, characters: on ? [...characters, slug] : characters });
    },
    async release(pageIds) {
      mustBeAdmin();
      const store = load();
      const now = new Date().toISOString();
      let count = 0;
      const pages = store.pages.map((page) => {
        if (!pageIds.includes(page.id) || page.releasedAt !== null || !page.hasCopies) return page;
        count += 1;
        return { ...page, releasedAt: now };
      });
      if (count === 0) throw new Error('NOTHING TO RELEASE.');
      save({ ...store, pages });
      return count;
    },
    async searchLore(query) {
      const store = load();
      const docs = await getDocsRepository(null).listDocs();
      const wanted = query.trim().toLowerCase();
      return docs
        .filter((doc) => doc.slug !== null && (wanted.length === 0 || doc.title.toLowerCase().includes(wanted)))
        .slice(0, 20)
        .map((doc) => ({ docId: doc.id, slug: doc.slug as string, title: doc.title, isCharacter: store.characters.includes(doc.slug as string) }));
    },
  };
}

