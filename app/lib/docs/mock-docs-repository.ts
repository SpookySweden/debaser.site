import * as Y from 'yjs';
import { createLocalId } from '../forum/ids';
import { docRoleFor, isDocSlug, sortByUpdated } from './rules';
import { bytesToBase64 } from './session';
import {
  DOC_FIELD,
  LORE_FOLDER_ID,
  type CreateDocInput,
  type CreateFolderInput,
  type DocChannelMessage,
  type DocComment,
  type DocFolder,
  type DocPatch,
  type DocRecord,
  type DocRoom,
  type DocScope,
  type DocShare,
  type DocSummary,
  type DocVersion,
  type DocViewer,
  type DocsRepository,
  type NewCommentInput,
} from './types';

/**
 * DOCS with no database: everything in localStorage, and a `BroadcastChannel` between tabs as the room.
 *
 * Kept so the site works with no backend (as every store here is). It holds the same shapes and the same
 * rules where they decide what a screen shows - who may see a document, who may edit it, an address
 * nobody else has - but it is one machine's browser, so "who" is whoever is signed in to the mock accounts.
 */

const STORAGE_KEY = 'debaser.docs.mock.v1';

type StoredDoc = Omit<DocRecord, 'role'>;

type PersistedState = {
  version: 1;
  folders: DocFolder[];
  docs: StoredDoc[];
  shares: { docId: string; share: DocShare }[];
  comments: DocComment[];
  versions: (DocVersion & { state: string })[];
};

/** A Yjs document built from prose, so a seeded lore page opens with its writing in the editor. */
export function documentStateFromText(text: string): string {
  const doc = new Y.Doc();
  const body = doc.getXmlFragment(DOC_FIELD);

  doc.transact(() => {
    for (const paragraph of text.split(/\n{2,}/).map((part) => part.trim()).filter((part) => part.length > 0)) {
      const node = new Y.XmlElement('paragraph');
      node.insert(0, [new Y.XmlText(paragraph)]);
      body.insert(body.length, [node]);
    }
  });

  return bytesToBase64(Y.encodeStateAsUpdate(doc));
}

const SEED_FILED = '2026-09-21T09:00:00.000Z';

const SEED_LORE: { slug: string; title: string; summary: string; body: string }[] = [
  {
    slug: 'the-glass-corridor',
    title: 'THE GLASS CORRIDOR',
    summary: 'Where the comic opens, and what the corridor is made of.',
    body: [
      'The corridor is glass on one side and poured concrete on the other, and it runs the length of the building without a single door in it. Everything that happens in the first act happens on the other side of that glass.',
      'Nothing in the corridor is decorated, which is the point: the people who built it wanted to be seen walking through it rather than met in it.',
    ].join('\n\n'),
  },
  {
    slug: 'hexham-grid',
    title: 'HEXHAM GRID',
    summary: 'The city the score was written for: what stands, and what was taken down.',
    body: [
      'Hexham was drawn as a grid of nine blocks with a substation at the middle of it, and the substation is the only building in the comic that is never shown from the outside.',
      'The score follows the grid: one theme per block, played in order, with the substation theme only ever heard underneath the others.',
    ].join('\n\n'),
  },
];

function seed(): PersistedState {
  return {
    version: 1,
    folders: [
      {
        id: LORE_FOLDER_ID,
        name: 'LORE',
        parentId: null,
        kind: 'shared',
        ownerId: null,
        ownerLabel: 'debaser.site',
        defaultAccess: 'public',
        createdAt: SEED_FILED,
      },
    ],
    docs: SEED_LORE.map((page) => ({
      id: createLocalId('doc'),
      slug: page.slug,
      title: page.title,
      summary: page.summary,
      access: 'public',
      folderId: LORE_FOLDER_ID,
      ownerId: null,
      ownerLabel: 'debaser.site',
      createdAt: SEED_FILED,
      createdByLabel: 'debaser.site',
      updatedAt: SEED_FILED,
      updatedByLabel: 'debaser.site',
      state: documentStateFromText(page.body),
      bodyText: page.body,
      boardThreadId: null,
    })),
    shares: [],
    comments: [],
    versions: [],
  };
}

let state: PersistedState | null = null;

function hasStorage(): boolean {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

function load(): PersistedState {
  if (state !== null) return state;

  state = seed();
  if (!hasStorage()) return state;

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw !== null) {
      const parsed = JSON.parse(raw) as Partial<PersistedState>;
      if (parsed.version === 1 && Array.isArray(parsed.docs) && Array.isArray(parsed.folders)) {
        state = {
          version: 1,
          folders: parsed.folders,
          docs: parsed.docs,
          shares: Array.isArray(parsed.shares) ? parsed.shares : [],
          comments: Array.isArray(parsed.comments) ? parsed.comments : [],
          versions: Array.isArray(parsed.versions) ? parsed.versions : [],
        };
      }
    }
  } catch {
    // A broken copy is a fresh shelf.
  }

  return state;
}

