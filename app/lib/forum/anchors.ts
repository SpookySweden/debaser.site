import { CONCEPT_SHEETS } from '../concepts/sheets';
import type { ProfileCommentKind } from '../profile/types';
import type { ForumAnchor, ForumPreview } from './types';

/**
 * Single source of truth for the items that can generate a forum thread.
 *
 * Every asset / text box in the site renders a `<CommentPopout anchor={...} />`
 * with one of these anchors (or one of the per-sheet anchors in
 * app/lib/concepts/sheets.ts), so a comment always files into the same thread
 * instead of spawning duplicates.
 */
export const FORUM_ANCHORS = {
  board: { kind: 'board', id: 'board-general', label: 'GENERAL BOARD', href: '/forum' },
  homeSummary: { kind: 'text-box', id: 'home-portal-summary', label: 'HOME // PORTAL ARCHIVE SUMMARY', href: '/' },
  homeQuickNav: { kind: 'text-box', id: 'home-quick-nav', label: 'HOME // QUICK NAVIGATION', href: '/' },
  conceptsSheetIndex: { kind: 'text-box', id: 'concepts-sheet-index', label: 'CONCEPT SHEET INDEX', href: '/concepts' },
  loreReader: { kind: 'asset', id: 'lore-reader', label: 'LORE READER', href: '/' },
} as const satisfies Record<string, ForumAnchor>;

export type ForumAnchorKey = keyof typeof FORUM_ANCHORS;

/** One entry in the "FILE UNDER" drop-down of the forum composer. */
export type ForumTarget = {
  key: string;
  anchor: ForumAnchor;
  /** Page the item sits on: used to subdivide the drop-down. */
  group: string;
};

/** The default filing target: an ordinary post on the board itself. */
export const BOARD_TARGET: ForumTarget = {
  key: 'board',
  group: 'FORUM BOARD',
  anchor: FORUM_ANCHORS.board,
};

/** Every item that lives on a page, in page order. */
export const PAGE_TARGETS: ForumTarget[] = [
  { key: 'homeSummary', group: 'HOME PAGE', anchor: FORUM_ANCHORS.homeSummary },
  { key: 'homeQuickNav', group: 'HOME PAGE', anchor: FORUM_ANCHORS.homeQuickNav },
  { key: 'conceptsSheetIndex', group: 'CONCEPT ARCHIVE', anchor: FORUM_ANCHORS.conceptsSheetIndex },
  ...CONCEPT_SHEETS.map((sheet) => ({
    key: sheet.id,
    group: 'CONCEPT ARCHIVE',
    anchor: sheet.anchor,
  })),
  { key: 'loreReader', group: 'LORE READER', anchor: FORUM_ANCHORS.loreReader },
];

/** Board first, then every page item. */
export const POST_TARGETS: ForumTarget[] = [BOARD_TARGET, ...PAGE_TARGETS];

/** PAGE_TARGETS folded into ordered sub-menus for the drop-down. */
export function postTargetGroups(): { group: string; targets: ForumTarget[] }[] {
  const groups: { group: string; targets: ForumTarget[] }[] = [];

  for (const target of PAGE_TARGETS) {
    const existing = groups.find((entry) => entry.group === target.group);

    if (existing === undefined) groups.push({ group: target.group, targets: [target] });
    else existing.targets.push(target);
  }

  return groups;
}

/**
 * The same destinations, folded into folders for the composer's file tree.
 *
 * A page is a folder and an item is a file in it, which is the shape a Windows file dialog has
 * and the reason the composer can offer forty destinations without a forty-line drop-down: the
 * board leads as its own folder, and everything else is one click open. `note` is the small grey
 * [ BOARD ] / [ ASSET ] / [ TEXT BOX ] tag beside a leaf, so the page an item lives on is not the
 * only thing that tells them apart.
 */
export function postTargetTree(): { label: string; items: { key: string; label: string; note?: string }[] }[] {
  const folder = (label: string, targets: ForumTarget[]) => ({
    label,
    items: targets.map((target) => ({
      key: target.key,
      label: target.anchor.label,
      note: target.anchor.kind,
    })),
  });

  return [folder(BOARD_TARGET.group, [BOARD_TARGET]), ...postTargetGroups().map((entry) => folder(entry.group, entry.targets))];
}

export function threadDomId(threadId: string): string {
  return `thread-${threadId}`;
}

/**
 * A profile is a board anchor too.
 *
 * Everything on this site that can be commented on files into one thread per subject, and a profile
 * is commentable in three places: the profile itself, one of its pictures, and the track beside the
 * picture. Each of those is its own subject - a remark on somebody's drawing is not a remark on
 * their page - so each is its own thread, and the anchor id says which one, including *which
 * version* of a picture or track it was written against (a new drawing is a new thread, and the
 * comments on the old one never silently re-point at it).
 *
 * The comment itself lives in the profile store, where the owner's comments switch and a pinned
 * remark already work; these anchors are what lets the board read the same comments as threads and
 * file an answer back (see app/lib/forum/profile-threads.ts and ForumProvider.addProfileComment).
 */
