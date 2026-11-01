/**
 * The playable file(s) behind a WEB audio item, for the site's music bar (`web-audio.ts` has the why).
 * Server-side only: it reads each platform's own official listing through `safe-fetch`, and never the
 * audio itself - the listener's browser is the only thing that touches a file, through the redirect the
 * file route answers with.
 *
 *   Internet Archive  the public metadata API (archive.org/metadata/{id}): the item's audio files, one
 *                     format only (VBR MP3 first), in track order. A LibriVox book is its chapters.
 *   Podcast           the hand-picked feed again (hosts.ts): the episode's own audio enclosure.
 *   Openverse         the public audio API (api.openverse.org/v1/audio/{id}/): the work's file address.
 *
 * Every answer is held in the day-long server fetch cache (`cachedFetch`), so playing the same item again,
 * or the next chapter, costs the platform nothing. Openverse has its own small daily budget on top, because
 * its anonymous limit (200 a day) is shared with the stream's reads.
 */
import { PODCAST_FEEDS } from './hosts';
import { IA_ALLOWED_HOSTS } from './adapters/internet-archive';
import { OV_ALLOWED_HOSTS, OV_FETCH_TIMEOUT_MS } from './adapters/openverse';
import { creatorName, episodeExternalId } from './adapters/podcast';
import { child, childText, children, parseXml } from './adapters/xml';
import { safeFetchJson, safeFetchText, type FetchLike } from './safe-fetch';
import { sanitiseText } from './sanitise';
import { buildUrl, isSafeIdentifier } from './urls';
import { MAX_WEB_FILES, type BarAudioPlatform, type WebAudioAnswer } from './web-audio';

/** One playable file: what the bar shows, and where the browser is sent for it. */
export type WebAudioFile = { title: string; seconds: number | null; url: string };
export type WebAudioItem = { title: string; creator: string; files: WebAudioFile[] };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MAX_SECONDS = 7 * 24 * 60 * 60;

/**
 * The Archive's audio formats, best first. An item usually carries the same recording in several (a
 * LibriVox book has VBR, 64 kbps and Ogg copies of every chapter), so only the best one present is used,
 * or every chapter would be queued three times.
 */
const IA_FORMATS = ['VBR MP3', '320Kbps MP3', '256Kbps MP3', '192Kbps MP3', '160Kbps MP3', '128Kbps MP3', 'MP3', '96Kbps MP3', '64Kbps MP3', 'Ogg Vorbis', 'Flac'];