function persist(): void {
  if (!hasStorage() || state === null) return;

  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Full or switched off: keeps working in memory.
  }
}

/** Who the mock store thinks is reading: the last account a call named. */
let currentViewer: string | null = null;

function shareFor(docId: string, personId: string | null): DocShare | null {
  if (personId === null) return null;
  return load().shares.find((entry) => entry.docId === docId && entry.share.personId === personId)?.share ?? null;
}

function roleOf(doc: StoredDoc) {
  return docRoleFor(doc, currentViewer, shareFor(doc.id, currentViewer));
}

function summary(doc: StoredDoc): DocSummary {
  return {
    id: doc.id,
    slug: doc.slug,
    title: doc.title,
    summary: doc.summary,
    access: doc.access,
    folderId: doc.folderId,
    ownerId: doc.ownerId,
    ownerLabel: doc.ownerLabel,
    createdAt: doc.createdAt,
    createdByLabel: doc.createdByLabel,
    updatedAt: doc.updatedAt,
    updatedByLabel: doc.updatedByLabel,
  };
}

function record(doc: StoredDoc | undefined): DocRecord | null {
  if (doc === undefined) return null;
  const role = roleOf(doc);
  return role === null ? null : { ...doc, role };
}

function mustFind(id: string): StoredDoc {
  const doc = load().docs.find((row) => row.id === id);
  if (doc === undefined) throw new Error('DOCUMENT NOT FOUND.');
  return doc;
}

type Listener = (message: DocChannelMessage) => void;
const rooms = new Map<string, { channel: BroadcastChannel | null; listeners: Set<Listener> }>();

function openRoom(docId: string): DocRoom {
  let entry = rooms.get(docId);

  if (entry === undefined) {
    entry = { channel: null, listeners: new Set() };
    if (typeof BroadcastChannel !== 'undefined') {
      const created = entry;
      created.channel = new BroadcastChannel(`debaser-doc-${docId}`);
      created.channel.onmessage = (event: MessageEvent<DocChannelMessage>) => {
        for (const listener of created.listeners) listener(event.data);
      };
    }
    rooms.set(docId, entry);
  }

  const held = entry;

  return {
    name: `debaser-doc-${docId}`,
    send: (message) => held.channel?.postMessage(message),
    listen: (listener) => {
      held.listeners.add(listener);
      return () => void held.listeners.delete(listener);
    },
    close: () => {
      if (held.listeners.size > 0) return;
      held.channel?.close();
      rooms.delete(docId);
    },
  };
}

class MockDocsRepository implements DocsRepository {
  readonly source = 'mock' as const;

  /** The mock accounts live beside this store; the pages tell it who is reading. */
  setViewer(viewerId: string | null): void {
    currentViewer = viewerId;
  }

  async listFolders(): Promise<DocFolder[]> {
    return load().folders.filter(
      (folder) => folder.id === LORE_FOLDER_ID || (folder.kind === 'shared' && currentViewer !== null) || folder.ownerId === currentViewer,
    );
  }

  async listDocs(scope: DocScope = {}): Promise<DocSummary[]> {
    return sortByUpdated(
      load()
        .docs.filter((doc) => roleOf(doc) !== null)
        .filter((doc) => scope.folderId === undefined || doc.folderId === scope.folderId)
        .filter((doc) => scope.ownerId === undefined || doc.ownerId === scope.ownerId)
        .map(summary),
    ).slice(0, 500);
  }

  async readState(id: string): Promise<string | null> {
    const doc = load().docs.find((row) => row.id === id);
    return doc === undefined || roleOf(doc) === null ? null : doc.state;
  }

  async getDoc(id: string): Promise<DocRecord | null> {
    return record(load().docs.find((doc) => doc.id === id));
  }

  async getDocBySlug(slug: string): Promise<DocRecord | null> {
    return record(load().docs.find((doc) => doc.slug === slug));
  }

  async createDoc(input: CreateDocInput): Promise<DocSummary> {
    currentViewer = input.viewer.id;
    const store = load();
    const title = input.title.trim().toUpperCase();
    if (title.length === 0) throw new Error('A DOCUMENT NEEDS A TITLE.');

    if (input.slug !== undefined) {
      if (!isDocSlug(input.slug)) throw new Error('TITLE NEEDS A LETTER OR DIGIT.');
      if (store.docs.some((doc) => doc.slug === input.slug)) throw new Error('THAT ADDRESS IS TAKEN.');
    }

    const now = new Date().toISOString();
    const doc: StoredDoc = {
      id: createLocalId('doc'),
      slug: input.slug ?? null,
      title: title.slice(0, 120),
      summary: input.summary.trim().slice(0, 300),
      access: input.access,
      folderId: input.folderId,
      ownerId: input.viewer.id,
      ownerLabel: input.viewer.name,
      createdAt: now,
      createdByLabel: input.viewer.name,
      updatedAt: now,
      updatedByLabel: input.viewer.name,
      state: '',
      bodyText: '',
      boardThreadId: null,
    };

    store.docs.push(doc);
    persist();
    return summary(doc);
  }

