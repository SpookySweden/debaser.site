/**
 * A lore page, and the store one lives in.
 *
 * The archive's lore is written rather than drawn, and it is written *together* - which is what
 * makes this different from the notes shelf (app/lib/projects/notes.ts, where a note is part of
 * the code and changes when the code does) and from the board (where a post is a row, and the
 * last write wins). A page here is a Yjs document: two people typing in the same paragraph merge
 * without either of them saving first, and the page keeps its own history of those merges.
 *
 * Two copies of a page are kept, deliberately. `state` is the editable document, as Yjs bytes,
 * which only an editor can open; `bodyText` is the same writing as plain text, which is what a
 * visitor who is not signed in reads and what a search can look at. The pair is written together
 * on every save, so the readable copy is never far behind the editable one.
 */
export type LoreDataSource = 'mock' | 'supabase';

export type LorePage = {
  id: string;
  /** The page's address and its key: `/lore/<slug>`. */
  slug: string;
  title: string;
  /** One line for the index. */
  summary: string;
  /** The writing as plain text, as last filed. */
  bodyText: string;
  /** Base64 of the Yjs document's state, as last filed. Empty until somebody saves. */
  state: string;
  createdAt: string;
  /** Who opened the page, as it reads on it. */
  createdByLabel: string;
  updatedAt: string;
  /** Who last filed it, as it reads on it. */
  updatedByLabel: string;
};

/** A page as the index lists it: everything but the writing itself. */
export type LorePageSummary = Pick<
  LorePage,
  'id' | 'slug' | 'title' | 'summary' | 'updatedAt' | 'updatedByLabel' | 'createdByLabel'
>;

export type CreateLorePageInput = {
  title: string;
  summary: string;
  /** Null while nobody is signed in: the mock store takes pages from guests, the real one does not. */
  creatorId: string | null;
  creatorName: string;
};

export type SaveLorePageInput = {
  id: string;
  /** Base64 of the Yjs document's state, which is what makes the page reopen where it was left. */
  state: string;
  /** The same writing as plain text, for the read view. */
  bodyText: string;
  editorId: string | null;
  editorName: string;
};

/**
 * One message on a page's channel.
 *
 * The four things a shared document needs, carried as JSON so both transports send the same
 * shapes: a joiner asks for the document, whoever is already there answers with the whole of it,
 * and every change after that is one update. Presence is a message of its own because it is not
 * writing - a caret is dropped when somebody goes quiet rather than merged into the text.
 */
export type LoreChannelMessage =
  | { kind: 'sync-request'; from: number }
  | { kind: 'sync-response'; from: number; to: number; state: string }
  | { kind: 'update'; from: number; update: string }
  | { kind: 'awareness'; from: number; update: string }
  | { kind: 'gone'; from: number };

/**
 * A page's live channel: a way to send, and a way to listen.
 *
 * The transport (Supabase Realtime Broadcast, or a `BroadcastChannel` between tabs on a machine
 * with no database) stops at this line. Everything above it - the handshake, the merging, the
 * carets - is the same code either way, which is the point: see ./session.ts.
 */
export type LoreRoom = {
  /** The room's name, for the status line: what everybody in it is joined to. */
  name: string;
  send: (message: LoreChannelMessage) => void;
  /** Subscribes to what arrives; answers with the way to stop listening. */
  listen: (handler: (message: LoreChannelMessage) => void) => () => void;
  close: () => void;
};

export type LoreRepository = {
  readonly source: LoreDataSource;
  /** Every page, newest filed first. Never throws: a store that cannot be read is an empty index. */
  listPages(): Promise<LorePageSummary[]>;
  /** One page, or null when there is no page at that address. */
  getPage(slug: string): Promise<LorePage | null>;
  createPage(input: CreateLorePageInput): Promise<LorePage>;
  /** Files the document as it stands now, and answers with the row as it now reads. */
  savePage(input: SaveLorePageInput): Promise<LorePage>;
  /** Joins a page's live channel. Never throws: a store that cannot open one leaves the editor alone. */
  openRoom(slug: string): LoreRoom;
};

/**
 * The field a document's text is kept under inside the Yjs document.
 *
 * Named rather than left to the default `default`, because the name is part of the document's
 * shape: renaming it would make every page that has already been filed open empty.
 */
export const LORE_DOCUMENT_FIELD = 'body';
