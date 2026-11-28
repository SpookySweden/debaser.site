'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { comicPanelAnchor } from '../../lib/comic/forum';
import { getComicRepository } from '../../lib/comic/repository';
import { chapterPages, chapterPath, COMIC_HOME, formatPlace, nextChapter, pageAnchor } from '../../lib/comic/rules';
import type { ComicPage, ComicPanel, LoreLink } from '../../lib/comic/types';
import { useComic } from '../../lib/comic/use-comic';
import { writePlace } from '../../lib/comic/place';
import { LINK_PIXEL, PLATE, PLATE_LINK, PLATE_PRESSED, TITLE_BAR } from '../../lib/ui/controls';
import CommentPopout from '../CommentPopout';
import { useForum } from '../ForumProvider';
import ComicFollowKey from './ComicFollowKey';
import ComicPageImage from './ComicPageImage';
import ComicZoom from './ComicZoom';
import { explain } from '../../lib/ui/explain';

const COMMENTS_KEY = 'debaser.site.comic.comments';

const switchListeners = new Set<() => void>();

function readCommentsSwitch(): boolean {
  try {
    return window.localStorage.getItem(COMMENTS_KEY) === '1';
  } catch {
    return false;
  }
}

function subscribeCommentsSwitch(listener: () => void): () => void {
  switchListeners.add(listener);
  return () => void switchListeners.delete(listener);
}

function writeCommentsSwitch(on: boolean): void {
  try {
    window.localStorage.setItem(COMMENTS_KEY, on ? '1' : '0');
  } catch {
    // Kept for this visit only: the store below still changes.
  }
  memoryOn = on;
  for (const listener of switchListeners) listener();
}

/** The switch's value where storage throws (a private window). */
let memoryOn: boolean | null = null;

type Selected = { panel: ComicPanel; page: ComicPage; pageNumber: number; panelNumber: number };

/**
 * A chapter of the comic (`/comic/<chapter>`, `/comic/<chapter>/<page>`; SPEC-comic.md, Q5): one column of pages, top to
 * bottom, as wide as the window allows. A spread fills the column's width. `[ COMMENTS ]` lights the panels that have
 * comments or lore links and makes every panel a press; pressing one opens its pane beside the column (WHO, and its board
 * thread). Where the reader is gets kept, for `[ CONTINUE ]` on the contents page.
 */
