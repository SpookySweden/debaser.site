import type { ForumAnchor, ForumTag, TagKind } from './types';

/**
 * Rule based auto-tagging. Every post (and reply) gets its badges from here -
 * tags are never hand written in the UI, so new posts are categorised the
 * moment they are filed.
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

const CONTENT_RULES: TagRule[] = [
  { id: 'content-spoiler', label: 'SPOILER', pattern: /spoiler/i },
];

const LINK_PATTERN = /https?:\/\//i;
const MEDIA_PATTERN = /\.(png|jpe?g|gif|webp|avif)\b|image|artwork|screenshot/i;

const LONG_READ_LENGTH = 480;
const SHORT_POST_LENGTH = 96;

const SOURCE_LABELS: Record<ForumAnchor['kind'], string> = {
  board: 'BOARD',
  asset: 'ASSET_SRC',
  'text-box': 'TEXT_BOX',
};

const DEFAULT_MAX_TAGS = 6;

function toTag(id: string, kind: TagKind, label: string): ForumTag {
  return { id, kind, label };
}

function collect(rule: TagRule, kind: TagKind, haystack: string): ForumTag | null {
  return rule.pattern.test(haystack) ? toTag(rule.id, kind, rule.label) : null;
}

export type DeriveTagsInput = {
  /** Title + body (or a single comment body) to scan. */
  text: string;
  /** Anchor the post is attached to, used for the source badge. */
  anchor?: ForumAnchor;
  maxTags?: number;
};

/**
 * Derives the full badge set for a post: one source badge, up to three
 * category badges, then content descriptors, capped by `maxTags`.
 */
export function deriveTags({ text, anchor, maxTags = DEFAULT_MAX_TAGS }: DeriveTagsInput): ForumTag[] {
  const haystack = text.trim();

  const sourceTags: ForumTag[] = anchor
    ? [toTag(`src-${anchor.kind}`, 'source', SOURCE_LABELS[anchor.kind])]
    : [];

  const categoryTags = CATEGORY_RULES.map((rule) => collect(rule, 'category', haystack))
    .filter((tag): tag is ForumTag => tag !== null)
    .slice(0, 3);

  const contentTags: ForumTag[] = [];
  const hasLink = LINK_PATTERN.test(haystack);
  const hasMedia = MEDIA_PATTERN.test(haystack);

  if (hasLink) contentTags.push(toTag('content-link', 'content', 'LINK'));
  if (hasMedia) contentTags.push(toTag('content-media', 'content', 'MEDIA'));
  if (!hasLink && !hasMedia) contentTags.push(toTag('content-text-only', 'content', 'TEXT_ONLY'));
  if (haystack.length >= LONG_READ_LENGTH) contentTags.push(toTag('content-long-read', 'content', 'LONG_READ'));
  if (haystack.length > 0 && haystack.length < SHORT_POST_LENGTH) {
    contentTags.push(toTag('content-short', 'content', 'SHORT'));
  }
  contentTags.push(
    ...CONTENT_RULES.map((rule) => collect(rule, 'content', haystack)).filter(
      (tag): tag is ForumTag => tag !== null,
    ),
  );

  const ordered = [...sourceTags, ...categoryTags, ...contentTags];
  const seen = new Set<string>();
  const unique: ForumTag[] = [];

  for (const tag of ordered) {
    if (seen.has(tag.id)) continue;
    seen.add(tag.id);
    unique.push(tag);
  }

  return unique.slice(0, maxTags);
}

export const AUTO_TAG_NOTE = 'Tags are generated automatically from the post text and the asset it is attached to.';
