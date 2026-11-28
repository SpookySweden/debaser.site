'use client';

import Link from 'next/link';
import { madeHeading, thingsShown, type MadeThing } from '../lib/forum/made';
import { useMadeThings } from '../lib/forum/made-things';
import { catalogueTrack } from '../lib/media/catalogue';
import { MADE_KINDS } from '../lib/settings/settings-rules';
import { useMusicPlayer } from './MusicPlayerProvider';
import { explain } from '../lib/ui/explain';

/**
 * A MADE row on the board (SPEC-forum-v3.md, M3A and M4A), drawn from the things themselves, never from the post: the way
 * `StreamRecord` draws a stream from its room. The `[ MADE ]` tag, the heading with its live count, and, opened, each thing
 * of the day with its picture or player.
 */

/** The row's tag, beside the title (M3A). */
export function MadeMarker() {
  return (
    <span className="shrink-0 border border-ink-plate bg-acid px-1 text-label font-bold text-ink-plate" data-made-tag>
      [ MADE ]
    </span>
  );
}

/** `SWEDEN MADE 3 THINGS TODAY`, the count read live (M4A). */
export function MadeTitle({ person, day, name, body }: { person: string; day: string; name: string; body: string }) {
  const things = useMadeThings(person, day);
  return <>{madeHeading(name, things === undefined ? null : thingsShown(things, body).length, day)}</>;
}

const kindLabel = (thing: MadeThing) => MADE_KINDS.find((one) => one.kind === thing.kind)?.label.replace(/S$/, '') ?? 'THING';

/** The day's things, newest first, each a link to where it lives. */
export default function MadeRecord({ person, day, body }: { person: string; day: string; body: string }) {
  const read = useMadeThings(person, day);
  // Only the kinds whose switch the maker left on (M1A): their tab writes those into the row (`madeBody`).
  const things = read === undefined ? undefined : thingsShown(read, body);
  if (things === undefined) return <p className="text-label font-bold text-ink">READING WHAT WAS MADE...</p>;
  if (things.length === 0) return <p className="text-label font-bold text-ink">NOTHING FROM THIS DAY IS STILL UP.</p>;

  return (
    <ul className="flex flex-col gap-2" data-made-record={`${person}:${day}`} aria-label="What was made">
      {things.map((thing) => (
        <MadeLine key={`${thing.kind}:${thing.id}`} thing={thing} />
      ))}
    </ul>
  );
}

function MadeLine({ thing }: { thing: MadeThing }) {
  const player = useMusicPlayer();
  return (
    <li className="flex flex-col gap-1 text-label text-ink" data-made-thing={thing.kind}>
      <p className="flex flex-wrap items-center gap-2">
        <span className="font-bold">{kindLabel(thing)}:</span>
        {/* Third-party-free, but still somebody's words: plain text, never HTML. */}
        <Link href={thing.href} className="underline">
          {thing.title}
        </Link>
        {thing.track === undefined ? null : (
          <button
            type="button"
            className="key px-1 text-label"
            onClick={() => {
              const track = catalogueTrack(thing.track as NonNullable<MadeThing['track']>, player.queue);
              player.play(track, { origin: 'shelf', href: thing.href, where: 'THE BOARD' });
            }}
            {...explain('Plays the track made with this post in the music player.', 'To hear it without leaving the board.')}
          >
            [ ▶ PLAY ]
          </button>
        )}
      </p>
      {thing.picture === undefined ? null : (
        // A picture the site already holds (the art shelf's drawing, the catalogue's image): shown, never copied.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={thing.picture} alt={thing.title} loading="lazy" className="aspect-video w-full max-w-sm frame bg-paper object-contain" />
      )}
    </li>
  );
}
