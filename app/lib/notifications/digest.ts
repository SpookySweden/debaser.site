import { notificationLine } from './feed';
import { notificationHref } from './links';
import { switchFor, type KindSwitch } from './prefs';
import { isNotificationKind, type AppNotification } from './types';

/**
 * The weekly email (SPEC-notifications.md, phase 2; answers 6A 7A 8A 9A 10A), as plain functions so a check can hold
 * every rule: when it goes, what is in it, and what never is.
 *
 * - When (7A): Sunday 18:00 UK time. If the PC is off then, any hour up to Monday 18:00 sends it; then the week is skipped.
 * - What (8A): only unread things, kinds whose switch is on (the database already picks those), up to 5 lines a kind with
 *   `AND 4 MORE`, each a link to the site. Names, titles and letter names only: never a notification's words.
 * - A week with nothing waiting sends nothing.
 * - Every email carries the one-click unsubscribe (10A), as a link and as the standard headers.
 */

export const SITE = 'https://debaser.site';
export const DIGEST_FROM = 'DEBASER_OS <post@debaser.site>';
export const DIGEST_SUBJECT = 'DEBASER_OS :: YOUR WEEK';
const SEND_HOUR = 18;
const LINES_PER_KIND = 5;

/** The UK wall clock for an instant: weekday (0 Sunday), date and hour. */
function londonParts(at: Date): { weekday: number; year: number; month: number; day: number; hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(at);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  return {
    weekday: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(get('weekday')),
    year: Number(get('year')),
    month: Number(get('month')),
    day: Number(get('day')),
    hour: Number(get('hour')),
    minute: Number(get('minute')),
  };
}

/** The instant a UK wall-clock time falls on (GMT in winter, BST in summer). */
function londonInstant(year: number, month: number, day: number, hour: number): Date {
  // Guess UTC, then correct by the difference the guess shows on the UK clock (at most an hour, so one step is enough).
  const guess = new Date(Date.UTC(year, month - 1, day, hour));
  const seen = londonParts(guess);
  const drift = Date.UTC(seen.year, seen.month - 1, seen.day, seen.hour, seen.minute) - guess.getTime();
  return new Date(guess.getTime() - drift);
}

/**
 * This week's send window: from Sunday 18:00 UK time for 24 hours. Null outside it, so a timer firing at any other hour
 * sends nothing. `weekStart` is what the database compares each person's last email against.
 */
export function digestWindow(now: Date): { weekStart: Date } | null {
  const local = londonParts(now);
  const back = local.weekday === 0 ? 0 : local.weekday === 1 ? 1 : -1;
  if (back < 0) return null;
  const sunday = new Date(Date.UTC(local.year, local.month - 1, local.day - back));
  const weekStart = londonInstant(sunday.getUTCFullYear(), sunday.getUTCMonth() + 1, sunday.getUTCDate(), SEND_HOUR);
  const elapsed = now.getTime() - weekStart.getTime();
  return elapsed >= 0 && elapsed < 24 * 60 * 60 * 1000 ? { weekStart } : null;
}

/** One row as `notify_digest_due` hands it over. */
export type DigestRow = {
  person: string;
  email: string;
  unsubscribe_code: string;
  kind: string;
  actor_name: string;
  thread_title: string;
  thread_id: string | null;
  recommendation_id: string | null;
  invite_id: string | null;
  room_id: string | null;
  href: string | null;
  created_at: string;
  kind_total: number;
};

export type DigestSection = { label: string; lines: { text: string; url: string }[]; more: number };
export type Digest = { person: string; email: string; unsubscribeCode: string; unsubscribeUrl: string; sections: DigestSection[] };

const SECTION_ORDER: readonly { key: KindSwitch; label: string }[] = [
  { key: 'replies', label: 'REPLIES AND TAGS' },
  { key: 'letters', label: 'LETTERS' },
  { key: 'live', label: 'ROOMS THAT WENT LIVE' },
  { key: 'comic', label: 'COMIC' },
  { key: 'invites', label: 'GAME INVITES' },
];

export function unsubscribeUrl(code: string): string {
  return `${SITE}/unsubscribe?t=${encodeURIComponent(code)}`;
}

