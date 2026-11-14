import { dayJitter, type Taste } from '../web/recommend';
import { hiddenKeys, keyOf, lessMakers, pickLane, type Candidate } from './engine';
import type { HistoryRow } from './types';

/**
 * YOUR YOUTUBE, closer to what a person watches (Luke, 2026-11-14: "many users are subscribed to many channels they no
 * longer watch, and most often watch videos from channels they are not subscribed to"). Google gives no watch history and
 * no home page, so this works from what there is: their likes and when they liked them, what is in their playlists, what
 * they play, finish and skip on this site, an imported summary of their own YouTube history (Google Takeout), and
 * YouTube's own "watch next" for those videos.
 *
 * Pure, so the checks hold it: no clock, browser or network; the page hands it all of that. Nothing here is a count that
 * is ever drawn: weights decide order only, and a why-line is words.
 *
 * - A channel STANDS by what the person did with it lately. Likes from the last few months weigh most and fade; a
 *   subscription counts only while the channel has shown up lately in their likes, playlists, plays here or imported
 *   history. A channel they never subscribed to stands just the same.
 * - The shelf is about 7 familiar to 3 new: new videos from channels that stand, and YouTube's "watch next" from
 *   channels they have never met.
 */

const DAY_MS = 86_400_000;
/** A like halves every two months: "likes from the last few months weigh heavily and older ones fade". */
const LIKE = { weight: 3, halfLifeDays: 60 };
const SAVE = { weight: 2, halfLifeDays: 90 };
const SITE_HALF_LIFE_DAYS = 30;
const SITE: Readonly<Record<string, number>> = { opened: 1, played: 2, read: 2, finished: 4, skipped: -1 };
const SITE_PRESS: Readonly<Record<string, number>> = { more: 4, not_for_me: -3 };
/** An imported history's strength (1 to 5) fades from the month the channel was last watched. */
const IMPORT = { perStrength: 0.8, halfLifeDays: 120 };
/** A subscription the person still watches adds this; one they don't adds nothing. */
const SUBSCRIBED = 2;
/** "Recently": a like, playlist add or imported watch within this long keeps a channel alive. */
export const LIVE_DAYS = 180;
/** With nothing at all to go on, YouTube's own first few subscriptions stand in, lightly. */
const GUESS_CHANNELS = 10;
/** A shelf shorter than this is topped up from the person's other subscriptions, last. */
const THIN_SHELF = 6;

const normal = (word: string) => word.trim().toLowerCase();

/** What one read of a linked YouTube says about one channel. Days are ISO dates; no counts are kept. */
export type ChannelEvidence = {
  /** YouTube's channel id. */
  id: string;
  name: string;
  subscribed: boolean;
  /** When the person liked a video of theirs, newest first (a few at most). */
  liked: string[];
  /** When a video of theirs went into one of the person's playlists, newest first. */
  saved: string[];
};

/** The summary a Google Takeout import leaves: channel names with a strength and a month, and topic words. */
export type WatchSummary = {
  channels: { name: string; strength: number; last: string }[];
  words: string[];
  importedAt: string;
};

export type ChannelStanding = {
  name: string;
  /** Null for a channel only known by name (watched here, or imported). */
  id: string | null;
  subscribed: boolean;
  /** Likes, playlists, the import and the subscription: what YouTube adds to the taste. */
  outside: number;
  /** Everything, with what they did on this site: the shelf's order. */
  weight: number;
  /** Shown up lately, and not turned down: its new videos are offered. */
  live: boolean;
  /** The strongest single reason, in words. */
  why: string;
};

const fade = (when: string, now: number, halfLifeDays: number): number => {
  const age = (now - Date.parse(when)) / DAY_MS;
  return Number.isFinite(age) ? 0.5 ** (Math.max(0, age) / halfLifeDays) : 0;
};

