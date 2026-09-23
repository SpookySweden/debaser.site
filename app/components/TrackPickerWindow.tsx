'use client';

import type { ForumAuthor, ForumTrack } from '../lib/forum/types';
import PopoutWindow from './PopoutWindow';
import TrackAttachmentPicker from './TrackAttachmentPicker';

type TrackPickerWindowProps = {
  id: string;
  author: ForumAuthor;
  onClose: () => void;
  /** The track that was picked: the window's whole answer, and the end of its business. */
  onPick: (track: ForumTrack) => void;
};

/**
 * The soundtrack, picked in a window.
 *
 * The archive is what a reader is looking at first, because the archive is where a track they
 * already know the name of lives - one of the netlabel's own releases, or anything else filed on the
 * shelf. The source is a tab, not a question asked before any names appear, and a track that is not
 * in the first screenful is a search away rather than invisible.
 *
 * One press attaches and closes: the record is filed with the post as it is submitted, the window's
 * promise is kept, and the composer is exactly as it was left.
 */
export default function TrackPickerWindow({ id, author, onClose, onPick }: TrackPickerWindowProps) {
  return (
    <PopoutWindow
      title="SOUNDTRACK :: PICK A TRACK"
      badge="[ MP3 ]"
      onClose={onClose}
      maxWidth="max-w-xl"
      status="ONE TRACK TO A POST :: THE ARCHIVE KEEPS OWNING THE AUDIO"
    >
      <TrackAttachmentPicker id={id} author={author} onChange={onPick} />
    </PopoutWindow>
  );
}
