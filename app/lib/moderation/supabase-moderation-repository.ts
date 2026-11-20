import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseBrowserClient } from '../supabase/client';
import {
  moderationError,
  type ModerationLogEntry,
  type ModerationReport,
  type ModerationStore,
  type ModeratorRow,
  type ReportReason,
  type ReportContextKind,
} from './types';

/**
 * The real moderation store: the moderators' functions and tables on the live database (20261120090000_moderation.sql).
 * Every write is a function the database checks itself (is a moderator, is the owner, is banned, can read the reported line),
 * so nothing here decides who may do what. Errors reach the page in the site's words (`moderationError`), never the database's.
 */

function client(): SupabaseClient {
  const found = getSupabaseBrowserClient();
  if (found === null) throw new Error('NO DATABASE.');
  return found;
}

async function call(name: string, args: Record<string, unknown>, fallback: string): Promise<unknown> {
  const { data, error } = await client().rpc(name, args);
  if (error !== null) throw moderationError(error.message, fallback);
  return data;
}

type ReportRow = {
  id: string;
  kind: 'report' | 'appeal';
  reporter: string | null;
  account: string;
  reason: ReportReason | null;
  note: string;
  context_kind: ReportContextKind | null;
  context_id: string | null;
  context_text: string;
  context_private: boolean;
  state: 'open' | 'dismissed' | 'acted';
  handled_at: string | null;
  created_at: string;
};

const REPORT_COLUMNS = 'id, kind, reporter, account, reason, note, context_kind, context_id, context_text, context_private, state, handled_at, created_at';

function toReport(row: ReportRow): ModerationReport {
  return {
    id: row.id,
    kind: row.kind,
    reporterId: row.reporter,
    accountId: row.account,
    reason: row.reason,
    note: row.note,
    context:
      row.context_kind !== null && row.context_id !== null
        ? { kind: row.context_kind, id: row.context_id, text: row.context_text, private: row.context_private }
        : null,
    state: row.state,
    handledAt: row.handled_at,
    createdAt: row.created_at,
  };
}

type LogRow = {
  id: number;
  at: string;
  actor: string | null;
  action: ModerationLogEntry['action'];
  target_kind: string | null;
  target_id: string | null;
  target_account: string | null;
  reason: string;
  excerpt: string;
};

let pulseChannelCount = 0;

const SUPABASE_STORE: ModerationStore = {
  async myRole(me) {
    const { data, error } = await client().from('moderators').select('user_id, is_owner').eq('user_id', me).maybeSingle();
    // Not a moderator reads nothing here (the table is the moderators' alone), which is the same answer as "no".
    if (error !== null || data === null) return { moderator: false, owner: false };
    return { moderator: true, owner: (data as { is_owner: boolean }).is_owner };
  },

  async myStanding() {
    const data = (await call('my_standing', {}, 'YOUR ACCOUNT COULD NOT BE READ.')) as { banned: boolean; reason: string; appeal_open: boolean }[] | null;
    const row = data?.[0];
    return { banned: row?.banned === true, reason: row?.reason ?? '', appealOpen: row?.appeal_open === true };
  },

  async listBlocks(me) {
    const { data, error } = await client().from('blocks').select('blocked').eq('blocker', me).limit(500);
    if (error !== null) throw new Error('YOUR BLOCKED LIST COULD NOT BE READ.');
    return ((data ?? []) as { blocked: string }[]).map((row) => row.blocked);
  },

  async block(_me, person) {
    await call('block_account', { person }, 'THEY COULD NOT BE BLOCKED.');
  },

  async unblock(_me, person) {
    await call('unblock_account', { person }, 'THEY COULD NOT BE UNBLOCKED.');
  },

  async fileReport(_me, input) {
    await call(
      'file_report',
      {
        person: input.accountId,
        why: input.reason,
        words: input.note,
        ctx_kind: input.context?.kind ?? null,
        ctx_id: input.context?.id ?? null,
      },
      'THE REPORT COULD NOT BE SENT.',
    );
  },

  async fileAppeal(_me, words) {
    await call('file_appeal', { words }, 'THE APPEAL COULD NOT BE SENT.');
  },

  async listReports(which) {
    let query = client().from('reports').select(REPORT_COLUMNS).order('created_at', { ascending: false }).limit(which === 'open' ? 200 : 100);
    query = which === 'open' ? query.eq('state', 'open') : query.neq('state', 'open');
    const { data, error } = await query;
    if (error !== null) throw new Error('THE REPORTS COULD NOT BE READ.');
    return ((data ?? []) as ReportRow[]).map(toReport);
  },

  async dismissReport(_me, reportId, why) {
    await call('dismiss_report', { report: reportId, why }, 'THE REPORT COULD NOT BE DISMISSED.');
  },

  async hide(_me, kind, id, why, reportId) {
    await call('moderate_hide', { kind, target: id, why, report: reportId ?? null }, 'IT COULD NOT BE HIDDEN.');
  },

  async unhide(_me, kind, id) {
    await call('moderate_unhide', { kind, target: id }, 'IT COULD NOT BE UNHIDDEN.');
  },

  async ban(_me, person, why, reportId) {
    await call('ban_account', { person, why, report: reportId ?? null }, 'THE BAN COULD NOT BE WRITTEN.');
  },

  async unban(_me, person, reportId) {
    await call('unban_account', { person, report: reportId ?? null }, 'THE BAN COULD NOT BE LIFTED.');
  },

  async listLog() {
    const { data, error } = await client()
      .from('moderation_log')
      .select('id, at, actor, action, target_kind, target_id, target_account, reason, excerpt')
      .order('at', { ascending: false })
      .limit(200);
    if (error !== null) throw new Error('THE LOG COULD NOT BE READ.');
    return ((data ?? []) as LogRow[]).map((row) => ({
      id: String(row.id),
      at: row.at,
      actorId: row.actor,
      action: row.action,
      targetKind: row.target_kind,
      targetId: row.target_id,
      targetAccountId: row.target_account,
      reason: row.reason,
      excerpt: row.excerpt,
    }));
  },

  async listModerators() {
    const { data, error } = await client().from('moderators').select('user_id, is_owner, added_at').order('added_at').limit(100);
    if (error !== null) throw new Error('THE MODERATORS COULD NOT BE READ.');
    return ((data ?? []) as { user_id: string; is_owner: boolean; added_at: string }[]).map(
      (row): ModeratorRow => ({ id: row.user_id, owner: row.is_owner, addedAt: row.added_at }),
    );
  },

  async addModerator(_me, person) {
    await call('add_moderator', { person }, 'THEY COULD NOT BE MADE A MODERATOR.');
  },

  async removeModerator(_me, person) {
    await call('remove_moderator', { person }, 'THEY COULD NOT BE TAKEN OFF.');
  },

  hiddenMarks() {
    return {};
  },

  subscribePulse(listener) {
    const found = getSupabaseBrowserClient();
    if (found === null) return () => undefined;
    // A name of its own per subscription: the same name hands back an already-subscribed channel (see the board's).
    pulseChannelCount += 1;
    const channel = found
      .channel(`moderation-pulse-${pulseChannelCount}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'moderation_pulse' }, () => listener())
      .subscribe();
    return () => {
      void found.removeChannel(channel);
    };
  },
};

export function getSupabaseModerationStore(): ModerationStore {
  return SUPABASE_STORE;
}
