import type { RealtimeChannel } from '@supabase/supabase-js';
import { getSupabaseBrowserClient } from '../supabase/client';
import { isDocAccess, isDocSlug, PICTURE_BUCKET, PICTURE_MAX_BYTES, PICTURE_TYPES, sortByUpdated } from './rules';
import type {
  CreateDocInput,
  CreateFolderInput,
  DocAccess,
  DocChannelMessage,
  DocComment,
  DocFolder,
  DocPatch,
  DocRecord,
  DocRole,
  DocRoom,
  DocScope,
  DocShare,
  DocSummary,
  DocVersion,
  DocViewer,
  DocsRepository,
  NewCommentInput,
} from './types';

/**
 * DOCS in Supabase (supabase/migrations/20261113022846_live_docs.sql).
 *
 * Row Level Security decides who sees and changes what; this file asks and reports. Live editing runs
 * over Realtime Broadcast on a private channel `doc:<id>` (heard by readers, sent by editors), never
 * through `postgres_changes`: a Yjs update is not a row, and the table is written only on a save.
 */

const BROADCAST_EVENT = 'yjs';

const SUMMARY_COLUMNS =
  'id, slug, title, summary, access, folder_id, owner_id, owner_label, created_at, created_by_label, updated_at, updated_by_label';
const RECORD_COLUMNS = `${SUMMARY_COLUMNS}, yjs_state, body_text, board_thread_id`;
const FOLDER_COLUMNS = 'id, name, parent_id, kind, owner_id, owner_label, default_access, created_at';
const COMMENT_COLUMNS =
  'id, doc_id, parent_id, author_id, author_label, body, anchor_from, anchor_to, quote, resolved, resolved_by_label, created_at';
const VERSION_COLUMNS = 'id, doc_id, name, snippet, created_by_label, created_at';

type SummaryRow = {
  id: string;
  slug: string | null;
  title: string;
  summary: string;
  access: string;
  folder_id: string | null;
  owner_id: string | null;
  owner_label: string;
  created_at: string;
  created_by_label: string;
  updated_at: string;
  updated_by_label: string;
};

type RecordRow = SummaryRow & { yjs_state: string; body_text: string; board_thread_id: string | null };

type FolderRow = {
  id: string;
  name: string;
  parent_id: string | null;
  kind: string;
  owner_id: string | null;
  owner_label: string;
  default_access: string | null;
  created_at: string;
};

type CommentRow = {
  id: string;
  doc_id: string;
  parent_id: string | null;
  author_id: string | null;
  author_label: string;
  body: string;
  anchor_from: string | null;
  anchor_to: string | null;
  quote: string;
  resolved: boolean;
  resolved_by_label: string | null;
  created_at: string;
};

type VersionRow = { id: string; doc_id: string; name: string | null; snippet: string; created_by_label: string; created_at: string };

function toSummary(row: SummaryRow): DocSummary {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    summary: row.summary,
    access: isDocAccess(row.access) ? row.access : 'private',
    folderId: row.folder_id,
    ownerId: row.owner_id,
    ownerLabel: row.owner_label,
    createdAt: row.created_at,
    createdByLabel: row.created_by_label,
    updatedAt: row.updated_at,
    updatedByLabel: row.updated_by_label,
  };
}

function toFolder(row: FolderRow): DocFolder {
  return {
    id: row.id,
    name: row.name,
    parentId: row.parent_id,
    kind: row.kind === 'shared' ? 'shared' : 'home',
    ownerId: row.owner_id,
    ownerLabel: row.owner_label,
    defaultAccess: isDocAccess(row.default_access) ? row.default_access : null,
    createdAt: row.created_at,
  };
}

function toComment(row: CommentRow): DocComment {
  return {
    id: row.id,
    docId: row.doc_id,
    parentId: row.parent_id,
    authorId: row.author_id,
    authorLabel: row.author_label,
    body: row.body,
    anchorFrom: row.anchor_from,
    anchorTo: row.anchor_to,
    quote: row.quote,
    resolved: row.resolved,
    resolvedByLabel: row.resolved_by_label,
    createdAt: row.created_at,
  };
}

function toVersion(row: VersionRow): DocVersion {
  return {
    id: row.id,
    docId: row.doc_id,
    name: row.name,
    snippet: row.snippet,
    createdByLabel: row.created_by_label,
    createdAt: row.created_at,
  };
}

