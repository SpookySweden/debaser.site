'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import type { SavedSong } from '../features/beatbox';
import { smallKey } from '../features/beatbox/ui/looks';
import { getBeatBoxSongRepository } from '../lib/beatbox/repository';
import { SONG_TEXT_MAX, SONG_TITLE_MAX, type SavedBeatBoxSong } from '../lib/beatbox/types';
import { useAuth } from './AuthProvider';

const FIELD =
  'bb-field w-full bg-bb-black p-bb-gutter text-bb-large text-bb-white focus:outline-(length:--focus-width) focus:outline-offset-(length:--focus-width) focus:outline-bb-daffodil';

/** The song text is what's after the # in its link. */
function songText({ link }: SavedSong): string {
  return link.slice(link.indexOf('#') + 1);
}

/**
 * A signed-in person's saved songs. Private to them: nobody else's list reads them, and sharing one is a separate,
 * deliberate forum post. Opening another song or deleting one takes two presses, as both can lose work.
 */
export default function BeatBoxSongs({
  getSong,
  onOpen,
}: {
  getSong: () => SavedSong;
  onOpen: (song: string) => void;
}) {
  const { status, user } = useAuth();
  if (status !== 'signed-in' || !user) {
    return (
      <Link href="/account" className={smallKey()}>
        Sign in to save songs
      </Link>
    );
  }
  return <OwnSongs key={user.id} owner={user.id} getSong={getSong} onOpen={onOpen} />;
}

function OwnSongs({
  owner,
  getSong,
  onOpen,
}: {
  owner: string;
  getSong: () => SavedSong;
  onOpen: (song: string) => void;
}) {
  const [songs, setSongs] = useState<SavedBeatBoxSong[]>([]);
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [armed, setArmed] = useState<string | null>(null);

  const say = useCallback((text: string) => setMessage(text), []);

  useEffect(() => {
    let current = true;
    getBeatBoxSongRepository()
      .list(owner)
      .then((list) => {
        if (current) setSongs(list);
      })
      .catch((error: Error) => {
        if (current) say(`Problem: ${error.message}`);
      });
    return () => {
      current = false;
    };
  }, [owner, say]);

  const me = owner;

  function textToSave(): string | null {
    const text = songText(getSong());
    if (text.length <= SONG_TEXT_MAX) return text;
    say('Problem: this song is too long to save here. Save it as a file instead.');
    return null;
  }

  async function saveNew() {
    const name = title.trim();
    if (name === '') {
      say('Problem: give it a title first.');
      return;
    }
    const text = textToSave();
    if (text === null) return;
    try {
      const saved = await getBeatBoxSongRepository().add(me, name, text);
      setSongs((list) => [saved, ...list]);
      setTitle('');
      say(`Saved: ${saved.title}.`);
    } catch (error) {
      say(`Problem: ${(error as Error).message}`);
    }
  }

  async function saveOver(entry: SavedBeatBoxSong) {
    const text = textToSave();
    if (text === null) return;
    try {
      const saved = await getBeatBoxSongRepository().update(me, entry.id, text);
      setSongs((list) => [saved, ...list.filter((other) => other.id !== saved.id)]);
      say(`Saved over ${saved.title}.`);
    } catch (error) {
      say(`Problem: ${(error as Error).message}`);
    }
  }

  async function remove(entry: SavedBeatBoxSong) {
    setArmed(null);
    try {
      await getBeatBoxSongRepository().remove(me, entry.id);
      setSongs((list) => list.filter((other) => other.id !== entry.id));
      say(`Deleted: ${entry.title}.`);
    } catch (error) {
      say(`Problem: ${(error as Error).message}`);
    }
  }

  /** The first press asks, and the second does it. */
  function twoPresses(key: string, act: () => void) {
    if (armed === key) {
      setArmed(null);
      act();
    } else {
      setArmed(key);
    }
  }

  return (
    <section aria-label="My songs" className="flex w-full flex-col items-start gap-bb-gutter">
      <h3 className="text-bb-large font-bold text-bb-daffodil uppercase">My songs</h3>
      <div className="flex w-full flex-col items-start gap-bb-gutter">
        <label className="flex w-full flex-col gap-bb-gutter text-bb-large font-bold uppercase">
          Title
          <input
            type="text"
            value={title}
            maxLength={SONG_TITLE_MAX}
            onChange={(event) => setTitle(event.target.value)}
            className={FIELD}
          />
        </label>
        <button type="button" onClick={() => void saveNew()} className={smallKey()}>
          Save as new song
        </button>
      </div>
      <p role="status" className="text-bb-large wrap-anywhere">
        {message}
      </p>
      {songs.length === 0 ? null : (
        <ul className="flex w-full flex-col gap-bb-gutter">
          {songs.map((entry) => (
            <li key={entry.id} className="flex flex-wrap items-center gap-bb-gutter">
              <span className="text-bb-large wrap-anywhere">{entry.title}</span>
              <button
                type="button"
                aria-label={armed === `open:${entry.id}` ? `Open ${entry.title}, replacing what's here` : `Open ${entry.title}`}
                onClick={() => twoPresses(`open:${entry.id}`, () => onOpen(entry.song))}
                className={smallKey()}
              >
                {armed === `open:${entry.id}` ? 'Replace what is here?' : 'Open'}
              </button>
              <button
                type="button"
                aria-label={armed === `over:${entry.id}` ? `Save over ${entry.title}, really` : `Save over ${entry.title}`}
                onClick={() => twoPresses(`over:${entry.id}`, () => void saveOver(entry))}
                className={smallKey()}
              >
                {armed === `over:${entry.id}` ? 'Really save over?' : 'Save over'}
              </button>
              <button
                type="button"
                aria-label={armed === `delete:${entry.id}` ? `Delete ${entry.title}, really` : `Delete ${entry.title}`}
                onClick={() => twoPresses(`delete:${entry.id}`, () => void remove(entry))}
                className={smallKey()}
              >
                {armed === `delete:${entry.id}` ? 'Really delete?' : 'Delete'}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
