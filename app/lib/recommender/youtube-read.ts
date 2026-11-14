import type { HistoryRow } from './types';
import { channelStandings, seedVideos, standingNames, youTubeShelf, type ChannelEvidence, type ChannelStanding, type SeedVideo, type ShelfPick, type WatchSummary } from './youtube-picks';

/**
 * A read of a linked YouTube as the browser keeps it, and what the page is handed once it has been weighed with the
 * person's own history on this site (Luke, 2026-11-14; `youtube-picks.ts` has the rules). Pure, so the checks hold it.
 */

/** A video row, as much of it as the weighing needs. The page's own rows carry more, and come back untouched. */
export type ReadVideo = { id: string; title: string; creator?: string; publishedAt?: string };

/** What one read found, as it is kept: the videos, and what the channels have to show. */
export type YouTubeRead<T extends ReadVideo = ReadVideo> = {
  uploads: T[];
  liked: T[];
  /** The day each like was made, by row id (`youtube:<id>`). */
  likedAt: Record<string, string>;
  /** The subscriptions, in YouTube's order. */
  channels: { id: string; name: string }[];
  topics: string[];
  playlists: string[];
  evidence: ChannelEvidence[];
};

/**
 * What the page is handed. `items` is the shelf in order, `picks` the same with each one's why. `channels` are the
 * channels that stand (subscribed or not), which is what teaches the page's order; `subscribed` is the plain list.
 */
export type YouTubeFound<T extends ReadVideo = ReadVideo> = Omit<YouTubeRead<T>, 'channels'> & {
  items: T[];
  picks: ShelfPick<T>[];
  channels: { id: string; name: string }[];
  subscribed: { id: string; name: string }[];
  standings: ChannelStanding[];
  /** The videos to ask YouTube's "watch next" about. */
  seeds: SeedVideo[];
};

export const NOTHING_READ: YouTubeRead<never> = { uploads: [], liked: [], likedAt: {}, channels: [], topics: [], playlists: [], evidence: [] };

/** The shelf's length: what YOUR YOUTUBE can show with every [ MORE ] pressed. */
export const SHELF = 60;
/** How many videos "watch next" is asked about on one visit. */
export const SEEDS = 6;

const strings = (value: unknown): string[] => (Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : []);
const videos = <T extends ReadVideo>(value: unknown): T[] =>
  Array.isArray(value) ? (value as T[]).filter((item) => typeof item?.id === 'string' && typeof item?.title === 'string') : [];
const lower = (name: string) => name.trim().toLowerCase();

/** Only the shapes a read gives: a kept copy from an older version, or a hand-edited one, is read as far as it fits. */
export function asRead<T extends ReadVideo>(value: Record<string, unknown>): YouTubeRead<T> {
  const channels = Array.isArray(value.channels)
    ? value.channels.filter((entry): entry is { id: string; name: string } => typeof entry?.id === 'string' && typeof entry?.name === 'string').map(({ id, name }) => ({ id, name }))
    : [];
  const evidence = Array.isArray(value.evidence)
    ? value.evidence
        .filter((entry): entry is ChannelEvidence => typeof entry?.id === 'string' && typeof entry?.name === 'string')
        .map((entry) => ({ id: entry.id, name: entry.name, subscribed: entry.subscribed === true, liked: strings(entry.liked), saved: strings(entry.saved) }))
    : // A copy kept before 2026-11-14 has no days: its subscriptions stand in, in YouTube's order.
      channels.map(({ id, name }) => ({ id, name, subscribed: true, liked: [], saved: [] }));
  const likedAt =
    typeof value.likedAt === 'object' && value.likedAt !== null
      ? Object.fromEntries(Object.entries(value.likedAt).filter((entry): entry is [string, string] => typeof entry[1] === 'string'))
      : {};
  return {
    // That older copy kept one list of videos: they are read as uploads.
    uploads: Array.isArray(value.uploads) ? videos<T>(value.uploads) : videos<T>(value.items),
    liked: videos<T>(value.liked),
    likedAt,
    channels,
    topics: strings(value.topics),
    playlists: strings(value.playlists),
    evidence,
  };
}

