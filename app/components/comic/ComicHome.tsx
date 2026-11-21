'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { getComicRepository } from '../../lib/comic/repository';
import { chapterPath, chaptersOfVolume, coverOf, COMIC_STUDIO, pageNumber, pagePath, parsePlace, volumesInOrder } from '../../lib/comic/rules';
import { useComic } from '../../lib/comic/use-comic';
import { readPlace, subscribePlace } from '../../lib/comic/place';
import { PLATE_LINK, TITLE_BAR } from '../../lib/ui/controls';
import ComicFollowKey from './ComicFollowKey';
import ComicPageImage from './ComicPageImage';

/**
 * COMIC's contents (`/comic`, SPEC-comic.md): each volume a title line, its chapters under it with their covers and titles.
 * `[ CONTINUE ]` brings a returning reader back to where they stopped; `[ FOLLOW ]` is the "new pages" alert; the house
 * account also gets `[ STUDIO ]`. Open to visitors; what they see is only what is released.
 */
export default function ComicHome() {
  const { contents, error, admin } = useComic();
  const placeRaw = useSyncExternalStore(subscribePlace, readPlace, () => null);
  const place = parsePlace(placeRaw);
  const search = useSearchParams();
  const router = useRouter();
  const panelId = search.get('panel');
  const [lost, setLost] = useState(false);

  // A board thread knows only its panel's id (`/comic?panel=<id>`): find the panel's page and go there.
  useEffect(() => {
    if (panelId === null || contents === null) return;
    let live = true;
    void getComicRepository()
      .findPanel(panelId)
      .then((panel) => {
        if (!live) return;
        const page = panel ? contents.pages.find((each) => each.id === panel.pageId) : undefined;
        const chapter = page ? contents.chapters.find((each) => each.id === page.chapterId) : undefined;
        if (!page || !chapter) {
          setLost(true);
          return;
        }
        router.replace(pagePath(chapter.number, pageNumber(contents, page), panelId));
      });
    return () => {
      live = false;
    };
  }, [panelId, contents, router]);

  if (contents === null) return <p className="p-4 text-label text-ink">LOADING…</p>;

  const volumes = volumesInOrder(contents);
  const placeReadable = place !== null && contents.chapters.some((chapter) => chapter.number === place.chapter);

  return (
    <div className="flex flex-col gap-4 p-3 sm:p-4">
      <div className="flex flex-wrap items-center gap-2">
        {placeReadable && place ? (
          <Link href={pagePath(place.chapter, place.page)} className={PLATE_LINK}>
            {`[ CONTINUE: CH ${place.chapter} P ${place.page} ]`}
          </Link>
        ) : null}
        <ComicFollowKey />
        {admin ? (
          <Link href={COMIC_STUDIO} className={`${PLATE_LINK} ml-auto`}>
            [ STUDIO ]
          </Link>
        ) : null}
      </div>

      {error ? <p className="w-fit bg-bubble-pale px-1 text-label text-ink-bar">{error}</p> : null}
      {lost ? <p className="w-fit bg-bubble-pale px-1 text-label text-ink-bar">THAT PANEL ISN&apos;T THERE ANY MORE.</p> : null}

      {volumes.length === 0 ? <p className="text-label text-ink">NOTHING YET.</p> : null}

      {volumes.map((volume) => {
        const chapters = chaptersOfVolume(contents, volume.id);
        return (
          <section key={volume.id} aria-labelledby={`volume-${volume.id}`} className="flex flex-col gap-2">
            <h2 id={`volume-${volume.id}`} className={TITLE_BAR}>
              {volume.title.length > 0 ? `VOLUME ${volume.number}: ${volume.title}` : `VOLUME ${volume.number}`}
            </h2>
            {chapters.length === 0 ? <p className="text-label text-ink">NOTHING YET.</p> : null}
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
              {chapters.map((chapter) => {
                const cover = coverOf(contents, chapter);
                const released = contents.pages.some((page) => page.chapterId === chapter.id && page.releasedAt !== null);
                return (
                  <li key={chapter.id}>
                    <Link href={chapterPath(chapter.number)} className="group flex flex-col gap-1 text-ink">
                      {cover ? (
                        <ComicPageImage page={cover} label={`CHAPTER ${chapter.number}`} className="frame overflow-hidden" />
                      ) : (
                        <span className="sprite-slot block aspect-2/3 w-full" aria-hidden />
                      )}
                      <span className="text-label text-accent-ink group-hover:underline">{`CHAPTER ${chapter.number}`}</span>
                      {chapter.title.length > 0 ? <span className="text-label">{chapter.title}</span> : null}
                      {!released ? <span className="w-fit bg-bubble-pale px-1 text-label text-ink-bar">NOT RELEASED</span> : null}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}

      {admin && volumes.length === 0 ? (
        <Link href={COMIC_STUDIO} className={PLATE_LINK}>
          [ OPEN THE STUDIO ]
        </Link>
      ) : null}
    </div>
  );
}