const within = (when: string, now: number, days: number): boolean => {
  const age = (now - Date.parse(when)) / DAY_MS;
  return Number.isFinite(age) && age <= days;
};

/** A month (`2026-09`) as the day it ended, near enough: an import says no more than the month. */
const monthEnd = (month: string): string => (/^\d{4}-\d{2}$/.test(month) ? `${month}-28T00:00:00Z` : '');

/** The site's own YouTube rows: what the person played, finished, skipped or pressed on a YouTube video here. */
const siteRows = (rows: readonly HistoryRow[]) => rows.filter((row) => row.kind === 'media' && row.ref.startsWith('youtube:') && row.maker.trim() !== '');

/**
 * Where every channel stands, strongest first. `evidence` comes in YouTube's own order (the subscriptions it thinks
 * matter most first), which only ever breaks ties and fills in when there is nothing else to go on.
 */
export function channelStandings(input: { evidence: readonly ChannelEvidence[]; rows: readonly HistoryRow[]; summary?: WatchSummary | null; now: number }): ChannelStanding[] {
  const { evidence, rows, now } = input;
  type Sums = { name: string; id: string | null; subscribed: boolean; like: number; save: number; site: number; imported: number; recent: boolean; order: number };
  const all = new Map<string, Sums>();
  const at = (name: string): Sums | null => {
    const key = normal(name);
    if (key === '') return null;
    let sums = all.get(key);
    if (sums === undefined) {
      sums = { name: name.trim(), id: null, subscribed: false, like: 0, save: 0, site: 0, imported: 0, recent: false, order: all.size };
      all.set(key, sums);
    }
    return sums;
  };

  for (const channel of evidence) {
    const sums = at(channel.name);
    if (sums === null) continue;
    sums.id ??= channel.id;
    sums.subscribed ||= channel.subscribed;
    for (const day of channel.liked) {
      sums.like += LIKE.weight * fade(day, now, LIKE.halfLifeDays);
      sums.recent ||= within(day, now, LIVE_DAYS);
    }
    for (const day of channel.saved) {
      sums.save += SAVE.weight * fade(day, now, SAVE.halfLifeDays);
      sums.recent ||= within(day, now, LIVE_DAYS);
    }
  }
  for (const row of siteRows(rows)) {
    const sums = at(row.maker);
    if (sums === null) continue;
    if (row.action in SITE_PRESS) {
      sums.site += SITE_PRESS[row.action];
      sums.recent ||= row.action === 'more';
    } else if (row.action in SITE) {
      sums.site += SITE[row.action] * fade(row.lastAt, now, SITE_HALF_LIFE_DAYS);
      // Playing or finishing a video of theirs here is the strongest sign they still watch the channel.
      sums.recent ||= row.action === 'played' || row.action === 'finished';
    }
  }
  for (const channel of input.summary?.channels ?? []) {
    const sums = at(channel.name);
    const last = monthEnd(channel.last);
    if (sums === null || last === '') continue;
    sums.imported += IMPORT.perStrength * Math.min(5, Math.max(0, channel.strength)) * fade(last, now, IMPORT.halfLifeDays);
    sums.recent ||= within(last, now, LIVE_DAYS);
  }

  const less = lessMakers(rows);
  const standings = [...all.entries()].map(([key, sums]) => {
    const turnedDown = less.has(key);
    const live = sums.recent && !turnedDown;
    const outside = sums.like + sums.save + sums.imported + (live && sums.subscribed ? SUBSCRIBED : 0);
    const strongest = Math.max(sums.like, sums.save, sums.site, sums.imported);
    const why =
      strongest <= 0
        ? 'YOU SUBSCRIBE'
        : strongest === sums.site
          ? 'YOU WATCH THEM HERE'
          : strongest === sums.like
            ? 'YOU LIKED THEIR VIDEOS LATELY'
            : strongest === sums.imported
              ? 'FROM YOUR YOUTUBE HISTORY'
              : 'IN YOUR PLAYLISTS';
    return { name: sums.name, id: sums.id, subscribed: sums.subscribed, outside: turnedDown ? 0 : outside, weight: turnedDown ? -1 : outside + sums.site, live, why, order: sums.order };
  });

  // Nothing at all to go on (just linked, never likes anything): YouTube's own first few subscriptions, lightly.
  if (!standings.some((standing) => standing.live)) {
    let given = 0;
    for (const standing of standings) {
      if (!standing.subscribed || standing.weight < 0 || given === GUESS_CHANNELS) continue;
      standing.live = true;
      standing.outside = 1 - given * 0.05;
      standing.weight += standing.outside;
      standing.why = 'YOU SUBSCRIBE';
      given += 1;
    }
  }
  return standings
    .sort((a, b) => b.weight - a.weight || a.order - b.order)
    .map((standing) => ({ name: standing.name, id: standing.id, subscribed: standing.subscribed, outside: standing.outside, weight: standing.weight, live: standing.live, why: standing.why }));
}

