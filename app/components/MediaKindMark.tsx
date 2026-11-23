import type { CSSProperties } from 'react';
import type { WebItem } from '../lib/web/types';
import { artSlot } from '../lib/ui/art/slots';
import { artOnDisk } from '../lib/ui/art/on-disk';

/** What a MEDIA result is, for the mark that stands where its picture would be. */
export type MediaMarkKind = 'video' | 'audio' | 'image' | 'text' | 'film' | 'live' | 'other';

/** The characters (Luke, 2026-11-23: "Do a"): letters of the site's own face until his drawing of a kind is filed. */
const MARKS: Record<MediaMarkKind, { glyph: string; name: string }> = {
  video: { glyph: '▶', name: 'Video' },
  audio: { glyph: '♪', name: 'Audio' },
  image: { glyph: '▦', name: 'Picture' },
  text: { glyph: '¶', name: 'Text' },
  film: { glyph: '▣', name: 'Film or show' },
  live: { glyph: '●', name: 'Live' },
  other: { glyph: '◆', name: 'Other' },
};

/** A live before anything else, then a film or a show (a KINO or server title), then the kind its platform says. */
export function mediaMarkKind(item: Pick<WebItem, 'kind' | 'live' | 'media'>): MediaMarkKind {
  if (item.live === true) return 'live';
  if (item.media?.type === 'movie' || item.media?.type === 'tv') return 'film';
  return item.kind;
}

/** Luke's drawing: 24x18 pixels, one colour on clear, shown in whole pixels at the size the box has room for. */
const DRAWN_W = 24;
const DRAWN_H = 18;
const SIZES = {
  /** A compact row's box, 48x36. */
  tiny: { zoom: 1, text: 'text-headline' },
  /** 64x48, the Tag Station's lists. */
  small: { zoom: 2, text: 'text-4xl' },
  /** 96x72, a row's box, and a poster's 96x144. */
  row: { zoom: 3, text: 'text-5xl' },
  /** A card's picture, 192 wide or more. */
  card: { zoom: 5, text: 'text-5xl' },
} as const;
export type MediaMarkSize = keyof typeof SIZES;

/**
 * The mark of what a MEDIA result is, in the place of the picture it has not got (Luke, 2026-11-23: "For results in the media
 * tab that have no image, we need an icon which represents the type of media it is, in glowy pixel art style similar to the
 * letters"). As with his envelope, the drawing is a mask: its pixels take the theme's accent ink and glow in it, at rest too.
 * Until a kind's drawing is in `assets/media-kinds/` the kind's character stands there the same way; the build says which are
 * drawn (`artOnDisk`), so a missing one is never asked for.
 */
export default function MediaKindMark({ kind, size = 'row' }: { kind: MediaMarkKind; size?: MediaMarkSize }) {
  const { glyph, name } = MARKS[kind];
  const { zoom, text } = SIZES[size];
  const src = `/${(artSlot('media-kind')?.path ?? 'assets/media-kinds/{code}.png').replace('{code}', kind)}`;
  const drawn = artOnDisk(src);
  const drawing: CSSProperties = { width: DRAWN_W * zoom, height: DRAWN_H * zoom, maskImage: `url(${src})`, WebkitMaskImage: `url(${src})` };

  return (
    <span role="img" aria-label={name} title={`${name}, no picture`} className="media-kind-mark flex h-full w-full items-center justify-center text-accent-ink" data-media-mark={kind} data-media-mark-drawn={drawn ? 'yes' : 'no'}>
      {drawn ? (
        <span aria-hidden="true" className="media-kind-drawing block" style={drawing} />
      ) : (
        <span aria-hidden="true" className={`${text} font-bold leading-none`}>
          {glyph}
        </span>
      )}
    </span>
  );
}
