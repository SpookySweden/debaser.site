import type { HistoryRow } from '../recommender/types';
import type { Taste } from './recommend';
import { spellWord, titleWords, wordKey } from './title-words';

/**
 * MEDIA's default feed, version 2 (SPEC-media-feed-v2.md; Luke, 2026-11-17: "All A"): a picture of the person, built from
 * every signal the site already lets them read. Pure, so `Temp/check-media-feed-rank.cjs` holds it: nothing here reads a
 * clock, the browser or the network; the page hands it all of that.
 *
 * Every signal adds weight to words (topics), makers (creators, channels, authors), kinds and particular items. Weights
 * from things done halve every 30 days unless the table says they hold. These numbers decide order only: they are never
 * shown, saved or sent anywhere.
 */

const DAY_MS = 86_400_000;
const HALF_LIFE_DAYS = 30;
/** Title words count half an item's own words. */
export const TITLE_SHARE = 0.5;
/** The parts of a several-word tag ("quantum mechanics" -> quantum, mechanic) count half too, so titles can meet tags. */
export const PART_SHARE = 0.5;

/** What each thing done says (SPEC-media-feed-v2.md, the signal table). */
const DONE = { finished: 4, played: 2, read: 2, opened: 1, replayed: 2 } as const;
const MORE_LIKE_THIS = 4;
const NOT_FOR_ME = -3;
const LESS_FROM_MAKER = -8;
const SKIPPED_MAKER = -1;
const SKIPPED_WORDS = -0.5;
/** Kinds of history row that say something about topics only weakly (a thread read, a room opened). */
const WEAK_KINDS = new Set(['thread', 'room', 'letter', 'lore', 'person']);
const WEAK = 0.5;
/** Things he put in his own letters, or recommended to others. */
const LETTER = 3;
const RECOMMENDED_BY_HIM = 3;
/** Things queued in stream rooms the person joined (watched together). */
const QUEUED = 1;
/** YOUR YOUTUBE: a channel's standing counts up to this; topics are broad ("Entertainment"), so they count little. */
const YOUTUBE_CHANNEL_CAP = 3;
const YOUTUBE_TOPIC = 0.5;
const YOUTUBE_PLAYLIST = 1;
const YOUTUBE_IMPORTED = 1;
/** The active DISCOVER preset's words. */
const PRESET = 3;
/** This browser's own opens: makers capped, platforms light. */
const BROWSER_MAKER_CAP = 2;
const BROWSER_PLATFORM = 0.25;
/** Played, finished, opened or skipped this recently: left out of the feed. */
const OUT_DAYS = 30;
/** Below this much evidence the person is new: the balanced sampler (decision 5A). */
export const COLD_BELOW = 3;

export type FeedSignals = {
  /** FOR YOU's private history (owner only), newest first. */
  history: readonly HistoryRow[];
  /** This browser's opens (`taste-store.ts`). */
  browser: Taste;
  /** YOUR YOUTUBE: channels by where they stand (their outside weight), topics, playlist names, an import's words. */
  youtube: { channels: readonly { name: string; outside: number }[]; topics: readonly string[]; playlists: readonly string[]; imported: readonly string[] } | null;
  /** The active DISCOVER preset's words. */
  presetWords: readonly string[];
  /** Things in letters the person made: a MEDIA row's id when it is one, its title, and its maker when known. */
  letters: readonly { ref: string; title: string; maker?: string }[];
  /** MEDIA rows the person recommended (ids). */
  recommended: readonly { ref: string; title: string; maker?: string }[];
  /** Things queued in stream rooms the person joined, by anyone: their titles. */
  queued: readonly { ref: string; title: string }[];
  /** VANITY's closeness (`music_for_you`): the people the person is closest to, any scale. */
  closeness: readonly { id: string; closeness: number }[];
  now: number;
};

/** A thing done that can explain a pick: "BECAUSE YOU PLAYED ...". */
export type Reason = { title: string; verb: string; words: ReadonlySet<string>; maker: string };