/** An https address the browser may be sent to: no credentials, no odd port, nothing but a plain file URL. */
function playableUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 2048) return null;
  let url: URL;
  try {
    url = new URL(value.trim().replace(/^http:\/\//i, 'https://'));
  } catch {
    return null;
  }
  return url.protocol === 'https:' && url.username === '' && url.password === '' && url.port === '' ? url.toString() : null;
}

/** Seconds out of `507.1`, `08:26` or `1:02:03`, or null. */
export function secondsOf(value: unknown): number | null {
  const text = typeof value === 'number' ? String(value) : typeof value === 'string' ? value.trim() : '';
  let seconds: number;
  if (/^\d+(\.\d+)?$/.test(text)) seconds = Number(text);
  else if (/^\d{1,3}(:\d{1,2}){1,2}$/.test(text)) seconds = text.split(':').reduce((total, part) => total * 60 + Number(part), 0);
  else return null;
  return seconds > 0 && seconds <= MAX_SECONDS ? seconds : null;
}

function str(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.find((entry): entry is string => typeof entry === 'string');
  return undefined;
}

/** The Archive's metadata answer as playable files, or null when it has none or may not be played. */
export function parseArchiveMetadata(id: string, body: unknown): WebAudioItem | null {
  if (!body || typeof body !== 'object') return null;
  const record = body as Record<string, unknown>;
  if (record.is_dark === true || !Array.isArray(record.files)) return null;
  const metadata = (record.metadata ?? {}) as Record<string, unknown>;
  const restricted = str(metadata['access-restricted-item']);
  if (restricted !== undefined && restricted.trim().toLowerCase() === 'true') return null;

  const files = record.files.filter(
    (file): file is Record<string, unknown> =>
      !!file && typeof file === 'object' && typeof (file as Record<string, unknown>).name === 'string' && str((file as Record<string, unknown>).private) !== 'true',
  );
  const format = IA_FORMATS.find((wanted) => files.some((file) => file.format === wanted));
  if (!format) return null;

  const chosen = files
    .filter((file) => file.format === format)
    .map((file) => ({ file, track: Number.parseInt(str(file.track) ?? '', 10) }))
    // The Archive's own track numbers when it has them, the file name otherwise ("01", "02", ...).
    .sort((a, b) =>
      Number.isFinite(a.track) && Number.isFinite(b.track) && a.track !== b.track
        ? a.track - b.track
        : String(a.file.name).localeCompare(String(b.file.name), 'en', { numeric: true }),
    )
    .slice(0, MAX_WEB_FILES);

  const out: WebAudioFile[] = [];
  for (const { file } of chosen) {
    const name = String(file.name);
    // Path segments are encoded one by one: a file may sit in a folder inside the item.
    if (name.length > 500 || name.split('/').some((part) => part === '' || part === '.' || part === '..')) continue;
    out.push({
      // No title from the Archive: blank, and the bar names it "<book> (n)" (`webTracks`), never a file name.
      title: sanitiseText(str(file.title), 300),
      seconds: secondsOf(file.length),
      url: buildUrl('archive.org', ['download', id, ...name.split('/')]),
    });
  }
  if (out.length === 0) return null;

  return {
    title: sanitiseText(str(metadata.title), 300) || id,
    creator: sanitiseText(str(metadata.creator), 200),
    files: out,
  };
}

/** The one episode in a feed with this id, as a playable file, or null. */
export function parsePodcastEpisode(xml: string, externalId: string): WebAudioItem | null {
  const feed = PODCAST_FEEDS.find((entry) => externalId.startsWith(`${entry.key}-`));
  if (!feed) return null;
  const channel = child(parseXml(xml), 'channel');
  for (const item of children(channel, 'item')) {
    if (episodeExternalId(item, feed) !== externalId) continue;
    const enclosure = child(item, 'enclosure');
    if (!(enclosure?.attrs.type ?? '').trim().toLowerCase().startsWith('audio/')) return null;
    const url = playableUrl(enclosure?.attrs.url);
    if (!url) return null;
    return {
      title: sanitiseText(childText(item, 'title'), 300) || 'Untitled episode',
      creator: creatorName(childText(item, 'itunes:author') ?? childText(item, 'author')) ?? '',
      files: [{ title: '', seconds: secondsOf(childText(item, 'itunes:duration')), url }],
    };
  }
  return null;
}

/** Openverse's answer for one audio work as a playable file, or null. */
export function parseOpenverseAudio(body: unknown): WebAudioItem | null {
  if (!body || typeof body !== 'object') return null;
  const record = body as Record<string, unknown>;
  if (record.mature !== false && record.mature !== undefined) return null;
  const url = playableUrl(record.url);
  if (!url) return null;
  const ms = typeof record.duration === 'number' ? record.duration : null;
  return {
    title: sanitiseText(str(record.title), 300) || 'Untitled',
    creator: sanitiseText(str(record.creator), 200),
    files: [{ title: '', seconds: ms !== null ? secondsOf(Math.round(ms / 1000)) : null, url }],
  };
}

export type ResolveDeps = { fetch?: FetchLike; spendOpenverse?: () => boolean };

/** An item's playable files, or null when it has none the bar can use. Throws `SafeFetchError` on a failed read. */
export async function resolveWebAudio(platform: BarAudioPlatform, externalId: string, deps: ResolveDeps = {}): Promise<WebAudioItem | null> {
  if (!isSafeIdentifier(externalId)) return null;
  const fetchImpl = deps.fetch;

  if (platform === 'internet_archive') {
    const body = await safeFetchJson(buildUrl('archive.org', ['metadata', externalId]), { allowedHosts: IA_ALLOWED_HOSTS, fetchImpl });
    return parseArchiveMetadata(externalId, body);
  }

  if (platform === 'podcast') {
    const feed = PODCAST_FEEDS.find((entry) => externalId.startsWith(`${entry.key}-`));
    if (!feed) return null;
    const xml = await safeFetchText(feed.feedUrl, {
      allowedHosts: [new URL(feed.feedUrl).hostname],
      fetchImpl,
      accept: 'application/rss+xml, application/xml;q=0.9, text/xml;q=0.8',
    });
    return parsePodcastEpisode(xml, externalId);
  }

  if (!UUID.test(externalId)) return null;
  if (deps.spendOpenverse && !deps.spendOpenverse()) return null;
  const body = await safeFetchJson(buildUrl('api.openverse.org', ['v1', 'audio', externalId, '']), {
    allowedHosts: OV_ALLOWED_HOSTS,
    fetchImpl,
    timeoutMs: OV_FETCH_TIMEOUT_MS,
  });
  return parseOpenverseAudio(body);
}

/** What the page is told: the words and running times, never the platform's file addresses. */
export function answerFor(item: WebAudioItem): WebAudioAnswer {
  return { title: item.title, creator: item.creator, files: item.files.map(({ title, seconds }) => ({ title, seconds })) };
}