/** The database's rows, one email per person; a person with nothing waiting gets none. */
export function buildDigests(rows: readonly DigestRow[]): Digest[] {
  const byPerson = new Map<string, DigestRow[]>();
  for (const row of rows) {
    if (!isNotificationKind(row.kind) || !row.email) continue;
    byPerson.set(row.person, [...(byPerson.get(row.person) ?? []), row]);
  }

  const digests: Digest[] = [];
  for (const [person, own] of byPerson) {
    const sections: DigestSection[] = [];
    for (const { key, label } of SECTION_ORDER) {
      const mine = own.filter((row) => switchFor(row.kind as AppNotification['kind']) === key);
      if (mine.length === 0) continue;
      // Totals per kind, added across the kinds that share a switch (a reply and a tag are one section).
      const totals = new Map<string, number>();
      for (const row of mine) totals.set(row.kind, Math.max(totals.get(row.kind) ?? 0, row.kind_total));
      const total = [...totals.values()].reduce((sum, count) => sum + count, 0);
      const shown = [...mine].sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, LINES_PER_KIND);
      sections.push({
        label,
        lines: shown.map((row) => {
          const item = asNotification(row);
          return { text: notificationLine(item), url: `${SITE}${notificationHref(item) ?? '/forum'}` };
        }),
        more: Math.max(0, total - shown.length),
      });
    }
    if (sections.length === 0) continue;
    digests.push({ person, email: own[0].email, unsubscribeCode: own[0].unsubscribe_code, unsubscribeUrl: unsubscribeUrl(own[0].unsubscribe_code), sections });
  }
  return digests;
}

/** A row as a notification for the shared line and address rules. Its words are never asked for. */
function asNotification(row: DigestRow): AppNotification {
  return {
    id: `${row.person}:${row.created_at}`,
    userId: row.person,
    kind: row.kind as AppNotification['kind'],
    actorId: null,
    actorName: row.actor_name,
    threadId: row.thread_id,
    threadTitle: row.thread_title,
    body: '',
    gameId: null,
    inviteId: row.invite_id,
    recommendationId: row.recommendation_id,
    href: row.href,
    roomId: row.room_id,
    createdAt: row.created_at,
    readAt: null,
  };
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/**
 * The email itself: a plain-text copy and an HTML copy that is the same text in a `<pre>` (every mail app shows it in a
 * fixed-width face, black on white), each line a link. No pictures, no colours, nothing that needs loading.
 */
export function renderDigest(digest: Digest): { subject: string; text: string; html: string; headers: Record<string, string> } {
  const textLines: string[] = ['DEBASER_OS :: WHAT WAITED FOR YOU THIS WEEK', ''];
  const htmlLines: string[] = [escapeHtml('DEBASER_OS :: WHAT WAITED FOR YOU THIS WEEK'), ''];
  for (const section of digest.sections) {
    textLines.push(`--- ${section.label} ---`);
    htmlLines.push(escapeHtml(`--- ${section.label} ---`));
    for (const line of section.lines) {
      textLines.push(`${line.text}`, `  ${line.url}`);
      htmlLines.push(`<a href="${escapeHtml(line.url)}">${escapeHtml(line.text)}</a>`);
    }
    if (section.more > 0) {
      textLines.push(`AND ${section.more} MORE`);
      htmlLines.push(escapeHtml(`AND ${section.more} MORE`));
    }
    textLines.push('');
    htmlLines.push('');
  }
  textLines.push(`OPEN THE SITE: ${SITE}/forum`, `TURN OFF WEEKLY EMAIL: ${digest.unsubscribeUrl}`);
  htmlLines.push(
    `<a href="${SITE}/forum">[ OPEN DEBASER_OS ]</a>`,
    `<a href="${escapeHtml(digest.unsubscribeUrl)}">[ TURN OFF WEEKLY EMAIL ]</a>`,
    escapeHtml('WHICH KINDS COME: PREFERENCES > NOTIFICATIONS, ON THE SITE.'),
  );

  return {
    subject: DIGEST_SUBJECT,
    text: textLines.join('\n'),
    html: `<!doctype html><html><body><pre>${htmlLines.join('\n')}</pre></body></html>`,
    // The standard one-click unsubscribe (RFC 8058): Gmail's and Outlook's own button posts to it.
    headers: {
      'List-Unsubscribe': `<${SITE}/api/notify/unsubscribe?t=${encodeURIComponent(digest.unsubscribeCode)}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    },
  };
}
