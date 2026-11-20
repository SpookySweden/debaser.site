import { getMockAuthRepository, locallyBannedAccountIds } from '../auth/mock-auth';
import { SITE_ACCOUNT_ID } from '../auth/builtin-account';
import {
  hiddenKey,
  MODERATION_TEXT_MAX,
  type HiddenMark,
  type ModerationAction,
  type ModerationLogEntry,
  type ModerationReport,
  type ModerationStore,
  type ModeratorRow,
  type ModTargetKind,
} from './types';

/**
 * The mock moderation store: this browser's storage, like every other mock repository, so local drives can see each side.
 * The mock house account is the owner moderator here (the live site's first moderator is Luke's own account). It keeps the
 * database's rules where a drive would notice them (one open report per person, one open appeal, owner-only moderator list).
 */

export const MOCK_MODERATION_KEY = 'debaser.moderation.mock.v1';

type MockState = {
  moderators: ModeratorRow[];
  blocks: Record<string, string[]>;
  reports: ModerationReport[];
  log: ModerationLogEntry[];
  hidden: Record<string, HiddenMark & { authorId: string | null }>;
  banReasons: Record<string, string>;
};

const listeners = new Set<() => void>();

function initial(): MockState {
  return {
    moderators: [{ id: SITE_ACCOUNT_ID, owner: true, addedAt: new Date(0).toISOString() }],
    blocks: {},
    reports: [],
    log: [],
    hidden: {},
    banReasons: {},
  };
}

function readState(): MockState {
  if (typeof window === 'undefined') return initial();
  try {
    const parsed = JSON.parse(window.localStorage.getItem(MOCK_MODERATION_KEY) ?? 'null') as Partial<MockState> | null;
    if (parsed === null || typeof parsed !== 'object') return initial();
    const base = initial();
    return {
      moderators: Array.isArray(parsed.moderators) && parsed.moderators.length > 0 ? parsed.moderators : base.moderators,
      blocks: parsed.blocks ?? {},
      reports: Array.isArray(parsed.reports) ? parsed.reports : [],
      log: Array.isArray(parsed.log) ? parsed.log : [],
      hidden: parsed.hidden ?? {},
      banReasons: parsed.banReasons ?? {},
    };
  } catch {
    return initial();
  }
}

function writeState(next: MockState): void {
  window.localStorage.setItem(MOCK_MODERATION_KEY, JSON.stringify(next));
}

function newId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
}

function note(state: MockState, actor: string, action: ModerationAction, targetKind: string, targetId: string, person: string | null, reason = '', excerpt = ''): void {
  state.log.unshift({
    id: newId(),
    at: new Date().toISOString(),
    actorId: actor,
    action,
    targetKind,
    targetId,
    targetAccountId: person,
    reason: reason.slice(0, MODERATION_TEXT_MAX),
    excerpt: excerpt.slice(0, 300),
  });
}

function isModerator(state: MockState, person: string): boolean {
  return state.moderators.some((row) => row.id === person);
}

function mustModerate(state: MockState, me: string): void {
  if (!isModerator(state, me)) throw new Error('ONLY A MODERATOR CAN DO THAT.');
}

function closeReport(state: MockState, reportId: string | null | undefined, outcome: 'acted' | 'dismissed'): void {
  if (!reportId) return;
  const report = state.reports.find((row) => row.id === reportId && row.state === 'open');
  if (report === undefined) return;
  report.state = outcome;
  report.handledAt = new Date().toISOString();
}

function pulse(): void {
  for (const listener of listeners) listener();
}