export type Profile = {
  /** Words by their matching key (each part folded: "quantum physic"). */
  words: Readonly<Record<string, number>>;
  /** Each key's spelling as first met ("quantum physics"). */
  spelled: Readonly<Record<string, string>>;
  makers: Readonly<Record<string, number>>;
  /** Item kinds (video, audio, text, image) and reading kinds (paper, news, longread, tech). */
  kinds: Readonly<Record<string, number>>;
  platforms: Readonly<Record<string, number>>;
  /** Ids never offered: NOT FOR ME, and anything played, finished, opened or skipped in the last 30 days. */
  out: ReadonlySet<string>;
  /** Makers of YOUR YOUTUBE channels that stand: "FROM A CHANNEL YOU WATCH". */
  channels: ReadonlySet<string>;
  reasons: readonly Reason[];
  /** 0 to 1, the closest person 1. */
  closeness: ReadonlyMap<string, number>;
  /** How much the person has shown at all: under `COLD_BELOW` the feed is a balanced sampler. */
  evidence: number;
};

export const normalMaker = (name: string): string => name.replace(/\s+/g, ' ').trim().toLowerCase();

type WordForm = { key: string; word: string; share: number };

/** An item's words: its own in full, their parts and its title's words at half; each keyed for matching, with its spelling. */
function wordForms(item: { title: string; tags?: readonly string[]; pickWords?: readonly string[] }): WordForm[] {
  const out = new Map<string, WordForm>();
  const add = (word: string, share: number) => {
    const key = wordKey(word);
    if (key.length < 3) return;
    const before = out.get(key);
    if (before === undefined || before.share < share) out.set(key, { key, word, share });
  };
  for (const raw of [...(item.tags ?? []), ...(item.pickWords ?? [])]) {
    const word = spellWord(raw);
    if (word === '') continue;
    add(word, 1);
    const parts = word.split(' ');
    if (parts.length > 1) for (const part of parts) if (part.length >= 4) add(part, PART_SHARE);
  }
  for (const word of titleWords(item.title)) add(word, TITLE_SHARE);
  return [...out.values()];
}

/** An item's words as the profile matches them (folded keys), with their weights. */
export function itemWords(item: { title: string; tags?: readonly string[]; pickWords?: readonly string[] }): Map<string, number> {
  return new Map(wordForms(item).map(({ key, share }) => [key, share]));
}

const VERB: Record<string, string> = { played: 'PLAYED', finished: 'FINISHED', read: 'READ', opened: 'OPENED', more: 'WANTED MORE LIKE' };
/** The platform part of a MEDIA history row's ref (`youtube:abc` -> youtube). */
const platformOf = (ref: string): string => ref.split(':')[0] ?? '';

