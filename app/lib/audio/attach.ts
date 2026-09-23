import type { ForumTrack } from '../forum/types';
import { validateTrackFile } from './catalogue';
import { formatTrackLength } from './format';
import { getMusicRepository } from './repository';
import { normaliseAudioTags } from './tags';
import { titleFromFileName } from './tracks';

/**
 * Getting an MP3 onto a post.
 *
 * Two ways in, because two kinds of poster want it:
 *
 *   - a file from the poster's own machine; the audio is filed where every other
 *     track on the site is
 *     (`getMusicRepository()`, so the `mp3` bucket with Supabase configured and the
 *     project's own `assets/audio/` folder without it) and the post keeps only what
 *     the board says about it;
 *   - a link to an MP3 that is already somewhere else, which is the way in for a
 *     guest - the site never has to hold the file, and the post still plays.
 *
 * Both end at the same `ForumTrack`, so a thread reads the same either way.
 */

/** Audio extensions the link field will take, taken from the shelf's own list. */
const AUDIO_SUFFIXES = ['.mp3', '.m4a', '.ogg', '.wav', '.flac'];
const LINK_PROBLEM = 'THAT LINK IS NOT AN AUDIO FILE - POINT IT AT AN MP3, M4A, OGG, WAV OR FLAC.';

export type TrackLinkInput = {
  /** What the poster typed. */
  src: string;
  /** Optional: falls back to the file name in the link. */
  title: string;
  credit: string;
  tags: string[];
};

export type TrackLinkResult = { ok: true; track: ForumTrack } | { ok: false; error: string };

/**
 * A link, if it is one the shelf can play.
 *
 * A path is accepted the way a browser accepts one (`https://...`, or a path on
 * this site like `/assets/audio/theme.mp3`), and the *file* has to be audio: a
 * link to a page that happens to mention an mp3 is not a track. Query strings are
 * allowed and ignored, because that is how a lot of file hosts hand out a link.
 */
export function trackFromLink(input: TrackLinkInput): TrackLinkResult {
  const src = input.src.trim();

  if (src.length === 0) return { ok: false, error: 'PASTE A LINK TO THE AUDIO FILE FIRST.' };

  const isUrl = /^https?:\/\//i.test(src);
  const isSitePath = src.startsWith('/');

  if (!isUrl && !isSitePath) {
    return { ok: false, error: 'LINKS START WITH https:// OR WITH A PATH ON THIS SITE (/assets/audio/...).' };
  }

  const path = src.split('?')[0].split('#')[0];
  if (audioExtension(path) === undefined) return { ok: false, error: LINK_PROBLEM };

  const title = input.title.trim().length === 0 ? titleFromFileName(path) : input.title.trim();

  return {
    ok: true,
    track: {
      src,
      title,
      credit: input.credit.trim(),
      tags: normaliseAudioTags(input.tags),
    },
  };
}

/** `.mp3` for a path the shelf takes; undefined for anything else. */
function audioExtension(path: string): string | undefined {
  const lower = path.toLowerCase();
  return AUDIO_SUFFIXES.find((suffix) => lower.endsWith(suffix));
}

export type UploadPostTrackInput = {
  file: File;
  title: string;
  credit: string;
  tags: string[];
  /** The account filing it. A post's audio needs an account: an upload is a write. */
  uploader: { id: string; displayName: string };
};

/**
 * Files a track and hands back what the post keeps.
 *
 * The title defaults to the file's own name, the credit to the uploader, and the
 * store is the site's one music store - so a track filed from a thread is on the
 * shelf, in the player's queue, and in the /music directory at the same time as
 * it appears under the post. A refusal comes back as thrown words, exactly as the
 * music shelf reports one.
 */
export async function uploadPostTrack(input: UploadPostTrackInput): Promise<ForumTrack> {
  const problem = validateTrackFile(input.file);
  if (problem !== undefined) throw new Error(problem);

  const title = input.title.trim().length === 0 ? titleFromFileName(input.file.name) : input.title.trim();
  // Measured here, before the bytes go anywhere: the browser can read a file's
  // running time in a moment, and the length column of the directory wants a
  // number rather than a placeholder.
  const length = await measureTrackLength(input.file);

  const track = await getMusicRepository().uploadTrack({
    uploaderId: input.uploader.id,
    uploaderName: input.uploader.displayName,
    title,
    credit: input.credit.trim().length === 0 ? input.uploader.displayName : input.credit.trim(),
    tags: normaliseAudioTags(input.tags),
    ...(length === undefined ? {} : { length }),
    file: input.file,
  });

  return {
    src: track.src,
    title: track.title,
    credit: track.credit,
    tags: normaliseAudioTags(track.tags),
    length: track.length,
  };
}

/**
 * A file's running time as the directory prints it: `3:41`, or undefined when the
 * browser will not read it (an unplayable file, or a codec it has no decoder for).
 *
 * Nothing depends on the answer - a track with no measurable length simply shows
 * `--:--` until the player reports one - so a failure here is quiet rather than
 * something the poster has to deal with.
 */
export async function measureTrackLength(file: File): Promise<string | undefined> {
  if (typeof window === 'undefined' || typeof window.URL.createObjectURL !== 'function') return undefined;

  const url = window.URL.createObjectURL(file);

  try {
    const seconds = await new Promise<number>((resolve, reject) => {
      const audio = new Audio();
      audio.preload = 'metadata';
      audio.onloadedmetadata = () => resolve(audio.duration);
      audio.onerror = () => reject(new Error('the file could not be read'));
      audio.src = url;
    });

    return Number.isFinite(seconds) && seconds > 0 ? formatTrackLength(seconds) : undefined;
  } catch {
    return undefined;
  } finally {
    window.URL.revokeObjectURL(url);
  }
}
