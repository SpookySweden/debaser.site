import type { WatchSummary } from './youtube-picks';

/**
 * A person's own YouTube watch history, from Google Takeout (Luke, 2026-11-14: "Import real YouTube history from Google
 * Takeout"). Google's API gives no watch history, but anyone can download their own from takeout.google.com as
 * `watch-history.json` (or `.html`). This reads that file's text and makes a small summary of it.
 *
 * Pure: no browser, no network. The page reads the file in the person's own browser and hands the text here; the file
 * is never uploaded. Only the summary leaves this function: channel names with a strength from 1 to 5 and the month
 * each was last watched, and topic words. No video, title, address or time of day is kept.
 */

/** One watched video, as far as the summary needs it. Never stored. */
export type WatchedVideo = { title: string; channel: string; at: number };

export const MAX_CHANNELS = 200;
export const MAX_WORDS = 60;
/** A file bigger than this is not read: a watch history of many years is tens of megabytes, not hundreds. */
export const MAX_FILE_BYTES = 250 * 1024 * 1024;
const DAY_MS = 86_400_000;
/** What was watched longer ago than this says little about now. */
const LOOK_BACK_DAYS = 730;
/** A watch halves every three months. */
const HALF_LIFE_DAYS = 90;
/** A word must turn up this often, from at least two channels, to be a topic. */
const WORD_MIN_TIMES = 3;

export type TakeoutResult = { ok: true; summary: WatchSummary; watched: number } | { ok: false; problem: string };

const clean = (text: unknown, max: number): string => (typeof text === 'string' ? text.replace(/\s+/g, ' ').trim().slice(0, max) : '');

/** `watch-history.json`: a list of things watched. Adverts and videos since removed have no channel and are passed over. */
function fromJson(text: string): WatchedVideo[] | null {
  let list: unknown;
  try {
    list = JSON.parse(text);
  } catch {
    return null;
  }
  if (!Array.isArray(list)) return null;
  const watched: WatchedVideo[] = [];
  for (const entry of list) {
    if (typeof entry !== 'object' || entry === null) continue;
    const { header, title, subtitles, time, details } = entry as { header?: unknown; title?: unknown; subtitles?: unknown; time?: unknown; details?: unknown };
    if (header !== 'YouTube' && header !== 'YouTube Music') continue;
    // "From Google Ads": an advert that played, not something they chose.
    if (Array.isArray(details) && details.length > 0) continue;
    const channel = Array.isArray(subtitles) ? clean((subtitles[0] as { name?: unknown } | undefined)?.name, 100) : '';
    const at = typeof time === 'string' ? Date.parse(time) : NaN;
    if (channel === '' || !Number.isFinite(at)) continue;
    watched.push({ title: clean(title, 300), channel, at });
  }
  return watched;
}

const ENTITIES: Readonly<Record<string, string>> = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", apos: "'", nbsp: ' ' };
const plain = (html: string): string =>
  html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (whole, name: string) => {
      const known = ENTITIES[name.toLowerCase()];
      if (known !== undefined) return known;
      const code = /^#x/i.test(name) ? parseInt(name.slice(2), 16) : /^#/.test(name) ? parseInt(name.slice(1), 10) : NaN;
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : whole;
    });

/**
 * `watch-history.html`: the same list as a page. Each thing watched is one block holding a link to the video, a link
 * to the channel, and the date as that person's Google language writes it. Only those three are picked out; the text
 * is never drawn or run as a page.
 */
function fromHtml(text: string): WatchedVideo[] | null {
  if (!/content-cell/.test(text)) return null;
  const watched: WatchedVideo[] = [];
  for (const block of text.split(/<div class="content-cell[^"]*mdl-cell--6-col[^"]*"[^>]*>/).slice(1)) {
    const body = block.slice(0, block.indexOf('</div>') === -1 ? undefined : block.indexOf('</div>'));
    const video = /<a href="https:\/\/(?:www|music)\.youtube\.com\/watch\?v=[^"]*">([\s\S]*?)<\/a>/.exec(body);
    const channel = /<a href="https:\/\/www\.youtube\.com\/(?:channel\/|@|user\/|c\/)[^"]*">([\s\S]*?)<\/a>/.exec(body);
    if (video === null || channel === null) continue;
    // The date is the last line of the block. Google writes "Oct 1, 2026, 12:34:56 PM GMT", with odd spaces.
    const lines = body.split(/<br\s*\/?>/i).map((line) => plain(line).replace(/[  ]/g, ' ').replace(/\s+/g, ' ').trim()).filter(Boolean);
    const at = Date.parse(lines.at(-1) ?? '');
    if (!Number.isFinite(at)) continue;
    watched.push({ title: clean(plain(video[1]), 300), channel: clean(plain(channel[1]), 100), at });
  }
  return watched;
}