/** The channels whose new videos are worth reading, strongest first: their YouTube ids. */
export function liveChannelIds(standings: readonly ChannelStanding[]): string[] {
  return standings.filter((standing) => standing.live && standing.id !== null).map((standing) => standing.id as string);
}

/** How much each kind of word teaches. A topic the person's live channels share counts most. */
const WORD_WEIGHT = { topic: 2, leadingTopic: 1, playlist: 1, imported: 1.5 };
const LEADING = 3;

/**
 * A taste with the person's YouTube in it: channels as creators by where they stand (a dead subscription adds nothing,
 * an unsubscribed channel they like adds as much as any), topics and playlist names as words, and an import's words.
 * What they did on this site is already in the taste (`tasteFromHistory`), so only the YouTube side is added here.
 */
export function youTubeTaste(taste: Taste, input: { standings: readonly ChannelStanding[]; topics: readonly string[]; playlists: readonly string[]; summary?: WatchSummary | null }): Taste {
  const bump = (from: Record<string, number>, key: string, by: number) => {
    if (key !== '' && by !== 0) from[key] = (from[key] ?? 0) + by;
  };
  const tags: Record<string, number> = { ...taste.tags };
  const creators: Record<string, number> = { ...taste.creators };
  input.topics.forEach((word, index) => bump(tags, normal(word), WORD_WEIGHT.topic + (index < LEADING ? WORD_WEIGHT.leadingTopic : 0)));
  for (const name of input.playlists) bump(tags, normal(name), WORD_WEIGHT.playlist);
  for (const word of input.summary?.words ?? []) bump(tags, normal(word), WORD_WEIGHT.imported);
  for (const standing of input.standings) bump(creators, normal(standing.name), standing.outside);
  return { tags, creators, platforms: taste.platforms };
}

/** The names of the channels that stand, for moving their rows to the front of a search's page. */
export function standingNames(standings: readonly ChannelStanding[]): { name: string }[] {
  return standings.filter((standing) => standing.live).map(({ name }) => ({ name }));
}

type Video = { id: string; title: string; creator?: string; publishedAt?: string };

export type ShelfPick<T> = { item: T; why: string; fresh: boolean };

/** How much a new upload's age counts beside its channel: it halves every two weeks. */
const UPLOAD_FRESH = { weight: 2, halfLifeDays: 14 };
/** A channel's standing counts up to this, so one favourite can't own the shelf. */
const STANDING_CAP = 6;
/** Below this a channel's videos are left off the shelf (a skip fades back above it in about a month). */
const AGAINST = -0.5;
/** Of each 10 places, the ones for something new (the engine's own 7 familiar to 3 new). */
const NEW_PLACES = new Set([2, 5, 8]);
/** ... and the one of those a surprise from a quiet subscription takes: one in ten, about one a screen. */
const SURPRISE_PLACE = 5;
const SUBSCRIBED_WHY = 'FROM A CHANNEL YOU SUBSCRIBE TO';

