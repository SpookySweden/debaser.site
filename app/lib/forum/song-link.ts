/**
 * A post that is nothing but a link to a beat box song (`ShareSongToForum`). The song is BeepBox's own text
 * after the #, so a post can hold it with no table of its own. The board shows a key rather than the long
 * text, and the key goes to this site's own page, whatever site the link was typed on.
 */
const SONG_LINK = /^https?:\/\/[^/\s]+\/beatbox(#[A-Za-z0-9_-]+)$/;

/** Where the post's song opens, or null if the post isn't a song link. */
export function songHrefIn(body: string): string | null {
  const match = SONG_LINK.exec(body.trim());
  return match === null ? null : `/beatbox${match[1]}`;
}

/** What the board's folded row says in place of the long link. */
export const SONG_POST_WORDS = 'A SONG FROM THE BEAT BOX';
