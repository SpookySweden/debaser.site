/**
 * Moderation (SPEC-moderation.md, Luke 2026-11-20): report, block, hide.
 *
 * The database is the lock (supabase/migrations/20261120090000_moderation.sql): who is a moderator, what a hidden row or a blocked
 * person's row lets anybody read, who may block, report, appeal, hide or ban. This store only asks; both stores answer the same
 * questions, the mock one from this browser's storage for local testing.
 */

/** What a moderator can hide: a board post, a reply, a comment on a profile, a line of room chat. */
export type ModTargetKind = 'thread' | 'reply' | 'profile_comment' | 'room_line';

/** Where a report can start from: those four, or a message in COMMS (which a moderator can't hide, only read the copied line). */
export type ReportContextKind = ModTargetKind | 'message';

export type ReportReason = 'spam' | 'harassment' | 'nasty' | 'other';

export const REPORT_REASONS: readonly { id: ReportReason; label: string }[] = [
  { id: 'spam', label: 'SPAM' },
  { id: 'harassment', label: 'HARASSMENT' },
  { id: 'nasty', label: 'NASTY' },
  { id: 'other', label: 'OTHER' },
];

/** The longest note on a report or an appeal, and the longest reason on a hide or ban. The database holds the same caps. */
export const MODERATION_TEXT_MAX = 500;

/** A hidden row's mark, as its author and the moderators see it. Everybody else never receives the row. */
export type HiddenMark = { reason: string };

export type ReportContext = {
  kind: ReportContextKind;
  id: string;
  /** The line itself, copied by the database when the report was filed. */
  text: string;
  /** True when it came from a private room or a conversation: the moderator sees this line and nothing else of it. */
  private: boolean;
};

export type ModerationReport = {
  id: string;
  kind: 'report' | 'appeal';
  reporterId: string | null;
  accountId: string;
  reason: ReportReason | null;
  note: string;
  context: ReportContext | null;
  state: 'open' | 'dismissed' | 'acted';
  handledAt: string | null;
  createdAt: string;
};

export type ModerationAction = 'hide' | 'unhide' | 'remove' | 'ban' | 'unban' | 'dismiss' | 'moderator_added' | 'moderator_removed';

export type ModerationLogEntry = {
  id: string;
  at: string;
  actorId: string | null;
  action: ModerationAction;
  targetKind: string | null;
  targetId: string | null;
  targetAccountId: string | null;
  reason: string;
  excerpt: string;
};

export type ModeratorRow = { id: string; owner: boolean; addedAt: string };

export type ModerationRole = { moderator: boolean; owner: boolean };

/** A person's own standing: banned or not, the moderator's reason, and whether their appeal is still waiting. */
export type Standing = { banned: boolean; reason: string; appealOpen: boolean };

export const NO_ROLE: ModerationRole = { moderator: false, owner: false };
export const GOOD_STANDING: Standing = { banned: false, reason: '', appealOpen: false };

export type ReportInput = {
  accountId: string;
  reason: ReportReason;
  note: string;
  /** The line it was filed from. `text` is used by the mock store only: the real one copies the line itself. */
  context?: { kind: ReportContextKind; id: string; text: string; private?: boolean };
};

export type ModerationStore = {
  myRole(me: string): Promise<ModerationRole>;
  myStanding(me: string): Promise<Standing>;

  listBlocks(me: string): Promise<string[]>;
  block(me: string, person: string): Promise<void>;
  unblock(me: string, person: string): Promise<void>;

  fileReport(me: string, input: ReportInput): Promise<void>;
  fileAppeal(me: string, note: string): Promise<void>;

  listReports(which: 'open' | 'done'): Promise<ModerationReport[]>;
  dismissReport(me: string, reportId: string, why: string): Promise<void>;
  /** `about` is for the mock store's log only (the real one reads the row). */
  hide(me: string, kind: ModTargetKind, id: string, why: string, reportId?: string | null, about?: { authorId: string | null; text: string }): Promise<void>;
  unhide(me: string, kind: ModTargetKind, id: string): Promise<void>;
  ban(me: string, person: string, why: string, reportId?: string | null): Promise<void>;
  unban(me: string, person: string, reportId?: string | null): Promise<void>;

  listLog(): Promise<ModerationLogEntry[]>;
  listModerators(): Promise<ModeratorRow[]>;
  addModerator(me: string, person: string): Promise<void>;
  removeModerator(me: string, person: string): Promise<void>;

  /** The mock store's hidden rows (`kind:id`); the real store's rows carry their own mark, so it answers with none. */
  hiddenMarks(): Record<string, HiddenMark>;
  /** Told when a moderator hides or unhides something anywhere, so an open page can read again. */
  subscribePulse(listener: () => void): () => void;
};

export function hiddenKey(kind: ModTargetKind, id: string): string {
  return `${kind}:${id}`;
}

/** The database's refusals, in the site's own words. Never a database message. */
export function moderationError(message: string | undefined, fallback: string): Error {
  const text = (message ?? '').toLowerCase();
  if (text.includes('too many reports')) return new Error('TOO MANY REPORTS. TRY AGAIN IN AN HOUR.');
  if (text.includes('already reported')) return new Error('YOU HAVE ALREADY REPORTED THEM.');
  if (text.includes('already appealed')) return new Error('YOUR APPEAL IS ALREADY WAITING.');
  if (text.includes('too many blocks')) return new Error('YOU HAVE BLOCKED TOO MANY PEOPLE.');
  if (text.includes("moderator can't be banned")) return new Error("A MODERATOR CAN'T BE BANNED.");
  if (text.includes('give a reason')) return new Error('GIVE A REASON.');
  if (text.includes('write a few words')) return new Error('WRITE A FEW WORDS.');
  if (text.includes('pick a reason')) return new Error('PICK A REASON.');
  if (text.includes('not found')) return new Error('IT IS NOT THERE ANY MORE.');
  return new Error(fallback);
}