const shortTitle = (title: string) => (title.length > 48 ? `${title.slice(0, 45).trimEnd()}...` : title).toUpperCase();

/**
 * YOUR YOUTUBE's shelf, in order. Familiar: new videos from channels that stand, YouTube's "watch next" from those same
 * channels, and the person's own likes last. New (about 3 in 10): YouTube's "watch next" from channels they have never
 * met, and, one place in ten, a surprise from a subscription they no longer watch. Steady all day. Things already
 * played here, NOT FOR ME things and SHOW LESS channels are left out.
 */
export function youTubeShelf<T extends Video>(input: {
  uploads: readonly T[];
  liked: readonly T[];
  related: readonly { item: T; seed: string }[];
  standings: readonly ChannelStanding[];
  rows: readonly HistoryRow[];
  now: number;
  size: number;
}): ShelfPick<T>[] {
  const { standings, rows, now, size } = input;
  const byName = new Map(standings.map((standing) => [normal(standing.name), standing]));
  const less = lessMakers(rows);
  const standingOf = (video: Video) => (video.creator ? byName.get(normal(video.creator)) : undefined);
  // A channel is left out once what they did says no: SHOW LESS, a NOT FOR ME, or a fresh skip with nothing to set against it.
  const turnedDown = (video: Video) => (video.creator ? less.has(normal(video.creator)) : false) || (standingOf(video)?.weight ?? 0) < AGAINST;

  const candidates = new Map<string, Candidate<T>>();
  const newWhy = new Map<string, string>();
  const add = (video: T, shared: { why: string; weight: number } | null) => {
    const key = keyOf('media', video.id);
    if (candidates.has(key) || turnedDown(video)) return;
    candidates.set(key, { key, words: [], maker: video.creator, item: video, ...(shared === null ? {} : { shared }) });
  };

  for (const video of input.uploads) {
    const standing = standingOf(video);
    if (standing === undefined || !standing.live) continue;
    const fresh = video.publishedAt ? UPLOAD_FRESH.weight * fade(video.publishedAt, now, UPLOAD_FRESH.halfLifeDays) : 0;
    add(video, { why: standing.why, weight: 1 + Math.min(standing.weight, STANDING_CAP) + fresh });
  }
  for (const { item, seed } of input.related) {
    const standing = standingOf(item);
    const after = `YOUTUBE'S NEXT AFTER ${shortTitle(seed)}`;
    if (standing !== undefined && standing.weight > 0) add(item, { why: after, weight: 1 + Math.min(standing.weight, STANDING_CAP) / 2 });
    else if (!candidates.has(keyOf('media', item.id)) && !turnedDown(item)) {
      add(item, null);
      newWhy.set(keyOf('media', item.id), `NEW TO YOU: ${after}`);
    }
  }
  // Their own likes come last among the familiar: they have seen them, but a liked song is worth having to hand.
  for (const video of input.liked) add(video, { why: 'YOU LIKED THIS', weight: 0.5 });

  // Everything in order first (the engine's own rules: steady for a day, one maker can't lead twice running, seen and
  // NOT FOR ME left out), then dealt into places below so a surprise can take one.
  const lane = pickLane([...candidates.values()], { taste: { tags: {}, creators: {}, platforms: {} }, rows, explore: new Map(), now, size: candidates.size });
  const familiar = lane.filter((pick) => !pick.fresh).map((pick): ShelfPick<T> => ({ item: pick.item, why: pick.why, fresh: false }));
  const fresh = lane.filter((pick) => pick.fresh).map((pick): ShelfPick<T> => ({ item: pick.item, why: newWhy.get(pick.key) ?? pick.why, fresh: true }));

  // Surprises (Luke, 2026-11-14: "regarding 'dead subscribes' add them in occasionally as surprises too"): the newest
  // video of a subscription they no longer watch, one channel at a time, a different one each day. Playing it brings the
  // channel back (it then stands by that play); NOT FOR ME or SHOW LESS quiets it.
  const seen = new Set(rows.map((row) => keyOf(row.kind, row.ref)));
  const day = Math.floor(now / DAY_MS);
  const quiet = new Map<string, T>();
  for (const video of input.uploads) {
    const standing = standingOf(video);
    if (standing === undefined || standing.live || !standing.subscribed || turnedDown(video)) continue;
    const name = normal(standing.name);
    if (!quiet.has(name) && !seen.has(keyOf('media', video.id)) && !candidates.has(keyOf('media', video.id))) quiet.set(name, video);
  }
  const surprises = [...quiet.entries()]
    .sort(([a], [b]) => dayJitter(`surprise:${b}`, day) - dayJitter(`surprise:${a}`, day) || a.localeCompare(b))
    .map(([, video]): ShelfPick<T> => ({ item: video, why: SUBSCRIBED_WHY, fresh: true }));

  const picks: ShelfPick<T>[] = [];
  while (picks.length < size) {
    const place = picks.length % 10;
    const next =
      place === SURPRISE_PLACE && surprises.length > 0
        ? surprises.shift()
        : NEW_PLACES.has(place)
          ? (fresh.shift() ?? familiar.shift())
          : (familiar.shift() ?? fresh.shift());
    if (next === undefined) break;
    picks.push(next);
  }

  // A thin shelf (few likes, nothing played here yet): the person's other subscriptions fill it, last and plainly said.
  if (picks.length < Math.min(THIN_SHELF, size)) {
    const taken = new Set(picks.map((pick) => pick.item.id));
    for (const video of input.uploads) {
      if (picks.length >= size) break;
      if (taken.has(video.id) || turnedDown(video) || seen.has(keyOf('media', video.id))) continue;
      taken.add(video.id);
      picks.push({ item: video, why: SUBSCRIBED_WHY, fresh: false });
    }
  }
  return picks;
}

