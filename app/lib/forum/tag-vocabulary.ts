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
  /** The namespace the tag list files it under, e.g. `theme:design`. */
  namespace: TagNamespace;
  /** Colour chosen in the picker, when the tag has one. */
  colour?: string;
};

/**
 * The namespace a tag sits in: what the tag list writes in front of it.
 *
 * A tag is not a loose word here any more - it is read as `namespace:name`, the way a gallery of
 * this kind files `artist:name` - because the namespace is half of what the word means. A `theme` is
 * a tag read out of the post's own text (`deriveTags` in ./tags.ts), a `warn` is one a reader wants
 * before opening the post, a `user` tag is one a poster typed themselves, and `filed` is the retired
 * housekeeping badge an older row still carries.
 */
export type TagNamespace = 'theme' | 'warn' | 'user' | 'filed';

/** The namespaces in the order a list reads them: what it is about, then the rest. */
export const TAG_NAMESPACES: TagNamespace[] = ['theme', 'warn', 'user', 'filed'];

export function tagNamespace(tag: ForumTag): TagNamespace {
  if (tag.kind === 'category') return 'theme';
  if (tag.kind === 'content') return 'warn';
  if (tag.kind === 'source') return 'filed';

  return 'user';
}

/** How a tag is written in a list: `theme:design`, lowercase and unambiguous. */
export function tagToken(tag: ForumTag): string {
  return `${tagNamespace(tag)}:${tagKey(tag.label)}`;
}

/**
 * The same tags folded into their namespaces, empty ones left out.
 *
 * Generic over the tag type so the board's own vocabulary options (`TagOption`, which carries a
 * count) fold by the same rule as the tags on a post - one function, so the filter panel and the
 * chooser cannot group the same board two ways.
 */
export function groupByNamespace<T extends { namespace: TagNamespace }>(
  items: T[],
): { namespace: TagNamespace; items: T[] }[] {
  return TAG_NAMESPACES.map((namespace) => ({
    namespace,
    items: items.filter((item) => item.namespace === namespace),
  })).filter((group) => group.items.length > 0);
}

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
 * The palette a tag's colour comes from: sixteen hues, one weight.
 *
 * Every entry is the same saturation and lightness - `hsl(n * 22.5deg, 42%, 38%)`, written out - so
 * the set reads as a palette rather than sixteen opinions: two tags a step apart in hue are equally
 * strong, and no single tag shouts. Hue is the only thing that changes, which is the whole trick.
 *
 * They are this dark on purpose. A colour that *fills* a chip has to be pale enough to write on; a
 * colour that *marks* one - the small key drawn in front of a tag's label, see TagBadge - has to be
 * dark enough to see, so the same palettes that looked like confetti as fills look like a control
 * panel's chart legend as keys. `markColour` (app/lib/ui/colour.ts) clamps a colour chosen in the
 * picker to the same weight, so a tag coloured before this rule existed still comes out as a
 * recognisable mark.
 */
export const TAG_MARK_PALETTE = [
  '#8a3838',
  '#8a5738',
  '#8a7538',
  '#7f8a38',
  '#618a38',
  '#428a38',
  '#388a4d',
  '#388a6b',
  '#388a8a',
  '#386b8a',
  '#384d8a',
  '#42388a',
  '#61388a',
  '#7f388a',
  '#8a3875',
  '#8a3857',
];

/** The automatic colour source: a tag's own label picks from this set by hash. */
export const TAG_PALETTE = TAG_MARK_PALETTE;

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

/** Starter tags whose namespace is not the theme one. They have no kind until somebody uses them. */
const STARTER_NAMESPACES: Record<string, TagNamespace> = { spoiler: 'warn' };

/** Starter tags plus everything already in use, most used first. */
export function buildTagVocabulary(
  threads: ForumThread[],
  chosenColours: Record<string, string> = {},
): TagOption[] {
  const counts = new Map<string, { label: string; count: number; namespace: TagNamespace; colour?: string }>();

  const tally = (tag: ForumTag) => {
    if (tag.kind === 'source' || tag.kind === 'content') return;

    const key = tagKey(tag.label);
    if (key.length === 0) return;

    const current = counts.get(key);
    const colour = tag.colour ?? current?.colour;

    counts.set(key, {
      label: normaliseTagLabel(tag.label),
      count: current === undefined ? 1 : current.count + 1,
      namespace: tagNamespace(tag),
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
      // A starter tag that nobody has used yet has no kind to read a namespace off, so the one that
      // is not a theme is named here - a warning is a warning whether or not a post carries it.
      namespace: counts.get(key)?.namespace ?? STARTER_NAMESPACES[key] ?? 'theme',
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
            namespace: value.namespace,
            ...(colour === undefined ? {} : { colour }),
          }
        : { ...existing, count: value.count, namespace: value.namespace, ...(colour === undefined ? {} : { colour }) },
    );
  }

  return [...options.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}
