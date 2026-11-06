import type { WebItem } from '../web/types';
import type { Facet } from './word-facts';

/**
 * TAG STATION's data (SPEC-tag-station.md). Metadata only, as everywhere in WEB: the counts here are how many of OUR saved
 * items carry a word. No platform's likes, views or ratings are read, kept or sent.
 */

/** Where a word on an item came from: Claude's batch (`web_item_tags`), the platform's own tags, or both. */
export type ItemWord = { word: string; claude: boolean; platform: boolean };

/** A saved item, as the page needs it. The same addresses as a WEB row, so `rowAddresses` checks them the same way. */
export type StationItem = Omit<WebItem, 'tags' | 'pickWords' | 'pickPage' | 'media'> & {
  words: ItemWord[];
  /** A search result nobody saved (`web_seen_items`): its words count, and it has no address of its own here. */
  seenOnly?: boolean;
};

/** Another word this one meets. `close` is the honest part: true only once the pair shares `MIN_SHARED` items. */
export type Partner = {
  name: string;
  /** Items carrying both. */
  shared: number;
  /** How much more often the two meet than chance, from -1 to 1. Only trusted when `close`. */
  npmi: number;
  close: boolean;
};

export type StationTag = {
  /** The spelling shown, and the word's name in an address. */
  name: string;
  /** Items carrying it. */
  count: number;
  /** Of those, how many have it from Claude and from the platform. */
  claude: number;
  platform: number;
  /** The era it names ("1920s"), or null. */
  era: string | null;
  /** What type of word it is (the word pass), or null until the pass has answered. */
  facet: Facet | null;
  /** The first and latest publish dates among its items (ISO), or null. */
  first: string | null;
  latest: string | null;
  /** Place on the map, from 0 to 1. */
  x: number;
  y: number;
  /** Closest first, at most `MAX_PARTNERS`. */
  partners: Partner[];
};

/** What the page draws from: one JSON answer, the same for every signed-in reader. */
export type StationGraph = {
  tags: StationTag[];
  items: StationItem[];
  /** Other spellings the word pass joined to a word: a word's key, then its name on the map. So an old link or a typed spelling still lands. */
  aliases?: Record<string, string>;
  /** How many items have been counted in all: what RECOMMENDED and DISCOVER on MEDIA wait for. */
  tagged?: number;
  /** True when the $60 tagging limit has stopped the batches: a person has to decide (SPEC-tag-station.md). */
  limitReached?: boolean;
};

/** One saved item and Claude's words for it, as a repository reads them. */
export type StationRow = {
  item: WebItem;
  claudeWords: readonly string[];
  seenOnly?: boolean;
  /** A swept item (`web_pool_items`): listed, but its words are already in the word counts, so they aren't counted again. */
  listOnly?: boolean;
};

/** What the sweep has counted (`web_word_stats`): most swept items are dropped once they're in here. */
export type SweptWord = { word: string; items: number; partners: Readonly<Record<string, number>> };
export type SweptCounts = { counted: number; words: readonly SweptWord[] };


/** A word a pasted link came with, and who said so. Only ever matched to the map's words; nothing is added or saved. */
export type LinkWord = { word: string; from: 'platform' | 'musicbrainz' };

/** What a pasted link turned out to be. `item` is a platform MEDIA can play; `card` a music service it only links to. */
export type LinkAnswer = {
  outcome: 'found' | 'unknown' | 'not-found' | 'no-answer';
  item: WebItem | null;
  card: { title: string; creator: string | null; source: string; link: string } | null;
  words: LinkWord[];
};