export default function ComicChapter({ chapterNumber, pageNumber }: { chapterNumber: number; pageNumber: number | null }) {
  const { contents, admin } = useComic();
  const search = useSearchParams();
  const forum = useForum();
  const [loadedPanels, setPanels] = useState<ComicPanel[] | null>(null);
  const panels = useMemo(() => loadedPanels ?? [], [loadedPanels]);
  const [tags, setTags] = useState<Record<string, LoreLink[]>>({});
  const storedOn = useSyncExternalStore(subscribeCommentsSwitch, () => memoryOn ?? readCommentsSwitch(), () => false);
  const [picked, setPicked] = useState<Selected | null>(null);
  const [linkDismissed, setLinkDismissed] = useState(false);
  const [zoomed, setZoomed] = useState<ComicPage | null>(null);
  const scrolled = useRef(false);

  const chapter = contents?.chapters.find((each) => each.number === chapterNumber) ?? null;
  const volume = chapter ? (contents?.volumes.find((each) => each.id === chapter.volumeId) ?? null) : null;
  const pages = useMemo(() => (contents && chapter ? chapterPages(contents, chapter.id) : []), [contents, chapter]);
  const pageIds = useMemo(() => pages.map((page) => page.id), [pages]);
  const next = contents && chapter ? nextChapter(contents, chapter.number) : null;

  useEffect(() => {
    if (pageIds.length === 0) return;
    let live = true;
    const repository = getComicRepository();
    void repository.panels(pageIds).then(async (found) => {
      if (!live) return;
      setPanels(found);
      const links = await repository.tags(found.map((panel) => panel.id));
      if (live) setTags(links);
    });
    return () => {
      live = false;
    };
  }, [pageIds]);

  // Opened at a panel (`?panel=<id>`, a board thread's link): that panel's pane is open until the reader closes or changes it.
  const panelParam = search.get('panel');
  const linked = useMemo<Selected | null>(() => {
    const panel = panelParam ? panels.find((each) => each.id === panelParam) : undefined;
    const index = panel ? pages.findIndex((page) => page.id === panel.pageId) : -1;
    if (!panel || index < 0) return null;
    const ofPage = panels.filter((each) => each.pageId === panel.pageId);
    return { panel, page: pages[index], pageNumber: index + 1, panelNumber: ofPage.findIndex((each) => each.id === panel.id) + 1 };
  }, [panelParam, panels, pages]);
  const selected = picked ?? (linkDismissed ? null : linked);
  const commentsOn = storedOn || selected !== null;
  const setSelected = useCallback((next: Selected | null) => {
    setPicked(next);
    setLinkDismissed(true);
  }, []);

  // Opened at a page (`/comic/3/12`) or a panel: scroll there once.
  useEffect(() => {
    if (scrolled.current || pages.length === 0) return;
    if (panelParam && linked === null && loadedPanels === null) return;
    scrolled.current = true;
    const target = linked ? linked.pageNumber : (pageNumber ?? 1);
    if (target > 1) document.getElementById(pageAnchor(target))?.scrollIntoView({ block: 'start' });
  }, [pages, loadedPanels, pageNumber, panelParam, linked]);

  // Keep where the reader is: the page nearest the top of the window.
  useEffect(() => {
    if (!chapter || pages.length === 0) return;
    let timer: number | undefined;
    const observer = new IntersectionObserver(
      (entries) => {
        const top = entries.filter((entry) => entry.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (!top) return;
        const num = Number((top.target as HTMLElement).dataset.pageNumber);
        window.clearTimeout(timer);
        timer = window.setTimeout(() => writePlace(formatPlace(chapter.number, num)), 1200);
      },
      { rootMargin: '0px 0px -60% 0px' },
    );
    for (const element of document.querySelectorAll('[data-page-number]')) observer.observe(element);
    return () => {
      window.clearTimeout(timer);
      observer.disconnect();
    };
  }, [chapter, pages]);

  const toggleComments = useCallback(() => {
    if (commentsOn) setSelected(null);
    writeCommentsSwitch(!commentsOn);
  }, [commentsOn, setSelected]);

  if (contents === null) return <p className="p-4 text-label text-ink">LOADING…</p>;
  if (chapter === null || pages.length === 0) {
    return (
      <div className="flex flex-col gap-2 p-4">
        <p className="text-label text-ink">THIS CHAPTER ISN&apos;T OUT YET.</p>
        <Link href={COMIC_HOME} className={PLATE_LINK} {...explain('Goes back to the comic’s contents page.', 'This chapter has nothing released to read, so pick another one there.')}>
          [ CONTENTS ]
        </Link>
      </div>
    );
  }

  const heading = `${chapter.title.length > 0 ? `CHAPTER ${chapter.number}: ${chapter.title}` : `CHAPTER ${chapter.number}`}`;
  const anchorFor = (choice: Selected) =>
    comicPanelAnchor({ panelId: choice.panel.id, chapterNumber: chapter.number, pageNumber: choice.pageNumber, panelNumber: choice.panelNumber });

  return (
    <div className="flex flex-col gap-2 p-2 sm:p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Link href={COMIC_HOME} className={PLATE_LINK} {...explain('Goes back to the comic’s contents page, with every volume and chapter.', 'For choosing another chapter.')}>
          [ CONTENTS ]
        </Link>
        <h2 className={`${TITLE_BAR} min-w-0 flex-1`}>
          {volume ? <span className="sr-only">{`VOLUME ${volume.number}, `}</span> : null}
          {heading}
        </h2>
        <button
          type="button"
          aria-pressed={commentsOn}
          onClick={toggleComments}
          className={commentsOn ? PLATE_PRESSED : PLATE}
          {...explain(
            commentsOn ? 'Turns the comments on the panels off and closes the panel pane.' : 'Turns on the comments on the panels: every panel can be pressed, and the ones with comments or lore light up.',
            'For reading what people said about one panel, or seeing who is in it. The choice is kept in this browser.',
          )}
        >
          [ COMMENTS ]
        </button>
      </div>

      <div className="flex items-start gap-3">
        <ol className="mx-auto flex w-full max-w-4xl flex-col">
          {pages.map((page, index) => {
            const num = index + 1;
            const label = `CHAPTER ${chapter.number}, PAGE ${num}`;
            const ofPage = panels.filter((panel) => panel.pageId === page.id);
            return (
              <li key={page.id} id={pageAnchor(num)} data-page-number={num} className="scroll-mt-2">
                <div className="relative">
                  <ComicPageImage page={page} label={label} />
                  {commentsOn
                    ? ofPage.map((panel, panelIndex) => {
                        const choice: Selected = { panel, page, pageNumber: num, panelNumber: panelIndex + 1 };
                        const lit = (tags[panel.id]?.length ?? 0) > 0 || forum.commentCountForAnchor(anchorFor(choice)) > 0;
                        const isOpen = selected?.panel.id === panel.id;
                        return (
                          <button
                            key={panel.id}
                            type="button"
                            aria-pressed={isOpen}
                            aria-label={`PANEL ${panelIndex + 1}`}
                            onClick={() => setSelected(isOpen ? null : choice)}
                            {...explain(isOpen ? 'Closes the pane for this panel.' : 'Opens the pane for this panel: who is in it, and what people said about it.', 'A lit panel already has comments or lore links.')}
                            className={`comic-panel absolute cursor-pointer ${lit ? 'comic-panel-lit' : ''} ${isOpen ? 'comic-panel-open' : ''}`}
                            style={{ left: `${panel.x * 100}%`, top: `${panel.y * 100}%`, width: `${panel.w * 100}%`, height: `${panel.h * 100}%` }}
                          />
                        );
                      })
                    : null}
                </div>
                <div className="flex items-center gap-2 py-0.5">
                  <span className="text-label text-ink">{`P ${num}`}</span>
                  {admin && page.releasedAt === null ? <span className="bg-bubble-pale px-1 text-label text-ink-bar">PREVIEW: NOT RELEASED</span> : null}
                  <button type="button" onClick={() => setZoomed(page)} className={`${PLATE} ml-auto`} {...explain('Shows this page on its own, larger and sharper, so you can drag around it.', 'For small lettering and detail. Esc or CLOSE brings you back.')}>
                    [ ZOOM ]
                  </button>
                </div>
              </li>
            );
          })}
          <li className="flex flex-wrap items-center gap-2 py-3">
            {next ? (
              <Link href={chapterPath(next.number)} className={PLATE_LINK} {...explain('Goes to the next chapter, at its first page.', 'For carrying straight on from the end of this one.')}>
                [ NEXT CHAPTER ]
              </Link>
            ) : (
              <>
                <span className="text-label text-ink">THAT&apos;S ALL FOR NOW.</span>
                <ComicFollowKey />
              </>
            )}
          </li>
        </ol>

        {selected ? (
          <aside aria-label="PANEL" className="frame sticky top-2 hidden w-72 shrink-0 flex-col gap-2 bg-paper p-2 md:flex">
            <div className="flex items-center gap-1">
              <h3 className={`${TITLE_BAR} flex-1`}>{`CH ${chapter.number} · P ${selected.pageNumber} · PANEL ${selected.panelNumber}`}</h3>
              <button type="button" onClick={() => setSelected(null)} className={PLATE} aria-label="CLOSE THE PANEL" {...explain('Closes the pane beside the page.', 'For giving the page the room back.')}>
                [ × ]
              </button>
            </div>
            <PanelWho links={tags[selected.panel.id] ?? []} />
            <CommentPopout anchor={anchorFor(selected)} compact label="COMMENTS" />
          </aside>
        ) : null}
      </div>

      {selected ? (
        // Below the md width there is no room beside the column: the pane sits at the foot of the window.
        <div className="frame sticky bottom-0 flex flex-col gap-2 bg-paper p-2 md:hidden">
          <div className="flex items-center gap-1">
            <h3 className={`${TITLE_BAR} flex-1`}>{`CH ${chapter.number} · P ${selected.pageNumber} · PANEL ${selected.panelNumber}`}</h3>
            <button type="button" onClick={() => setSelected(null)} className={PLATE} aria-label="CLOSE THE PANEL" {...explain('Closes the pane at the foot of the window.', 'For giving the page the room back.')}>
              [ × ]
            </button>
          </div>
          <PanelWho links={tags[selected.panel.id] ?? []} />
          <CommentPopout anchor={anchorFor(selected)} compact label="COMMENTS" />
        </div>
      ) : null}

      {zoomed ? (
        <ComicZoom page={zoomed} label={`CHAPTER ${chapter.number}, PAGE ${pages.indexOf(zoomed) + 1}`} onClose={() => setZoomed(null)} />
      ) : null}
    </div>
  );
}

/** WHO: the lore pages Luke tagged on this panel, characters first. Nothing when none. */
function PanelWho({ links }: { links: LoreLink[] }) {
  if (links.length === 0) return null;
  return (
    <div className="flex flex-col gap-1">
      <span className="text-label text-ink">WHO</span>
      <ul className="flex flex-col gap-0.5">
        {links.map((link) => (
          <li key={link.docId}>
            <Link href={`/lore/${link.slug}`} className={`${LINK_PIXEL} text-label text-ink`}>
              {link.title}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
