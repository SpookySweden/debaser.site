import type { RealtimeChannel } from '@supabase/supabase-js';
import { getSupabaseBrowserClient } from '../supabase/client';
import { isLoreSlug, loreSlug, sortPagesByUpdated, titleFromSlug } from './pages';
import type {
  CreateLorePageInput,
  LoreChannelMessage,
  LorePage,
  LorePageSummary,
  LoreRepository,
  LoreRoom,
  SaveLorePageInput,
} from './types';

/**
 * The lore shelf in Supabase - the production implementation of `LoreRepository`. Dormant until
 * the table in `supabase/schema.sql` exists and `NEXT_PUBLIC_LORE_DATA_SOURCE=supabase` is set
 * (see ./repository.ts).
 *
 * The table this code expects, with the RLS rules the mock store keeps by construction - anybody
 * may read a page, only a signed-in account may open or file one:
 *
 *   lore_pages  id uuid, slug text unique, title text, summary text, body_text text,
 *               yjs_state text, created_at timestamptz, created_by uuid, created_by_label text,
 *               updated_at timestamptz, updated_by uuid, updated_by_label text
 *
 * The document is carried as base64 in `yjs_state` rather than as bytes: one client writes it and
 * one reads it (the merging happens over the channel, never in the column), and text keeps the row
 * legible in the dashboard when somebody wants to see what is actually in there.
 *
 * Live editing deliberately does *not* use `postgres_changes`. A Yjs update is not a row, and a
 * change-feed over the table would put every keystroke of every page through the database's
 * replication stream and write a row per letter. The channel uses Realtime's Broadcast mode
 * instead (see `openRoom`), and the table is written only when somebody saves - which also means
 * this feature needs no publication entry, and so cannot be the table that takes a channel quiet.
 */

const TABLE = 'lore_pages';

/** The event name on the channel. One per room: the room's name is the page. */
const BROADCAST_EVENT = 'yjs';

/**
 * What the page is told when this database has not had the lore script.
 *
 * A deployment step rather than a mistake the reader made, so it names the files to run - both the
 * catch-up script and the section of the whole script that holds it - and says the rest of the
 * site is unaffected, which is true: nothing else reads this table.
 */
export const LORE_NEED_MIGRATION =
  'LORE PAGES NEED A ONE-TIME DATABASE UPDATE: RUN supabase/migrations/20260929000022_lore_pages.sql (OR SECTION 22 OF supabase/schema.sql) IN THE SUPABASE SQL EDITOR, THEN RELOAD. THE REST OF THE SITE IS UNAFFECTED.';

/** The codes PostgREST and Postgres answer with when the database is behind the code. */
const MISSING_SCHEMA_CODES = new Set(['PGRST200', 'PGRST204', 'PGRST205', 'PGRST106', '42P01', '42703']);

/** The unique-violation code, which for a page means somebody already took that address. */
const DUPLICATE = '23505';

type QueryError = { message: string; code?: string };

function isMissingSchema(error: QueryError): boolean {
  if (typeof error.code === 'string' && MISSING_SCHEMA_CODES.has(error.code)) return true;

  return /schema cache|does not exist|could not find/i.test(error.message);
}

type LoreRow = {
  id: string;
  slug: string;
  title: string;
  summary: string | null;
  body_text: string | null;
  yjs_state: string | null;
  created_at: string;
  created_by_label: string | null;
  updated_at: string;
  updated_by_label: string | null;
};

function toPage(row: LoreRow): LorePage {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    summary: row.summary ?? '',
    bodyText: row.body_text ?? '',
    state: row.yjs_state ?? '',
    createdAt: row.created_at,
    createdByLabel: row.created_by_label ?? 'Unknown',
    updatedAt: row.updated_at,
    updatedByLabel: row.updated_by_label ?? 'Unknown',
  };
}

function toSummary(row: LoreRow): LorePageSummary {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    summary: row.summary ?? '',
    updatedAt: row.updated_at,
    updatedByLabel: row.updated_by_label ?? 'Unknown',
    createdByLabel: row.created_by_label ?? 'Unknown',
  };
}

const SUMMARY_COLUMNS = 'id, slug, title, summary, created_at, created_by_label, updated_at, updated_by_label';

class SupabaseLoreRepository implements LoreRepository {
  readonly source = 'supabase' as const;

  private fail(message: string): never {
    throw new Error(message);
  }

  private client() {
    const client = getSupabaseBrowserClient();
    if (client === null) this.fail('LORE PAGES NEED SUPABASE TO BE CONFIGURED.');

    return client;
  }

  async listPages(): Promise<LorePageSummary[]> {
    const { data, error } = await this.client()
      .from(TABLE)
      .select(SUMMARY_COLUMNS)
      .order('updated_at', { ascending: false });

    if (error !== null) {
      if (isMissingSchema(error)) this.fail(LORE_NEED_MIGRATION);
      this.fail(error.message);
    }

    return sortPagesByUpdated(((data ?? []) as LoreRow[]).map(toSummary));
  }

