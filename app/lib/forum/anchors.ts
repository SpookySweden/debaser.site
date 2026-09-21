import type { ForumAnchor } from './types';

/**
 * Single source of truth for the boxes that can generate a forum thread.
 *
 * Every site asset / text box renders `<AssetCommentBox anchor={...} />` with
 * one of these constants, so a comment left under an asset always files into
 * the same thread on the board instead of creating duplicates.
 */
export const FORUM_ANCHORS = {
  board: { kind: 'board', id: 'board-general', label: 'GENERAL BOARD' },
  homeSummary: { kind: 'text-box', id: 'home-portal-summary', label: 'HOME // PORTAL ARCHIVE SUMMARY' },
  homeQuickNav: { kind: 'text-box', id: 'home-quick-nav', label: 'HOME // QUICK NAVIGATION' },
  conceptsViewer: { kind: 'asset', id: 'concepts-viewer', label: 'CONCEPT ART VIEWER' },
  conceptsSheetIndex: { kind: 'text-box', id: 'concepts-sheet-index', label: 'CONCEPT SHEET INDEX' },
  loreReader: { kind: 'asset', id: 'lore-reader', label: 'LORE READER' },
} as const satisfies Record<string, ForumAnchor>;

export type ForumAnchorKey = keyof typeof FORUM_ANCHORS;

/** Drop-down options for the forum "New Post" composer. */
export const POST_TARGETS: { key: ForumAnchorKey; anchor: ForumAnchor }[] = [
  { key: 'board', anchor: FORUM_ANCHORS.board },
  { key: 'homeSummary', anchor: FORUM_ANCHORS.homeSummary },
  { key: 'homeQuickNav', anchor: FORUM_ANCHORS.homeQuickNav },
  { key: 'conceptsViewer', anchor: FORUM_ANCHORS.conceptsViewer },
  { key: 'conceptsSheetIndex', anchor: FORUM_ANCHORS.conceptsSheetIndex },
  { key: 'loreReader', anchor: FORUM_ANCHORS.loreReader },
];

export function threadDomId(threadId: string): string {
  return `thread-${threadId}`;
}

/** Title used when a comment left under an asset/text box opens a new thread. */
export function autoThreadTitle(anchor: ForumAnchor): string {
  return `RE: ${anchor.label}`;
}

/** Body used for those auto-filed threads, so they read as system-generated. */
export const AUTO_FILED_BODY = 'Auto-filed from a site comment box.';
