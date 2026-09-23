import { normaliseTagLabel, tagColour, tagKey } from '../forum/tag-vocabulary';

/**
 * The sound's own tags.
 *
 * The board's tags describe what a post is about; these describe how a track
 * sounds, which is the whole point of a netlabel shelf and the reason a reader
 * wants to filter it. They are written in the site's one tag grammar
 * (`../forum/tag-vocabulary`), so `lo-fi`, `lo fi` and `LO FI` are one tag with
 * one colour wherever an audio tag is drawn, exactly as a theme tag behaves on
 * the board - and a tag chip on a track sits beside a tag chip on a post without
 * looking like a different kind of thing.
 */

/** How many audio tags one file may carry. */
export const MAX_AUDIO_TAGS = 4;

/** The tags the shelf offers before anybody has filed anything. */
export const STARTER_AUDIO_TAGS: string[] = [
  'HIP HOP',
  'LO FI',
  'AMBIENT',
  'EXPERIMENTAL',
  'BREAKCORE',
  'DOWNTEMPO',
  'NOISE',
  'SPOKEN WORD',
];

/** The label to file a tag under: `lo-fi` -> `LO FI`. */
export function audioTagLabel(raw: string): string {
  return normaliseTagLabel(raw);
}

/** The key used for filtering, colours and links: `LO FI` -> `lo fi`. */
export function audioTagKey(raw: string): string {
  return tagKey(raw);
}

/** The colour a tag always comes back in. */
export function audioTagColour(raw: string): string {
  return tagColour(raw);
}

/**
 * A row of tags as filed: spelled the site's way, no duplicates, capped.
 *
 * The cap is the picker's rule as well as the storer's, so a track filed with
 * five tags reads the same after a reload as it did on the way in.
 */
export function normaliseAudioTags(labels: string[]): string[] {
  const tags: string[] = [];
  const seen = new Set<string>();

  for (const label of labels) {
    const key = audioTagKey(label);
    if (key.length === 0 || seen.has(key)) continue;

    seen.add(key);
    tags.push(audioTagLabel(label));
    if (tags.length === MAX_AUDIO_TAGS) break;
  }

  return tags;
}

/** One tag as the filter bar offers it: a label, its key, and how many files wear it. */
export type AudioTagOption = {
  label: string;
  key: string;
  /** How many files on the shelf carry it. */
  count: number;
  /** True for one of the tags that ship with the archive. */
  starter: boolean;
};

/**
 * Every tag in use, most used first, with the starter tags always offered.
 *
 * A starter tag nobody has used yet is still listed (with a count of zero) so
 * the vocabulary is visible rather than guessed at - the same thing the board's
 * chooser does with its own starter list.
 */
export function buildAudioTagVocabulary(tracks: { tags?: string[] }[]): AudioTagOption[] {
  const counts = new Map<string, { label: string; count: number }>();

  for (const track of tracks) {
    for (const tag of track.tags ?? []) {
      const key = audioTagKey(tag);
      if (key.length === 0) continue;

      const current = counts.get(key);
      counts.set(key, {
        label: audioTagLabel(tag),
        count: current === undefined ? 1 : current.count + 1,
      });
    }
  }

  const options = new Map<string, AudioTagOption>();

  for (const label of STARTER_AUDIO_TAGS) {
    const key = audioTagKey(label);
    options.set(key, { label: audioTagLabel(label), key, count: counts.get(key)?.count ?? 0, starter: true });
  }

  for (const [key, value] of counts) {
    const existing = options.get(key);

    options.set(
      key,
      existing === undefined
        ? { label: value.label, key, count: value.count, starter: false }
        : { ...existing, count: value.count },
    );
  }

  return [...options.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

/** True when a track wears that tag. */
export function trackHasTag(track: { tags?: string[] }, key: string): boolean {
  return (track.tags ?? []).some((tag) => audioTagKey(tag) === key);
}

/**
 * The shelf, filtered.
 *
 * `any` (the default) is the useful reading of a filter bar: picking LO FI and
 * AMBIENT asks for either. `all` is there for the narrower question - the one
 * that wants a file filed as both - and is one switch away rather than a second
 * meaning for the same click.
 *
 * An empty selection means everything, so an untouched bar never hides a file
 * that has no tags at all.
 */
export function filterTracksByTags<T extends { tags?: string[] }>(
  tracks: T[],
  keys: string[],
  mode: 'any' | 'all' = 'any',
): T[] {
  if (keys.length === 0) return tracks;

  return tracks.filter((track) => {
    const worn = keys.map((key) => trackHasTag(track, key));
    return mode === 'all' ? worn.every(Boolean) : worn.some(Boolean);
  });
}