const MOCK_STORE: ModerationStore = {
  async myRole(me) {
    const row = readState().moderators.find((entry) => entry.id === me);
    return { moderator: row !== undefined, owner: row?.owner === true };
  },

  async myStanding(me) {
    const state = readState();
    const banned = locallyBannedAccountIds().includes(me);
    return {
      banned,
      reason: banned ? (state.banReasons[me] ?? '') : '',
      appealOpen: state.reports.some((row) => row.kind === 'appeal' && row.accountId === me && row.state === 'open'),
    };
  },

  async listBlocks(me) {
    return [...(readState().blocks[me] ?? [])];
  },

  async block(me, person) {
    if (me === person) throw new Error("YOU CAN'T BLOCK YOURSELF.");
    const state = readState();
    const mine = state.blocks[me] ?? [];
    if (!mine.includes(person)) state.blocks[me] = [...mine, person];
    writeState(state);
  },

  async unblock(me, person) {
    const state = readState();
    state.blocks[me] = (state.blocks[me] ?? []).filter((id) => id !== person);
    writeState(state);
  },

  async fileReport(me, input) {
    const state = readState();
    if (input.accountId === me) throw new Error("YOU CAN'T REPORT YOURSELF.");
    if (state.reports.some((row) => row.kind === 'report' && row.reporterId === me && row.accountId === input.accountId && row.state === 'open')) {
      throw new Error('YOU HAVE ALREADY REPORTED THEM.');
    }
    const hourAgo = Date.now() - 60 * 60 * 1000;
    if (state.reports.filter((row) => row.reporterId === me && Date.parse(row.createdAt) > hourAgo).length >= 10) {
      throw new Error('TOO MANY REPORTS. TRY AGAIN IN AN HOUR.');
    }
    state.reports.unshift({
      id: newId(),
      kind: 'report',
      reporterId: me,
      accountId: input.accountId,
      reason: input.reason,
      note: input.note.slice(0, MODERATION_TEXT_MAX),
      context: input.context
        ? { kind: input.context.kind, id: input.context.id, text: input.context.text.slice(0, 1000), private: input.context.private === true }
        : null,
      state: 'open',
      handledAt: null,
      createdAt: new Date().toISOString(),
    });
    writeState(state);
  },

  async fileAppeal(me, words) {
    const state = readState();
    if (!locallyBannedAccountIds().includes(me)) throw new Error('ONLY A BANNED ACCOUNT CAN APPEAL.');
    if (words.trim().length === 0) throw new Error('WRITE A FEW WORDS.');
    if (state.reports.some((row) => row.kind === 'appeal' && row.accountId === me && row.state === 'open')) {
      throw new Error('YOUR APPEAL IS ALREADY WAITING.');
    }
    state.reports.unshift({
      id: newId(),
      kind: 'appeal',
      reporterId: me,
      accountId: me,
      reason: null,
      note: words.slice(0, MODERATION_TEXT_MAX),
      context: null,
      state: 'open',
      handledAt: null,
      createdAt: new Date().toISOString(),
    });
    writeState(state);
  },

  async listReports(which) {
    const rows = readState().reports;
    return which === 'open' ? rows.filter((row) => row.state === 'open') : rows.filter((row) => row.state !== 'open').slice(0, 100);
  },

  async dismissReport(me, reportId, why) {
    const state = readState();
    mustModerate(state, me);
    const report = state.reports.find((row) => row.id === reportId && row.state === 'open');
    if (report === undefined) throw new Error('IT IS NOT THERE ANY MORE.');
    closeReport(state, reportId, 'dismissed');
    note(state, me, 'dismiss', 'report', reportId, report.accountId, why);
    writeState(state);
  },

  async hide(me, kind, id, why, reportId, about) {
    const state = readState();
    mustModerate(state, me);
    state.hidden[hiddenKey(kind, id)] = { reason: why.slice(0, MODERATION_TEXT_MAX), authorId: about?.authorId ?? null };
    note(state, me, 'hide', kind, id, about?.authorId ?? null, why, about?.text ?? '');
    closeReport(state, reportId, 'acted');
    writeState(state);
    pulse();
  },

  async unhide(me, kind, id) {
    const state = readState();
    mustModerate(state, me);
    const mark = state.hidden[hiddenKey(kind, id)];
    delete state.hidden[hiddenKey(kind, id)];
    note(state, me, 'unhide', kind, id, mark?.authorId ?? null);
    writeState(state);
    pulse();
  },

  async ban(me, person, why, reportId) {
    const state = readState();
    mustModerate(state, me);
    if (isModerator(state, person) || person === me) throw new Error("A MODERATOR CAN'T BE BANNED.");
    if (why.trim().length === 0) throw new Error('GIVE A REASON.');
    await getMockAuthRepository().banAccount?.(person, why);
    const after = readState();
    after.banReasons[person] = why.slice(0, MODERATION_TEXT_MAX);
    note(after, me, 'ban', 'account', person, person, why);
    closeReport(after, reportId, 'acted');
    writeState(after);
  },

  async unban(me, person, reportId) {
    const state = readState();
    mustModerate(state, me);
    await getMockAuthRepository().unbanAccount?.(person);
    const after = readState();
    delete after.banReasons[person];
    note(after, me, 'unban', 'account', person, person);
    closeReport(after, reportId, 'acted');
    for (const row of after.reports) {
      if (row.kind === 'appeal' && row.accountId === person && row.state === 'open') {
        row.state = 'acted';
        row.handledAt = new Date().toISOString();
      }
    }
    writeState(after);
  },

  async listLog() {
    return readState().log.slice(0, 200);
  },

  async listModerators() {
    return readState().moderators;
  },

  async addModerator(me, person) {
    const state = readState();
    if (!state.moderators.some((row) => row.id === me && row.owner)) throw new Error('ONLY THE OWNER CAN ADD A MODERATOR.');
    if (!isModerator(state, person)) state.moderators.push({ id: person, owner: false, addedAt: new Date().toISOString() });
    note(state, me, 'moderator_added', 'account', person, person);
    writeState(state);
  },

  async removeModerator(me, person) {
    const state = readState();
    if (!state.moderators.some((row) => row.id === me && row.owner)) throw new Error('ONLY THE OWNER CAN TAKE A MODERATOR OFF.');
    state.moderators = state.moderators.filter((row) => row.id !== person || row.owner);
    note(state, me, 'moderator_removed', 'account', person, person);
    writeState(state);
  },

  hiddenMarks() {
    const out: Record<string, HiddenMark> = {};
    for (const [key, mark] of Object.entries(readState().hidden)) out[key] = { reason: mark.reason };
    return out;
  },

  subscribePulse(listener) {
    listeners.add(listener);
    const onStorage = (event: StorageEvent) => {
      if (event.key === MOCK_MODERATION_KEY) listener();
    };
    window.addEventListener('storage', onStorage);
    return () => {
      listeners.delete(listener);
      window.removeEventListener('storage', onStorage);
    };
  },
};

export function getMockModerationStore(): ModerationStore {
  return MOCK_STORE;
}

/** Whether a hidden kind is one the mock keeps (for the drive's seed). */
export function isModTargetKind(value: string): value is ModTargetKind {
  return value === 'thread' || value === 'reply' || value === 'profile_comment' || value === 'room_line';
}