export type SeedVideo = { id: string; title: string; creator: string };

const YOUTUBE_REF = /^youtube:([A-Za-z0-9][A-Za-z0-9_-]{10})$/;

/**
 * The videos to ask YouTube's "watch next" about: what the person finished or played here lately and what they liked
 * lately, taking turns, newest first. A few only: each is one question to YouTube.
 */
export function seedVideos(input: { liked: readonly (Video & { likedAt?: string })[]; rows: readonly HistoryRow[]; limit: number }): SeedVideo[] {
  const watched = input.rows
    .filter((row) => row.kind === 'media' && ['finished', 'played', 'more'].includes(row.action))
    .map((row) => ({ id: YOUTUBE_REF.exec(row.ref)?.[1] ?? '', title: row.title, creator: row.maker, at: row.action === 'played' ? row.lastAt : `9${row.lastAt}` }))
    .filter((seed) => seed.id !== '' && seed.title !== '')
    // Finished and MORE LIKE THIS before merely played, each newest first.
    .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  const liked = input.liked
    .map((video) => ({ id: YOUTUBE_REF.exec(video.id)?.[1] ?? '', title: video.title, creator: video.creator ?? '', at: video.likedAt ?? '' }))
    .filter((seed) => seed.id !== '' && seed.title !== '')
    .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  const hidden = hiddenKeys(input.rows);
  const less = lessMakers(input.rows);
  const seeds: SeedVideo[] = [];
  for (let i = 0; seeds.length < input.limit && (i < watched.length || i < liked.length); i++) {
    for (const seed of [watched[i], liked[i]]) {
      if (seed === undefined || seeds.length === input.limit) continue;
      if (seeds.some((one) => one.id === seed.id) || hidden.has(keyOf('media', `youtube:${seed.id}`)) || less.has(normal(seed.creator))) continue;
      seeds.push({ id: seed.id, title: seed.title, creator: seed.creator });
    }
  }
  return seeds;
}