  async getPage(slug: string): Promise<LorePage | null> {
    const { data, error } = await this.client().from(TABLE).select('*').eq('slug', slug).limit(1);

    if (error !== null) {
      if (isMissingSchema(error)) this.fail(LORE_NEED_MIGRATION);
      this.fail(error.message);
    }

    const rows = (data ?? []) as LoreRow[];
    const row = rows[0];

    return row === undefined ? null : toPage(row);
  }

  async createPage(input: CreateLorePageInput): Promise<LorePage> {
    if (input.creatorId === null) this.fail('OPENING A PAGE TAKES AN ACCOUNT - SIGN IN FIRST.');

    const slug = loreSlug(input.title);
    if (!isLoreSlug(slug)) this.fail('THAT TITLE MAKES NO ADDRESS - GIVE THE PAGE A NAME TO FILE IT UNDER.');

    const { data, error } = await this.client()
      .from(TABLE)
      .insert({
        slug,
        title: input.title.trim().length === 0 ? titleFromSlug(slug) : input.title.trim(),
        summary: input.summary.trim(),
        body_text: '',
        yjs_state: '',
        created_by: input.creatorId,
        created_by_label: input.creatorName,
        updated_by: input.creatorId,
        updated_by_label: input.creatorName,
      })
      .select('*')
      .limit(1);

    if (error !== null) {
      if (isMissingSchema(error)) this.fail(LORE_NEED_MIGRATION);
      if (error.code === DUPLICATE) this.fail('A PAGE ALREADY LIVES AT THAT ADDRESS.');
      this.fail(error.message);
    }

    const rows = (data ?? []) as LoreRow[];
    const row = rows[0];
    if (row === undefined) this.fail('THE PAGE WAS NOT FILED - TRY AGAIN.');

    return toPage(row);
  }

  async savePage(input: SaveLorePageInput): Promise<LorePage> {
    if (input.editorId === null) this.fail('FILING A PAGE TAKES AN ACCOUNT - SIGN IN FIRST.');

    const { data, error } = await this.client()
      .from(TABLE)
      .update({
        body_text: input.bodyText,
        yjs_state: input.state,
        updated_at: new Date().toISOString(),
        updated_by: input.editorId,
        updated_by_label: input.editorName,
      })
      .eq('id', input.id)
      .select('*')
      .limit(1);

    if (error !== null) {
      if (isMissingSchema(error)) this.fail(LORE_NEED_MIGRATION);
      this.fail(error.message);
    }

    const rows = (data ?? []) as LoreRow[];
    const row = rows[0];
    if (row === undefined) this.fail('THAT PAGE IS NOT THERE - IT MAY HAVE BEEN TAKEN OFF THE SHELF.');

    return toPage(row);
  }

  /**
   * The page's channel, over Realtime Broadcast.
   *
   * A room is one channel named after the page, and every message on it is one of the five the
   * provider understands (see ./types.ts). Sends before the subscription lands are held rather
   * than dropped: Realtime refuses to send on a channel that has not joined yet, and the very
   * first message of the handshake is a sync request - losing it would leave a joiner believing
   * the page is empty, and then *saving* that belief over everybody else's writing.
   */
  openRoom(slug: string): LoreRoom {
    const name = `lore:${slug}`;
    const listeners = new Set<(message: LoreChannelMessage) => void>();
    const waiting: LoreChannelMessage[] = [];
    const client = getSupabaseBrowserClient();
    let channel: RealtimeChannel | null = null;
    let joined = false;

    if (client !== null) {
      channel = client.channel(name, { config: { broadcast: { self: false } } });

      channel.on('broadcast', { event: BROADCAST_EVENT }, ({ payload }) => {
        const message = payload as LoreChannelMessage | undefined;
        if (message === undefined || typeof message.kind !== 'string') return;

        for (const listener of listeners) listener(message);
      });

      channel.subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          joined = true;

          while (waiting.length > 0) {
            const next = waiting.shift();
            if (next !== undefined) void channel?.send({ type: 'broadcast', event: BROADCAST_EVENT, payload: next });
          }

          return;
        }

        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          console.warn(
            'lore pages: realtime is not delivering - run supabase/migrations/20260929000022_lore_pages.sql and ' +
              'reload. Editing still saves; the other editors simply will not see the keystrokes.',
          );
        }
      });
    }

    return {
      name,
      send: (message) => {
        if (channel === null) return;

        if (!joined) {
          waiting.push(message);
          return;
        }

        void channel.send({ type: 'broadcast', event: BROADCAST_EVENT, payload: message });
      },
      listen: (handler) => {
        listeners.add(handler);

        return () => void listeners.delete(handler);
      },
      close: () => {
        if (channel !== null && client !== null) void client.removeChannel(channel);

        channel = null;
        waiting.length = 0;
      },
    };
  }
}

let repository: SupabaseLoreRepository | null = null;

export function getSupabaseLoreRepository(): LoreRepository {
  if (repository === null) repository = new SupabaseLoreRepository();

  return repository;
}
