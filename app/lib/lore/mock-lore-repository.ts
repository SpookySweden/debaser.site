import * as Y from 'yjs';
import { createLocalId } from '../forum/ids';
import { isLoreSlug, loreSlug, sortPagesByUpdated, titleFromSlug } from './pages';
import { bytesToBase64 } from './session';
import {
  LORE_DOCUMENT_FIELD,
  type CreateLorePageInput,
  type LoreChannelMessage,
  type LorePage,
  type LorePageSummary,
  type LoreRepository,
  type LoreRoom,
  type SaveLorePageInput,
} from './types';

/**
 * The lore shelf used while Supabase is not wired up.
 *
 * Pages live in localStorage beside the board's rows and the profiles, so a page written on this
 * machine is still there after a reload. The room is a `BroadcastChannel`: two tabs of the same
 * browser join the same channel and merge each other's edits, which is the same handshake the
 * real store runs over Realtime (see ./session.ts) - so live editing can be seen with no database
 * at all, and one store cannot work while the other does not.
 *
 * The rules the database keeps are kept here too, on purpose: an address that is not a slug is
 * refused, two pages cannot share one, and only an account may open or file a page. A mock that
 * accepts more than the real thing is worse than no mock.
 */

// v1: the shelf as it stands - one row per page, the writing kept twice (editable state, plain text).
const STORAGE_KEY = 'debaser.lore.mock.v1';
const STORAGE_VERSION = 1;

type PersistedState = {
  version: number;
  pages: LorePage[];
};

/** The one refusal that is about being signed out rather than about the page. */
const NEEDS_ACCOUNT = 'OPENING AND FILING A PAGE TAKES AN ACCOUNT - SIGN IN FIRST.';

/**
 * A Yjs document built from prose, which is how a page the archive starts life holding is filed.
 *
 * The structure matters: `y-prosemirror` maps a ProseMirror node to an `XmlElement` *by the node's
 * name*, so a paragraph of prose is an `XmlElement('paragraph')` holding one `XmlText`. Written
 * here rather than typed in by hand so a seeded page opens in the editor with its writing in it,
 * and so the mock store's own copy is a real document rather than a paragraph string the editor
 * would have to be told about.
 */
export function loreDocumentState(text: string): string {
  const doc = new Y.Doc();
  const body = doc.getXmlFragment(LORE_DOCUMENT_FIELD);

  doc.transact(() => {
    for (const paragraph of text.split(/\n{2,}/).map((part) => part.trim()).filter((part) => part.length > 0)) {
      const node = new Y.XmlElement('paragraph');
      node.insert(0, [new Y.XmlText(paragraph)]);
      body.insert(body.length, [node]);
    }
  });

  return bytesToBase64(Y.encodeStateAsUpdate(doc));
}

/** What the shelf opens with on a machine that has never held a page. */
const SEED_PAGES: { slug: string; title: string; summary: string; body: string; filed: string }[] = [
  {
    slug: 'the-glass-corridor',
    title: 'THE GLASS CORRIDOR',
    summary: 'Where the comic opens, and what the corridor is made of.',
    filed: '2026-09-21T09:00:00.000Z',
    body: [
      'The corridor is glass on one side and poured concrete on the other, and it runs the length of the building without a single door in it. Everything that happens in the first act happens on the other side of that glass.',
      'Nothing in the corridor is decorated, which is the point: the people who built it wanted to be seen walking through it rather than met in it.',
    ].join('\n\n'),
  },
  {
    slug: 'hexham-grid',
    title: 'HEXHAM GRID',
    summary: 'The city the score was written for: what stands, and what was taken down.',
    filed: '2026-09-21T08:30:00.000Z',
    body: [
      'Hexham was drawn as a grid of nine blocks with a substation at the middle of it, and the substation is the only building in the comic that is never shown from the outside.',
      'The score follows the grid: one theme per block, played in order, with the substation theme only ever heard underneath the others.',
    ].join('\n\n'),
  },
];

function seedPages(): LorePage[] {
  return SEED_PAGES.map((seed) => ({
    id: createLocalId('lore'),
    slug: seed.slug,
    title: seed.title,
    summary: seed.summary,
    bodyText: seed.body,
    state: loreDocumentState(seed.body),
    createdAt: seed.filed,
    createdByLabel: 'debaser.site',
    updatedAt: seed.filed,
    updatedByLabel: 'debaser.site',
  }));
}

type Listener = (message: LoreChannelMessage) => void;

let state: LorePage[] | null = null;

function hasStorage(): boolean {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

function isPageShaped(value: unknown): value is LorePage {
  if (typeof value !== 'object' || value === null) return false;
  const row = value as Partial<LorePage>;

  return (
    typeof row.id === 'string' &&
    typeof row.slug === 'string' &&
    typeof row.title === 'string' &&
    typeof row.summary === 'string' &&
    typeof row.bodyText === 'string' &&
    typeof row.state === 'string' &&
    typeof row.createdAt === 'string' &&
    typeof row.updatedAt === 'string'
  );
}

/** Defensive read: a payload from an older shape still loads what it can. */
function loadPages(): LorePage[] {
  if (!hasStorage()) return seedPages();

  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (raw === null || raw.length === 0) return seedPages();

  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return seedPages();

    const candidate = parsed as Partial<PersistedState>;
    if (!Array.isArray(candidate.pages)) return seedPages();

    const pages = candidate.pages.filter(isPageShaped);
    // An empty shelf is a shelf with nothing on it, not a shelf that needs seeding again: the
    // reader may simply have taken everything off it.
    return pages.map((row) => ({
      ...row,
      createdByLabel: typeof row.createdByLabel === 'string' ? row.createdByLabel : 'Unknown',
      updatedByLabel: typeof row.updatedByLabel === 'string' ? row.updatedByLabel : 'Unknown',
    }));
  } catch {
    return seedPages();
  }
}

