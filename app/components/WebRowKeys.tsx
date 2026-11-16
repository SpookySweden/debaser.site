'use client';

import { useState, type ReactNode } from 'react';
import type { PlaylistThing } from '../lib/audio/playlist-adding';
import { PLATE } from '../lib/ui/controls';
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

/**
 * The arrow that keeps a MEDIA row to its main keys (Luke, 2026-11-16: "only play and queue, with an arrow on the same row
 * beside them that reveals the rest of the options"). Every result has it: a MEDIA row after PLAY / + QUEUE, a KINO or
 * friend's-server card after its WATCH keys. A press unfolds the rest on the same line; each row starts folded.
 *
 * The arrow stays under the pointer when pressed: in a row whose keys hug the right edge (`unfold="left"`) the rest
 * unfolds before it, otherwise after it. It points the way they come out, and back once they have.
 */
export function MoreKeys({ title, unfold = 'right', children }: { title: string; unfold?: 'left' | 'right'; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const glyph = (unfold === 'right') === open ? '◂' : '▸';
  const arrow = (
    <button
      type="button"
      onClick={() => setOpen(!open)}
      aria-expanded={open}
      aria-label={open ? `Fewer options for "${title}"` : `More options for "${title}"`}
      title={open ? 'Fewer options' : 'More options'}
      className={PLATE}
      data-more-keys={open ? 'open' : 'shut'}
    >
      {`[ ${glyph} ]`}
    </button>
  );
  return (
    <>
      {open && unfold === 'left' ? children : null}
      {arrow}
      {open && unfold === 'right' ? children : null}
    </>
  );
}