/** The database's words, turned into the site's: never a raw database message to the screen. */
function plain(error: { message: string; code?: string }, fallback: string): Error {
  const message = error.message.toLowerCase();

  if (error.code === '23505') return new Error('THAT ADDRESS IS TAKEN.');
  if (error.code === '42501' || message.includes('row-level security')) return new Error('YOU ARE NOT ALLOWED TO DO THAT.');
  if (message.includes('the most there is room for')) return new Error(error.message.toUpperCase());
  if (message.includes('only the owner')) return new Error('ONLY THE OWNER CHANGES THAT.');
  if (message.includes('someone else')) return new Error('THAT FOLDER IS SOMEONE ELSE\'S.');
  if (message.includes('lore stays')) return new Error('LORE STAYS.');
  if (message.includes('less than an hour')) return new Error('A COPY WAS KEPT LESS THAN AN HOUR AGO.');
  if (message.includes('named versions')) return new Error('THAT IS 20 NAMED VERSIONS - REMOVE ONE FIRST.');
  if (message.includes('stays in lore')) return new Error('A LORE PAGE STAYS IN LORE.');

  return new Error(fallback);
}

class SupabaseDocsRepository implements DocsRepository {
  readonly source = 'supabase' as const;

  private client() {
    const client = getSupabaseBrowserClient();
    if (client === null) throw new Error('DOCS NEED SUPABASE TO BE CONFIGURED.');
    return client;
  }

  async listFolders(): Promise<DocFolder[]> {
    const { data, error } = await this.client().from('doc_folders').select(FOLDER_COLUMNS).order('name').limit(500);
    if (error !== null) throw plain(error, 'FOLDERS DID NOT LOAD.');
    return ((data ?? []) as FolderRow[]).map(toFolder);
  }

  async listDocs(scope: DocScope = {}): Promise<DocSummary[]> {
    let query = this.client().from('docs').select(SUMMARY_COLUMNS);
    if (scope.folderId !== undefined) query = scope.folderId === null ? query.is('folder_id', null) : query.eq('folder_id', scope.folderId);
    if (scope.ownerId !== undefined) query = query.eq('owner_id', scope.ownerId);
    const { data, error } = await query.order('updated_at', { ascending: false }).limit(500);
    if (error !== null) throw plain(error, 'DOCUMENTS DID NOT LOAD.');
    return sortByUpdated(((data ?? []) as SummaryRow[]).map(toSummary));
  }

  private async withRole(row: RecordRow | undefined): Promise<DocRecord | null> {
    if (row === undefined) return null;

    const { data, error } = await this.client().rpc('doc_role', { target: row.id });
    const role = error === null && (data === 'owner' || data === 'edit' || data === 'read') ? (data as DocRole) : 'read';

    return {
      ...toSummary(row),
      state: row.yjs_state,
      bodyText: row.body_text,
      boardThreadId: row.board_thread_id,
      role,
    };
  }

  async readState(id: string): Promise<string | null> {
    const { data, error } = await this.client().from('docs').select('yjs_state').eq('id', id).limit(1);
    if (error !== null) return null;
    return ((data ?? []) as { yjs_state: string }[])[0]?.yjs_state ?? null;
  }

  async getDoc(id: string): Promise<DocRecord | null> {
    const { data, error } = await this.client().from('docs').select(RECORD_COLUMNS).eq('id', id).limit(1);
    if (error !== null) throw plain(error, 'THE DOCUMENT DID NOT LOAD.');
    return this.withRole(((data ?? []) as RecordRow[])[0]);
  }

  async getDocBySlug(slug: string): Promise<DocRecord | null> {
    const { data, error } = await this.client().from('docs').select(RECORD_COLUMNS).eq('slug', slug).limit(1);
    if (error !== null) throw plain(error, 'THE PAGE DID NOT LOAD.');
    return this.withRole(((data ?? []) as RecordRow[])[0]);
  }

  async createDoc(input: CreateDocInput): Promise<DocSummary> {
    const title = input.title.trim().toUpperCase();
    if (title.length === 0) throw new Error('A DOCUMENT NEEDS A TITLE.');
    if (input.slug !== undefined && !isDocSlug(input.slug)) throw new Error('TITLE NEEDS A LETTER OR DIGIT.');

    const { data, error } = await this.client()
      .from('docs')
      .insert({
        title: title.slice(0, 120),
        summary: input.summary.trim().slice(0, 300),
        access: input.access,
        folder_id: input.folderId,
        slug: input.slug ?? null,
        owner_label: input.viewer.name,
        created_by_label: input.viewer.name,
        updated_by_label: input.viewer.name,
      })
      .select(SUMMARY_COLUMNS)
      .limit(1);

    if (error !== null) throw plain(error, 'THE DOCUMENT WAS NOT MADE.');
    const row = ((data ?? []) as SummaryRow[])[0];
    if (row === undefined) throw new Error('THE DOCUMENT WAS NOT MADE.');
    return toSummary(row);
  }

