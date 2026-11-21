'use client';

import { useState, type ReactNode, type Ref } from 'react';
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
 * DETAILS (MEDIADETAILS, Luke 2026-11-20: "only visible with an "i" icon on the top right of a thumbnail replacing the go to
 * arrow. the i icon shows a pop up window with video details, recommendation details, description, go to etc."): a small `i`
 * in the picture's top right, on a square of the window's own colour as OPEN's `↗` was, in the site's own face (a plain
 * letter every reader has, where ⓘ would come from whatever symbol font a system happens to carry). The press opens the
 * row's DETAILS window; the window's GO TO is the way out to the platform now. Its box is a full 24px each way (`min-h-hit`), the
 * square sitting in that box's top right, so it is easy to press without covering more of the picture.
 */
export function ThumbInfo({ label, open, onPress, ref }: { label: string; open: boolean; onPress: () => void; ref?: Ref<HTMLButtonElement> }) {
  return (
    <button
      ref={ref}
      type="button"
      onClick={onPress}
      aria-haspopup="dialog"
      aria-expanded={open}
      aria-label={label}
      title="Details"
      className="group absolute right-0 top-0 flex min-h-hit min-w-hit cursor-pointer items-start justify-end focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-bubble max-sm:min-h-tap max-sm:min-w-tap"
      data-thumb-info
    >
      <span className="block bg-paper px-1 py-0.5 text-label font-strong leading-none text-accent-ink group-hover:bg-accent-ink group-hover:text-paper group-active:bg-bubble group-active:text-ink-plate">
        i
      </span>
    </button>
  );
}

/**
 * M9 ("replace +letter with another dual button of +letter/playlist"): `[ + LETTER │ PLAYLIST ]`, one key of two halves.
 * The PLAYLIST half is offered only for what a playlist can hold today (a thing with a `trackId`: what the music bar plays),
 * through the one helper the song menu also uses (app/lib/audio/playlist-adding.ts); otherwise the key is `[ + LETTER ]`.
 * Accounts only, as both are saved to one.
 */
/**
 * `apart` (MEDIA's GRID cards, MEDIACARD, Luke 2026-11-17: "significantly neater"): the two as keys of their own,
 * `[ + LETTER ]` and `[ + PLAYLIST ]`, each on its own line in a card's opened area, because the joined key (21 letters) is
 * wider than a card about 160px wide and would break inside its brackets.
 */
export function LetterPlaylistKey({ letter, playlist, apart = false }: { letter: LetterThing; playlist: PlaylistThing | null; apart?: boolean }) {
  const { user, status } = useAuth();
  const library = useMusicLibrary();
  if (user === null || status !== 'signed-in') return null;
  const second = playlist !== null && library.canWrite ? playlist : null;
  if (apart) {
    return (
      <>
        <AddToLetterKey thing={letter} label="[ + LETTER ]" />
        {second === null ? null : <AddToPlaylistKey thing={second} label="[ + PLAYLIST ]" />}
      </>
    );
  }
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
/**
 * `inKey` (MEDIA's GRID cards, Luke 2026-11-17): the arrow is drawn as the last part of the row's PLAY / QUEUE key, `▸ ]`
 * with no side padding, handed to `inKey` to place (SplitKey's `end`), so a narrow card keeps them on one line.
 */
export function MoreKeys({ title, unfold = 'right', inKey, children }: { title: string; unfold?: 'left' | 'right'; inKey?: (arrow: ReactNode) => ReactNode; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const glyph = (unfold === 'right') === open ? '◂' : '▸';
  const arrow = (
    <button
      type="button"
      onClick={() => setOpen(!open)}
      aria-expanded={open}
      aria-label={open ? `Fewer options for "${title}"` : `More options for "${title}"`}
      title={open ? 'Fewer options' : 'More options'}
      className={inKey ? PLATE_IN_KEY : PLATE}
      data-more-keys={open ? 'open' : 'shut'}
    >
      {inKey ? `${glyph} ]` : `[ ${glyph} ]`}
    </button>
  );
  return (
    <>
      {open && unfold === 'left' ? children : null}
      {inKey ? inKey(arrow) : arrow}
      {open && unfold === 'right' ? children : null}
    </>
  );
}

/**
 * The arrow of a MEDIA result (MEDIACARD, Luke 2026-11-17: "the media stuff needs to be significantly neater, with the source
 * also only showing on expansion"): the row keeps whether it is open, and draws the rest as an area of its own under the
 * keys (the source, the licence, then the other keys), so the arrow points down, `▾`, and up, `▴`, once it has opened.
 * `inKey` as for MoreKeys: GRID draws it as the last part of the PLAY / QUEUE key, `▾ ]`.
 */
export function MoreArrow({ title, open, onToggle, controls, inKey }: { title: string; open: boolean; onToggle: () => void; controls: string; inKey?: (arrow: ReactNode) => ReactNode }) {
  const glyph = open ? '▴' : '▾';
  const arrow = (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      aria-controls={open ? controls : undefined}
      aria-label={open ? `Fewer options for "${title}"` : `More options for "${title}"`}
      title={open ? 'Fewer options' : 'More options'}
      className={inKey ? PLATE_IN_KEY : PLATE}
      data-more-keys={open ? 'open' : 'shut'}
    >
      {inKey ? `${glyph} ]` : `[ ${glyph} ]`}
    </button>
  );
  return <>{inKey ? inKey(arrow) : arrow}</>;
}

/** The arrow as the last part of a key: `PLATE` with no side padding (the brackets are the key's own). */
const PLATE_IN_KEY = PLATE.replace(/(^|\s)(?:max-sm:)?px-1(?=\s|$)/g, '$1').replace(/\s+/g, ' ').trim();