export type ProfileAnchorTarget = {
  userId: string;
  /** Which of the three: the page itself, the picture, or the track. */
  kind: ProfileCommentKind;
  /** Picture and track comments only: the version they were written against. */
  versionId?: string;
  /** The version's own number, for the label: `PICTURE v3 // SWEDEN`. */
  versionNumber?: number;
  /** Whose page it is, as the label spells it. */
  displayName: string;
};

/** The stable id of the thread for that subject: `profile:<user>[:<aspect>[:<version>]]`. */
export function profileAnchorId(target: ProfileAnchorTarget): string {
  if (target.kind === 'profile') return `profile:${target.userId}`;

  const aspect = target.kind === 'avatar' ? 'picture' : 'track';

  // A comment from before pictures carried versions still belongs to the picture, not to the page:
  // it files under `profile:<user>:<aspect>`, which is a thread of its own.
  return target.versionId === undefined
    ? `profile:${target.userId}:${aspect}`
    : `profile:${target.userId}:${aspect}:${target.versionId}`;
}

/** What the thread is called on the board: the subject first, then whose page it is. */
export function profileAnchorLabel(target: ProfileAnchorTarget): string {
  const name = target.displayName.trim().length === 0 ? 'AN ACCOUNT' : target.displayName.toUpperCase();

  if (target.kind === 'profile') return `PROFILE // ${name}`;

  const aspect = target.kind === 'avatar' ? 'PICTURE' : 'TRACK';
  const version = target.versionNumber === undefined ? '' : ` v${target.versionNumber}`;

  return `${aspect}${version} // ${name}`;
}

/** The anchor the board files that subject under. */
export function profileAnchor(target: ProfileAnchorTarget): ForumAnchor {
  return {
    kind: 'profile',
    id: profileAnchorId(target),
    label: profileAnchorLabel(target),
    href: `/profile/${encodeURIComponent(target.userId)}`,
  };
}

/**
 * The subject an anchor was built from, so a reply knows what to write and where.
 *
 * Null for anything that is not a profile anchor, which is what every caller asks first: an answer
 * on a profile thread is filed as a profile comment (in the profile store), and an answer anywhere
 * else is a board comment.
 */
export function profileAnchorTarget(anchor: ForumAnchor): Omit<ProfileAnchorTarget, 'displayName'> | null {
  if (anchor.kind !== 'profile') return null;

  const parts = anchor.id.split(':');
  const userId = parts[1];
  if (userId === undefined || userId.length === 0) return null;

  const aspect = parts[2];
  const versionId = parts.slice(3).join(':');

  if (aspect === 'picture') return { userId, kind: 'avatar', ...(versionId.length === 0 ? {} : { versionId }) };
  if (aspect === 'track') return { userId, kind: 'song', ...(versionId.length === 0 ? {} : { versionId }) };

  return { userId, kind: 'profile' };
}
/**
 * DOM id of one reply, so a post can be opened straight onto the reply somebody came for.
 *
 * That is what the board does when a tag filter matched a reply rather than the post itself: a
 * marker on a folded post with the reply three folds further in is not much of an answer.
 */
export function commentDomId(commentId: string): string {
  return `comment-${commentId}`;
}

/** Title used when a comment left under an asset/text box opens a new thread. */
export function autoThreadTitle(anchor: ForumAnchor): string {
  return `RE: ${anchor.label}`;
}

/**
 * Auto-filed threads carry no body text: instead of a filler line the UI links
 * straight back to the item that was commented on.
 */
export const AUTO_FILED_BODY = '';

/** Body written by an earlier build; still recognised so old posts link back too. */
export const LEGACY_AUTO_FILED_BODY = 'Auto-filed from a site comment box.';

export function isAutoFiledBody(body: string): boolean {
  const trimmed = body.trim();
  return trimmed.length === 0 || trimmed === LEGACY_AUTO_FILED_BODY;
}

/** Fallback destinations when an anchor row predates the link fields. */
const KIND_DEFAULT_HREF: Record<ForumAnchor['kind'], string> = {
  board: '/forum',
  asset: '/concepts',
  'text-box': '/',
  // A profile anchor always carries its own href (`profileAnchor` builds it); this is the fallback
  // for a row written by hand, and the directory is where an account is looked up.
  profile: '/users',
};

export function allKnownAnchors(): ForumAnchor[] {
  return [...Object.values(FORUM_ANCHORS), ...CONCEPT_SHEETS.map((sheet) => sheet.anchor)];
}

/**
 * Resolves where a thread's item lives and what it looks like.
 *
 * Anchors are stored with each post, so this also fills in the link and preview
 * for rows that came back from storage without them.
 */
export function resolveAnchorTarget(anchor: ForumAnchor): {
  href: string;
  preview: ForumPreview | undefined;
} {
  const known = allKnownAnchors().find(
    (candidate) => candidate.kind === anchor.kind && candidate.id === anchor.id,
  );

  return {
    href: anchor.href ?? known?.href ?? KIND_DEFAULT_HREF[anchor.kind],
    preview: anchor.preview ?? known?.preview,
  };
}
