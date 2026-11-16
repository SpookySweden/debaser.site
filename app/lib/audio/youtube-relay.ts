import { SafeFetchError, safeFetchJson, safeFetchStream, type FetchLike } from '../web/safe-fetch';
import { buildUrl } from '../web/urls';

/**
 * YouTube's sound, relayed through the site so the sound graph can measure it (Luke, 2026-11-16: "both", the fallback to
 * listening to the tab). Server only. The graph's hidden player asks `/api/audio/relay/<id>` for a slice at a time; this
 * finds the video's smallest audio file through InnerTube's player answer (the JSON YouTube's own apps ask for) and
 * passes that slice through. The sound is played by nobody: the page only measures it.
 *
 * The risks, said once:
 * - **double data**: the reader's browser fetches the sound twice, once in YouTube's player and once here (the smallest
 *   file YouTube has, about 0.4 MB a minute), and the site's server carries the second copy;
 * - **drift**: the copy is kept within a second and a half of YouTube's own player, by what YouTube's player says;
 * - **YouTube may refuse the server**: from a data centre it often answers "sign in to confirm you're not a bot". Then
 *   this answers 502 and the graph moves gently instead (or listens to the tab, if the reader allows it).
 * - an audio address is tied to the address that asked for it, so each slice may ask afresh when the server's own
 *   address changes between requests (a refusal is retried once with a new answer).
 *
 * Kept to: one allow-listed host for the question (www.youtube.com), YouTube's own numbered file servers for the slice,
 * a validated video id, a slice at most `SLICE_BYTES` long, nothing stored but a few addresses in memory for a few minutes.
 */

const HOST = 'www.youtube.com';
const PLAYER_URL = buildUrl(HOST, ['youtubei', 'v1', 'player'], [['prettyPrint', 'false']]);
/** YouTube's numbered file servers, the only hosts a slice is read from. */
const FILE_SERVER = /^rr\d{1,3}---sn-[a-z0-9-]{4,40}\.googlevideo\.com$/;
export const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
/** A slice: about two and a half minutes of the smallest file. The player asks again for the next. */
export const SLICE_BYTES = 1024 * 1024;

/**
 * The apps whose answers carry plain audio addresses, in the order they are tried. Checked from a home connection on
 * 2026-11-16: the iPhone app's answer did; the headset app's said "sign in"; the TV's said it is no longer supported.
 */
const CLIENTS = [
  {
    clientName: 'IOS',
    clientVersion: '20.10.4',
    userAgent: 'com.google.ios.youtube/20.10.4 (iPhone16,2; U; CPU iOS 18_3_2 like Mac OS X;)',
    extra: { deviceMake: 'Apple', deviceModel: 'iPhone16,2', osName: 'iPhone', osVersion: '18.3.2.22D82' },
  },
  {
    clientName: 'ANDROID_VR',
    clientVersion: '1.60.19',
    userAgent: 'com.google.android.apps.youtube.vr.oculus/1.60.19 (Linux; U; Android 12L; eureka-user Build/SQ3A.220605.009.A1) gzip',
    extra: { androidSdkVersion: 32, deviceMake: 'Oculus', deviceModel: 'Quest 3', osName: 'Android', osVersion: '12L' },
  },
] as const;

export type RelayFile = { url: string; host: string; length: number; type: string; userAgent: string };

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

/**
 * The smallest audio file in a player answer that has a plain address on a YouTube file server, preferring MP4 (every
 * browser plays it), or null. Only the address, its length and its type are read.
 */
export function pickAudioFile(answer: unknown, userAgent: string): RelayFile | null {
  const formats = record(record(answer)?.streamingData)?.adaptiveFormats;
  if (!Array.isArray(formats)) return null;
  const found: (RelayFile & { bitrate: number; mp4: boolean })[] = [];
  for (const raw of formats) {
    const format = record(raw);
    if (!format) continue;
    const type = typeof format.mimeType === 'string' ? format.mimeType : '';
    if (!type.startsWith('audio/') || typeof format.url !== 'string') continue;
    let host: string;
    try {
      const url = new URL(format.url);
      if (url.protocol !== 'https:') continue;
      host = url.hostname;
    } catch {
      continue;
    }
    if (!FILE_SERVER.test(host)) continue;
    const length = Number(format.contentLength);
    if (!Number.isFinite(length) || length <= 0) continue;
    const bitrate = Number(format.bitrate);
    found.push({ url: format.url, host, length, type: type.split(';')[0], userAgent, bitrate: Number.isFinite(bitrate) ? bitrate : Infinity, mp4: type.startsWith('audio/mp4') });
  }
  found.sort((a, b) => Number(b.mp4) - Number(a.mp4) || a.bitrate - b.bitrate);
  const best = found[0];
  return best ? { url: best.url, host: best.host, length: best.length, type: best.type, userAgent: best.userAgent } : null;
}

