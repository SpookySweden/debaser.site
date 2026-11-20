/**
 * COMIC (SPEC-comic.md, phase 1): Luke's comic as volumes > chapters > pages, released by hand, panels on pages, lore pages
 * tagged on panels. The database's Row Level Security decides what a reader sees: an unreleased page never reaches anyone but
 * the admin (a moderator), so nothing here filters for safety.
 */

export type ComicVolume = { id: string; number: number; title: string };

export type ComicChapter = {
  id: string;
  volumeId: string;
  /** Numbered straight through the whole comic. */
  number: number;
  title: string;
  coverPageId: string | null;
};

export type ComicPage = {
  id: string;
  chapterId: string;
  position: number;
  isSpread: boolean;
  width: number | null;
  height: number | null;
  readingWidth: number | null;
  readingHeight: number | null;
  version: number;
  /** Set once the server has made the copies; a page without them can't be released. */
  hasCopies: boolean;
  words: string;
  releasedAt: string | null;
};

/** A box on a page, in fractions of the page (0 to 1). */
export type PanelBox = { x: number; y: number; w: number; h: number };

export type ComicPanel = PanelBox & { id: string; pageId: string; position: number; guessed: boolean };

export type LoreLink = { docId: string; slug: string; title: string; isCharacter: boolean };

export type ComicContents = { volumes: ComicVolume[]; chapters: ComicChapter[]; pages: ComicPage[] };

/** A place a lore page appears: one tagged panel on a released page. */
export type Appearance = {
  panelId: string;
  pageId: string;
  chapterNumber: number;
  pageNumber: number;
  box: PanelBox;
  page: Pick<ComicPage, 'id' | 'version' | 'readingWidth' | 'readingHeight'>;
};

/** What the upload route hands back once a page's copies are made. */
export type UploadedPage = {
  width: number;
  height: number;
  readingWidth: number;
  readingHeight: number;
  version: number;
  originalPath: string;
  readingPath: string;
  zoomPath: string;
  panels: PanelBox[];
};

export type PagePatch = Partial<{ chapterId: string; position: number; isSpread: boolean; words: string }>;

export interface ComicRepository {
  /** Everything the viewer may see, in one read: the contents page, the reader and the studio all start here. */
  contents(): Promise<ComicContents>;
  panels(pageIds: readonly string[]): Promise<ComicPanel[]>;
  /** One panel by its id (a board thread knows only that), or null when its page isn't readable. */
  findPanel(panelId: string): Promise<ComicPanel | null>;
  /** The lore pages tagged on these panels. */
  tags(panelIds: readonly string[]): Promise<Record<string, LoreLink[]>>;
  /** Where a lore page appears, released pages only, in reading order. */
  appearances(docId: string): Promise<Appearance[]>;
  isCharacter(docId: string): Promise<boolean>;

  // The studio (the admin (a moderator) only; the database refuses anyone else).
  addVolume(input: { number: number; title: string }): Promise<void>;
  updateVolume(id: string, input: { number?: number; title?: string }): Promise<void>;
  deleteVolume(id: string): Promise<void>;
  addChapter(input: { volumeId: string; number: number; title: string }): Promise<void>;
  updateChapter(id: string, input: { number?: number; title?: string; coverPageId?: string | null; volumeId?: string }): Promise<void>;
  deleteChapter(id: string): Promise<void>;
  /** Files a page whose copies the upload route made (a new page, or a replaced file for an existing one). */
  savePage(input: { id: string; chapterId: string; position: number; uploaded: UploadedPage; replacing: boolean }): Promise<void>;
  updatePage(id: string, patch: PagePatch): Promise<void>;
  reorderPages(chapterId: string, orderedIds: readonly string[]): Promise<void>;
  deletePage(id: string): Promise<void>;
  /** Replaces a page's panels with these, in order. */
  savePanels(pageId: string, panels: readonly (PanelBox & { guessed: boolean })[]): Promise<void>;
  setTags(panelId: string, docIds: readonly string[]): Promise<void>;
  setCharacter(docId: string, on: boolean): Promise<void>;
  /** Releases these pages now, as one batch: returns how many went out. */
  release(pageIds: readonly string[]): Promise<number>;
  /** Lore pages to tag, searched by title. */
  searchLore(query: string): Promise<LoreLink[]>;
}