  async saveDoc(input: { id: string; state: string; bodyText: string; viewer: DocViewer }): Promise<string> {
    const now = new Date().toISOString();
    const { data, error } = await this.client()
      .from('docs')
      .update({ yjs_state: input.state, body_text: input.bodyText, updated_at: now, updated_by_label: input.viewer.name })
      .eq('id', input.id)
      .select('updated_at')
      .limit(1);

    if (error !== null) throw plain(error, 'NOT SAVED.');
    const row = ((data ?? []) as { updated_at: string }[])[0];
    if (row === undefined) throw new Error('NOT SAVED: YOU CAN ONLY READ THIS ONE NOW.');
    return row.updated_at;
  }

  async updateDoc(id: string, patch: DocPatch): Promise<void> {
    const update: Record<string, unknown> = {};
    if (patch.title !== undefined) update.title = patch.title.trim().toUpperCase().slice(0, 120);
    if (patch.summary !== undefined) update.summary = patch.summary.trim().slice(0, 300);
    if (patch.access !== undefined) update.access = patch.access;
    if (patch.folderId !== undefined) update.folder_id = patch.folderId;
    if (patch.boardThreadId !== undefined) update.board_thread_id = patch.boardThreadId;

    const { data, error } = await this.client().from('docs').update(update).eq('id', id).select('id').limit(1);
    if (error !== null) throw plain(error, 'NOT CHANGED.');
    if ((data ?? []).length === 0) throw new Error('NOT CHANGED: YOU ARE NOT ALLOWED TO.');
  }

  async deleteDoc(id: string): Promise<void> {
    const { data, error } = await this.client().from('docs').delete().eq('id', id).select('id');
    if (error !== null) throw plain(error, 'NOT DELETED.');
    if ((data ?? []).length === 0) throw new Error('ONLY THE OWNER DELETES IT.');
  }

  async createFolder(input: CreateFolderInput): Promise<DocFolder> {
    const name = input.name.trim().toUpperCase();
    if (name.length === 0) throw new Error('A FOLDER NEEDS A NAME.');

    const { data, error } = await this.client()
      .from('doc_folders')
      .insert({
        name: name.slice(0, 60),
        parent_id: input.parentId,
        kind: input.kind,
        default_access: input.defaultAccess,
        owner_label: input.viewer.name,
      })
      .select(FOLDER_COLUMNS)
      .limit(1);

    if (error !== null) throw plain(error, 'THE FOLDER WAS NOT MADE.');
    const row = ((data ?? []) as FolderRow[])[0];
    if (row === undefined) throw new Error('THE FOLDER WAS NOT MADE.');
    return toFolder(row);
  }

  async updateFolder(id: string, patch: { name?: string; defaultAccess?: DocAccess | null }): Promise<void> {
    const update: Record<string, unknown> = {};
    if (patch.name !== undefined) update.name = patch.name.trim().toUpperCase().slice(0, 60);
    if (patch.defaultAccess !== undefined) update.default_access = patch.defaultAccess;

    const { data, error } = await this.client().from('doc_folders').update(update).eq('id', id).select('id');
    if (error !== null) throw plain(error, 'NOT CHANGED.');
    if ((data ?? []).length === 0) throw new Error('ONLY ITS MAKER CHANGES A FOLDER.');
  }

  async deleteFolder(id: string): Promise<void> {
    const { data, error } = await this.client().from('doc_folders').delete().eq('id', id).select('id');
    if (error !== null) throw plain(error, 'NOT REMOVED.');
    if ((data ?? []).length === 0) throw new Error('ONLY ITS MAKER REMOVES A FOLDER.');
  }

  async listShares(docId: string): Promise<DocShare[]> {
    const { data, error } = await this.client()
      .from('doc_shares')
      .select('person_id, person_label, can_edit')
      .eq('doc_id', docId)
      .order('person_label')
      .limit(50);
    if (error !== null) throw plain(error, 'SHARING DID NOT LOAD.');
    return ((data ?? []) as { person_id: string; person_label: string; can_edit: boolean }[]).map((row) => ({
      personId: row.person_id,
      personLabel: row.person_label,
      canEdit: row.can_edit,
    }));
  }