export function buildProfile(signals: FeedSignals): Profile {
  const words: Record<string, number> = {};
  const makers: Record<string, number> = {};
  const kinds: Record<string, number> = {};
  const platforms: Record<string, number> = {};
  const out = new Set<string>();
  const reasons: Reason[] = [];
  let evidence = 0;
  const spelled: Record<string, string> = {};
  const bump = (into: Record<string, number>, key: string, by: number) => {
    if (key !== '' && by !== 0) into[key] = (into[key] ?? 0) + by;
  };
  /** One word, as spelled: weighed by its key, its spelling kept for asking DISCOVER and for why-lines. */
  const teachWord = (word: string, by: number) => {
    const key = wordKey(word);
    if (key === '' || by === 0) return;
    bump(words, key, by);
    spelled[key] ??= spellWord(word);
  };
  const teachWords = (item: { title: string; words?: readonly string[] }, by: number) => {
    for (const { key, word, share } of wordForms({ title: item.title, tags: item.words })) {
      bump(words, key, by * share);
      spelled[key] ??= word;
    }
  };

  for (const row of signals.history) {
    const maker = normalMaker(row.maker);
    if (row.action === 'less') {
      bump(makers, maker, LESS_FROM_MAKER);
      continue;
    }
    const age = Math.max(0, signals.now - Date.parse(row.lastAt)) / DAY_MS;
    const fade = Number.isFinite(age) ? 0.5 ** (age / HALF_LIFE_DAYS) : 0;
    if (row.kind === 'media' && (row.action === 'not_for_me' || (Number.isFinite(age) && age <= OUT_DAYS && row.action !== 'more'))) out.add(row.ref);
    if (row.action === 'not_for_me') {
      teachWords(row, NOT_FOR_ME);
      bump(makers, maker, NOT_FOR_ME);
      continue;
    }
    if (row.action === 'skipped') {
      teachWords(row, SKIPPED_WORDS * fade);
      bump(makers, maker, SKIPPED_MAKER * fade);
      continue;
    }
    if (row.kind === 'maker') continue;
    const replayed = Date.parse(row.lastAt) - Date.parse(row.firstAt) > DAY_MS ? DONE.replayed : 0;
    const base = row.action === 'more' ? MORE_LIKE_THIS : ((DONE as Record<string, number>)[row.action] ?? 0) * fade + replayed * fade;
    const weight = WEAK_KINDS.has(row.kind) ? base * WEAK : base;
    if (weight <= 0) continue;
    teachWords(row, weight);
    if (!WEAK_KINDS.has(row.kind)) bump(makers, maker, weight);
    if (row.kind === 'media') {
      bump(platforms, platformOf(row.ref), weight);
      const reading = platformOf(row.ref);
      if (['paper', 'news', 'longread', 'tech'].includes(reading)) bump(kinds, reading, weight);
    }
    evidence += weight;
    if (row.title.trim() !== '' && row.kind !== 'person') {
      reasons.push({ title: row.title, verb: VERB[row.action] ?? 'OPENED', words: new Set(itemWords({ title: row.title, tags: row.words }).keys()), maker });
    }
  }

  for (const thing of signals.letters) {
    teachWords(thing, LETTER);
    if (thing.maker) bump(makers, normalMaker(thing.maker), LETTER);
    evidence += LETTER;
  }
  for (const thing of signals.recommended) {
    teachWords(thing, RECOMMENDED_BY_HIM);
    if (thing.maker) bump(makers, normalMaker(thing.maker), RECOMMENDED_BY_HIM);
    evidence += RECOMMENDED_BY_HIM;
  }

  for (const thing of signals.queued) {
    teachWords(thing, QUEUED);
    evidence += QUEUED / 2;
  }

  const channels = new Set<string>();
  if (signals.youtube !== null) {
    for (const channel of signals.youtube.channels) {
      const weight = Math.min(YOUTUBE_CHANNEL_CAP, channel.outside);
      if (weight <= 0) continue;
      bump(makers, normalMaker(channel.name), weight);
      channels.add(normalMaker(channel.name));
      evidence += weight / 2;
    }
    for (const topic of signals.youtube.topics) teachWord(topic, YOUTUBE_TOPIC);
    for (const name of signals.youtube.playlists) teachWords({ title: name }, YOUTUBE_PLAYLIST * 2);
    for (const word of signals.youtube.imported) teachWord(word, YOUTUBE_IMPORTED);
  }

  for (const word of signals.presetWords) {
    teachWord(word, PRESET);
    evidence += 1;
  }

  for (const [word, count] of Object.entries(signals.browser.tags)) teachWord(word, count);
  for (const [maker, count] of Object.entries(signals.browser.creators)) bump(makers, normalMaker(maker), Math.min(BROWSER_MAKER_CAP, count));
  for (const [platform, count] of Object.entries(signals.browser.platforms)) {
    bump(platforms, platform, count * BROWSER_PLATFORM);
    evidence += count * BROWSER_PLATFORM;
  }

  const top = Math.max(0, ...signals.closeness.map((one) => one.closeness));
  const closeness = new Map<string, number>();
  if (top > 0) for (const one of signals.closeness) if (one.closeness > 0) closeness.set(one.id, Math.max(closeness.get(one.id) ?? 0, one.closeness / top));

  return { words, spelled, makers, kinds, platforms, out, channels, reasons, closeness, evidence };
}

/** A matching key as the person would read it ("physic" -> "physics"). */
export const spelledOf = (profile: Profile, key: string): string => profile.spelled[key] ?? key;

/** The person's strongest words as spelled, for asking DISCOVER's catalogue (use-feed-lanes.ts). */
export function strongestSpelled(profile: Profile, limit: number): string[] {
  return Object.entries(profile.words)
    .filter(([, weight]) => weight > 0)
    .sort(([a, x], [b, y]) => y - x || a.localeCompare(b))
    .slice(0, limit)
    .map(([key]) => spelledOf(profile, key));
}

