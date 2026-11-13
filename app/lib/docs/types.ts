/**
 * DOCS: shared live documents in folders (SPEC-live-docs.md, Luke 2026-11-13).
 *
 * A document is a Yjs document, edited by several people at once over one broadcast channel each
 * (`doc:<id>`), filed in a folder. Lore pages are documents too: they live in the LORE folder, keep
 * their `/lore/<slug>` address, and are PUBLIC. The tables are `docs`, `doc_folders`, `doc_shares`,
 * `doc_comments` and `doc_versions` (supabase/migrations/20261113022846_live_docs.sql), where Row Level
 * Security is the real lock on who sees and changes what; the rules in ./rules.ts only decide what the
 * screen offers.
 */

export type DocsDataSource = 'mock' | 'supabase';

/** Who can see a document, picked by its owner. */
export type DocAccess = 'private' | 'shared' | 'signed_in' | 'public';

/** What the reader may do with one document. */
export type DocRole = 'owner' | 'edit' | 'read';

/** The one shared folder with no owner, which the lore pages live in. Its id is fixed in the migration. */
export const LORE_FOLDER_ID = '00000000-0000-4000-8000-00000000d0c1';

/**
 * The field a document's text is kept under inside the Yjs document.
 *
 * `body`, the same name the lore pages used, so a lore page copied into DOCS opens with its writing in it.
 */
export const DOC_FIELD = 'body';

export type DocFolder = {
  id: string;
  name: string;
  parentId: string | null;
  /** `home`: inside its owner's MY DOCS, seen by them alone. `shared`: seen by everyone signed in. */
  kind: 'home' | 'shared';
  ownerId: string | null;
  ownerLabel: string;
  /** What a new document made in this folder starts as. */
  defaultAccess: DocAccess | null;
  createdAt: string;
};

export type DocSummary = {
  id: string;
  /** Only a lore document has one: its `/lore/<slug>` address. */
  slug: string | null;
  title: string;
  summary: string;
  access: DocAccess;
  folderId: string | null;
  ownerId: string | null;
  ownerLabel: string;
  createdAt: string;
  createdByLabel: string;
  updatedAt: string;
  updatedByLabel: string;
};

export type DocRecord = DocSummary & {
  /** Base64 of the Yjs state, as last saved. Empty until somebody saves. */
  state: string;
  /** The same writing as plain text: what the forum post quotes and a search could read. */
  bodyText: string;
  /** The board post made when it first went PUBLIC or ANYONE SIGNED IN. */
  boardThreadId: string | null;
  /** What this reader may do with it, as the database decides it. */
  role: DocRole;
};

export type DocShare = {
  personId: string;
  personLabel: string;
  canEdit: boolean;
};

export type DocComment = {
  id: string;
  docId: string;
  /** A reply's comment; null for a comment left on words. */
  parentId: string | null;
  authorId: string | null;
  authorLabel: string;
  body: string;
  /** Base64 Yjs relative positions of the words it was left on. A reply has none. */
  anchorFrom: string | null;
  anchorTo: string | null;
  /** What those words said when it was left. */
  quote: string;
  resolved: boolean;
  resolvedByLabel: string | null;
  createdAt: string;
};

export type DocVersion = {
  id: string;
  docId: string;
  name: string | null;
  snippet: string;
  createdByLabel: string;
  createdAt: string;
};

/** Who is reading: an account, or null for a visitor. */
export type DocViewer = { id: string; name: string };

export type CreateDocInput = {
  title: string;
  summary: string;
  folderId: string | null;
  access: DocAccess;
  /** Lore documents only. */
  slug?: string;
  viewer: DocViewer;
};

export type DocPatch = {
  title?: string;
  summary?: string;
  access?: DocAccess;
  folderId?: string | null;
  boardThreadId?: string;
};

export type CreateFolderInput = {
  name: string;
  parentId: string | null;
  kind: 'home' | 'shared';
  defaultAccess: DocAccess | null;
  viewer: DocViewer;
};

export type NewCommentInput = {
  docId: string;
  parentId: string | null;
  body: string;
  anchorFrom: string | null;
  anchorTo: string | null;
  quote: string;
  viewer: DocViewer;
};

/**
 * One message on a document's channel.
 *
 * The lore pages' five (a joiner asks, someone answers with the whole document, then one update per
 * change, presence, and goodbye), plus two: `pointer`, where someone's mouse is, and `saved`, said
 * after a save so a reader who missed a change can read the saved copy again.
 */
export type DocChannelMessage =
  | { kind: 'sync-request'; from: number }
  | { kind: 'sync-response'; from: number; to: number; state: string }
  | { kind: 'update'; from: number; update: string }
  | { kind: 'awareness'; from: number; update: string }
  | { kind: 'gone'; from: number }
  | { kind: 'pointer'; from: number; at: string | null; dx: number; dy: number }
  | { kind: 'saved'; from: number };

/** A document's live channel: the transport stops at this line (./session.ts is the rest). */
export type DocRoom = {
  name: string;
  send: (message: DocChannelMessage) => void;
  listen: (handler: (message: DocChannelMessage) => void) => () => void;
  close: () => void;
};

export type DocsRepository = {
  readonly source: DocsDataSource;
  /** The folders this reader may see. */
  listFolders(): Promise<DocFolder[]>;
  /** The documents this reader may see, newest first, at most 500. */
  listDocs(): Promise<DocSummary[]>;
  getDoc(id: string): Promise<DocRecord | null>;
  getDocBySlug(slug: string): Promise<DocRecord | null>;
  createDoc(input: CreateDocInput): Promise<DocSummary>;
  /** Files the writing as it stands; answers with when. */
  saveDoc(input: { id: string; state: string; bodyText: string; viewer: DocViewer }): Promise<string>;
  updateDoc(id: string, patch: DocPatch): Promise<void>;
  deleteDoc(id: string): Promise<void>;
  createFolder(input: CreateFolderInput): Promise<DocFolder>;
  updateFolder(id: string, patch: { name?: string; defaultAccess?: DocAccess | null }): Promise<void>;
  deleteFolder(id: string): Promise<void>;
  /** The owner sees every share; anybody else only their own. */
  listShares(docId: string): Promise<DocShare[]>;
  setShare(docId: string, share: DocShare): Promise<void>;
  removeShare(docId: string, personId: string): Promise<void>;
  listComments(docId: string): Promise<DocComment[]>;
  addComment(input: NewCommentInput): Promise<DocComment>;
  setResolved(commentId: string, resolved: boolean, viewer: DocViewer): Promise<void>;
  deleteComment(commentId: string): Promise<void>;
  listVersions(docId: string): Promise<DocVersion[]>;
  versionState(versionId: string): Promise<string | null>;
  /** Keeps a copy. An unnamed one is refused within the hour of the last, and answers null. */
  keepVersion(input: { docId: string; state: string; snippet: string; name: string | null; viewer: DocViewer }): Promise<DocVersion | null>;
  /** A picture for a document: shrunk already, filed, and answered with its address. */
  uploadPicture(file: Blob, viewer: DocViewer): Promise<string>;
  openRoom(docId: string): DocRoom;
};