  async setShare(docId: string, share: DocShare): Promise<void> {
    const { error } = await this.client()
      .from('doc_shares')
      .upsert(
        { doc_id: docId, person_id: share.personId, person_label: share.personLabel, can_edit: share.canEdit },
        { onConflict: 'doc_id,person_id' },
      );
    if (error !== null) throw plain(error, 'NOT SHARED.');
  }

  async removeShare(docId: string, personId: string): Promise<void> {
    const { error } = await this.client().from('doc_shares').delete().eq('doc_id', docId).eq('person_id', personId);
    if (error !== null) throw plain(error, 'NOT TAKEN BACK.');
  }

  async listComments(docId: string): Promise<DocComment[]> {
    const { data, error } = await this.client()
      .from('doc_comments')
      .select(COMMENT_COLUMNS)
      .eq('doc_id', docId)
      .order('created_at')
      .limit(500);
    if (error !== null) throw plain(error, 'COMMENTS DID NOT LOAD.');
    return ((data ?? []) as CommentRow[]).map(toComment);
  }

  async addComment(input: NewCommentInput): Promise<DocComment> {
    const body = input.body.trim();
    if (body.length === 0) throw new Error('WRITE SOMETHING FIRST.');

    const { data, error } = await this.client()
      .from('doc_comments')
      .insert({
        doc_id: input.docId,
        parent_id: input.parentId,
        author_label: input.viewer.name,
        body: body.slice(0, 2000),
        anchor_from: input.anchorFrom,
        anchor_to: input.anchorTo,
        quote: input.quote.slice(0, 300),
      })
      .select(COMMENT_COLUMNS)
      .limit(1);

    if (error !== null) throw plain(error, 'THE COMMENT WAS NOT LEFT.');
    const row = ((data ?? []) as CommentRow[])[0];
    if (row === undefined) throw new Error('THE COMMENT WAS NOT LEFT.');
    return toComment(row);
  }

  async setResolved(commentId: string, resolved: boolean, viewer: DocViewer): Promise<void> {
    const { error } = await this.client()
      .from('doc_comments')
      .update({ resolved, resolved_by_label: resolved ? viewer.name : null })
      .eq('id', commentId);
    if (error !== null) throw plain(error, 'NOT CHANGED.');
  }

  async deleteComment(commentId: string): Promise<void> {
    const { error } = await this.client().from('doc_comments').delete().eq('id', commentId);
    if (error !== null) throw plain(error, 'NOT DELETED.');
  }

  async listVersions(docId: string): Promise<DocVersion[]> {
    const { data, error } = await this.client()
      .from('doc_versions')
      .select(VERSION_COLUMNS)
      .eq('doc_id', docId)
      .order('created_at', { ascending: false })
      .limit(100);
    if (error !== null) throw plain(error, 'HISTORY DID NOT LOAD.');
    return ((data ?? []) as VersionRow[]).map(toVersion);
  }

  async versionState(versionId: string): Promise<string | null> {
    const { data, error } = await this.client().from('doc_versions').select('yjs_state').eq('id', versionId).limit(1);
    if (error !== null) throw plain(error, 'THAT VERSION DID NOT LOAD.');
    return ((data ?? []) as { yjs_state: string }[])[0]?.yjs_state ?? null;
  }

  async deleteVersion(versionId: string): Promise<void> {
    const { data, error } = await this.client().from('doc_versions').delete().eq('id', versionId).select('id');
    if (error !== null) throw plain(error, 'NOT REMOVED.');
    if ((data ?? []).length === 0) throw new Error('ONLY THE OWNER REMOVES A VERSION.');
  }

  async keepVersion(input: { docId: string; state: string; snippet: string; name: string | null; viewer: DocViewer }): Promise<DocVersion | null> {
    const { data, error } = await this.client()
      .from('doc_versions')
      .insert({
        doc_id: input.docId,
        yjs_state: input.state,
        snippet: input.snippet.slice(0, 200),
        name: input.name === null ? null : input.name.trim().toUpperCase().slice(0, 80),
        created_by_label: input.viewer.name,
      })
      .select(VERSION_COLUMNS)
      .limit(1);

    if (error !== null) {
      if (input.name === null && error.message.toLowerCase().includes('less than an hour')) return null;
      throw plain(error, 'THAT VERSION WAS NOT KEPT.');
    }
    const row = ((data ?? []) as VersionRow[])[0];
    return row === undefined ? null : toVersion(row);
  }

