/**
 * How a listing of files can be ordered, in the words the browser offers them in.
 *
 * `name` is the archive's own order and the default - a directory is read by name. The other three
 * are the questions somebody asks about a *file* rather than about the shelf: when it was last
 * posted, how many people have posted it, and who posted it. All three are read off what the board
 * holds (`filedAt` / `filedCount`), so nothing has to be counted twice or kept in a column.
 *
 * It lives on its own, with no imports, because both listings need it: the archive browser
 * (`archive-tree.ts`) and the board's own music list (`forum-tracks.ts`).
 */
export type TrackSort = 'name' | 'recent' | 'popular' | 'uploader';

export const TRACK_SORTS: { value: TrackSort; label: string; hint: string }[] = [
  { value: 'name', label: 'A TO Z', hint: 'By track title, the order the directory is read in' },
  { value: 'recent', label: 'RECENT', hint: 'Newest post first; a file nobody has posted yet comes last' },
  { value: 'popular', label: 'POPULAR', hint: 'Most posted first: how many posts and replies carry the file' },
  { value: 'uploader', label: 'UPLOADER', hint: 'By whoever filed it, then by name' },
];