/**
 * The read, weighed with what the person does on this site: where each channel stands, and the shelf in order.
 * `related`: YouTube's "watch next" for the seeds, once it has been asked. `summary`: an imported YouTube history.
 */
export function weigh<T extends ReadVideo>(
  read: YouTubeRead<T>,
  rows: readonly HistoryRow[],
  now: number,
  more: { related?: readonly { item: T; seed: string }[]; summary?: WatchSummary | null } = {},
): YouTubeFound<T> {
  const standings = channelStandings({ evidence: read.evidence, rows, summary: more.summary, now });
  const liked = read.liked.map((item) => ({ ...item, likedAt: read.likedAt[item.id] }));
  const picks = youTubeShelf<T>({ uploads: read.uploads, liked: read.liked, related: more.related ?? [], standings, rows, now, size: SHELF });
  const ids = new Map(read.evidence.map((channel) => [lower(channel.name), channel.id]));
  return {
    ...read,
    items: picks.map((pick) => pick.item),
    picks,
    subscribed: read.channels,
    channels: standingNames(standings).map(({ name }) => ({ id: ids.get(lower(name)) ?? '', name })),
    standings,
    seeds: seedVideos({ liked, rows, limit: SEEDS }),
  };
}

/**
 * A channel as the account's copy keeps it (`user_youtube_taste`; Luke's OK 2026-11-14: "up to 50 channels that matter,
 * each with subscribed yes/no and its latest like or add date"). A day, never a count.
 */
export type KeptChannel = { id: string; name: string; sub: boolean; seen: string | null };

export const KEPT_CHANNELS = 50;
const CHANNEL_ID = /^UC[A-Za-z0-9_-]{22}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** The channels the account keeps: the ones that stand first, then the other subscriptions in YouTube's order. */
export function keptChannels(evidence: readonly ChannelEvidence[], standings: readonly ChannelStanding[]): KeptChannel[] {
  const byId = new Map(evidence.map((channel) => [channel.id, channel]));
  const first = standings.filter((standing) => standing.live && standing.id !== null).map((standing) => standing.id as string);
  const kept: KeptChannel[] = [];
  for (const id of new Set([...first, ...evidence.filter((channel) => channel.subscribed).map((channel) => channel.id)])) {
    const channel = byId.get(id);
    if (channel === undefined || !CHANNEL_ID.test(id)) continue;
    const latest = [...channel.liked, ...channel.saved].sort().at(-1)?.slice(0, 10) ?? null;
    kept.push({ id, name: channel.name.slice(0, 100), sub: channel.subscribed, seen: latest !== null && DAY.test(latest) ? latest : null });
    if (kept.length === KEPT_CHANNELS) break;
  }
  return kept;
}

/** The account's copy, read back as evidence. A row saved before 2026-11-14 holds subscriptions only, with no day. */
export function keptAsEvidence(value: unknown): ChannelEvidence[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry): entry is { id: string; name: string; sub?: unknown; seen?: unknown } => typeof entry?.id === 'string' && CHANNEL_ID.test(entry.id) && typeof entry?.name === 'string')
    .slice(0, KEPT_CHANNELS)
    .map((entry) => ({
      id: entry.id,
      name: entry.name.slice(0, 100),
      subscribed: entry.sub !== false,
      liked: typeof entry.seen === 'string' && DAY.test(entry.seen) ? [`${entry.seen}T00:00:00.000Z`] : [],
      saved: [],
    }));
}

/** YouTube ids of channels the person plays on this site: the read asks for their new videos first. */
export function watchedHere(read: Pick<YouTubeRead, 'evidence'>, rows: readonly HistoryRow[]): string[] {
  const ids = new Map(read.evidence.map((channel) => [lower(channel.name), channel.id]));
  const found = rows
    .filter((row) => row.kind === 'media' && row.ref.startsWith('youtube:') && (row.action === 'played' || row.action === 'finished' || row.action === 'more'))
    .map((row) => ids.get(lower(row.maker)))
    .filter((id): id is string => id !== undefined && id !== '');
  return [...new Set(found)].slice(0, 25);
}
