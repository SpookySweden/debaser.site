import { CONCEPT_SHEETS } from '../concepts/sheets';
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
