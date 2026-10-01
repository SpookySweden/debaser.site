'use client';

import type { ReadMarks } from '../lib/forum/read-state';
import { postIsRead } from '../lib/forum/read-state';
import type { ForumThread } from '../lib/forum/types';
import ForumGalleryTile from './ForumGalleryTile';

type ForumGalleryViewProps = {
  /** The page's threads, already filtered to the posts that carry a picture. */
  threads: ForumThread[];
  /** Opens one of them in the board's feed, where the replies are. */
  onOpen: (threadId: string) => void;
  tagFilter?: string[];
  /** What this reader has read, so a tile is drawn as quiet as the row it stands for. */
  seenByThread?: ReadMarks;
};

/**
 * The board as a wall of pictures.
 *
 * Explorer's "large icons" reading of the same list: one tile per post that carries a picture, all of
 * them drawn open, in a grid rather than a column. It is a *view* and not a second board - the board's
 * query, its paging and its tag filter are the ones feeding it (see `imageOnly` in
 * app/lib/forum/board-query.ts), so a search or a tag narrows this exactly as it narrows the feed, and
 * the count over the top of it says what is in it.
 *
 * The container keeps the feed's own id (`forum-thread-list`), because it is the same place on the
 * page: the board scrolls it into view when the page changes, and a deep link to a post has to land
 * somewhere. Only one of the two readings is in the document at a time, so the id is never doubled.
 *
 * A tile is a post, so it wears the post's own reading state: the reader's marks are handed down and
 * each tile says whether it has been read (`app/lib/forum/read-state.ts`), which is what stops a wall
 * of quiet tiles from being indistinguishable from a wall nobody has opened.
 */
export default function ForumGalleryView({
  threads,
  onOpen,
  tagFilter = [],
  seenByThread = {},
}: ForumGalleryViewProps) {
  return (
    <ul
      id="forum-thread-list"
      data-view="gallery"
      className="grid list-none grid-cols-1 gap-2 rounded-none border-2 border-t-black border-l-black border-r-white border-b-white bg-paper p-2 text-ink sm:grid-cols-2 xl:grid-cols-3"
    >
      {threads.map((thread) => (
        <ForumGalleryTile
          key={thread.id}
          thread={thread}
          onOpen={onOpen}
          tagFilter={tagFilter}
          read={postIsRead(seenByThread, thread.id)}
        />
      ))}
    </ul>
  );
}
