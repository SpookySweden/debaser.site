'use client';

import Link from 'next/link';
import { useState } from 'react';
import type { SavedSong } from '../features/beatbox';
import { BOARD_TARGET } from '../lib/forum/anchors';
import { smallKey } from '../features/beatbox/ui/looks';
import { useAuth } from './AuthProvider';
import { useForum } from './ForumProvider';

const TITLE_MAX = 80;
const LINK_MAX = 20000;

/**
 * Sharing a song to the forum: an ordinary thread by the person sharing, holding the song's link. Two presses,
 * as starting anything from the board is. Anything posted is as public as any other post.
 */
export default function ShareSongToForum({ getSong }: { getSong: () => SavedSong }) {
  const { status } = useAuth();
  const forum = useForum();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  async function post() {
    const name = title.trim();
    if (name === '') {
      setMessage('Problem: give it a title first.');
      return;
    }
    const { link } = getSong();
    if (link.length > LINK_MAX) {
      setMessage('Problem: this song is too long to post as a link. Save it as a file instead.');
      return;
    }
    setBusy(true);
    try {
      await forum.createThread({ title: name, body: link, anchor: BOARD_TARGET.anchor });
      setOpen(false);
      setTitle('');
      setMessage('Posted to the forum.');
    } catch {
      setMessage("Problem: that didn't post. Try again in a moment.");
    } finally {
      setBusy(false);
    }
  }

  if (status !== 'signed-in') {
    return (
      <Link href="/account" className={smallKey()}>
        Sign in to share
      </Link>
    );
  }

  return (
    <div className="flex w-full flex-col items-start gap-bb-gutter">
      {open ? (
        <>
          <label className="flex w-full flex-col gap-bb-gutter text-bb-large font-bold uppercase">
            Title for the post
            <input
              type="text"
              value={title}
              maxLength={TITLE_MAX}
              onChange={(event) => setTitle(event.target.value)}
              className="bb-field w-full bg-bb-black p-bb-gutter text-bb-large text-bb-white focus:outline-(length:--focus-width) focus:outline-offset-(length:--focus-width) focus:outline-bb-daffodil"
            />
          </label>
          <p className="text-bb-large wrap-anywhere">Everyone on the forum will be able to open this song.</p>
          <div className="flex flex-wrap gap-bb-gutter">
            <button type="button" disabled={busy} onClick={() => void post()} className={smallKey()}>
              Post
            </button>
            <button type="button" onClick={() => setOpen(false)} className={smallKey()}>
              Cancel
            </button>
          </div>
        </>
      ) : (
        <button type="button" onClick={() => setOpen(true)} className={smallKey()}>
          Share to forum
        </button>
      )}
      <p role="status" className="text-bb-large wrap-anywhere">
        {message}
      </p>
    </div>
  );
}