  async uploadPicture(file: Blob, viewer: DocViewer): Promise<string> {
    if (!PICTURE_TYPES.includes(file.type)) throw new Error('PNG, JPG, WEBP OR GIF ONLY.');
    if (file.size > PICTURE_MAX_BYTES) throw new Error('PICTURES MUST BE 1 MB OR SMALLER.');

    const extension = file.type === 'image/png' ? 'png' : file.type === 'image/gif' ? 'gif' : file.type === 'image/webp' ? 'webp' : 'jpg';
    const name = globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
    const path = `${viewer.id}/${name}.${extension}`;
    const client = this.client();

    // The bucket holds the type and size to the same list; its policy holds the account to its own
    // folder and to 20 pictures in ten minutes (the migration's "doc pictures filed by accounts").
    const { error } = await client.storage.from(PICTURE_BUCKET).upload(path, file, { contentType: file.type, upsert: false });
    if (error !== null) {
      const message = error.message.toLowerCase();
      if (message.includes('row-level security') || message.includes('unauthorized')) {
        throw new Error('THAT IS A LOT OF PICTURES AT ONCE - WAIT A FEW MINUTES AND TRY AGAIN.');
      }
      throw new Error('THE PICTURE WAS NOT FILED.');
    }

    return client.storage.from(PICTURE_BUCKET).getPublicUrl(path).data.publicUrl;
  }

  async removePictures(addresses: string[]): Promise<void> {
    const paths = addresses
      .map((address) => address.split(`/${PICTURE_BUCKET}/`)[1])
      .filter((path): path is string => typeof path === 'string' && /^[0-9a-f-]{36}\/[A-Za-z0-9-]+\.(png|jpg|gif|webp)$/.test(path));
    if (paths.length === 0) return;
    await this.client().storage.from(PICTURE_BUCKET).remove(paths.slice(0, 300));
  }

  /**
   * The document's channel. Sends before the subscription lands are held, not dropped: the first
   * message is the request for the document, and losing it would leave a joiner believing it empty.
   */
  openRoom(docId: string): DocRoom {
    const name = `doc:${docId}`;
    const listeners = new Set<(message: DocChannelMessage) => void>();
    const rejoinListeners = new Set<() => void>();
    const waiting: DocChannelMessage[] = [];
    let everJoined = false;
    const client = getSupabaseBrowserClient();
    let channel: RealtimeChannel | null = null;
    let joined = false;

    if (client !== null) {
      channel = client.channel(name, { config: { broadcast: { self: false }, private: true } });

      channel.on('broadcast', { event: BROADCAST_EVENT }, ({ payload }) => {
        const message = payload as DocChannelMessage | undefined;
        if (message === undefined || typeof message.kind !== 'string' || typeof message.from !== 'number') return;
        for (const listener of listeners) listener(message);
      });

      channel.subscribe((status) => {
        if (status !== 'SUBSCRIBED') {
          // Dropped (a sleeping laptop, a network switch): hold sends until it is back.
          if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') joined = false;
          return;
        }
        {
          joined = true;
          const back = everJoined;
          everJoined = true;
          if (back) for (const listener of rejoinListeners) listener();
          while (waiting.length > 0) {
            const next = waiting.shift();
            if (next !== undefined) void channel?.send({ type: 'broadcast', event: BROADCAST_EVENT, payload: next });
          }
        }
      });
    }

    return {
      name,
      send: (message) => {
        if (channel === null) return;
        if (!joined) {
          if (waiting.length < 200) waiting.push(message);
          return;
        }
        void channel.send({ type: 'broadcast', event: BROADCAST_EVENT, payload: message });
      },
      listen: (handler) => {
        listeners.add(handler);
        return () => void listeners.delete(handler);
      },
      onRejoin: (handler) => {
        rejoinListeners.add(handler);
        return () => void rejoinListeners.delete(handler);
      },
      close: () => {
        rejoinListeners.clear();
        if (channel !== null && client !== null) void client.removeChannel(channel);
        channel = null;
        waiting.length = 0;
      },
    };
  }
}

let repository: SupabaseDocsRepository | null = null;

export function getSupabaseDocsRepository(): DocsRepository {
  if (repository === null) repository = new SupabaseDocsRepository();
  return repository;
}
