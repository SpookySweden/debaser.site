import type { ForumAuthor, ForumThread, ForumTrack } from '../forum/types';
import { threadDomId } from '../forum/anchors';
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