  async saveDoc(input: { id: string; state: string; bodyText: string; viewer: DocViewer }): Promise<string> {
    currentViewer = input.viewer.id;
    const doc = mustFind(input.id);
    const role = roleOf(doc);
    if (role !== 'owner' && role !== 'edit') throw new Error('YOU CAN ONLY READ THIS ONE.');

    doc.state = input.state;
    doc.bodyText = input.bodyText;
    doc.updatedAt = new Date().toISOString();
    doc.updatedByLabel = input.viewer.name;
    persist();
    return doc.updatedAt;
  }

  async updateDoc(id: string, patch: DocPatch): Promise<void> {
    const doc = mustFind(id);
    const role = roleOf(doc);
    if (role !== 'owner' && role !== 'edit') throw new Error('YOU CAN ONLY READ THIS ONE.');
    if (role !== 'owner' && (patch.access !== undefined || patch.folderId !== undefined || patch.boardThreadId !== undefined)) {
      throw new Error('ONLY THE OWNER CHANGES THAT.');
    }

    if (patch.title !== undefined) doc.title = patch.title.trim().toUpperCase().slice(0, 120) || doc.title;
    if (patch.summary !== undefined) doc.summary = patch.summary.trim().slice(0, 300);
    if (patch.access !== undefined) doc.access = patch.access;
    if (patch.folderId !== undefined) doc.folderId = patch.folderId;
    if (patch.boardThreadId !== undefined && doc.boardThreadId === null) doc.boardThreadId = patch.boardThreadId;
    persist();
  }

  async deleteDoc(id: string): Promise<void> {
    const store = load();
    const doc = mustFind(id);
    if (doc.ownerId !== currentViewer) throw new Error('ONLY THE OWNER DELETES IT.');

    store.docs = store.docs.filter((row) => row.id !== id);
    store.shares = store.shares.filter((entry) => entry.docId !== id);
    store.comments = store.comments.filter((comment) => comment.docId !== id);
    store.versions = store.versions.filter((version) => version.docId !== id);
    persist();
  }

  async createFolder(input: CreateFolderInput): Promise<DocFolder> {
    currentViewer = input.viewer.id;
    const name = input.name.trim().toUpperCase().slice(0, 60);
    if (name.length === 0) throw new Error('A FOLDER NEEDS A NAME.');

    const folder: DocFolder = {
      id: createLocalId('folder'),
      name,
      parentId: input.parentId,
      kind: input.kind,
      ownerId: input.viewer.id,
      ownerLabel: input.viewer.name,
      defaultAccess: input.defaultAccess,
      createdAt: new Date().toISOString(),
    };

    load().folders.push(folder);
    persist();
    return folder;
  }

  async updateFolder(id: string, patch: { name?: string; defaultAccess?: DocAccessOrNull }): Promise<void> {
    const folder = load().folders.find((row) => row.id === id);
    if (folder === undefined || folder.ownerId !== currentViewer) throw new Error('ONLY ITS MAKER CHANGES A FOLDER.');

    if (patch.name !== undefined && patch.name.trim().length > 0) folder.name = patch.name.trim().toUpperCase().slice(0, 60);
    if (patch.defaultAccess !== undefined) folder.defaultAccess = patch.defaultAccess;
    persist();
  }

  async deleteFolder(id: string): Promise<void> {
    const store = load();
    const folder = store.folders.find((row) => row.id === id);
    if (folder === undefined || id === LORE_FOLDER_ID || folder.ownerId !== currentViewer) throw new Error('ONLY ITS MAKER REMOVES A FOLDER.');

    // Its documents fall back to their owners' MY DOCS; its folders go with it.
    const gone = new Set([id]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const row of store.folders) {
        if (row.parentId !== null && gone.has(row.parentId) && !gone.has(row.id)) {
          gone.add(row.id);
          grew = true;
        }
      }
    }

