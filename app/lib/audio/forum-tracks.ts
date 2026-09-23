import type { ForumAuthor, ForumThread, ForumTrack } from '../forum/types';
import { threadDomId } from '../forum/anchors';
import type { TrackSort } from './sorts';
import { normaliseAudioTags } from './tags';
import type { AudioTrack } from './tracks';

/**
 * Tracks filed on the board, as the rest of the site reads them.
 *
 * A track attached to a post is two things at once: something to play (the
 * player's own `AudioTrack`, the same shape the shelf and the profile songs
 * use) and something to find again (which post it came from, and who put it
 * there). Both are settled here rather than in the two components that need
 * them, so the inline player in a thread and the /music directory can never
 * disagree about what a posted track is called.
 */

/**
 * A file the archive holds, as the record a post carries.
 *
 * Nothing is copied and nothing is re-titled: the post keeps the file's own name, credit, tags and
 * running time, so a track pulled from the shelf and the same row in the directory on `/music` are
 * one file with one name. This is the only conversion of its kind - the picker inside a composer and
 * the directory's own `[ ♪ TO A POST ]` both come through here - so the two cannot attach records
 * that differ in shape.
 */
export function forumTrackFromArchive(track: AudioTrack): ForumTrack {
  return {
    src: track.src,
    title: track.title,
    credit: track.credit,
    tags: normaliseAudioTags(track.tags),
    ...(track.length.length === 0 ? {} : { length: track.length }),
  };
}

/** One posted track, with the post it came from. */
export type FiledTrack = {
  /** Ready for `useMusicPlayer()`: pressing play queues it like any other file. */
  track: AudioTrack;
  /** The display name of whoever posted it. */
  poster: string;
  threadId: string;
  threadTitle: string;
  /** Where to read the post it was filed under. */
  href: string;
  filedAt: string;
  /** `POST` for the post's own track, `REPLY` for one attached to a reply. */
  origin: 'POST' | 'REPLY';
};

/** What the player calls a track that was filed from the board. */
export const FILED_ON_BOARD = 'FILED ON THE BOARD';

export function authorName(author: ForumAuthor): string {
  return author.displayName.length > 0 ? author.displayName : 'Anonymous';
}

/**
 * A posted track as the player's own kind.
 *
 * `shelf: 'bucket'` on purpose: the file is where the shelf's files are (the
 * `mp3` bucket, or `assets/audio/` without a backend), so the bar's caption says
 * `UPLOADED`, which is true, rather than inventing a third shelf for it.
 */
export function postedTrackAsAudio(posted: ForumTrack, poster: string): AudioTrack {
  return {
    id: posted.src,
    title: posted.title,
    credit: posted.credit.trim().length === 0 ? poster : posted.credit,
    kind: FILED_ON_BOARD,
    src: posted.src,
    length: posted.length ?? '--:--',
    tags: posted.tags ?? [],
    shelf: 'bucket',
  };
}

/**
 * Every track the board holds, newest post first.
 *
 * The board is read rather than a table of its own: a track is filed *with* a
 * post, so the post is what says it exists. A reply's track is listed with the
 * replies of its own thread, which is the order somebody reading the thread
 * would meet them in.
 */
export function collectFiledTracks(threads: ForumThread[]): FiledTrack[] {
  const filed: FiledTrack[] = [];

  for (const thread of threads) {
    const poster = authorName(thread.author);

    if (thread.track !== undefined) {
      filed.push({
        track: postedTrackAsAudio(thread.track, poster),
        poster,
        threadId: thread.id,
        threadTitle: thread.title,
        href: `/forum#${threadDomId(thread.id)}`,
        filedAt: thread.createdAt,
        origin: 'POST',
      });
    }

    for (const comment of thread.comments) {
      if (comment.track === undefined) continue;

      const commenter = authorName(comment.author);
      filed.push({
        track: postedTrackAsAudio(comment.track, commenter),
        poster: commenter,
        threadId: thread.id,
        threadTitle: thread.title,
        href: `/forum#${threadDomId(thread.id)}`,
        filedAt: comment.createdAt,
        origin: 'REPLY',
      });
    }
  }

  return filed.sort((a, b) => Date.parse(b.filedAt) - Date.parse(a.filedAt));
}

/** One post a file is on: where to read it, and who put it there. */
export type Filing = {
  poster: string;
  threadId: string;
  threadTitle: string;
  href: string;
  filedAt: string;
  origin: 'POST' | 'REPLY';
};

/**
 * The board's music as *files* rather than as postings.
 *
 * The same MP3 can be filed by more than one post, and the question somebody asks about music ("how
 * much is this one around?") is about the file, not about the post that happened to be in front of
 * them. So the postings are folded by `src`: one entry per file, how many posts carry it, who filed
 * it, and when it was last posted - the three orderings the listings offer, each read off the same
 * grouping so they can never disagree.
 */
export type FiledFile = {
  track: AudioTrack;
  /** How many posts and replies carry this file: what "popular" counts. */
  count: number;
  /** Who filed it, newest first, once each. */
  posters: string[];
  /** When it was last posted. */
  newest: string;
  /** Every post it is on, newest first. */
  filings: Filing[];
};

export function groupFiledTracks(filed: FiledTrack[]): FiledFile[] {
  const files = new Map<string, FiledFile>();

  for (const entry of filed) {
    const existing = files.get(entry.track.src);

    if (existing === undefined) {
      files.set(entry.track.src, {
        track: entry.track,
        count: 1,
        posters: [entry.poster],
        newest: entry.filedAt,
        filings: [
          {
            poster: entry.poster,
            threadId: entry.threadId,
            threadTitle: entry.threadTitle,
            href: entry.href,
            filedAt: entry.filedAt,
            origin: entry.origin,
          },
        ],
      });

      continue;
    }

    existing.count += 1;
    if (!existing.posters.includes(entry.poster)) existing.posters.push(entry.poster);
    existing.filings.push({
      poster: entry.poster,
      threadId: entry.threadId,
      threadTitle: entry.threadTitle,
      href: entry.href,
      filedAt: entry.filedAt,
      origin: entry.origin,
    });
  }

  return [...files.values()];
}

/** Who a file is filed under: the first name it arrived with, or the site for an unsigned file. */
export function filedFileUploader(file: FiledFile): string {
  return file.posters[0] ?? (file.track.credit.length === 0 ? 'DEBASER.SITE' : file.track.credit);
}

/** The same files in the order that was asked for. Ties always fall back to the title. */
export function sortFiledFiles(files: FiledFile[], sort: TrackSort): FiledFile[] {
  const byTitle = (a: FiledFile, b: FiledFile) => a.track.title.localeCompare(b.track.title);

  if (sort === 'popular') return [...files].sort((a, b) => b.count - a.count || byTitle(a, b));
  if (sort === 'uploader') {
    return [...files].sort(
      (a, b) => filedFileUploader(a).toLowerCase().localeCompare(filedFileUploader(b).toLowerCase()) || byTitle(a, b),
    );
  }
  if (sort === 'name') return [...files].sort(byTitle);

  // Recent: an ISO stamp compares as text, newest first.
  return [...files].sort((a, b) => b.newest.localeCompare(a.newest) || byTitle(a, b));
}
