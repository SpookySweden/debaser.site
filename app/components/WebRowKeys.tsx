'use client';

import type { PlaylistThing } from '../lib/audio/playlist-adding';
import type { LetterThing } from '../lib/letters/types';
import AddToLetterKey from './AddToLetterKey';
import AddToPlaylistKey from './AddToPlaylistKey';
import { useAuth } from './AuthProvider';
import { useMusicLibrary } from './MusicLibraryProvider';
import SplitKey from './SplitKey';

/**
 * Small keys every MEDIA row shares (Luke's list, 2026-11-14).
 */

/**
 * OPEN, M8 ("open button much smaller in the top right of the thumbnail"): the way out to the platform is a small `↗` in
 * the picture's top right corner, on a square of the window's own colour so it reads over any picture. Its name for a
 * screen reader says where it goes. On a narrow screen the corner keeps a thumb's tap size as invisible room round it.
 * The picture box it sits in is `relative`.
 */
export function ThumbOpen({ href, label }: { href: string; label: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer nofollow"
      aria-label={label}
      title="Open in a new tab"
      className="group absolute right-0 top-0 flex items-start justify-end focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-bubble max-sm:min-h-tap max-sm:min-w-tap"
      data-thumb-open
    >
      <span className="block bg-paper px-0.5 text-label leading-none text-accent-ink group-hover:bg-accent-ink group-hover:text-paper group-active:bg-bubble group-active:text-ink-plate">
        ↗
      </span>
    </a>
  );
}

/**
 * M9 ("replace +letter with another dual button of +letter/playlist"): `[ + LETTER │ PLAYLIST ]`, one key of two halves.
 * The PLAYLIST half is offered only for what a playlist can hold today (a thing with a `trackId`: what the music bar plays),
 * through the one helper the song menu also uses (app/lib/audio/playlist-adding.ts); otherwise the key is `[ + LETTER ]`.
 * Accounts only, as both are saved to one.
 */
export function LetterPlaylistKey({ letter, playlist }: { letter: LetterThing; playlist: PlaylistThing | null }) {
  const { user, status } = useAuth();
  const library = useMusicLibrary();
  if (user === null || status !== 'signed-in') return null;
  const second = playlist !== null && library.canWrite ? playlist : null;
  return (
    <SplitKey
      label={`Add "${letter.title}" to a letter or a playlist`}
      first={{ words: '+ LETTER', draw: (className, text) => <AddToLetterKey thing={letter} className={className} label={text} /> }}
      second={second === null ? null : { words: 'PLAYLIST', draw: (className, text) => <AddToPlaylistKey thing={second} className={className} label={text} /> }}
    />
  );
}