    store.folders = store.folders.filter((row) => !gone.has(row.id));
    for (const doc of store.docs) if (doc.folderId !== null && gone.has(doc.folderId)) doc.folderId = null;
    persist();
  }

  async listShares(docId: string): Promise<DocShare[]> {
    const doc = mustFind(docId);
    return load()
      .shares.filter((entry) => entry.docId === docId && (doc.ownerId === currentViewer || entry.share.personId === currentViewer))
      .map((entry) => entry.share);
  }

  async setShare(docId: string, share: DocShare): Promise<void> {
    const store = load();
    const doc = mustFind(docId);
    if (doc.ownerId !== currentViewer) throw new Error('ONLY THE OWNER SHARES IT.');
    if (share.personId === doc.ownerId) throw new Error('THE OWNER ALREADY HAS IT.');

    store.shares = store.shares.filter((entry) => !(entry.docId === docId && entry.share.personId === share.personId));
    store.shares.push({ docId, share });
    persist();
  }

  async removeShare(docId: string, personId: string): Promise<void> {
    const store = load();
    const doc = mustFind(docId);
    if (doc.ownerId !== currentViewer) throw new Error('ONLY THE OWNER SHARES IT.');

    store.shares = store.shares.filter((entry) => !(entry.docId === docId && entry.share.personId === personId));
    persist();
  }

  async listComments(docId: string): Promise<DocComment[]> {
    return load()
      .comments.filter((comment) => comment.docId === docId)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  }

  async addComment(input: NewCommentInput): Promise<DocComment> {
    currentViewer = input.viewer.id;
    const body = input.body.trim();
    if (body.length === 0) throw new Error('WRITE SOMETHING FIRST.');

    const comment: DocComment = {
      id: createLocalId('comment'),
      docId: input.docId,
      parentId: input.parentId,
      authorId: input.viewer.id,
      authorLabel: input.viewer.name,
      body: body.slice(0, 2000),
      anchorFrom: input.anchorFrom,
      anchorTo: input.anchorTo,
      quote: input.quote.slice(0, 300),
      resolved: false,
      resolvedByLabel: null,
      createdAt: new Date().toISOString(),
    };

    load().comments.push(comment);
    persist();
    return comment;
  }

  async setResolved(commentId: string, resolved: boolean, viewer: DocViewer): Promise<void> {
    const comment = load().comments.find((row) => row.id === commentId);
    if (comment === undefined) throw new Error('COMMENT NOT FOUND.');

    comment.resolved = resolved;
    comment.resolvedByLabel = resolved ? viewer.name : null;
    persist();
  }

  async deleteComment(commentId: string): Promise<void> {
    const store = load();
    store.comments = store.comments.filter((row) => row.id !== commentId && row.parentId !== commentId);
    persist();
  }

  async listVersions(docId: string): Promise<DocVersion[]> {
    return load()
      .versions.filter((version) => version.docId === docId)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .map((version) => ({
        id: version.id,
        docId: version.docId,
        name: version.name,
        snippet: version.snippet,
        createdByLabel: version.createdByLabel,
        createdAt: version.createdAt,
      }));
  }

  async versionState(versionId: string): Promise<string | null> {
    return load().versions.find((version) => version.id === versionId)?.state ?? null;
  }

  async keepVersion(input: { docId: string; state: string; snippet: string; name: string | null; viewer: DocViewer }): Promise<DocVersion | null> {
    const store = load();
    const now = Date.now();

    if (input.name === null) {
      const recent = store.versions.some(
        (version) => version.docId === input.docId && version.name === null && now - Date.parse(version.createdAt) < 50 * 60 * 1000,
      );
      if (recent) return null;
    }

    const version = {
      id: createLocalId('version'),
      docId: input.docId,
      name: input.name,
      snippet: input.snippet.slice(0, 200),
      createdByLabel: input.viewer.name,
      createdAt: new Date(now).toISOString(),
      state: input.state,
    };

    store.versions.push(version);

    const unnamed = store.versions
      .filter((row) => row.docId === input.docId && row.name === null)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
    const drop = new Set(unnamed.slice(40).map((row) => row.id));
    store.versions = store.versions.filter((row) => !drop.has(row.id));
    persist();

    return {
      id: version.id,
      docId: version.docId,
      name: version.name,
      snippet: version.snippet,
      createdByLabel: version.createdByLabel,
      createdAt: version.createdAt,
    };
  }

  /** No storage here: the picture rides in the document as its own `data:` address. */
  async uploadPicture(file: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => (typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('PICTURE NOT READ.')));
      reader.onerror = () => reject(new Error('PICTURE NOT READ.'));
      reader.readAsDataURL(file);
    });
  }

  /** Nothing to remove: a mock picture lives inside its document. */
  async removePictures(): Promise<void> {}

  openRoom(docId: string): DocRoom {
    return openRoom(docId);
  }
}

type DocAccessOrNull = DocFolder['defaultAccess'];

let repository: MockDocsRepository | null = null;

export function getMockDocsRepository(): MockDocsRepository {
  if (repository === null) repository = new MockDocsRepository();
  return repository;
}