function ensureState(): LorePage[] {
  if (state === null) state = loadPages();
  return state;
}

function persist(): void {
  if (!hasStorage()) return;

  const payload: PersistedState = { version: STORAGE_VERSION, pages: ensureState() };

  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // Storage disabled or full: the shelf keeps working in memory.
  }
}

function summaryOf(page: LorePage): LorePageSummary {
  return {
    id: page.id,
    slug: page.slug,
    title: page.title,
    summary: page.summary,
    updatedAt: page.updatedAt,
    updatedByLabel: page.updatedByLabel,
    createdByLabel: page.createdByLabel,
  };
}

/** One room per page, shared by every tab that opens it in this one. */
const rooms = new Map<string, { channel: BroadcastChannel | null; listeners: Set<Listener> }>();

function openRoom(slug: string): LoreRoom {
  const existing = rooms.get(slug);

  if (existing !== undefined) {
    return roomFor(slug, existing);
  }

  const entry = { channel: null as BroadcastChannel | null, listeners: new Set<Listener>() };

  // No BroadcastChannel (an old browser, or Node without one) is a room nobody can hear: the page
  // still reads and writes, it is simply edited by one tab at a time.
  if (typeof BroadcastChannel !== 'undefined') {
    entry.channel = new BroadcastChannel(`debaser-lore-${slug}`);
    entry.channel.onmessage = (event: MessageEvent<LoreChannelMessage>) => {
      for (const listener of entry.listeners) listener(event.data);
    };
  }

  rooms.set(slug, entry);

  return roomFor(slug, entry);
}

function roomFor(slug: string, entry: { channel: BroadcastChannel | null; listeners: Set<Listener> }): LoreRoom {
  const room: LoreRoom = {
    name: `debaser-lore-${slug}`,
    send: (message) => entry.channel?.postMessage(message),
    listen: (listener) => {
      entry.listeners.add(listener);

      return () => {
        entry.listeners.delete(listener);
      };
    },
    close: () => {
      if (entry.listeners.size > 0) return;

      entry.channel?.close();
      rooms.delete(slug);
    },
  };

  return room;
}

class MockLoreRepository implements LoreRepository {
  readonly source = 'mock' as const;

  async listPages(): Promise<LorePageSummary[]> {
    return sortPagesByUpdated(ensureState().map(summaryOf));
  }

  async getPage(slug: string): Promise<LorePage | null> {
    return ensureState().find((page) => page.slug === slug) ?? null;
  }

  async createPage(input: CreateLorePageInput): Promise<LorePage> {
    if (input.creatorId === null) throw new Error(NEEDS_ACCOUNT);

    const slug = loreSlug(input.title);
    if (!isLoreSlug(slug)) throw new Error('THAT TITLE MAKES NO ADDRESS - GIVE THE PAGE A NAME TO FILE IT UNDER.');

    const pages = ensureState();
    if (pages.some((page) => page.slug === slug)) throw new Error('A PAGE ALREADY LIVES AT THAT ADDRESS.');

    const now = new Date().toISOString();
    const page: LorePage = {
      id: createLocalId('lore'),
      slug,
      title: input.title.trim().length === 0 ? titleFromSlug(slug) : input.title.trim(),
      summary: input.summary.trim(),
      bodyText: '',
      state: '',
      createdAt: now,
      createdByLabel: input.creatorName,
      updatedAt: now,
      updatedByLabel: input.creatorName,
    };

    pages.push(page);
    persist();

    return page;
  }

  async savePage(input: SaveLorePageInput): Promise<LorePage> {
    if (input.editorId === null) throw new Error(NEEDS_ACCOUNT);

    const page = ensureState().find((row) => row.id === input.id);
    if (page === undefined) throw new Error('THAT PAGE IS NOT THERE - IT MAY HAVE BEEN TAKEN OFF THE SHELF.');

    page.state = input.state;
    page.bodyText = input.bodyText;
    page.updatedAt = new Date().toISOString();
    page.updatedByLabel = input.editorName;
    persist();

    return page;
  }

  openRoom(slug: string): LoreRoom {
    return openRoom(slug);
  }

  /** Local pages only: the shelf the app ships with is not touched by this. */
  async clearLocalPages(): Promise<void> {
    state = [];
    persist();
  }
}

let mockLoreRepository: MockLoreRepository | null = null;

export function getMockLoreRepository(): LoreRepository {
  if (mockLoreRepository === null) mockLoreRepository = new MockLoreRepository();

  return mockLoreRepository;
}