/** The videos a Takeout file lists, or null when the text is neither of the two files Takeout makes. */
export function watchedFrom(text: string): WatchedVideo[] | null {
  const start = text.slice(0, 200).trimStart();
  return start.startsWith('[') ? fromJson(text) : fromHtml(text);
}

/** Words that say nothing about a topic, and Takeout's own "Watched". */
const DULL = new Set(
  'watched the and for with from this that these those your you are was were will have has had not but all any can out new how why what when who into over full part episode official video videos music audio lyrics live feat best more most very just like about after before than then them they their here there make made making first last next ever every some one two three shorts short trailer review reaction vlog'.split(' '),
);

const titleWords = (title: string): string[] => [
  ...new Set(
    title
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((word) => word.length >= 4 && word.length <= 30 && !DULL.has(word) && !/^\d+$/.test(word)),
  ),
];

/**
 * The summary: which channels, how strongly (often and lately count for more), the month each was last watched, and
 * the words their watched titles share. What was watched more than two years ago is left out.
 */
export function summarise(watched: readonly WatchedVideo[], now: number): WatchSummary {
  const channels = new Map<string, { name: string; score: number; last: number }>();
  const words = new Map<string, { score: number; times: number; from: Set<string> }>();
  for (const video of watched) {
    const age = (now - video.at) / DAY_MS;
    if (!(age <= LOOK_BACK_DAYS)) continue;
    const weight = 0.5 ** (Math.max(0, age) / HALF_LIFE_DAYS);
    const key = video.channel.toLowerCase();
    const channel = channels.get(key) ?? { name: video.channel, score: 0, last: 0 };
    channel.score += weight;
    channel.last = Math.max(channel.last, video.at);
    channels.set(key, channel);
    for (const word of titleWords(video.title)) {
      // A channel's own name in its titles is not a topic.
      if (key.includes(word)) continue;
      const found = words.get(word) ?? { score: 0, times: 0, from: new Set<string>() };
      found.score += weight;
      found.times += 1;
      found.from.add(key);
      words.set(word, found);
    }
  }
  const ranked = [...channels.values()].sort((a, b) => b.score - a.score || a.name.localeCompare(b.name)).slice(0, MAX_CHANNELS);
  const top = ranked[0]?.score ?? 1;
  return {
    channels: ranked.map((channel) => ({
      name: channel.name,
      // 1 to 5 against the person's own most-watched channel: no count of anything is kept.
      strength: Math.max(1, Math.min(5, Math.ceil(5 * Math.sqrt(channel.score / top)))),
      last: new Date(channel.last).toISOString().slice(0, 7),
    })),
    words: [...words.entries()]
      .filter(([, found]) => found.times >= WORD_MIN_TIMES && found.from.size >= 2)
      .sort(([a, x], [b, y]) => y.score - x.score || a.localeCompare(b))
      .slice(0, MAX_WORDS)
      .map(([word]) => word),
    importedAt: new Date(now).toISOString(),
  };
}

/** A Takeout file's text as a summary, or what is wrong with it in plain words. */
export function readTakeout(text: string, now: number): TakeoutResult {
  const watched = watchedFrom(text);
  if (watched === null) return { ok: false, problem: 'THAT IS NOT A WATCH HISTORY FILE FROM GOOGLE TAKEOUT. CHOOSE THE FILE NAMED WATCH-HISTORY.' };
  if (watched.length === 0) return { ok: false, problem: 'NO WATCHED VIDEOS COULD BE READ FROM THAT FILE. IN TAKEOUT, SET HISTORY TO JSON AND TRY AGAIN.' };
  const summary = summarise(watched, now);
  if (summary.channels.length === 0) return { ok: false, problem: 'THAT FILE HOLDS NOTHING WATCHED IN THE LAST TWO YEARS.' };
  return { ok: true, summary, watched: watched.length };
}

/** A summary read back from storage, as far as it is shaped like one. */
export function asSummary(value: unknown): WatchSummary | null {
  if (typeof value !== 'object' || value === null) return null;
  const { channels, words, importedAt } = value as { channels?: unknown; words?: unknown; importedAt?: unknown };
  if (!Array.isArray(channels)) return null;
  const kept = channels
    .filter((entry): entry is { name: string; strength: number; last: string } => typeof entry?.name === 'string' && typeof entry?.strength === 'number' && typeof entry?.last === 'string' && /^\d{4}-\d{2}$/.test(entry.last))
    .slice(0, MAX_CHANNELS)
    .map((entry) => ({ name: entry.name.slice(0, 100), strength: Math.max(1, Math.min(5, Math.round(entry.strength))), last: entry.last }));
  if (kept.length === 0) return null;
  return {
    channels: kept,
    words: (Array.isArray(words) ? words : []).filter((word): word is string => typeof word === 'string').slice(0, MAX_WORDS).map((word) => word.slice(0, 60)),
    importedAt: typeof importedAt === 'string' ? importedAt : new Date(0).toISOString(),
  };
}
