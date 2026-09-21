import { makeUserTag, tagKey } from './tag-vocabulary';
import { readTagColours } from './tag-colours';
import type { ForumAnchor, ForumTag, TagKind } from './types';

/**
 * Rule based auto-tagging, themes only.
 *
 * A post's badges come from two places: the tags the poster picked in the
 * chooser, and the themes detected here from the text. The old housekeeping
 * badges - where a post was filed (`BOARD`, `ASSET_SRC`, `TEXT_BOX`) and how it
 * was written (`TEXT_ONLY`, `SHORT`, `LONG_READ`, `LINK`, `MEDIA`) - are
 * deprecated: the board already states the filing target in its own line and the
 * length of a post is obvious from looking at it. Rows written by older builds
 * still carry them, so `displayTags` strips them on the way to the screen.
 *
 * Keeping this pure and framework free also means the same rules can move to a
 * Postgres trigger / edge function when Supabase takes over.
 */

type TagRule = {
  id: string;
  label: string;
  pattern: RegExp;
};

/** Describes what the content is about. */
const CATEGORY_RULES: TagRule[] = [
  { id: 'cat-lore', label: 'LORE', pattern: /\blore\b|canon|mythos|backstory|archive/i },
  { id: 'cat-character', label: 'CHARACTER', pattern: /character|protagonist|antagonist|\bcast\b|silhouette/i },
  { id: 'cat-environment', label: 'ENVIRONMENT', pattern: /environment|landscape|architecture|\bmap\b|city/i },
  { id: 'cat-design', label: 'DESIGN', pattern: /design|concept|sheet|palette|sketch/i },
  { id: 'cat-continuity', label: 'CONTINUITY', pattern: /continuity|timeline|retcon|chapter|issue/i },
  { id: 'cat-mechanics', label: 'MECHANICS', pattern: /mechanic|\bstat\b|rules|system/i },
  { id: 'cat-theory', label: 'THEORY', pattern: /theory|headcanon|i think|maybe/i },
  { id: 'cat-question', label: 'QUESTION', pattern: /\?/ },
];

/** Worth warning about, so these stay. */
const CONTENT_RULES: TagRule[] = [
  { id: 'content-spoiler', label: 'SPOILER', pattern: /spoiler/i },
];

/** Badge ids retired from the board; hidden on rows written by older builds. */
const DEPRECATED_TAG_IDS = new Set([
  'content-link',
  'content-media',
  'content-text-only',
  'content-long-read',
  'content-short',
]);

const DEFAULT_MAX_TAGS = 6;

function toTag(id: string, kind: TagKind, label: string): ForumTag {
  return { id, kind, label };
}

function collect(rule: TagRule, kind: TagKind, haystack: string): ForumTag | null {
  return rule.pattern.test(haystack) ? toTag(rule.id, kind, rule.label) : null;
}

/** True for the retired housekeeping badges. */
export function isDeprecatedTag(tag: ForumTag): boolean {
  return tag.kind === 'source' || DEPRECATED_TAG_IDS.has(tag.id);
}

/** Tags as the board should show them: themes and spoilers, nothing else. */
export function displayTags(tags: ForumTag[]): ForumTag[] {
  return tags.filter((tag) => !isDeprecatedTag(tag));
}

export type DeriveTagsInput = {
  /** Title + body (or a single comment body) to scan. */
  text: string;
  /** Kept for call-site compatibility; the filing target is no longer a badge. */
  anchor?: ForumAnchor;
  maxTags?: number;
};

/** Derives the theme badges for a post: up to three categories, then content warnings. */
export function deriveTags({ text, maxTags = DEFAULT_MAX_TAGS }: DeriveTagsInput): ForumTag[] {
  const haystack = text.trim();

  const categoryTags = CATEGORY_RULES.map((rule) => collect(rule, 'category', haystack))
    .filter((tag): tag is ForumTag => tag !== null)
    .slice(0, 3);

  const contentTags = CONTENT_RULES.map((rule) => collect(rule, 'content', haystack)).filter(
    (tag): tag is ForumTag => tag !== null,
  );

  const ordered = [...categoryTags, ...contentTags];
  const seen = new Set<string>();
  const unique: ForumTag[] = [];

  for (const tag of ordered) {
    if (seen.has(tag.id)) continue;
    seen.add(tag.id);
    unique.push(tag);
  }

  return unique.slice(0, maxTags);
}

export const AUTO_TAG_NOTE = 'Theme tags are read from the post text; pick your own to add colour.';

/**
 * Combines the tags a poster picked with the automatic ones.
 *
 * Chosen tags come first (they are coloured badges), duplicates are dropped by
 * canonical key so picking LORE never doubles up with the derived LORE badge.
 */
export function mergeTags(
  userLabels: string[],
  autoTags: ForumTag[],
  chosenColours: Record<string, string> = readTagColours(),
): ForumTag[] {
  const merged: ForumTag[] = [];
  const seen = new Set<string>();

  for (const label of userLabels) {
    const colour = chosenColours[tagKey(label)];
    const tag = makeUserTag(label, colour);
    const key = tagKey(tag.label);
    if (key.length === 0 || seen.has(key)) continue;
    seen.add(key);
    merged.push(tag);
  }

  for (const tag of autoTags) {
    const key = tagKey(tag.label);
    if (key.length === 0 || seen.has(key)) continue;
    seen.add(key);
    // A colour chosen for this label wins on theme tags too, so the badge on a
    // post is painted exactly like the badge in the picker.
    const colour = tag.colour ?? chosenColours[key];
    merged.push(colour === undefined ? tag : { ...tag, colour });
  }

  return merged;
}