/** Answers kept a few minutes, so a video's slices do not each ask YouTube again. Never written anywhere. */
const KEPT_MS = 5 * 60_000;
const kept = new Map<string, { file: RelayFile; at: number }>();

/** The video's audio file, asked of each app in turn; null when none hands one out (refused, private, live, gone). */
export async function findAudioFile(videoId: string, options: { fresh?: boolean; fetchImpl?: FetchLike } = {}): Promise<RelayFile | null> {
  if (!VIDEO_ID.test(videoId)) return null;
  const was = kept.get(videoId);
  if (!options.fresh && was && Date.now() - was.at < KEPT_MS) return was.file;
  for (const client of CLIENTS) {
    try {
      const answer = await safeFetchJson(PLAYER_URL, {
        allowedHosts: [HOST],
        fetchImpl: options.fetchImpl,
        timeoutMs: 8_000,
        userAgent: client.userAgent,
        postJson: {
          context: { client: { clientName: client.clientName, clientVersion: client.clientVersion, hl: 'en', gl: 'US', ...client.extra } },
          videoId,
          contentCheckOk: true,
          racyCheckOk: true,
        },
      });
      const file = pickAudioFile(answer, client.userAgent);
      if (file) {
        kept.set(videoId, { file, at: Date.now() });
        if (kept.size > 200) kept.delete(kept.keys().next().value as string);
        return file;
      }
    } catch {
      // This app refused or failed: the next one is asked.
    }
  }
  kept.delete(videoId);
  return null;
}

/** The slice a `Range` header asks for, cut to `SLICE_BYTES` and the file's end; null when it asks past the end. */
export function sliceFor(range: string | null, length: number): { start: number; end: number } | null {
  let start = 0;
  let end = length - 1;
  if (range !== null) {
    const match = range.match(/^bytes=(\d{1,12})-(\d{0,12})$/);
    if (match) {
      start = Number(match[1]);
      if (match[2] !== '') end = Math.min(end, Number(match[2]));
    }
  }
  if (start >= length || end < start) return null;
  return { start, end: Math.min(end, start + SLICE_BYTES - 1) };
}

/**
 * One slice of the video's sound, as the answer to the graph's player: 206 with the slice, 416 past the end, 404 for a
 * malformed id, 502 when YouTube hands out nothing.
 */
export async function relaySlice(videoId: string, range: string | null, fetchImpl?: FetchLike): Promise<Response> {
  if (!VIDEO_ID.test(videoId)) return new Response('not a video', { status: 404 });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const file = await findAudioFile(videoId, { fresh: attempt > 0, fetchImpl });
    if (file === null) return new Response('no sound', { status: 502, headers: { 'Cache-Control': 'no-store' } });
    const slice = sliceFor(range, file.length);
    if (slice === null) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${file.length}` } });
    try {
      const opened = await safeFetchStream(file.url, {
        allowedHosts: [file.host],
        fetchImpl,
        timeoutMs: 20_000,
        maxBytes: SLICE_BYTES + 1,
        accept: '*/*',
        userAgent: file.userAgent,
        range: `bytes=${slice.start}-${slice.end}`,
      });
      return new Response(opened.body, {
        status: 206,
        headers: {
          'Content-Type': file.type,
          'Content-Range': `bytes ${slice.start}-${slice.end}/${file.length}`,
          'Content-Length': String(slice.end - slice.start + 1),
          'Accept-Ranges': 'bytes',
          'Cache-Control': 'private, no-store',
        },
      });
    } catch (error) {
      // A refused address (tied to another server address, or expired): asked afresh once.
      if (!(error instanceof SafeFetchError) || attempt > 0) break;
    }
  }
  return new Response('no sound', { status: 502, headers: { 'Cache-Control': 'no-store' } });
}
