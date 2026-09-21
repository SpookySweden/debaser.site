import type { ForumTag, ForumThread } from './types';

/**
 * User tag vocabulary.
 *
 * Tags typed by posters are canonicalised (casing, spacing, punctuation,
 * plurals and single-character typos collapse onto one tag), then given a
 * colour derived from a hash of that canonical key - so the same tag, or a
 * decidedly similar spelling of it, always comes out the same colour.
 *
 * The options offered by the chooser are the starter list below plus every tag
 * already in use on the board, ranked by how many posts carry it.
 */

export type TagOption = {
  /** Display label, e.g. `WORLD BUILDING`. */
  label: string;
  /** Canonical key used for colour, filtering and similar-tag matching. */
  key: string;
  /** How many posts/replies on the board carry this tag. */
  count: number;
  /** True for one of the pre-made starter tags. */
  starter: boolean;
  /** Colour chosen in the picker, when the tag has one. */
  colour?: string;
};

/** Pre-made tags that ship with the archive. */
export const STARTER_TAGS: string[] = [
  'LORE',
  'CHARACTER',
  'ENVIRONMENT',
  'DESIGN',
  'PALETTE',
  'LINEART',
  'CONTINUITY',
  'MECHANICS',
  'THEORY',
  'QUESTION',
  'FEEDBACK',
  'SPOILER',
];

const MAX_TAG_LENGTH = 24;

/** Casing, separators, punctuation and spacing are all flattened here. */
export function normaliseTagLabel(raw: string): string {
  return raw
    .replace(/[_\-/]+/g, ' ')
    .replace(/[^A-Za-z0-9 ]+/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase()
    .slice(0, MAX_TAG_LENGTH)
    .trim();
}

export function tagKey(raw: string): string {
  return normaliseTagLabel(raw).toLowerCase().replace(/\s+/g, '-');
}

function stem(key: string): string {
  return key.length > 3 && key.endsWith('s') ? key.slice(0, -1) : key;
}

function levenshtein(a: string, b: string): number {
  const rows = a.length + 1;
  const columns = b.length + 1;
  let previous = Array.from({ length: columns }, (_unused, index) => index);

  for (let row = 1; row < rows; row += 1) {
    const current = [row];
    for (let column = 1; column < columns; column += 1) {
      const substitution = previous[column - 1] + (a[row - 1] === b[column - 1] ? 0 : 1);
      current[column] = Math.min(previous[column] + 1, current[column - 1] + 1, substitution);
    }
    previous = current;
  }

  return previous[columns - 1];
}

/** True when two labels are decidedly the same tag. */
export function tagsAreSimilar(a: string, b: string): boolean {
  const keyA = tagKey(a);
  const keyB = tagKey(b);

  if (keyA.length === 0 || keyB.length === 0) return keyA === keyB;
  if (keyA === keyB) return true;
  if (stem(keyA) === stem(keyB)) return true;
  if (keyA.length >= 5 && keyB.length >= 5) return levenshtein(keyA, keyB) <= 1;

  return false;
}

/** Reuses an existing label whenever the new one is decidedly similar to it. */
export function canonicalTagLabel(raw: string, existing: string[]): string {
  const label = normaliseTagLabel(raw);
  const match = existing.find((candidate) => tagsAreSimilar(label, candidate));
  return match === undefined ? label : normaliseTagLabel(match);
}

/**
 * CRT pastel swatch palette: the 16 colours the tag picker offers, and the set
 * the automatic fallback colour is hashed into.
 *
 * All sixteen are light enough to read black lettering on (see TagBadge).
 */
export const CRT_PASTEL_PALETTE = [
  '#ffb3ba',
  '#ffd7b5',
  '#ffefb5',
  '#d9f7b0',
  '#b5f7c8',
  '#b5f0e8',
  '#b7e2ff',
  '#c3cbff',
  '#d9bfff',
  '#f0bfff',
  '#ffbfe4',
  '#ffd0d9',
  '#ffc9b5',
  '#d8e8b5',
  '#bfe8d8',
  '#e6e0ff',
];

/** Back-compat alias: the palette is also the automatic colour source. */
export const TAG_PALETTE = CRT_PASTEL_PALETTE;

function hashKey(key: string): number {
  let hash = 2166136261;

  for (let index = 0; index < key.length; index += 1) {
    hash ^= key.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return hash >>> 0;
}

/** Deterministic colour for a tag: same tag in, same colour out. */
export function tagColour(raw: string): string {
  // Hash the plural-stemmed key so `LORES` and `LORE` can never drift apart
  // into two colours even if an old row still holds the plural spelling.
  const key = stem(tagKey(raw));
  if (key.length === 0) return TAG_PALETTE[0];
  return TAG_PALETTE[hashKey(key) % TAG_PALETTE.length];
}

/** Every tag label already used on the board, for folding new spellings onto. */
export function collectTagLabels(threads: ForumThread[]): string[] {
  const labels = new Set<string>();

  for (const thread of threads) {
    for (const tag of thread.tags) labels.add(normaliseTagLabel(tag.label));
    for (const comment of thread.comments) {
      for (const tag of comment.tags) labels.add(normaliseTagLabel(tag.label));
    }
  }

  return [...labels];
}

/** Builds the coloured badge record stored on a post. */
export function makeUserTag(raw: string, colour?: string): ForumTag {
  const label = normaliseTagLabel(raw);

  return {
    id: `user-${tagKey(raw)}`,
    kind: 'user',
    label,
    ...(colour === undefined ? {} : { colour }),
  };
}

/** Starter tags plus everything already in use, most used first. */
export function buildTagVocabulary(
  threads: ForumThread[],
  chosenColours: Record<string, string> = {},
): TagOption[] {
  const counts = new Map<string, { label: string; count: number; colour?: string }>();

  const tally = (tag: ForumTag) => {
    if (tag.kind === 'source' || tag.kind === 'content') return;

    const key = tagKey(tag.label);
    if (key.length === 0) return;

    const current = counts.get(key);
    const colour = tag.colour ?? current?.colour;

    counts.set(key, {
      label: normaliseTagLabel(tag.label),
      count: current === undefined ? 1 : current.count + 1,
      ...(colour === undefined ? {} : { colour }),
    });
  };

  for (const thread of threads) {
    thread.tags.forEach(tally);
    for (const comment of thread.comments) comment.tags.forEach(tally);
  }

  const options = new Map<string, TagOption>();

  for (const label of STARTER_TAGS) {
    const key = tagKey(label);
    const colour = chosenColours[key] ?? counts.get(key)?.colour;

    options.set(key, {
      label: normaliseTagLabel(label),
      key,
      count: counts.get(key)?.count ?? 0,
      starter: true,
      ...(colour === undefined ? {} : { colour }),
    });
  }

  for (const [key, value] of counts) {
    const existing = options.get(key);
    const colour = chosenColours[key] ?? value.colour;

    options.set(
      key,
      existing === undefined
        ? {
            label: value.label,
            key,
            count: value.count,
            starter: false,
            ...(colour === undefined ? {} : { colour }),
          }
        : { ...existing, count: value.count, ...(colour === undefined ? {} : { colour }) },
    );
  }

  return [...options.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}
